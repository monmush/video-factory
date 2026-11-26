import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { type ImageRef, mediaUrl, type StagedImage } from "../shared/ipc";
import { findSession } from "./board";
import { dataDir, materialDir, mediaDir, voicesDir } from "./paths";
import { childPath, childPathOrNull } from "./safe-path";

const SCHEME = "hyan-media";
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export const assetDir = (assetId: string) => childPath(join(dataDir(), "assets"), assetId);
export const stagingDir = () => join(dataDir(), "staging");

export function registerMediaSchemeBeforeAppReady() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function handleMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const file = await mediaFile(new URL(request.url)).catch(() => null);
    if (!file) return new Response("Not found", { status: 404 });
    return (
      (await serveRange(file, request.headers.get("range"))) ??
      net.fetch(pathToFileURL(file).toString())
    );
  });
}

async function sessionDir(sessionId: string | undefined) {
  if (!sessionId) return null;
  const { session } = await findSession(sessionId);
  return mediaDir(session.seriesId, session.id);
}

async function mediaFile(url: URL): Promise<string | null> {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (url.hostname === "asset" && parts.length === 2) {
    return childPathOrNull(join(dataDir(), "assets"), first as string, second as string);
  }
  if (url.hostname === "staging" && parts.length === 1) {
    return childPathOrNull(stagingDir(), first as string);
  }
  if (url.hostname === "material" && parts.length === 2) {
    return childPathOrNull(materialDir(first as string), second as string);
  }
  if (url.hostname === "voice" && parts.length === 1) {
    return childPathOrNull(voicesDir(), first as string);
  }
  if (url.hostname === "chat" && parts.length === 2) {
    const dir = await sessionDir(first);
    return dir && childPathOrNull(dir, "chat-files", second as string);
  }
  if (url.hostname === "video" && parts.length === 3) {
    const dir = await sessionDir(first);
    return dir && childPathOrNull(dir, "videos", second as string, third as string);
  }
  return null;
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

async function serveRange(file: string, range: string | null): Promise<Response | null> {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  const size = info.size;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: {
      "Content-Type":
        MEDIA_TYPES[extname(file).slice(1).toLowerCase()] ?? "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

export async function clearStaging() {
  await rm(stagingDir(), { recursive: true, force: true });
}

export async function stageImages(paths: string[]): Promise<StagedImage[]> {
  await mkdir(stagingDir(), { recursive: true });
  const staged: StagedImage[] = [];
  for (const path of paths) {
    const ext = extname(path).slice(1).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_IMAGE_BYTES) continue;
    const file = `${randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
    await copyFile(path, join(stagingDir(), file));
    staged.push({ id: file, url: mediaUrl.staged(file) });
  }
  return staged;
}

export function imageRefPath(ref: ImageRef, assetImages?: Map<string, string>): string {
  if (ref.source === "staged") {
    if (!/^[0-9a-f-]+\.(png|jpg|webp)$/.test(ref.id)) throw new Error("Invalid staged image");
    return join(stagingDir(), ref.id);
  }
  const file = assetImages?.get(ref.id);
  if (!file) throw new Error(`Image not found: ${ref.id}`);
  return join(assetDir(ref.assetId), file);
}
