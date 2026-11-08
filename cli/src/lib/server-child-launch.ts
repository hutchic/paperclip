import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export type ServerChildLaunch = {
  command: string;
  args: string[];
};

function findRepoRootContainingServerSrc(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    const serverSrc = path.join(dir, "server", "src", "index.ts");
    if (fs.existsSync(serverSrc)) {
      return dir;
    }
    const parent = path.resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveTsxCli(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot, "cli", "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Resolve how to spawn the Paperclip server as a separate process (supervisor use).
 * Prefers published `@paperclipai/server` dist; falls back to monorepo `server/src/index.ts` + tsx.
 */
export function resolveServerChildLaunch(importMetaUrl: string): ServerChildLaunch {
  const require = createRequire(importMetaUrl);
  try {
    const pkgJson = require.resolve("@paperclipai/server/package.json");
    const distIndex = path.join(path.dirname(pkgJson), "dist", "index.js");
    if (fs.existsSync(distIndex)) {
      return { command: process.execPath, args: [distIndex] };
    }
  } catch {
    /* use monorepo fallback */
  }

  const fromFile = findRepoRootContainingServerSrc(path.dirname(fileURLToPath(importMetaUrl)));
  const fromCwd = findRepoRootContainingServerSrc(process.cwd());
  const repoRoot = fromFile ?? fromCwd;
  if (repoRoot) {
    const devEntry = path.join(repoRoot, "server", "src", "index.ts");
    const tsx = resolveTsxCli(repoRoot);
    if (fs.existsSync(devEntry) && tsx) {
      return { command: process.execPath, args: [tsx, devEntry] };
    }
  }

  throw new Error(
    "Could not resolve Paperclip server entry for a child process. " +
      "Install a built @paperclipai/server package or run from the Paperclip repository with dev dependencies installed.",
  );
}
