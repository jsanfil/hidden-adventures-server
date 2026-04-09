const prettyRuntimeModes = new Set([
  "local_manual_qa",
  "local_automation_test_core"
]);

type CreateLoggerOptionsArgs = {
  level: string;
  runtimeMode: string;
  isTTY?: boolean;
};

export function createLoggerOptions({
  level,
  runtimeMode,
  isTTY = process.stdout.isTTY ?? false
}: CreateLoggerOptionsArgs) {
  if (!isTTY || !prettyRuntimeModes.has(runtimeMode)) {
    return { level };
  }

  return {
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "SYS:standard",
        singleLine: false
      }
    }
  };
}
