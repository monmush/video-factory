import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { calculated, VOICE_SAMPLE_USD } from "../shared/cost/rates";
import type { VideoJob } from "../shared/video-job";
import { sampleIdentity, voiceRequest } from "../shared/voice-request";
import { characterTraitsOf, type JobVoice, type VoiceChoice } from "../shared/voice-step";
import { cleanVoiceText, type VoiceTraits } from "../shared/voices";
import {
  type Canceller,
  type CancelOutcome,
  type Fal,
  falCall,
  falCancel,
  falPoll,
  falSubmit,
} from "./fal";
import { voicesDir } from "./paths";
import { falClient, providerMode } from "./providers";
import { childPath } from "./safe-path";
import { probeSeconds, voiceSample } from "./video/ffmpeg";
import { fixtureNetwork } from "./video/fixture-net";
import type { StepPoll } from "./video/steps";

const ENDPOINT = "google/gemini-3.8-flash-tts";
const PURPOSE = "character-voice";

export const SHORTEST_SAMPLE_SEC = 2;
const FIXTURE_VOICE_MS = 4000;

const isFixture = () => providerMode() === "fixture";
const fixtureSource = () => join(app.getAppPath(), "resources/fixtures/video/dialogue.mp3");

type Result = { audio?: { url?: string } };

export const sampleFile = (text: string, character: VoiceTraits) =>
  `${createHash("sha256")
    .update(sampleIdentity(ENDPOINT, text, character))
    .digest("hex")}.mp3`;

export const samplePath = (file: string) => childPath(voicesDir(), file);

export async function sampleVersion(file: string): Promise<number | null> {
  const info = await stat(samplePath(file)).catch(() => null);
  return info?.isFile() ? Math.trunc(info.mtimeMs) : null;
}

export async function sampleExists(file: string): Promise<boolean> {
  return (await sampleVersion(file)) !== null;
}

export async function voiceChoice(
  characterId: string,
  text: string,
  character: VoiceTraits,
): Promise<VoiceChoice> {
  const file = sampleFile(text, character);
  return { characterId, text, character, file, ready: await sampleExists(file) };
}

let falPromise: Promise<Fal> | null = null;
function fal(): Promise<Fal> {
  falPromise ??= falClient().catch((error) => {
    falPromise = null;
    throw error;
  });
  return falPromise;
}

async function keep(source: string, file: string): Promise<void> {
  await mkdir(voicesDir(), { recursive: true });
  const tmp = samplePath(`${file}.${randomUUID()}.tmp.mp3`);
  try {
    await voiceSample(source, tmp);
    if ((await probeSeconds(tmp)) < SHORTEST_SAMPLE_SEC) throw new Error("Giọng tạo ra quá ngắn");
    await rename(tmp, samplePath(file));
  } finally {
    await rm(tmp, { force: true });
  }
}

async function keepDownload(url: string, file: string): Promise<void> {
  if (url === "fixture:voice") {
    fixtureNetwork();
    await keep(fixtureSource(), file);
    return;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Đường dẫn tải không hợp lệ");
  const res = await fetch(parsed, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Không tải được (${res.status})`), { status: res.status });
  }
  await mkdir(voicesDir(), { recursive: true });
  const download = samplePath(`${file}.${randomUUID()}.download`);
  try {
    await writeFile(download, Buffer.from(await res.arrayBuffer()));
    await keep(download, file);
  } finally {
    await rm(download, { force: true });
  }
}

const making = new Map<string, Promise<void>>();

async function makeNow(text: string, character: VoiceTraits, file: string): Promise<void> {
  if (isFixture()) {
    await new Promise((resolve) => setTimeout(resolve, FIXTURE_VOICE_MS));
    await keepDownload("fixture:voice", file);
    return;
  }
  const { data } = await falCall<Result>(await fal(), ENDPOINT, voiceRequest(text, character), {
    purpose: PURPOSE,
    cost: () => VOICE_SAMPLE_USD,
    costIsEstimate: true,
  });
  const url = data.audio?.url;
  if (!url) throw new Error("Không nhận được giọng nói");
  await keepDownload(url, file);
}

async function makeOnce(text: string, character: VoiceTraits, file: string): Promise<void> {
  const running = making.get(file);
  if (running) return running;
  const run = makeNow(text, character, file).finally(() => making.delete(file));
  making.set(file, run);
  return run;
}

function sampleFileOf(text: string, character: VoiceTraits): string {
  if (!cleanVoiceText(text)) throw new Error("Chưa có mô tả giọng");
  return sampleFile(text, character);
}

export async function makeSample(text: string, character: VoiceTraits): Promise<string> {
  const file = sampleFileOf(text, character);
  if (!(await sampleExists(file))) await makeOnce(text, character, file);
  return file;
}

export async function remakeSample(text: string, character: VoiceTraits): Promise<string> {
  const file = sampleFileOf(text, character);
  await makeOnce(text, character, file);
  return file;
}

export async function submitVoice(job: VideoJob, voice: JobVoice): Promise<string> {
  if (isFixture()) {
    fixtureNetwork();
    return `fixture-${randomUUID()}`;
  }
  return falSubmit(await fal(), ENDPOINT, voiceRequest(voice.text, characterTraitsOf(voice)), {
    purpose: PURPOSE,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    voice: voice.characterId,
    attempt: voice.sending,
  });
}

export async function pollVoice(job: VideoJob, voice: JobVoice): Promise<StepPoll> {
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(voice.submittedAt ?? new Date().toISOString());
    if (elapsed < FIXTURE_VOICE_MS) return { state: "pending" };
    return { state: "done", url: "fixture:voice", cost: calculated(VOICE_SAMPLE_USD) };
  }
  const result = await falPoll<Result>(await fal(), ENDPOINT, voice.requestId as string, {
    purpose: PURPOSE,
    cost: () => VOICE_SAMPLE_USD,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    voice: voice.characterId,
  });
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = result.data.audio?.url;
  if (!url) return { state: "failed", message: "Không nhận được giọng nói" };
  return { state: "done", url, cost: result.cost };
}

export async function cancelVoice(
  voice: JobVoice,
  cancel: Canceller = falCancel,
): Promise<CancelOutcome> {
  if (isFixture() || !voice.requestId) return "removed";
  return cancel(ENDPOINT, voice.requestId);
}

export const downloadVoice = (url: string, voice: JobVoice) => keepDownload(url, voice.file);
