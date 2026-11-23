import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { selectReportFiles, writeProblemReport } from "./problem-report";

const job = "media/series-a/session-b/videos/video-c/job.json";
const small = 1024;

describe("selectReportFiles", () => {
  it("keeps logs, workspace and job text, never secrets, chat folders or media", () => {
    const selection = selectReportFiles(
      [
        "secrets.json",
        "claude-code/projects/x/session.jsonl",
        "claude-chat/history.json",
        "assets/product/photo.json",
        "media/series-a/session-b/videos/video-c/final.mp4",
        "media/series-a/session-b/still-wide.png",
        job,
        "media/series-a/session-b/videos/video-c/director-prompt.md",
        "logs/app.log",
        "workspace.json",
      ].map((path) => ({ path, size: small })),
    );
    expect(selection.included).toEqual([
      job,
      "media/series-a/session-b/videos/video-c/director-prompt.md",
      "logs/app.log",
      "workspace.json",
    ]);
    expect(selection.leftOutForSize).toEqual([]);
  });

  it("names a wanted file that is too large instead of including it", () => {
    const selection = selectReportFiles([{ path: job, size: 6 * 1024 * 1024 }]);
    expect(selection).toEqual({ included: [], leftOutForSize: [job] });
  });
});

describe("writeProblemReport", () => {
  const folders: string[] = [];
  afterEach(async () => {
    await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
  });

  it("zips nested job records and leaves the secrets file out", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "report-data-"));
    const destination = await mkdtemp(join(tmpdir(), "report-out-"));
    folders.push(dataDir, destination);
    const put = async (path: string, text: string) => {
      await mkdir(dirname(join(dataDir, path)), { recursive: true });
      await writeFile(join(dataDir, path), text);
    };
    await put("secrets.json", '{"fal":"cipher"}');
    await put(job, '{"status":"failed"}');

    const file = await writeProblemReport({
      dataDir,
      destination,
      about: { version: "1.2.3", packaged: true },
    });

    const entries = unzipSync(new Uint8Array(await readFile(file)));
    expect(Object.keys(entries).sort()).toEqual([job, "report.json"]);
    expect(strFromU8(entries[job] ?? new Uint8Array())).toBe('{"status":"failed"}');
  });
});
