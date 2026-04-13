import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { env } from "../config/env.js";

type CliOptions = {
  outputDir?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const composeFile = path.join(repoRoot, "docker-compose.yml");

export function resolveLocalBackupDir(
  overrideDir?: string,
  configuredDir = env.LOCAL_BACKUP_DIR,
  homeDir = process.env.HOME
): string {
  if (overrideDir) {
    return path.resolve(overrideDir);
  }

  if (configuredDir) {
    return path.resolve(configuredDir);
  }

  if (homeDir) {
    return path.join(homeDir, ".hidden-adventures", "backups", "postgres");
  }

  return path.resolve(repoRoot, "..", "hidden-adventures-backups", "postgres");
}

export function buildBackupFilePath(backupDir: string, date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return path.join(backupDir, `hidden-adventures-local-${timestamp}.dump`);
}

function parseArgs(argv: string[]): CliOptions {
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output-dir") {
      outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outputDir };
}

export async function createLocalPostgresBackup(options: CliOptions = {}): Promise<string> {
  const backupDir = resolveLocalBackupDir(options.outputDir);
  await mkdir(backupDir, { recursive: true });

  const outputPath = buildBackupFilePath(backupDir);
  const output = createWriteStream(outputPath);

  const args = [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "-U",
    env.POSTGRES_USER,
    "-d",
    env.POSTGRES_DB
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: repoRoot,
      env: process.env
    });

    let stderr = "";

    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      output.end();
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `pg_dump exited with code ${code ?? "unknown"}.`));
    });
  });

  return outputPath;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry ? path.resolve(entry) === __filename : false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Backing up Postgres database: ${env.POSTGRES_DB}`);
  const outputPath = await createLocalPostgresBackup(options);
  console.log(outputPath);
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    console.error("Local Postgres backup failed.", error);
    process.exitCode = 1;
  });
}
