import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { type ImageRef, mediaUrl, type StagedImage } from "../shared/ipc";
import { findSession } from "./board";
import { dataDir, mediaDir } from "./paths";

// Local media is served to the renderer through a custom protocol instead of
// file:// so the renderer never gets general file-system access:
//   hyan-media://asset/<assetId>/<file>   saved asset images
//   hyan-media://staging/<file>           images picked but not yet saved
//   hyan-media://chat/<sessionId>/<file>  files attached in a session chat
//   hyan-media://video/<sessionId>/<scriptId>/<file>  a video job's voice, frames and clips

const SCHEME = "hyan-media";
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export const assetDir = (assetId: string) => join(dataDir(), "assets", assetId);
export const stagingDir = () => join(dataDir(), "staging");

/** Must run before app "ready". */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function handleMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    const base =
      url.hostname === "asset" && parts.length === 2
        ? assetDir(parts[0] as string)
        : url.hostname === "staging" && parts.length === 1
          ? stagingDir()
          : url.hostname === "chat" && parts.length === 2
            ? await findSession(parts[0] as string)
                .then(({ session }) => join(mediaDir(session.seriesId, session.id), "chat-files"))
                .catch(() => null)
            : url.hostname === "video" && parts.length === 3 && /^[\w-]+$/.test(parts[1] as string)
              ? await findSession(parts[0] as string)
                  .then(({ session }) =>
                    join(mediaDir(session.seriesId, session.id), "videos", parts[1] as string),
                  )
                  .catch(() => null)
              : null;
    if (!base) return new Response("Not found", { status: 404 });
    const file = resolve(base, parts.at(-1) as string);
    if (!file.startsWith(resolve(base) + sep)) return new Response("Forbidden", { status: 403 });
    return (
      (await serveRange(file, request.headers.get("range"))) ??
      net.fetch(pathToFileURL(file).toString())
    );
  });
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

/**
 * Answers a byte-range request ourselves: players ask for ranges to start and
 * to seek, and a file:// fetch does not honour them. Null when the request has
 * no usable range, so the caller serves the whole file.
 */
async function serveRange(file: string, range: string | null): Promise<Response | null> {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });
  const size = info.size;
  // "bytes=-N" is the last N bytes.
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

/** Staged files from an earlier run were never saved; start clean. */
export async function clearStaging() {
  await rm(stagingDir(), { recursive: true, force: true });
}

/** Copies user-chosen images into staging. Non-images and oversized files are skipped. */
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

/** Absolute path of a staged or saved image. Ids are file names, validated against traversal. */
export function imageRefPath(ref: ImageRef, assetImages?: Map<string, string>): string {
  if (ref.source === "staged") {
    if (!/^[0-9a-f-]+\.(png|jpg|webp)$/.test(ref.id)) throw new Error("Invalid staged image");
    return join(stagingDir(), ref.id);
  }
  const file = assetImages?.get(ref.id);
  if (!file) throw new Error(`Image not found: ${ref.id}`);
  return join(assetDir(ref.assetId), file);
}
