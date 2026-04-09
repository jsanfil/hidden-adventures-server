import { describe, expect, it } from "vitest";

import { createLoggerOptions } from "../src/config/logger.js";

describe("createLoggerOptions", () => {
  it("enables pino-pretty for qa and test runtime modes on a terminal", () => {
    const options = createLoggerOptions({
      level: "info",
      runtimeMode: "local_manual_qa",
      isTTY: true
    });

    expect(options).toMatchObject({
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "SYS:standard",
          singleLine: false
        }
      }
    });
  });

  it("keeps structured logging when the process is not interactive", () => {
    const options = createLoggerOptions({
      level: "info",
      runtimeMode: "local_automation_test_core",
      isTTY: false
    });

    expect(options).toEqual({
      level: "info"
    });
  });

  it("keeps structured logging in production", () => {
    const options = createLoggerOptions({
      level: "info",
      runtimeMode: "production",
      isTTY: true
    });

    expect(options).toEqual({
      level: "info"
    });
  });
});
