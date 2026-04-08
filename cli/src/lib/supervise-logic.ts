import type { PaperclipConfig } from "../config/schema.js";

export function buildHealthCheckUrl(config: PaperclipConfig): string {
  const envUrl = process.env.PAPERCLIP_API_URL?.trim();
  if (envUrl) {
    const base = envUrl.replace(/\/+$/, "");
    return `${base}/api/health`;
  }
  const host = config.server.host;
  const port = config.server.port;
  const connectHost =
    host === "0.0.0.0" || host === "::" || host === "[::]" ? "127.0.0.1" : host;
  return `http://${connectHost}:${port}/api/health`;
}

export function computeNextBackoffMs(
  initialMs: number,
  maxMs: number,
  restartAttempt: number,
): number {
  const exp = Math.min(maxMs, initialMs * 2 ** Math.max(0, restartAttempt));
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.1));
  return Math.min(maxMs, exp + jitter);
}

/** One step of consecutive /api/health failure counting (process may still be alive). */
export function nextHealthFailureState(
  consecutiveFailures: number,
  checkOk: boolean,
  threshold: number,
): { consecutiveFailures: number; shouldRestart: boolean } {
  if (checkOk) {
    return { consecutiveFailures: 0, shouldRestart: false };
  }
  const next = consecutiveFailures + 1;
  return {
    consecutiveFailures: next,
    shouldRestart: next >= threshold,
  };
}
