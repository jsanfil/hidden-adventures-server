import { resetDatabase } from "./lib/local-db-admin.js";

async function main() {
  await resetDatabase();
  console.log(
    JSON.stringify(
      {
        database: process.env.POSTGRES_DB,
        reset: true
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error("Local database reset failed.", error);
  process.exitCode = 1;
});
