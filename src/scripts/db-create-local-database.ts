import { createDatabaseIfMissing } from "./lib/local-db-admin.js";

async function main() {
  const created = await createDatabaseIfMissing();
  console.log(
    JSON.stringify(
      {
        database: process.env.POSTGRES_DB,
        created
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error("Local database creation failed.", error);
  process.exitCode = 1;
});
