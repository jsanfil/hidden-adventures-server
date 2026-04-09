import {
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type FetchMediaObjectOptions = {
  bucket: string;
  key: string;
  region: string;
};

type PresignedUploadOptions = {
  bucket: string;
  key: string;
  region: string;
  contentType: string;
  expiresInSeconds?: number;
};

export type MediaObjectPayload = {
  body: Buffer;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
};

export type PresignedUploadPayload = {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

const clients = new Map<string, S3Client>();

function s3Client(region: string): S3Client {
  const existing = clients.get(region);
  if (existing) {
    return existing;
  }

  const created = new S3Client({ region });
  clients.set(region, created);
  return created;
}

const supportedImageMimeTypes = new Map<string, { mimeType: string; extension: string }>([
  ["image/jpeg", { mimeType: "image/jpeg", extension: "jpg" }],
  ["image/jpg", { mimeType: "image/jpeg", extension: "jpg" }],
  ["image/png", { mimeType: "image/png", extension: "png" }],
  ["image/webp", { mimeType: "image/webp", extension: "webp" }],
  ["image/heic", { mimeType: "image/heic", extension: "heic" }],
  ["image/heif", { mimeType: "image/heif", extension: "heif" }]
]);

export function normalizeAdventureImageMimeType(mimeType: string): {
  mimeType: string;
  extension: string;
} {
  const normalized = supportedImageMimeTypes.get(mimeType.trim().toLowerCase());
  if (!normalized) {
    throw new Error(`Unsupported image MIME type "${mimeType}".`);
  }

  return normalized;
}

export function buildAdventureImageStorageKey(options: {
  handle: string;
  mediaId: string;
  extension: string;
}): string {
  return `adventures/${options.handle}_${options.mediaId}.${options.extension}`;
}

export async function createPresignedUpload(
  options: PresignedUploadOptions
): Promise<PresignedUploadPayload> {
  const expiresInSeconds = options.expiresInSeconds ?? 15 * 60;
  const url = await getSignedUrl(
    s3Client(options.region),
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      ContentType: options.contentType
    }),
    {
      expiresIn: expiresInSeconds
    }
  );

  return {
    method: "PUT",
    url,
    headers: {
      "Content-Type": options.contentType
    },
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  };
}

export async function checkMediaObjectExists(options: {
  bucket: string;
  key: string;
  region: string;
}): Promise<boolean> {
  try {
    await s3Client(options.region).send(
      new HeadObjectCommand({
        Bucket: options.bucket,
        Key: options.key
      })
    ) as HeadObjectCommandOutput;
    return true;
  } catch {
    return false;
  }
}

export async function fetchMediaObject(
  options: FetchMediaObjectOptions
): Promise<MediaObjectPayload> {
  const response = await s3Client(options.region).send(
    new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key
    })
  ) as GetObjectCommandOutput;

  if (!response.Body) {
    throw new Error(`S3 returned an empty response for media key "${options.key}".`);
  }

  const bytes = await response.Body.transformToByteArray();

  return {
    body: Buffer.from(bytes),
    contentType: response.ContentType ?? null,
    contentLength: response.ContentLength ?? null,
    etag: response.ETag ?? null
  };
}
