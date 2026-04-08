#!/usr/bin/env node
/**
 * Apply migration SQL files with psql against embedded Postgres (from ~/.paperclip config).
 * Use after a logical restore when the journal says "up to date" but schema is behind (drift).
 *
 * Run from server directory:
 *   PAPERCLIP_CONFIG=~/.paperclip/instances/default/config.json node apply-migrations-sql.mjs ../packages/db/src/migrations/0047_overjoyed_groot.sql ...
 */
import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const configPath = process.env.PAPERCLIP_CONFIG?.trim()
  ? path.resolve(process.env.PAPERCLIP_CONFIG.trim().replace(/^~(?=\/)/, `${process.env.HOME}/`))
  : path.join(process.env.HOME ?? "", ".paperclip/instances/default/config.json");

const raw = readFileSync(configPath, "utf8");
const config = JSON.parse(raw);
const dataDir = config.database?.embeddedPostgresDataDir;
const port = config.database?.embeddedPostgresPort ?? 54329;
if (!dataDir || !existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.error("Missing embedded Postgres data dir in config:", dataDir);
  process.exit(1);
}

const files = process.argv.slice(2).filter(Boolean);
if (files.length === 0) {
  console.error("Pass one or more .sql migration file paths (relative to cwd or absolute).");
  process.exit(1);
}

const ep = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "paperclip",
  password: "paperclip",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
  onLog: (m) => process.stderr.write(String(m)),
  onError: (m) => process.stderr.write(String(m)),
});

await ep.start();
try {
  for (const file of files) {
    const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    console.error(`Applying ${abs} ...`);
    const r = spawnSync(
      "psql",
      ["-h", "127.0.0.1", "-p", String(port), "-U", "paperclip", "-d", "paperclip", "-v", "ON_ERROR_STOP=1", "-f", abs],
      { env: { ...process.env, PGPASSWORD: "paperclip" }, stdio: "inherit" },
    );
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
} finally {
  await ep.stop();
}
console.error("Done.");
