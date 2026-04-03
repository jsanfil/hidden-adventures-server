import { loadFixturePack, fixturePackSummary } from "../features/fixtures/manifest.js";

type CliOptions = {
  pack: string;
};

function parseArgs(argv: string[]): CliOptions {
  let pack = "test-core";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--pack") {
      pack = argv[index + 1] ?? pack;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { pack };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pack = await loadFixturePack(options.pack);
  console.log(
    JSON.stringify(
      {
        pack: pack.pack,
        targetDatabase: pack.targetDatabase,
        summary: fixturePackSummary(pack)
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error("Fixture validation failed.", error);
  process.exitCode = 1;
});
