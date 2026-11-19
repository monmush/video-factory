import { spawn } from "node:child_process";
import { access, constants, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { app } from "electron";

const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

function bundledDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "bin");
  return join(app.getAppPath(), "resources", "bin", `${process.platform}-${process.arch}`);
}

export const FFMPEG_MISSING = "Chưa cài FFmpeg trên máy này";

const found = new Map<string, string>();

async function find(name: "ffmpeg" | "ffprobe"): Promise<string> {
  const cached = found.get(name);
  if (cached) return cached;
  const dirs = [
    bundledDir(),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    ...EXTRA_DIRS,
  ];
  for (const dir of dirs) {
    const path = join(dir, name);
    try {
      await access(path, constants.X_OK);
      found.set(name, path);
      return path;
    } catch {}
  }
  throw new Error(FFMPEG_MISSING);
}

function run(bin: string, args: string[], onStdout?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      const text = d.toString();
      out += text;
      onStdout?.(text);
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`FFmpeg lỗi (${code}): ${err.trim().split("\n").at(-1) ?? ""}`));
    });
  });
}

const ffmpeg = async (args: string[], onStdout?: (chunk: string) => void) =>
  run(await find("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...args], onStdout);

export async function assertFfmpegBeforeAnyPaidStep(): Promise<void> {
  await find("ffmpeg");
  await find("ffprobe");
}

export async function probeSeconds(path: string): Promise<number> {
  const out = await run(await find("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error("Không đọc được độ dài tệp");
  return seconds;
}

export async function cutLine(
  source: string,
  cut: { start: number; end: number },
  out: string,
  minSec: number,
): Promise<void> {
  await ffmpeg([
    "-i",
    source,
    "-af",
    `atrim=start=${cut.start}:end=${cut.end},asetpts=PTS-STARTPTS,apad=whole_dur=${minSec}`,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    out,
  ]);
}

export async function fixtureClip(
  video: string,
  audio: string,
  out: string,
  { width, height }: Size,
): Promise<void> {
  await ffmpeg([
    "-stream_loop",
    "-1",
    "-i",
    video,
    "-i",
    audio,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    out,
  ]);
}

export async function loopAudio(source: string, seconds: number, out: string): Promise<void> {
  await ffmpeg([
    "-stream_loop",
    "-1",
    "-i",
    source,
    "-t",
    seconds.toFixed(3),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    out,
  ]);
}

export const OUTPUT = { fps: 30, sampleRate: 44100 };

export type Size = { width: number; height: number };

export const frameCount = (start: number, end: number, fps = OUTPUT.fps) =>
  Math.max(1, Math.round(end * fps) - Math.round(start * fps));

export async function padAudio(source: string, minSec: number, out: string): Promise<void> {
  await ffmpeg([
    "-i",
    source,
    "-af",
    `apad=whole_dur=${minSec}`,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    out,
  ]);
}

export async function insertSilence(
  source: string,
  sourceSec: number,
  inserts: { at: number; sec: number }[],
  out: string,
): Promise<void> {
  const holds = [...inserts].sort((a, b) => a.at - b.at);
  const format = `aresample=${OUTPUT.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  const pieces: string[] = [];
  const filters: string[] = [];
  const edges = [0, ...holds.map((h) => Math.min(h.at, sourceSec)), sourceSec];
  const parts = edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] as number }));
  filters.push(`[0:a]${format},asplit=${parts.length}${parts.map((_, i) => `[p${i}]`).join("")}`);
  parts.forEach((part, i) => {
    filters.push(
      `[p${i}]atrim=start=${part.start.toFixed(3)}:end=${part.end.toFixed(3)},asetpts=PTS-STARTPTS[g${i}]`,
    );
  });
  holds.forEach((_, j) => {
    filters.push(`[${j + 1}:a]${format}[z${j}]`);
  });
  parts.forEach((part, i) => {
    if (part.end - part.start > 0.0005) pieces.push(`[g${i}]`);
    else filters.push(`[g${i}]anullsink`);
    if (i < holds.length) pieces.push(`[z${i}]`);
  });
  filters.push(`${pieces.join("")}concat=n=${pieces.length}:v=0:a=1[out]`);
  await ffmpeg([
    "-i",
    source,
    ...holds.flatMap((h) => [
      "-f",
      "lavfi",
      "-t",
      h.sec.toFixed(3),
      "-i",
      `anullsrc=r=${OUTPUT.sampleRate}:cl=stereo`,
    ]),
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "160k",
    out,
  ]);
}

export async function silence(seconds: number, out: string): Promise<void> {
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=mono`,
    "-t",
    seconds.toFixed(3),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    out,
  ]);
}

export async function cropCloser(image: string, out: string): Promise<void> {
  await ffmpeg([
    "-i",
    image,
    "-vf",
    "crop=trunc(iw*0.74/2)*2:trunc(ih*0.74/2)*2:(iw-ow)/2:ih*0.04",
    "-frames:v",
    "1",
    out,
  ]);
}

export async function productStill(photo: string, out: string, size: Size): Promise<void> {
  const w = size.width * 2;
  const h = size.height * 2;
  await ffmpeg([
    "-i",
    photo,
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2,eq=brightness=-0.06[bg];` +
      `[0:v]scale=${Math.round(w * 0.86)}:${Math.round(h * 0.7)}:force_original_aspect_ratio=decrease[fg];` +
      "[bg][fg]overlay=(W-w)/2:(H-h)/2",
    "-frames:v",
    "1",
    out,
  ]);
}

export async function productShot(input: {
  plate: string;
  cutout: string;
  box: { x: number; y: number; w: number; h: number };
  place: { x: number; y: number; w: number; h: number };
  gains: [number, number, number];
  frames: number;
  size: Size;
  zoom: { plate: number; product: number };
  out: string;
}): Promise<void> {
  const { fps } = OUTPUT;
  const { width: W, height: H } = input.size;
  const K = 2;
  const [W2, H2] = [W * K, H * K];
  const n = Math.max(1, input.frames);
  const T = n / fps;
  const still = n === 1;
  const pw = input.place.w * K;
  const ph = input.place.h * K;
  const px = (input.place.x + input.place.w / 2) * K;
  const base = (input.place.y + input.place.h) * K;
  const [cx, cy] = [W2 / 2, H2 / 2];
  const z = still ? "1" : `(1+${input.zoom.product}*t/${T.toFixed(4)})`;
  const sw = Math.round(pw * 1.15);
  const sh = Math.max(6, Math.round(ph * 0.08));
  const sigma = Math.max(2, sh * 0.45);
  const pad = Math.ceil(sigma * 3);
  const swp = sw + 2 * pad;
  const shp = sh + 2 * pad;
  const even = (v: string) => `trunc(${v}/2)*2`;
  const [r, g, b] = input.gains.map((v) => v.toFixed(4));
  const bg = still
    ? `[0:v]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},setsar=1[bg]`
    : `[0:v]scale=${W2 * 2}:${H2 * 2}:force_original_aspect_ratio=increase,crop=${W2 * 2}:${H2 * 2},` +
      `zoompan=z='1+${input.zoom.plate}*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W2}x${H2}:fps=${fps},setsar=1[bg]`;
  const filters = [
    bg,
    `[1:v]crop=${input.box.w}:${input.box.h}:${input.box.x}:${input.box.y},format=rgba,split=2[pa][pb]`,
    `[pa]colorchannelmixer=rr=${r}:gg=${g}:bb=${b},scale=w='${even(`${pw}*${z}`)}':h='${even(`${ph}*${z}`)}':eval=frame:flags=bicubic[prod]`,
    `[pb]scale=${sw}:${sh},colorchannelmixer=rr=0:gg=0:bb=0:aa=0.65,pad=${swp}:${shp}:${pad}:${pad}:color=black@0,gblur=sigma=${sigma.toFixed(2)},` +
      `scale=w='${even(`${swp}*${z}`)}':h='${even(`${shp}*${z}`)}':eval=frame[shadow]`,
    `[bg][shadow]overlay=x='${cx}+(${px}-${cx})*${z}-w/2':y='${cy}+(${base}-${cy})*${z}-h/2+${(sh * 0.2).toFixed(1)}*${z}':eval=frame[b1]`,
    `[b1][prod]overlay=x='${cx}+(${px}-${cx})*${z}-w/2':y='${cy}+(${base}-${cy})*${z}-h+${(sh * 0.15).toFixed(1)}*${z}':eval=frame,` +
      `scale=${W}:${H}:flags=lanczos,setsar=1,format=${still ? "rgb24" : "yuv420p"}[out]`,
  ];
  await ffmpeg([
    "-i",
    input.plate,
    ...(still ? [] : ["-loop", "1", "-framerate", String(fps), "-t", T.toFixed(4)]),
    "-i",
    input.cutout,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-frames:v",
    String(n),
    ...(still
      ? []
      : ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-r", String(fps)]),
    input.out,
  ]);
}

export async function readRgba(
  path: string,
  maxSide = 512,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const out = await run(await find("ffprobe"), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path,
  ]);
  const [w0, h0] = out.trim().split(",").map(Number) as [number, number];
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * k));
  const height = Math.max(1, Math.round(h0 * k));
  const bin = await find("ffmpeg");
  const data = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-vf",
        `scale=${width}:${height}:flags=area,format=rgba`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`FFmpeg lỗi (${code})`)),
    );
  });
  return { data: new Uint8Array(data), width, height };
}

export async function fixtureCutout(photo: string, out: string): Promise<void> {
  await ffmpeg([
    "-i",
    photo,
    "-vf",
    "scale=720:-2,format=rgba,pad=iw:ih:0:0,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':" +
      "a='if(between(X,W*0.3,W*0.7)*between(Y,H*0.2,H*0.75),255,0)'",
    "-frames:v",
    "1",
    out,
  ]);
}

export async function stillClip(
  image: string,
  frames: number,
  out: string,
  { width, height }: Size,
): Promise<void> {
  const { fps } = OUTPUT;
  await ffmpeg([
    "-i",
    image,
    "-vf",
    `scale=${width * 3}:${height * 3}:force_original_aspect_ratio=increase,crop=${width * 3}:${height * 3},` +
      `zoompan=z='1+0.07*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},` +
      "setsar=1,format=yuv420p",
    "-frames:v",
    String(frames),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "19",
    out,
  ]);
}

export async function exactClip(
  clip: string,
  frames: number,
  out: string,
  { width, height }: Size,
): Promise<void> {
  const { fps } = OUTPUT;
  await ffmpeg([
    "-i",
    clip,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=10`,
    "-frames:v",
    String(frames),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "19",
    out,
  ]);
}

export async function assembleOverDialogue(
  clips: string[],
  dialogue: string,
  assFile: string,
  listFile: string,
  out: string,
  totalSec: number,
  onProgress: (share: number) => void,
): Promise<void> {
  await writeFile(
    listFile,
    clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );
  const assPath = assFile.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await ffmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-i",
      dialogue,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-vf",
      `ass='${assPath}'`,
      "-af",
      `aresample=${OUTPUT.sampleRate},aformat=channel_layouts=stereo`,
      "-t",
      totalSec.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      out,
    ],
    (chunk) => {
      const match = /out_time_us=(\d+)/.exec(chunk);
      if (match && totalSec > 0) onProgress(Math.min(1, Number(match[1]) / 1e6 / totalSec));
    },
  );
}
