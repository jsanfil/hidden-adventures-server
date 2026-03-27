import Fastify from "fastify";

import { env } from "./config/env.js";
import { db } from "./db/client.js";
import { registerRoutes } from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
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
