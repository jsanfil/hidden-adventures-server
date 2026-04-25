import type { FastifyInstance } from "fastify";

import { adventureRoutes } from "../features/adventures/routes.js";
import { authPlugin } from "../features/auth/plugin.js";
import { authRoutes } from "../features/auth/routes.js";
import { discoverRoutes } from "../features/discover/routes.js";
import { mediaRoutes } from "../features/media/routes.js";
import { profileRoutes } from "../features/profiles/routes.js";
import { sidekickRoutes } from "../features/sidekicks/routes.js";
import { healthRoutes } from "./health.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(async (protectedApp) => {
    await authPlugin(protectedApp);
    await protectedApp.register(authRoutes);
    await protectedApp.register(mediaRoutes);
    await protectedApp.register(adventureRoutes);
    await protectedApp.register(discoverRoutes);
    await protectedApp.register(profileRoutes);
    await protectedApp.register(sidekickRoutes);
  });
}
