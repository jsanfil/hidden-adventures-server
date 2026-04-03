import { buildApp } from "./app.js";
import { env } from "./config/env.js";

async function main() {
  const app = await buildApp();

  try {
    app.log.info(
      {
        runtimeMode: env.SERVER_RUNTIME_MODE,
        authMode: env.AUTH_MODE,
        database: env.POSTGRES_DB
      },
      "Starting Hidden Adventures server."
    );

    await app.listen({
      host: "0.0.0.0",
      port: env.PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
