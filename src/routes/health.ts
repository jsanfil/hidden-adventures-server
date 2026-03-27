import type { FastifyInstance } from "fastify";

import { db } from "../db/client.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    try {
      const database = await db.checkHealth();

      return {
        ok: true,
        checks: {
          database: {
            ok: true,
            latencyMs: database.latencyMs
          }
        },
        service: "hidden-adventures-server",
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      app.log.error({ err: error }, "database health check failed");

      return reply.code(503).send({
        ok: false,
        checks: {
          database: {
            ok: false
          }
        },
        service: "hidden-adventures-server",
        timestamp: new Date().toISOString()
      });
    }
  });
}
