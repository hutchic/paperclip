import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import pc from "picocolors";
import { doctor } from "./doctor.js";
import { loadPaperclipEnvFile } from "../config/env.js";
import { configExists, readConfig, resolveConfigPath } from "../config/store.js";
import {
  describeLocalInstancePaths,
  resolvePaperclipHomeDir,
  resolvePaperclipInstanceId,
} from "../config/home.js";
import { resolveServerChildLaunch } from "../lib/server-child-launch.js";
import { buildHealthCheckUrl, computeNextBackoffMs, nextHealthFailureState } from "../lib/supervise-logic.js";

export interface SuperviseCommandOptions {
  config?: string;
  instance?: string;
  repair?: boolean;
  yes?: boolean;
  pollIntervalMs: number;
  healthFailThreshold: number;
  healthTimeoutMs: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  json: boolean;
}

type RestartReason = "crash" | "health_degraded" | "bind_error";

function appendSuperviseLog(logFile: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${line}\n`, "utf-8");
  } catch {
    /* best-effort */
  }
}

function emitEvent(
  opts: SuperviseCommandOptions,
  logFile: string,
  event: Record<string, unknown>,
): void {
  const line = JSON.stringify(event);
  appendSuperviseLog(logFile, line);
  if (opts.json) {
    console.log(line);
  }
}

function emitHuman(
  opts: SuperviseCommandOptions,
  logFile: string,
  humanLine: string,
  jsonPayload: Record<string, unknown>,
): void {
  appendSuperviseLog(logFile, JSON.stringify({ ...jsonPayload, human: humanLine }));
  if (opts.json) {
    console.log(JSON.stringify(jsonPayload));
  } else {
    console.error(humanLine);
  }
}

export async function superviseCommand(opts: SuperviseCommandOptions): Promise<void> {
  const instanceId = resolvePaperclipInstanceId(opts.instance);
  process.env.PAPERCLIP_INSTANCE_ID = instanceId;

  const homeDir = resolvePaperclipHomeDir();
  fs.mkdirSync(homeDir, { recursive: true });

  const paths = describeLocalInstancePaths(instanceId);
  fs.mkdirSync(paths.instanceRoot, { recursive: true });
  fs.mkdirSync(paths.logDir, { recursive: true });

  const logFile = path.join(paths.logDir, "supervise.log");
  const configPath = resolveConfigPath(opts.config);
  process.env.PAPERCLIP_CONFIG = configPath;
  loadPaperclipEnvFile(configPath);

  if (!opts.json) {
    console.error(
      pc.bgMagenta(pc.black(" paperclipai supervise ")) +
        " " +
        pc.dim(`instance=${paths.instanceId} config=${configPath}`),
    );
    console.error(pc.dim("Supervisor runs the API server as a child process and restarts on crash or failed /api/health."));
  }

  if (!configExists(configPath)) {
    console.error("No Paperclip config found. Run `paperclipai onboard` once, then retry `paperclipai supervise`.");
    process.exit(1);
  }

  const summary = await doctor({
    config: configPath,
    repair: opts.repair ?? true,
    yes: opts.yes ?? true,
  });

  if (summary.failed > 0) {
    console.error("Doctor found blocking issues. Not starting supervised server.");
    process.exit(1);
  }

  const config = readConfig(configPath);
  if (!config) {
    console.error(`No config found at ${configPath}.`);
    process.exit(1);
  }

  const healthUrl = buildHealthCheckUrl(config);
  const launch = resolveServerChildLaunch(import.meta.url);

  let supervisorShuttingDown = false;
  let child: ChildProcess | null = null;
  let healthTimer: NodeJS.Timeout | null = null;
  let restartAttempt = 0;
  let consecutiveHealthFailures = 0;
  /** When set, the next child exit is attributed to this reason (e.g. health kill). */
  let pendingExitReason: RestartReason | null = null;

  const stopHealthPoll = (): void => {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  };

  const runHealthPoll = (): void => {
    stopHealthPoll();
    healthTimer = setInterval(() => {
      void (async () => {
        if (!child || supervisorShuttingDown) return;
        let checkOk = false;
        try {
          const res = await fetch(healthUrl, {
            signal: AbortSignal.timeout(opts.healthTimeoutMs),
          });
          checkOk = res.ok;
        } catch {
          checkOk = false;
        }
        const healthStep = nextHealthFailureState(
          consecutiveHealthFailures,
          checkOk,
          opts.healthFailThreshold,
        );
        consecutiveHealthFailures = healthStep.consecutiveFailures;
        if (checkOk) {
          restartAttempt = 0;
        }
        if (healthStep.shouldRestart) {
          consecutiveHealthFailures = 0;
          pendingExitReason = "health_degraded";
          emitHuman(
            opts,
            logFile,
            pc.red("supervise: health check failed repeatedly; restarting server (reason=health_degraded)"),
            {
              type: "supervise_restart",
              reason: "health_degraded" as const,
              healthUrl,
              threshold: opts.healthFailThreshold,
            },
          );
          child?.kill("SIGTERM");
        }
      })();
    }, opts.pollIntervalMs);
    if (typeof healthTimer.unref === "function") {
      healthTimer.unref();
    }
  };

  const scheduleRestart = (reason: RestartReason, detail: Record<string, unknown>): void => {
    const backoffMs = computeNextBackoffMs(opts.backoffInitialMs, opts.backoffMaxMs, restartAttempt);
    restartAttempt++;
    emitEvent(opts, logFile, {
      type: "supervise_backoff",
      reason,
      backoffMs,
      restartAttempt,
      ...detail,
    });
    if (!opts.json) {
      console.error(
        pc.yellow(
          `supervise: scheduling restart (reason=${reason}, attempt=${restartAttempt}, backoff_ms=${backoffMs})`,
        ),
      );
    }
    setTimeout(() => {
      if (supervisorShuttingDown) return;
      void startChild();
    }, backoffMs).unref?.();
  };

  const startChild = async (): Promise<void> => {
    if (supervisorShuttingDown) return;
    stopHealthPoll();
    consecutiveHealthFailures = 0;

    emitEvent(opts, logFile, {
      type: "supervise_spawn",
      command: launch.command,
      args: launch.args,
    });

    const proc = spawn(launch.command, launch.args, {
      env: { ...process.env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child = proc;

    proc.on("error", (err) => {
      if (supervisorShuttingDown) return;
      emitHuman(
        opts,
        logFile,
        pc.red(`supervise: failed to spawn server process: ${err.message}`),
        { type: "supervise_spawn_error", error: err.message },
      );
      scheduleRestart("bind_error", { error: err.message });
    });

    proc.on("exit", (code, signal) => {
      child = null;
      stopHealthPoll();
      if (supervisorShuttingDown) return;

      const reason = pendingExitReason;
      pendingExitReason = null;

      if (reason === "health_degraded") {
        scheduleRestart("health_degraded", { signal: signal ?? undefined, exitCode: code });
        return;
      }

      const detail = { exitCode: code, signal: signal ?? undefined };
      emitHuman(
        opts,
        logFile,
        pc.yellow(
          `supervise: server exited (code=${code}, signal=${signal ?? "none"}); restarting (reason=crash)`,
        ),
        { type: "supervise_child_exit", ...detail },
      );
      scheduleRestart("crash", detail);
    });

    runHealthPoll();
  };

  const shutdown = (): void => {
    if (supervisorShuttingDown) return;
    supervisorShuttingDown = true;
    stopHealthPoll();
    emitEvent(opts, logFile, { type: "supervise_shutdown", signal: "shutdown" });
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  };

  process.once("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  await startChild();

  await new Promise<void>(() => {
    /* run until signal */
  });
}
