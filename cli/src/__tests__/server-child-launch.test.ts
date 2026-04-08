import { describe, expect, it } from "vitest";
import { resolveServerChildLaunch } from "../lib/server-child-launch.js";

describe("resolveServerChildLaunch", () => {
  it("resolves a runnable server entry from this workspace", () => {
    const launch = resolveServerChildLaunch(import.meta.url);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args.length).toBeGreaterThanOrEqual(1);
  });
});
