import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "../config/env.js";
import { loadFixturePack } from "../features/fixtures/manifest.js";

type CliOptions = {
  pack: string;
};

function parseArgs(argv: string[]): CliOptions {
  let pack = "qa-rich";

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
  if (!env.S3_BUCKET) {
    throw new Error("S3_BUCKET is required for fixture media verification.");
  }

  const options = parseArgs(process.argv.slice(2));
  const pack = await loadFixturePack(options.pack);
  const client = new S3Client({ region: env.AWS_REGION });
  const missing: string[] = [];

  for (const asset of pack.mediaAssets) {
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: asset.storageKey
        })
      );
    } catch {
      missing.push(asset.storageKey);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing ${missing.length} fixture media object(s): ${missing.join(", ")}`);
  }

  console.log(
    JSON.stringify(
      {
        pack: pack.pack,
        bucket: env.S3_BUCKET,
        verified: pack.mediaAssets.length
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error("Fixture media verification failed.", error);
  process.exitCode = 1;
});
