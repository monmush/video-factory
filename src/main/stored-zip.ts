import { once } from "node:events";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { type FileHandle, open, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Zip, ZipPassThrough } from "fflate";

export const INVALID_FILE_MESSAGE = "Tệp không hợp lệ.";

export class InvalidZipError extends Error {
  constructor() {
    super(INVALID_FILE_MESSAGE);
  }
}

export type ZipSource = { path: string } & ({ file: string } | { bytes: Uint8Array });

async function pushSource(entry: ZipPassThrough, source: ZipSource, out: WriteStream) {
  const chunks = "bytes" in source ? [source.bytes] : createReadStream(source.file);
  for await (const chunk of chunks) {
    entry.push(chunk as Uint8Array, false);
    if (out.writableNeedDrain) await once(out, "drain");
  }
  entry.push(new Uint8Array(0), true);
  if (out.writableNeedDrain) await once(out, "drain");
}

async function writeEntries(out: WriteStream, sources: readonly ZipSource[]) {
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else out.write(data);
  });
  for (const source of sources) {
    const entry = new ZipPassThrough(source.path);
    zip.add(entry);
    await pushSource(entry, source, out);
    if (failure) throw failure;
  }
  zip.end();
  if (failure) throw failure;
}

export async function writeStoredZip(target: string, sources: readonly ZipSource[]) {
  const out = createWriteStream(target, { flags: "wx" });
  await once(out, "open");
  const failed = new Promise<never>((_, reject) => out.once("error", reject));
  try {
    await Promise.race([writeEntries(out, sources), failed]);
    out.end();
    await Promise.race([once(out, "finish"), failed]);
  } catch (error) {
    out.destroy();
    await rm(target, { force: true });
    throw error;
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const UTF8_FLAG = 0x800;
const ENCRYPTED_FLAG = 0x1;
const MAX_TEXT_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  path: string;
  size: number;
  offset: number;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new InvalidZipError();
  return buffer;
}

function findEndRecord(tail: Buffer): number {
  for (let at = tail.length - EOCD_SIZE; at >= 0; at--) {
    if (tail.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new InvalidZipError();
}

function parseCentralDirectory(directory: Buffer, count: number, dataEnd: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new InvalidZipError();
    }
    const flags = directory.readUInt16LE(at + 8);
    const method = directory.readUInt16LE(at + 10);
    const compressed = directory.readUInt32LE(at + 20);
    const size = directory.readUInt32LE(at + 24);
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const offset = directory.readUInt32LE(at + 42);
    const nameEnd = at + 46 + nameLength;
    if (nameEnd > directory.length) throw new InvalidZipError();
    if (method !== 0 || flags & ENCRYPTED_FLAG || compressed !== size) throw new InvalidZipError();
    if (offset + size > dataEnd) throw new InvalidZipError();
    const name = directory.subarray(at + 46, nameEnd);
    const path = name.toString(flags & UTF8_FLAG ? "utf8" : "latin1");
    entries.push({ path, size, offset });
    at = nameEnd + extraLength + commentLength;
  }
  return entries;
}

export interface StoredZip {
  entries: ZipEntry[];
  readText(path: string): Promise<string | null>;
  extract(entry: ZipEntry, target: string): Promise<void>;
  close(): Promise<void>;
}

async function readDirectory(
  handle: FileHandle,
): Promise<{ entries: ZipEntry[]; directoryOffset: number }> {
  const { size } = await handle.stat();
  if (size < EOCD_SIZE) throw new InvalidZipError();
  const tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT);
  const tail = await readAt(handle, size - tailLength, tailLength);
  const end = findEndRecord(tail);
  const count = tail.readUInt16LE(end + 10);
  const directorySize = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (directoryOffset + directorySize > size - tailLength + end) throw new InvalidZipError();
  const directory = await readAt(handle, directoryOffset, directorySize);
  const entries = parseCentralDirectory(directory, count, directoryOffset);
  if (new Set(entries.map((e) => e.path)).size !== entries.length) throw new InvalidZipError();
  return { entries, directoryOffset };
}

async function dataStart(handle: FileHandle, entry: ZipEntry, dataEnd: number): Promise<number> {
  const header = await readAt(handle, entry.offset, 30);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new InvalidZipError();
  const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (start + entry.size > dataEnd) throw new InvalidZipError();
  return start;
}

export async function openStoredZip(file: string): Promise<StoredZip> {
  const handle = await open(file, "r");
  try {
    const { entries, directoryOffset } = await readDirectory(handle);
    return {
      entries,
      async readText(path) {
        const entry = entries.find((e) => e.path === path);
        if (!entry) return null;
        if (entry.size > MAX_TEXT_BYTES) throw new InvalidZipError();
        const start = await dataStart(handle, entry, directoryOffset);
        return (await readAt(handle, start, entry.size)).toString("utf8");
      },
      async extract(entry, target) {
        const start = await dataStart(handle, entry, directoryOffset);
        const out = createWriteStream(target);
        if (entry.size === 0) {
          out.end();
          await once(out, "finish");
          return;
        }
        await pipeline(createReadStream(file, { start, end: start + entry.size - 1 }), out);
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
