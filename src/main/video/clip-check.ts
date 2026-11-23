import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { addedLettering, clipFrameTimes, readClipAnswer } from "../../shared/clip-check";
import type { JobShot } from "../../shared/video-job";
import { askClaudeCode } from "../claude-code";
import { providerMode } from "../providers";
import { parseJsonObject } from "../text-ai";
import { logUsage } from "../usage";
import { checksEnabled } from "./checks";
import { frameAt, probeSeconds } from "./ffmpeg";
import { fixtureTimesForShot } from "./fixture-net";

const SYSTEM = "You inspect images for a video production. Answer with one JSON object only.";

const QUESTION = `Ảnh 1 is the still image a short video clip was generated from. The other images are frames from the start, middle and end of that clip.
Does any clip frame show lettering that is not in Ảnh 1: captions, subtitles, written characters of any script, a watermark, a caption bar or any text laid over the picture?
Lettering already in Ảnh 1 (a logo or letters on clothing, a label on a product, a sign in the room) does not count, even when it moves, blurs or is partly hidden.
Answer {"added": a few words saying what was added and where, or null if nothing was added}`;

const FIXTURE_CAPTIONS = "HYAN_FIXTURE_CAPTIONS";

export async function clipAddedLettering(input: {
  clipPath: string;
  stillPath: string;
  shot: Pick<JobShot, "index" | "rejectedClips">;
  sessionId: string;
}): Promise<string | null> {
  if (providerMode() === "fixture") return fixtureVerdict(input);
  if (!checksEnabled()) return null;
  return addedLettering(() => ask(input));
}

async function fixtureVerdict(input: {
  clipPath: string;
  shot: Pick<JobShot, "index" | "rejectedClips">;
}): Promise<string | null> {
  const captionedTimes = fixtureTimesForShot(FIXTURE_CAPTIONS, input.shot.index + 1);
  if (!captionedTimes) return null;
  const captioned = (input.shot.rejectedClips ?? 0) < captionedTimes;
  return addedLettering(() =>
    withClipFrames(input.clipPath, async () => (captioned ? "simulated subtitles" : null)),
  );
}

async function withClipFrames<T>(clipPath: string, use: (frames: string[]) => Promise<T>) {
  const dir = `${clipPath}.check`;
  await mkdir(dir, { recursive: true });
  try {
    const seconds = await probeSeconds(clipPath);
    const frames: string[] = [];
    for (const [i, at] of clipFrameTimes(seconds).entries()) {
      const out = join(dir, `frame-${i + 1}.jpg`);
      await frameAt(clipPath, at, out);
      frames.push(out);
    }
    return await use(frames);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ask(input: {
  clipPath: string;
  stillPath: string;
  sessionId: string;
}): Promise<string | null> {
  return withClipFrames(input.clipPath, async (frames) => {
    const answer = await askClaudeCode({
      system: SYSTEM,
      prompt: QUESTION,
      imagePaths: [input.stillPath, ...frames],
      numberImages: true,
      maxImageSide: 1024,
      model: "sonnet",
      effort: "low",
      timeoutMs: 90_000,
    });
    await logUsage({
      provider: "claude-code",
      purpose: "video-clip-check",
      sessionId: input.sessionId,
      notionalCostUsd: answer.notionalCostUsd,
      durationMs: answer.durationMs,
    });
    return readClipAnswer(parseJsonObject<unknown>(answer.text));
  });
}
