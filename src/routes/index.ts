import type { FastifyInstance } from "fastify";

import { adventureRoutes } from "../features/adventures/routes.js";
import { profileRoutes } from "../features/profiles/routes.js";
import { healthRoutes } from "./health.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(adventureRoutes);
  await app.register(profileRoutes);
}
