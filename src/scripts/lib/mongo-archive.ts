import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type MongoArchiveDocument = Record<string, unknown>;

type ArchiveHeaderDocument = {
  collection?: string;
  EOF?: boolean;
};

function readCString(buffer: Buffer, offset: number): [string, number] {
  const end = buffer.indexOf(0, offset);

  if (end === -1) {
    throw new Error(`Unterminated cstring at offset ${offset}.`);
  }

  return [buffer.subarray(offset, end).toString("utf8"), end + 1];
}

function parseDocument(buffer: Buffer, offset: number): [MongoArchiveDocument, number] {
  const length = buffer.readInt32LE(offset);
  const end = offset + length;
  let position = offset + 4;
  const document: MongoArchiveDocument = {};

  while (position < end - 1) {
    const valueType = buffer[position];
    position += 1;

    const [key, nextPosition] = readCString(buffer, position);
    position = nextPosition;

    let value: unknown;

    switch (valueType) {
      case 0x01:
        value = buffer.readDoubleLE(position);
        position += 8;
        break;
      case 0x02: {
        const size = buffer.readInt32LE(position);
        value = buffer.subarray(position + 4, position + 4 + size - 1).toString("utf8");
        position += 4 + size;
        break;
      }
      case 0x03: {
        [value, position] = parseDocument(buffer, position);
        break;
      }
      case 0x04: {
        const [arrayDocument, newPosition] = parseDocument(buffer, position);
        value = Object.keys(arrayDocument)
          .sort((left, right) => {
            const leftNumber = Number(left);
            const rightNumber = Number(right);

            if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
              return leftNumber - rightNumber;
            }

            return left.localeCompare(right);
          })
          .map((arrayKey) => arrayDocument[arrayKey]);
        position = newPosition;
        break;
      }
      case 0x07:
        value = buffer.subarray(position, position + 12).toString("hex");
        position += 12;
        break;
      case 0x08:
        value = buffer[position] !== 0;
        position += 1;
        break;
      case 0x09: {
        const milliseconds = Number(buffer.readBigInt64LE(position));
        value = new Date(milliseconds).toISOString();
        position += 8;
        break;
      }
      case 0x0a:
        value = null;
        break;
      case 0x10:
        value = buffer.readInt32LE(position);
        position += 4;
        break;
      case 0x11:
        value = { _bson_timestamp: buffer.readBigUInt64LE(position).toString() };
        position += 8;
        break;
      case 0x12:
        value = Number(buffer.readBigInt64LE(position));
        position += 8;
        break;
      default:
        throw new Error(`Unsupported BSON type 0x${valueType.toString(16)} at offset ${position - 1}.`);
    }

    document[key] = value;
  }

  return [document, end];
}

export async function readMongoArchive(
  archivePath: string
): Promise<Record<string, MongoArchiveDocument[]>> {
  const buffer = await readFile(archivePath);
  let position = 4;

  while (position + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(position);
    if (length === 0xffffffff) {
      break;
    }

    [, position] = parseDocument(buffer, position);
  }

  const collections: Record<string, MongoArchiveDocument[]> = {};

  while (position + 4 <= buffer.length) {
    const marker = buffer.readUInt32LE(position);
    if (marker !== 0xffffffff) {
      break;
    }

    position += 4;
    if (position + 4 > buffer.length) {
      break;
    }

    const [header, nextPosition] = parseDocument(buffer, position);
    position = nextPosition;

    const archiveHeader = header as ArchiveHeaderDocument;
    const collection = archiveHeader.collection;

    if (!collection) {
      throw new Error("Encountered archive block without a collection name.");
    }

    const documents = collections[collection] ?? [];
    collections[collection] = documents;

    while (position + 4 <= buffer.length) {
      const length = buffer.readUInt32LE(position);
      if (length === 0xffffffff) {
        break;
      }

      const [document, nextDocumentPosition] = parseDocument(buffer, position);
      position = nextDocumentPosition;

      if (!archiveHeader.EOF) {
        documents.push(document);
      }
    }
  }

  return collections;
}

export async function sha256File(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}
