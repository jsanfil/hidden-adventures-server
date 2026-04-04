import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

type FetchMediaObjectOptions = {
  bucket: string;
  key: string;
  region: string;
};

export type MediaObjectPayload = {
  body: Buffer;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
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

export async function fetchMediaObject(
  options: FetchMediaObjectOptions
): Promise<MediaObjectPayload> {
  const response = await s3Client(options.region).send(
    new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key
    })
  );

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
