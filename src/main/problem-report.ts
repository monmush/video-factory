import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { join, posix, relative, sep } from "node:path";
import { type Zippable, zip } from "fflate";

const TOP_LEVEL_FILES = new Set([
  "workspace.json",
  "settings.json",
  "requests.jsonl",
  "usage.jsonl",
  "claude-limits.json",
  "video-averages.json",
  "feedback.jsonl",
]);
const LOG_FILES = new Set(["logs/app.log", "logs/app.previous.log"]);
const MEDIA_TEXT_EXTENSIONS = new Set([".json", ".md", ".jsonl", ".txt", ".srt", ".ass", ".vtt"]);
const WALKED_FOLDERS = ["logs", "media"];
const LARGEST_FILE_BYTES = 5 * 1024 * 1024;

export interface ReportCandidate {
  path: string;
  size: number;
}

export interface ReportSelection {
  included: string[];
  leftOutForSize: string[];
}

function belongsInReport(path: string): boolean {
  if (TOP_LEVEL_FILES.has(path) || LOG_FILES.has(path)) return true;
  return path.startsWith("media/") && MEDIA_TEXT_EXTENSIONS.has(posix.extname(path).toLowerCase());
}

export function selectReportFiles(candidates: ReportCandidate[]): ReportSelection {
  const wanted = candidates.filter((candidate) => belongsInReport(candidate.path));
  return {
    included: wanted.filter((f) => f.size <= LARGEST_FILE_BYTES).map((f) => f.path),
    leftOutForSize: wanted.filter((f) => f.size > LARGEST_FILE_BYTES).map((f) => f.path),
  };
}

async function listCandidates(dataDir: string): Promise<ReportCandidate[]> {
  const listings = await Promise.all(
    [
      readdir(dataDir, { withFileTypes: true }),
      ...WALKED_FOLDERS.map((folder) =>
        readdir(join(dataDir, folder), { withFileTypes: true, recursive: true }),
      ),
    ].map((listing) => listing.catch(() => [])),
  );
  const files = listings.flat().filter((entry) => entry.isFile());
  const candidates = await Promise.all(
    files.map(async (entry) => {
      const full = join(entry.parentPath, entry.name);
      const size = await stat(full).then(
        (s) => s.size,
        () => null,
      );
      return size === null ? null : { path: relative(dataDir, full).split(sep).join("/"), size };
    }),
  );
  return candidates.filter((candidate) => candidate !== null);
}

const pad = (n: number) => String(n).padStart(2, "0");

function reportFileName(now: Date, attempt: number): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `bao-loi-${stamp}${attempt > 1 ? `-${attempt}` : ""}.zip`;
}

async function writeUnderFreeName(destination: string, now: Date, bytes: Uint8Array) {
  await mkdir(destination, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const file = join(destination, reportFileName(now, attempt));
    try {
      await writeFile(file, bytes, { flag: "wx" });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

const zipped = (files: Zippable) =>
  new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (error, data) => (error ? reject(error) : resolve(data))),
  );

export async function writeProblemReport(input: {
  dataDir: string;
  destination: string;
  about: { version: string; packaged: boolean };
}): Promise<string> {
  const now = new Date();
  const selection = selectReportFiles(await listCandidates(input.dataDir));
  const files: Zippable = {};
  for (const path of selection.included) {
    const bytes = await readFile(join(input.dataDir, ...path.split("/"))).catch(() => null);
    if (bytes) files[path] = new Uint8Array(bytes);
  }
  const report = {
    createdAt: now.toISOString(),
    version: input.about.version,
    platform: process.platform,
    arch: process.arch,
    os: release(),
    packaged: input.about.packaged,
    leftOutForSize: { count: selection.leftOutForSize.length, files: selection.leftOutForSize },
  };
  files["report.json"] = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
  return writeUnderFreeName(input.destination, now, await zipped(files));
}
