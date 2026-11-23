import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { outputSize } from "../../shared/batch-settings";
import { calculated } from "../../shared/cost/rates";
import { splitTrailingCue } from "../../shared/cues";
import type { Asset } from "../../shared/ipc";
import { readMediaUrl } from "../../shared/live-plan";
import { plannedMotion, speechPrompt } from "../../shared/prompt-text";
import {
  type JobSegment,
  SILENCE_MIN_SEC,
  SILENCE_NOISE_DB,
  type SpeechBounds,
  speakingSec,
  speechBounds,
} from "../../shared/speech";
import { type SpeechModel, speechModel, speechUsd } from "../../shared/speech-models";
import { segmentAnchor, type VideoJob } from "../../shared/video-job";
import { guessVoiceTraits, voiceDescription } from "../../shared/voices";
import {
  type Canceller,
  type CancelOutcome,
  type Fal,
  falCancel,
  falPoll,
  falSubmit,
} from "../fal";
import { uploadImages } from "../fal-upload";
import { falClient, providerMode } from "../providers";
import { fixtureSpeechClip, silenceLog } from "./ffmpeg";
import { fixtureNetwork, fixtureTimesForShot } from "./fixture-net";
import type { StepPoll } from "./steps";

const isFixture = () => providerMode() === "fixture";
const fixtureVoice = () => join(app.getAppPath(), "resources/fixtures/video/dialogue.mp3");

let falPromise: Promise<Fal> | null = null;
function fal(): Promise<Fal> {
  falPromise ??= falClient().catch((error) => {
    falPromise = null;
    throw error;
  });
  return falPromise;
}

export function segmentPrompt(job: VideoJob, segment: JobSegment, character?: Asset): string {
  const ambient = job.plan?.seats.find((s) => s.characterId === segment.characterId)?.ambient;
  const shot = segment.speakerShot === null ? undefined : job.shots[segment.speakerShot];
  const route = shot && job.live?.plan.routes[shot.index];
  const motion = shot
    ? route
      ? plannedMotion(route.input?.prompt, false, ambient)
      : shot.visual
    : "";
  const { words, cue } = splitTrailingCue(segment.text);
  return speechPrompt({
    people: job.frames.find((f) => f.id === segment.frame)?.people ?? 1,
    words,
    cue,
    voice: voiceDescription(
      character ? guessVoiceTraits(character.name, character.description) : {},
    ),
    motion,
    ambient,
  });
}

export async function submitSegment(input: {
  job: VideoJob;
  segment: JobSegment;
  model: SpeechModel;
  seconds: number;
  stillPath: string;
  prompt: string;
}): Promise<string> {
  const { job, segment, model, seconds } = input;
  if (isFixture()) {
    fixtureNetwork();
    return `fixture-${randomUUID()}`;
  }
  const client = await fal();
  const [imageUrl] = await uploadImages(client, [input.stillPath]);
  return falSubmit(
    client,
    model.endpoint,
    model.input({ prompt: input.prompt, imageUrl: imageUrl as string, seconds }),
    {
      purpose: "video-speech",
      model: model.id,
      seconds,
      sessionId: job.sessionId,
      scriptId: job.scriptId,
      segment: segment.id,
      attempt: segment.sending,
    },
  );
}

const FIXTURE_SPEECH_MS = 6000;

export async function pollSegment(job: VideoJob, segment: JobSegment): Promise<StepPoll> {
  const model = speechModel(segment.model);
  const usd = speechUsd(model, segment.seconds ?? 0);
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(segment.submittedAt ?? new Date().toISOString());
    const failures = fixtureTimesForShot("HYAN_FIXTURE_FAIL", segmentAnchor(segment) + 1);
    if (segment.failures < failures && elapsed > FIXTURE_SPEECH_MS * 0.6) {
      return { state: "failed", message: "Lỗi giả lập" };
    }
    if (elapsed < FIXTURE_SPEECH_MS) return { state: "pending" };
    return { state: "done", url: "fixture:speech", cost: calculated(usd) };
  }
  const result = await falPoll<unknown>(await fal(), model.endpoint, segment.requestId as string, {
    purpose: "video-speech",
    model: model.id,
    cost: () => usd,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    segment: segment.id,
  });
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = readMediaUrl(result.data, "video");
  if (!url) return { state: "failed", message: "Không nhận được video" };
  return { state: "done", url, cost: result.cost };
}

export async function cancelSegment(
  segment: JobSegment,
  cancel: Canceller = falCancel,
): Promise<CancelOutcome> {
  if (isFixture() || !segment.requestId) return "removed";
  return cancel(speechModel(segment.model).endpoint, segment.requestId);
}

const FIXTURE_SPEECH_STARTS_SEC = 0.4;

function fixtureSpeech(segment: JobSegment, seconds: number): SpeechBounds {
  const cutOff =
    (segment.cutOffs ?? 0) < fixtureTimesForShot("HYAN_FIXTURE_CUTOFF", segmentAnchor(segment) + 1);
  const end = FIXTURE_SPEECH_STARTS_SEC + speakingSec(segment.text);
  return { start: FIXTURE_SPEECH_STARTS_SEC, end: cutOff ? seconds : Math.min(end, seconds) };
}

export async function downloadSegment(input: {
  url: string;
  job: VideoJob;
  segment: JobSegment;
  stillPath: string;
  out: string;
}): Promise<void> {
  const { url, segment } = input;
  if (url === "fixture:speech") {
    fixtureNetwork();
    const seconds = (segment.seconds ?? 0) + (speechModel(segment.model).runsLongerSec ?? 0);
    await fixtureSpeechClip({
      still: input.stillPath,
      voice: fixtureVoice(),
      seconds,
      speech: fixtureSpeech(segment, seconds),
      out: input.out,
      size: outputSize(input.job.resolution),
    });
    return;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Đường dẫn tải không hợp lệ");
  const res = await fetch(parsed, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Không tải được (${res.status})`), { status: res.status });
  }
  await writeFile(input.out, Buffer.from(await res.arrayBuffer()));
}

export async function heardSpeech(clipPath: string, clipSec: number): Promise<SpeechBounds | null> {
  return speechBounds(await silenceLog(clipPath, SILENCE_NOISE_DB, SILENCE_MIN_SEC), clipSec);
}
