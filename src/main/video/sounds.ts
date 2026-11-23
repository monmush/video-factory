import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { calculated } from "../../shared/cost/rates";
import type { JobSound, SoundSourceId } from "../../shared/sound";
import { jobSoundSource, type VideoJob } from "../../shared/video-job";
import {
  type Canceller,
  type CancelOutcome,
  type Fal,
  falCancel,
  falPoll,
  falSubmit,
} from "../fal";
import { falClient, providerMode } from "../providers";
import { fixtureSound } from "./ffmpeg";
import { fixtureNetwork } from "./fixture-net";
import type { StepPoll } from "./steps";

export interface SoundMaker {
  submit: (job: VideoJob, sound: JobSound) => Promise<{ requestId: string }>;
  poll: (job: VideoJob, sound: JobSound) => Promise<StepPoll>;
  cancel: (sound: JobSound, cancel?: Canceller) => Promise<CancelOutcome>;
  download: (url: string, sound: JobSound, out: string) => Promise<void>;
}

const isFixture = () => providerMode() === "fixture";

let falPromise: Promise<Fal> | null = null;
function fal(): Promise<Fal> {
  falPromise ??= falClient().catch((error) => {
    falPromise = null;
    throw error;
  });
  return falPromise;
}

const FIXTURE_SOUND_MS = 2000;
const FIXTURE_FAILURES_EVERY_ATTEMPT = Number.POSITIVE_INFINITY;

export function fixtureSoundFailures(variable: string | undefined, id: string): number {
  for (const part of (variable ?? "").split(",")) {
    const match = /^(.+?)(?:x(\d+))?$/.exec(part.trim());
    if (match?.[1] === id) return match[2] ? Number(match[2]) : FIXTURE_FAILURES_EVERY_ATTEMPT;
  }
  return 0;
}

const EFFECTS_ENDPOINT = "elevenlabs/sound-effects/v3";

const generatedEffects: SoundMaker = {
  async submit(job, sound) {
    if (isFixture()) {
      fixtureNetwork();
      return { requestId: `fixture-${randomUUID()}` };
    }
    const requestId = await falSubmit(
      await fal(),
      EFFECTS_ENDPOINT,
      {
        text: sound.text,
        duration_seconds: sound.seconds,
        loop: sound.loop,
        output_format: "mp3_44100_128",
      },
      {
        purpose: "video-sound",
        sessionId: job.sessionId,
        scriptId: job.scriptId,
        sound: sound.id,
        attempt: sound.sending,
      },
    );
    return { requestId };
  },
  async poll(job, sound) {
    const usd = sound.seconds * jobSoundSource(job).usdPerSec;
    if (isFixture()) {
      fixtureNetwork();
      const elapsed = Date.now() - Date.parse(sound.submittedAt ?? new Date().toISOString());
      if (elapsed < FIXTURE_SOUND_MS) return { state: "pending" };
      if (sound.attempts < fixtureSoundFailures(process.env.HYAN_FIXTURE_SOUND_FAIL, sound.id)) {
        return { state: "failed", message: "Lỗi giả lập" };
      }
      return { state: "done", url: `fixture:sound:${sound.role}`, cost: calculated(usd) };
    }
    const result = await falPoll<{ audio?: { url?: string } }>(
      await fal(),
      EFFECTS_ENDPOINT,
      sound.requestId as string,
      {
        purpose: "video-sound",
        cost: () => usd,
        sessionId: job.sessionId,
        scriptId: job.scriptId,
        sound: sound.id,
      },
    );
    if (result.state === "pending") return { state: "pending" };
    if (result.state === "failed") return result;
    const url = result.data.audio?.url;
    if (!url) return { state: "failed", message: "Không nhận được âm thanh" };
    return { state: "done", url, cost: result.cost };
  },
  async cancel(sound, cancel = falCancel) {
    if (isFixture() || !sound.requestId) return "removed";
    return cancel(EFFECTS_ENDPOINT, sound.requestId);
  },
  async download(url, sound, out) {
    if (url.startsWith("fixture:sound:")) {
      fixtureNetwork();
      await fixtureSound(sound.role, sound.seconds, out);
      return;
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Đường dẫn tải không hợp lệ");
    const res = await fetch(parsed, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Không tải được (${res.status})`);
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
  },
};

const MAKERS: Record<SoundSourceId, SoundMaker> = { "generated-effects": generatedEffects };

export const soundMaker = (job: Pick<VideoJob, "soundSource">): SoundMaker =>
  MAKERS[jobSoundSource(job).id as SoundSourceId];
