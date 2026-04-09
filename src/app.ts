import Fastify from "fastify";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import { createLoggerOptions } from "./config/logger.js";
import { db } from "./db/client.js";
import { registerRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({
    logger: createLoggerOptions({
      level: env.LOG_LEVEL,
      runtimeMode: env.SERVER_RUNTIME_MODE
    })
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Invalid request.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    throw error;
  });

  app.addHook("onClose", async () => {
    await db.close();
  });

  await app.register(registerRoutes, { prefix: "/api" });

  app.get("/", async () => {
    return {
      service: "hidden-adventures-server",
      status: "ready"
    };
  });

  return app;
}
