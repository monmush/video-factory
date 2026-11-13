import { randomUUID } from "node:crypto";
import { copyFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { app } from "electron";
import { outputResolution, outputSize } from "../../shared/batch-settings";
import { syllables, VOICE_USD_PER_CHAR } from "../../shared/board";
import { voiceText } from "../../shared/cues";
import type { Asset } from "../../shared/ipc";
import {
  type Alignment,
  type Gaze,
  type LineChars,
  productFreeProps,
  type ShotPlan,
  withoutProducts,
} from "../../shared/shot-plan";
import {
  billedSeconds,
  type JobFrame,
  type JobShot,
  lineSpans,
  shotModel,
  type VideoJob,
} from "../../shared/video-job";
import { clipUsd, type VideoModel } from "../../shared/video-models";
import { resolveVoice, takenVoiceIds } from "../../shared/voices";
import { DEFAULT_IMAGE_MODEL, estimateAngles, MODELS } from "../angles";
import { type Fal, falPoll, falSubmit } from "../fal";
import { uploadFile, uploadImages } from "../fal-upload";
import { assetDir } from "../media";
import { elevenLabsClient, falClient, providerMode } from "../providers";
import { logUsage } from "../usage";
import { PROVIDER_VOICES, VOICE_DIRECTION } from "../voices";
import { fixtureClip, loopAudio, probeSeconds, type Size } from "./ffmpeg";
import { shotEndpoint } from "./shot-models";

// The paid steps of a video job, live and fixture. Live requests follow the
// experiments that already ran successfully (experiments/voice-auditions/
// dialogue-03.json, experiments/speaking-shot/fal-avatar.mjs). Fixture mode
// simulates them with the prototype's media and a few seconds per step, so
// the whole Video tab can be driven for free; fixture costs are shown in the
// job (as estimates) but never logged to usage.jsonl.

const VOICE_MODEL = "eleven_v4";

const isFixture = () => providerMode() === "fixture";
const fixtureMedia = (file: string) => join(app.getAppPath(), "resources/fixtures/video", file);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let falPromise: Promise<Fal> | null = null;
function fal(): Promise<Fal> {
  falPromise ??= falClient().catch((error) => {
    falPromise = null;
    throw error;
  });
  return falPromise;
}

// ---------------------------------------------------------------------------
// Voice: one dialogue request for the whole script, with per-line timings.
// ---------------------------------------------------------------------------

export interface VoiceResult {
  /** Whole dialogue, written to `out`. */
  seconds: number;
  spans: { start: number; end: number }[];
  costUsd: number;
  chars: number;
  /** Per-character timing, to cut inside a line; absent in fixture mode. */
  timing?: { alignment: Alignment; lineChars: LineChars[] };
}

export async function generateVoice(
  job: VideoJob,
  assets: readonly Asset[],
  out: string,
): Promise<VoiceResult> {
  const inputs = job.lines.map((line) => {
    const character = assets.find((a) => a.id === line.characterId && a.kind === "character");
    if (!character) throw new Error(`Không tìm thấy nhân vật ${line.speaker}`);
    const voice = resolveVoice(character, takenVoiceIds(assets, character.id));
    // Sounds like "[cười]" go to the voice as its own tags ("[laughs]").
    return {
      text: `${VOICE_DIRECTION} ${voiceText(line.text)}`,
      voiceId: PROVIDER_VOICES[voice].voiceId,
    };
  });
  const chars = inputs.reduce((n, i) => n + i.text.length, 0);

  if (isFixture()) {
    await wait(3000);
    // Lines back to back at their estimated length, over the sample dialogue.
    let at = 0;
    const spans = job.lines.map((line) => {
      const seconds = Math.max(0.8, syllables([line]) / 3.7);
      const span = { start: at + 0.2, end: at + 0.2 + seconds };
      at = span.end + 0.2;
      return span;
    });
    await loopAudio(fixtureMedia("dialogue.mp3"), at + 0.3, out);
    return { seconds: at + 0.3, spans, costUsd: chars * VOICE_USD_PER_CHAR, chars };
  }

  const client = await elevenLabsClient();
  const { data, rawResponse } = await client.textToDialogue
    .convertWithTimestamps(
      {
        modelId: VOICE_MODEL,
        languageCode: "vi",
        inputs,
        outputFormat: "mp3_44100_128",
        audioEffects: { distance: 0, sendLevel: 0, pan: 0 },
      },
      { maxRetries: 0, timeoutInSeconds: 180 },
    )
    .withRawResponse();
  const bytes = Buffer.from(data.audioBase64, "base64");
  if (!bytes.length) throw new Error("Không nhận được giọng đọc");
  // Billed characters as the provider reports them, else what was sent.
  const billed = Number(rawResponse.headers.get("x-character-count")) || chars;
  const costUsd = billed * VOICE_USD_PER_CHAR;
  await logUsage({
    provider: "elevenlabs",
    purpose: "video-voice",
    model: VOICE_MODEL,
    requestId: rawResponse.headers.get("request-id") ?? undefined,
    characters: billed,
    cost: costUsd,
    costIsEstimate: true,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
  });
  await writeFile(out, bytes);
  // Keep the provider's full timing (per character and per segment) beside the
  // audio: animated word-by-word subtitles can be added later without paying
  // for the voice again.
  await writeFile(
    `${out}.timing.json`,
    JSON.stringify({
      voiceSegments: data.voiceSegments,
      alignment: data.alignment,
      normalizedAlignment: data.normalizedAlignment,
    }),
  );
  const seconds = await probeSeconds(out);
  const spans = lineSpans(data.voiceSegments ?? [], inputs.length);
  if (!spans) throw new Error("Giọng đọc thiếu mốc thời gian từng câu");
  return {
    seconds,
    spans,
    costUsd,
    chars: billed,
    timing: timingOf(data.alignment, data.voiceSegments ?? [], inputs.length),
  };
}

/** Where each line sits in the provider's character timing. */
function timingOf(
  alignment: Alignment | undefined | null,
  segments: {
    dialogueInputIndex: number;
    characterStartIndex: number;
    characterEndIndex: number;
  }[],
  lineCount: number,
): VoiceResult["timing"] {
  if (!alignment?.characters?.length) return undefined;
  const lineChars: LineChars[] = [];
  for (let i = 0; i < lineCount; i++) {
    const mine = segments.filter((s) => s.dialogueInputIndex === i);
    if (!mine.length) return undefined;
    lineChars.push({
      start: Math.min(...mine.map((s) => s.characterStartIndex)),
      end: Math.max(...mine.map((s) => s.characterEndIndex)),
    });
  }
  return { alignment, lineChars };
}

// ---------------------------------------------------------------------------
// Start frames: one 9:16 still per speaking character, in the environment.
// ---------------------------------------------------------------------------

const assetImagePaths = (asset: Asset, max: number) =>
  asset.images.slice(0, max).map((img) => join(assetDir(asset.id), img.file));

/** The character's cover photo as its frame (no environment). */
export async function coverFrame(character: Asset, dir: string): Promise<string> {
  const cover = character.images[0];
  if (!cover) throw new Error(`${character.name} chưa có ảnh`);
  const file = `frame-${character.id}${extname(cover.file) || ".png"}`;
  await copyFile(join(assetDir(character.id), cover.file), join(dir, file));
  return file;
}

const GAZE: Record<Gaze, string> = {
  frame_right:
    "Their face, eyes and shoulders are turned toward the RIGHT edge of the image (the viewer's right), where the person they are talking to sits just out of frame; seen in three-quarter view, not facing the camera.",
  frame_left:
    "Their face, eyes and shoulders are turned toward the LEFT edge of the image (the viewer's left), where the person they are talking to sits just out of frame; seen in three-quarter view, not facing the camera.",
  camera: "They face the camera with the head turned very slightly to one side.",
};

const IDENTITY =
  "Identical face, age, skin, hair, facial hair, body proportions, outfit, colours and accessories as in their reference photos. Keep any logo or lettering on clothing exactly as in the references; if unreadable, keep that area plain.";

/**
 * The plan's props, never a product: products are never generated (B6), so a
 * prop that names one is dropped here even if a plan slipped through.
 */
const props = (plan: ShotPlan, productNames: readonly string[]) => {
  const list = productFreeProps(plan.props, productNames);
  return list.length
    ? `Objects in the scene, each exactly once: ${list.map((p) => `${p.name} (${p.where})`).join("; ")}. No other objects on the table.`
    : "";
};

const NO_PACKAGING =
  "No product packaging and no box, bag, pouch or label with lettering anywhere in the image.";

/** What has changed in the scene by this shot (S5). */
const stateAt = (plan: ShotPlan, shot: number) =>
  plan.stateChanges
    .filter((c) => c.fromShot <= shot)
    .map((c) => c.change)
    .join(" ");

export interface FrameInputs {
  plan: ShotPlan;
  place: Asset;
  /** Characters by id. */
  cast: Map<string, Asset>;
  /** The wide still, once it exists (every other generated still is drawn from it). */
  widePath?: string;
  /** Kept stills of the series by character: used as the people in the wide still. */
  lookPaths?: Map<string, string>;
  /** Names of the library's products: never drawn, so never named in a still request. */
  productNames: string[];
}

/** Reference images and prompt for one still (docs/DIRECTING_RULES.md, layer B). */
function frameRequest(job: VideoJob, frame: JobFrame, inputs: FrameInputs) {
  const { plan, place, cast, productNames } = inputs;
  const visual = (text?: string) => withoutProducts(text ?? "", productNames);
  const name = (id: string) => cast.get(id)?.name ?? "";
  const placeNotes = place.description.trim()
    ? `Place notes (Vietnamese): ${place.description.trim()}`
    : "";
  if (frame.kind === "wide") {
    const people = plan.seats
      .map((s) => cast.get(s.characterId))
      .filter((a): a is Asset => Boolean(a));
    const shot = job.shots.find((s) => s.kind === "wide");
    const seating = plan.seats
      .map(
        (s) =>
          `${name(s.characterId)} sits on the ${s.side === "centre" ? "middle" : s.side} of the image`,
      )
      .join("; ");
    return {
      paths: [
        ...assetImagePaths(place, 2),
        ...people.map((p) => inputs.lookPaths?.get(p.id) ?? (assetImagePaths(p, 1)[0] as string)),
      ],
      prompt: [
        `The first ${Math.min(2, place.images.length)} photos show a place. The next photos show one person each, in this order: ${people.map((p) => p.name).join(", ")}.`,
        "Create a new photorealistic vertical wide shot of exactly this place with exactly these people seated in it, the whole scene visible, faces small.",
        `${seating}. They are turned toward each other, talking.`,
        IDENTITY,
        props(plan, productNames),
        visual(shot?.visual) ? `Moment: ${visual(shot?.visual)}` : "",
        "Keep the place's furniture, materials and light as in its photos. No other people. No text overlays.",
        NO_PACKAGING,
        placeNotes,
        ...people.map((p) =>
          p.description.trim() ? `${p.name} notes (Vietnamese): ${p.description.trim()}` : "",
        ),
      ],
    };
  }
  if (frame.kind === "character") {
    const character = cast.get(frame.characterId ?? "");
    if (!character) throw new Error("Không tìm thấy nhân vật");
    const seat = plan.seats.find((s) => s.characterId === character.id);
    const lone = plan.seats.length < 2;
    return {
      paths: [...assetImagePaths(character, 2), ...(inputs.widePath ? [inputs.widePath] : [])],
      prompt: [
        inputs.widePath
          ? `The first photos show one person; the last photo is the scene, where this person sits on the ${seat?.side === "centre" ? "middle" : (seat?.side ?? "middle")} of the image.`
          : "The photos show one person.",
        "Create a new photorealistic vertical medium close-up, chest up, of exactly this person seated in that same seat of that same scene.",
        IDENTITY,
        GAZE[lone ? "camera" : (seat?.looks ?? "camera")],
        seat?.behind ? `Behind them: ${seat.behind}` : "",
        "Mouth closed, calm natural expression, as if listening before speaking. Hands rest low, away from the face.",
        "Only this one person is in the image. The same light and the same objects as the scene; no duplicated objects or props. No text overlays.",
        NO_PACKAGING,
        character.description.trim()
          ? `Person notes (Vietnamese): ${character.description.trim()}`
          : "",
        placeNotes,
      ],
    };
  }
  if (frame.kind === "product") {
    // The plate: the planned spot, empty. The product's own photo is placed on it afterwards.
    const shot = job.shots[frame.shot ?? -1];
    const state = stateAt(plan, frame.shot ?? 0);
    return {
      paths: [...(inputs.widePath ? [inputs.widePath] : []), ...assetImagePaths(place, 1)],
      prompt: [
        "The photos show the scene. Create a new photorealistic vertical close shot inside exactly this scene, same light, materials and objects, of the spot where an object will be placed later:",
        visual(shot?.visual) || "an empty place on the main surface in front of the camera.",
        "The surface fills the lower half of the image, seen from slightly above; the spot is in the centre, just below the middle of the image, empty and in sharp focus, with free space above it. Other objects stay at the sides or behind, never in the centre.",
        "No hands, no people.",
        props(plan, productNames),
        state ? `By now in the scene: ${visual(state)}` : "",
        "No text, labels or signs.",
        NO_PACKAGING,
        placeNotes,
      ],
    };
  }
  // Detail of an object or an action.
  const shot = job.shots[frame.shot ?? -1];
  const state = stateAt(plan, frame.shot ?? 0);
  return {
    paths: [...(inputs.widePath ? [inputs.widePath] : []), ...assetImagePaths(place, 1)],
    prompt: [
      "The photos show the scene. Create a new photorealistic vertical close detail shot inside exactly this scene, same light, materials and objects:",
      visual(shot?.visual),
      "No faces in frame; hands and sleeves may appear, matching the people's clothing in the scene.",
      props(plan, productNames),
      state ? `By now in the scene: ${visual(state)}` : "",
      "No text, labels or signs.",
      NO_PACKAGING,
      placeNotes,
    ],
  };
}

/** Submits a generated still; returns the request id. */
export async function submitFrame(
  job: VideoJob,
  frame: JobFrame,
  inputs: FrameInputs,
): Promise<string> {
  if (isFixture()) return `fixture-${randomUUID()}`;
  const { paths, prompt } = frameRequest(job, frame, inputs);
  // A redo after the automatic check says what was wrong with the first attempt.
  if (frame.redone && frame.check) {
    prompt.push(`A previous attempt was rejected because it showed: ${frame.check}. Avoid that.`);
  }
  // The operator's correction outranks everything else in the request.
  if (frame.note) prompt.push(`Important correction, follow it exactly: ${frame.note}`);
  const client = await fal();
  const urls = await uploadImages(client, paths);
  const model = MODELS[DEFAULT_IMAGE_MODEL];
  return falSubmit(
    client,
    model.endpoint,
    model.input(prompt.filter(Boolean).join(" "), urls, "9:16"),
    {
      purpose: "video-frame",
      sessionId: job.sessionId,
      scriptId: job.scriptId,
      frame: frame.id,
    },
  );
}

export type StepPoll =
  | { state: "pending" }
  | { state: "failed"; message: string }
  | { state: "done"; url: string; costUsd: number; seconds?: number };

const FIXTURE_FRAME_MS = 3000;

export async function pollFrame(job: VideoJob, frame: JobFrame): Promise<StepPoll> {
  if (isFixture()) {
    const elapsed = Date.now() - Date.parse(frame.submittedAt ?? new Date().toISOString());
    return elapsed < FIXTURE_FRAME_MS
      ? { state: "pending" }
      : { state: "done", url: "fixture:cover", costUsd: 0.12 };
  }
  const client = await fal();
  const model = MODELS[DEFAULT_IMAGE_MODEL];
  // Image models bill by tokens and do not return the charge; log fal's historical average.
  const { cost: unit } = await estimateAngles(DEFAULT_IMAGE_MODEL, 1);
  const result = await falPoll<{ images?: { url: string }[] }>(
    client,
    model.endpoint,
    frame.requestId as string,
    {
      purpose: "video-frame",
      cost: () => unit,
      costIsEstimate: true,
      sessionId: job.sessionId,
      scriptId: job.scriptId,
    },
  );
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = result.data.images?.[0]?.url;
  if (!url) return { state: "failed", message: "Không nhận được ảnh" };
  return { state: "done", url, costUsd: unit };
}

// ---------------------------------------------------------------------------
// Speaking shots: image + that line's audio.
// ---------------------------------------------------------------------------

// Only models whose endpoint takes a prompt receive these (`takesPrompt` in
// src/shared/video-models.ts). The background asks for gentle life instead of
// a frozen photograph: an experiment, unproven until seen live
// (docs/DIRECTING_RULES.md, "Life in the background").
const SHOT_PROMPT =
  "The person speaks naturally with subtle head movement and natural expression. Keep the face, hair and outfit faithful to the reference image; stationary camera.";
const LISTEN_PROMPT =
  "The person listens silently with the mouth closed, reacting only with the eyes, brows and a slight head movement. Keep the face, hair and outfit faithful to the reference image; stationary camera.";
/** The place behind the person: the same, but not frozen. */
const background = (ambient?: string) =>
  ambient
    ? `The place behind them stays exactly the same, with gentle natural motion: ${ambient.replace(/[.\s]+$/, "")}. Nothing new appears.`
    : "Keep the place behind them faithful to the reference image.";

/** Sends a speaking shot to `model` (the caller records it on the shot); returns the request id. */
export async function submitShot(
  job: VideoJob,
  shot: JobShot,
  model: VideoModel,
  framePath: string,
  audioPath: string,
): Promise<string> {
  if (isFixture()) return `fixture-${randomUUID()}`;
  const client = await fal();
  const [imageUrl] = await uploadImages(client, [framePath]);
  const audioUrl = await uploadFile(client, audioPath, "audio/mpeg");
  return falSubmit(
    client,
    model.endpoint,
    shotEndpoint(model.id).input({
      imageUrl: imageUrl as string,
      audioUrl,
      resolution: outputResolution(job.resolution),
      prompt: [
        shot.kind === "listener" ? LISTEN_PROMPT : SHOT_PROMPT,
        background(job.plan?.seats.find((s) => s.characterId === shot.characterId)?.ambient),
        shot.visual,
      ]
        .filter(Boolean)
        .join(" "),
    }),
    {
      purpose: "video-shot",
      model: model.id,
      sessionId: job.sessionId,
      scriptId: job.scriptId,
      shot: shot.index,
    },
  );
}

/** Fixture shot lengths: a few seconds each, varied so shots finish out of order. */
const fixtureShotMs = (shot: JobShot) => 5000 + ((shot.index * 7) % 5) * 1000;

/** HYAN_FIXTURE_FAIL="2,4x2": shot 2 fails once (retried automatically), shot 4 twice (fails). */
function fixtureFailures(shotNumber: number): number {
  for (const part of (process.env.HYAN_FIXTURE_FAIL ?? "").split(",")) {
    const [n, times] = part.trim().split("x");
    if (Number(n) === shotNumber) return Number(times ?? 1) || 1;
  }
  return 0;
}

export async function pollShot(job: VideoJob, shot: JobShot): Promise<StepPoll> {
  // Always the model that made this request: its endpoint holds the result.
  const model = shotModel(job, shot);
  if (isFixture()) {
    const elapsed = Date.now() - Date.parse(shot.submittedAt ?? new Date().toISOString());
    if (shot.failures < fixtureFailures(shot.index + 1) && elapsed > fixtureShotMs(shot) * 0.6) {
      return { state: "failed", message: "Lỗi giả lập" };
    }
    if (elapsed < fixtureShotMs(shot)) return { state: "pending" };
    const seconds = billedSeconds(shot);
    return {
      state: "done",
      url: "fixture:shot",
      costUsd: clipUsd(model, seconds, job.resolution),
      seconds,
    };
  }
  const client = await fal();
  const { read } = shotEndpoint(model.id);
  // Seconds of output as reported, else the audio sent (padded to the model's minimum).
  const secondsOf = (data: unknown) => read(data).seconds ?? billedSeconds(shot);
  const result = await falPoll<unknown>(client, model.endpoint, shot.requestId as string, {
    purpose: "video-shot",
    model: model.id,
    // Billed per second of output; the listed rate, so an estimate.
    cost: (data) => clipUsd(model, secondsOf(data), job.resolution),
    costIsEstimate: true,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    shot: shot.index,
  });
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = read(result.data).url;
  if (!url) return { state: "failed", message: "Không nhận được video" };
  const seconds = secondsOf(result.data);
  return { state: "done", url, costUsd: clipUsd(model, seconds, job.resolution), seconds };
}

/** Fetches a finished result into the job folder (fixture results are made locally). */
export async function download(
  url: string,
  out: string,
  fixture?: { framePath?: string; audioPath?: string; size?: Size },
): Promise<void> {
  if (url === "fixture:cover" && fixture?.framePath) {
    await copyFile(fixture.framePath, out);
    return;
  }
  if (url === "fixture:shot" && fixture?.audioPath) {
    await fixtureClip(
      fixtureMedia("shot.mp4"),
      fixture.audioPath,
      out,
      fixture.size ?? outputSize(),
    );
    return;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Đường dẫn tải không hợp lệ");
  const res = await fetch(parsed, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Không tải được (${res.status})`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}
