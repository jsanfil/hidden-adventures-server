import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "../db/client.js";

const __filename = fileURLToPath(import.meta.url);

const PROFILE_KIND_TO_COLUMN = {
  profile_avatar: "avatar_media_asset_id",
  profile_cover: "cover_media_asset_id"
} as const;

type SupportedProfileKind = keyof typeof PROFILE_KIND_TO_COLUMN;
type ProfileColumn = (typeof PROFILE_KIND_TO_COLUMN)[SupportedProfileKind];

type NamespaceReportEntry = {
  mediaAssetId: string;
  kind: string;
  oldKey: string;
  newKey: string;
  status: string;
  reason?: string;
};

type NamespaceReport = {
  entries?: NamespaceReportEntry[];
};

type MissingProfileMediaSource = {
  mediaAssetId: string;
  kind: SupportedProfileKind;
  oldKey: string;
  profileColumn: ProfileColumn;
};

type LinkedProfileRow = {
  user_id: string;
  media_deleted_at: string | null;
};

export type CliOptions = {
  apply: boolean;
  reportPath: string;
};

export type CleanupEntryStatus =
  | "planned"
  | "cleared"
  | "already_deleted"
  | "skipped";

export type CleanupReportEntry = {
  mediaAssetId: string;
  kind: SupportedProfileKind;
  oldKey: string;
  profileUserId: string | null;
  profileColumn: ProfileColumn;
  status: CleanupEntryStatus;
  reason?: string;
};

export type CleanupReport = {
  apply: boolean;
  sourceReportPath: string;
  examined: number;
  eligible: number;
  clearedProfiles: number;
  softDeletedAssets: number;
  skipped: number;
  entries: CleanupReportEntry[];
};

function createEmptyReport(options: CliOptions): CleanupReport {
  return {
    apply: options.apply,
    sourceReportPath: path.resolve(process.cwd(), options.reportPath),
    examined: 0,
    eligible: 0,
    clearedProfiles: 0,
    softDeletedAssets: 0,
    skipped: 0,
    entries: []
  };
}

export function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let reportPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--report") {
      reportPath = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!reportPath) {
    throw new Error("Missing required --report <path> argument.");
  }

  return {
    apply,
    reportPath
  };
}

function isSupportedProfileKind(value: string): value is SupportedProfileKind {
  return value in PROFILE_KIND_TO_COLUMN;
}

export async function loadMissingProfileMediaEntries(
  reportPath: string
): Promise<MissingProfileMediaSource[]> {
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw) as NamespaceReport;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

  return entries
    .filter(
      (entry): entry is NamespaceReportEntry & { kind: SupportedProfileKind } =>
        entry.status === "missing_source" && isSupportedProfileKind(entry.kind)
    )
    .map((entry) => ({
      mediaAssetId: entry.mediaAssetId,
      kind: entry.kind,
      oldKey: entry.oldKey,
      profileColumn: PROFILE_KIND_TO_COLUMN[entry.kind]
    }));
}

async function findLinkedProfile(
  mediaAssetId: string,
  profileColumn: ProfileColumn
): Promise<LinkedProfileRow | null> {
  const result = await db.query<LinkedProfileRow>(
    `
      select
        profiles.user_id::text as user_id,
        media_assets.deleted_at::text as media_deleted_at
      from public.profiles profiles
      join public.media_assets media_assets
        on media_assets.id = $1::uuid
       and media_assets.kind = $2
      where profiles.${profileColumn} = $1::uuid
      limit 1
    `,
    [mediaAssetId, profileColumn === "avatar_media_asset_id" ? "profile_avatar" : "profile_cover"]
  );

  return result.rows[0] ?? null;
}

async function clearProfileReference(
  userId: string,
  mediaAssetId: string,
  profileColumn: ProfileColumn
): Promise<number> {
  const result = await db.query(
    `
      update public.profiles
      set ${profileColumn} = null
      where user_id = $1::uuid
        and ${profileColumn} = $2::uuid
    `,
    [userId, mediaAssetId]
  );

  return result.rowCount ?? 0;
}

async function softDeleteMediaAsset(mediaAssetId: string): Promise<number> {
  const result = await db.query(
    `
      update public.media_assets
      set deleted_at = coalesce(deleted_at, now())
      where id = $1::uuid
        and kind = any($2::text[])
    `,
    [mediaAssetId, Object.keys(PROFILE_KIND_TO_COLUMN)]
  );

  return result.rowCount ?? 0;
}

export async function runClearMissingProfileMedia(options: CliOptions): Promise<CleanupReport> {
  const missingEntries = await loadMissingProfileMediaEntries(options.reportPath);
  const report = createEmptyReport(options);

  report.examined = missingEntries.length;

  for (const item of missingEntries) {
    const linkedProfile = await findLinkedProfile(item.mediaAssetId, item.profileColumn);

    if (!linkedProfile) {
      report.skipped += 1;
      report.entries.push({
        mediaAssetId: item.mediaAssetId,
        kind: item.kind,
        oldKey: item.oldKey,
        profileUserId: null,
        profileColumn: item.profileColumn,
        status: "skipped",
        reason: "No matching profile reference currently points at this media asset."
      });
      continue;
    }

    report.eligible += 1;

    const entry: CleanupReportEntry = {
      mediaAssetId: item.mediaAssetId,
      kind: item.kind,
      oldKey: item.oldKey,
      profileUserId: linkedProfile.user_id,
      profileColumn: item.profileColumn,
      status: "planned"
    };

    if (options.apply) {
      const clearCount = await clearProfileReference(
        linkedProfile.user_id,
        item.mediaAssetId,
        item.profileColumn
      );

      if (clearCount !== 1) {
        entry.status = "skipped";
        entry.reason = "Profile reference changed before cleanup could be applied.";
        report.skipped += 1;
        report.entries.push(entry);
        continue;
      }

      report.clearedProfiles += 1;

      const deleteCount = await softDeleteMediaAsset(item.mediaAssetId);
      if (deleteCount !== 1) {
        entry.status = "skipped";
        entry.reason = "Linked media asset could not be soft-deleted.";
        report.skipped += 1;
        report.entries.push(entry);
        continue;
      }

      if (linkedProfile.media_deleted_at) {
        entry.status = "already_deleted";
        entry.reason = "Profile reference cleared; media asset was already soft-deleted.";
      } else {
        report.softDeletedAssets += 1;
        entry.status = "cleared";
      }
    }

    report.entries.push(entry);
  }

  await writeFile(
    options.reportPath,
    JSON.stringify(
      {
        sourceReportPath: report.sourceReportPath,
        cleanup: report
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runClearMissingProfileMedia(options);
  console.log(JSON.stringify(report, null, 2));
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry ? path.resolve(entry) === __filename : false;
}

if (isDirectExecution()) {
  void main()
    .catch((error: unknown) => {
      console.error("Missing profile media cleanup failed.", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.close();
    });
}
