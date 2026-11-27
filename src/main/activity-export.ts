import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Zippable } from "fflate";
import type { ActivityRecord } from "../shared/activity";
import {
  type CostReport,
  type CurrentVideos,
  costReport,
  toCsv,
  type UsageLine,
} from "../shared/cost-report";
import type { Workspace } from "../shared/ipc";
import { parseLines } from "../shared/request-reconcile";
import { ACTIVITY_EVENTS_FILE } from "./activity";
import { getBoard } from "./board";
import { jobsFor } from "./video/runner";
import { dateStamp, jsonBytes, writeZipUnderFreeName, zipped } from "./zip-file";

const USAGE = "usage.jsonl";

async function currentVideos(
  workspace: Pick<Workspace, "series" | "sessions">,
): Promise<CurrentVideos> {
  const sessionIds = workspace.sessions.map((s) => s.id);
  const [jobs, boards] = await Promise.all([
    Promise.all(sessionIds.map(jobsFor)),
    Promise.all(sessionIds.map((id) => getBoard(id).catch(() => null))),
  ]);
  return {
    jobs: jobs.flat(),
    scripts: boards.flatMap((board, at) =>
      (board?.scripts ?? []).map((script) => ({
        sessionId: sessionIds[at] as string,
        scriptId: script.id,
        title: script.title,
      })),
    ),
  };
}

async function readReport(dataDir: string, workspace: Pick<Workspace, "series" | "sessions">) {
  const read = (path: string) => readFile(join(dataDir, path), "utf8").catch(() => "");
  const [events, usage, current] = await Promise.all([
    read(ACTIVITY_EVENTS_FILE),
    read(USAGE),
    currentVideos(workspace),
  ]);
  const report = costReport(
    parseLines<UsageLine>(usage),
    parseLines<ActivityRecord>(events),
    workspace,
    current,
  );
  return { events, usage, report };
}

export async function readCostReport(
  dataDir: string,
  workspace: Pick<Workspace, "series" | "sessions">,
): Promise<CostReport> {
  return (await readReport(dataDir, workspace)).report;
}

export async function writeActivityExport(input: {
  dataDir: string;
  destination: string;
  about: Record<string, unknown>;
  workspace: Pick<Workspace, "series" | "sessions">;
}): Promise<string> {
  const now = new Date();
  const { events, usage, report } = await readReport(input.dataDir, input.workspace);
  const encode = (text: string) => new TextEncoder().encode(text);
  const files: Zippable = {
    [ACTIVITY_EVENTS_FILE]: encode(events),
    [USAGE]: encode(usage),
    "about.json": jsonBytes({ createdAt: now.toISOString(), ...input.about }),
    "costs/calls.csv": encode(toCsv(report.calls)),
    "costs/videos.csv": encode(toCsv(report.videos)),
    "costs/batches.csv": encode(toCsv(report.batches)),
    "costs/series.csv": encode(toCsv(report.series)),
  };
  return writeZipUnderFreeName(
    input.destination,
    `du-lieu-su-dung-${dateStamp(now)}`,
    await zipped(files),
  );
}
