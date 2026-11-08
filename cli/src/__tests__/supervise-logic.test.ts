import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildHealthCheckUrl,
  computeNextBackoffMs,
  nextHealthFailureState,
} from "../lib/supervise-logic.js";
import type { PaperclipConfig } from "../config/schema.js";

function serverOnlyConfig(host: string, port: number): PaperclipConfig {
  return {
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host,
      port,
      allowedHostnames: [],
      serveUi: true,
    },
  } as unknown as PaperclipConfig;
}

describe("buildHealthCheckUrl", () => {
  const originalApiUrl = process.env.PAPERCLIP_API_URL;

  beforeEach(() => {
    delete process.env.PAPERCLIP_API_URL;
  });

  afterEach(() => {
    if (originalApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = originalApiUrl;
  });

  it("uses PAPERCLIP_API_URL when set", () => {
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3102/";
    expect(buildHealthCheckUrl(serverOnlyConfig("127.0.0.1", 3100))).toBe("http://127.0.0.1:3102/api/health");
  });

  it("maps 0.0.0.0 bind to localhost for health checks", () => {
    expect(buildHealthCheckUrl(serverOnlyConfig("0.0.0.0", 3200))).toBe("http://127.0.0.1:3200/api/health");
  });
});

describe("nextHealthFailureState", () => {
  it("resets streak on success", () => {
    expect(nextHealthFailureState(2, true, 3)).toEqual({
      consecutiveFailures: 0,
      shouldRestart: false,
    });
  });

  it("counts failures and signals restart at threshold while checks are still failing", () => {
    expect(nextHealthFailureState(0, false, 3)).toEqual({
      consecutiveFailures: 1,
      shouldRestart: false,
    });
    expect(nextHealthFailureState(1, false, 3)).toEqual({
      consecutiveFailures: 2,
      shouldRestart: false,
    });
    expect(nextHealthFailureState(2, false, 3)).toEqual({
      consecutiveFailures: 3,
      shouldRestart: true,
    });
  });
});

describe("computeNextBackoffMs", () => {
  it("stays within initial and max bounds", () => {
    const initial = 1000;
    const max = 10000;
    for (let attempt = 0; attempt <= 12; attempt++) {
      const v = computeNextBackoffMs(initial, max, attempt);
      expect(v).toBeGreaterThanOrEqual(initial);
      expect(v).toBeLessThanOrEqual(max);
    }
  });
});
