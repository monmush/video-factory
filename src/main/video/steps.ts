import { randomUUID } from "node:crypto";
import { copyFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { app } from "electron";
import { outputResolution, outputSize } from "../../shared/batch-settings";
import { syllables, VOICE_USD_PER_CHAR } from "../../shared/board";
import { voiceText } from "../../shared/cues";
import type { Asset } from "../../shared/ipc";
import { fitDuration, placeholderOf, placeholdersIn, readMediaUrl } from "../../shared/live-plan";
import { speakPrompt, withNoCaptions } from "../../shared/prompt-text";
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
  frameUsd,
  type JobFrame,
  type JobShot,
  lineSpans,
  liveSeconds,
  shotEstimateUsd,
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
import { fixtureClip, loopAudio, padAudio, probeSeconds, type Size } from "./ffmpeg";
import { fixtureNetwork } from "./fixture-net";
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
    fixtureNetwork();
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
  if (isFixture()) {
    fixtureNetwork();
    return `fixture-${randomUUID()}`;
  }
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
      // The mark saved in job.json for this attempt (src/shared/request-reconcile.ts).
      attempt: frame.sending,
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
    fixtureNetwork();
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

/** Sends a speaking shot to `model` (the caller records it on the shot); returns the request id. */
export async function submitShot(
  job: VideoJob,
  shot: JobShot,
  model: VideoModel,
  framePath: string,
  audioPath: string,
): Promise<string> {
  if (isFixture()) {
    fixtureNetwork();
    return `fixture-${randomUUID()}`;
  }
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
      prompt: speakPrompt(
        shot.kind === "listener",
        job.plan?.seats.find((s) => s.characterId === shot.characterId)?.ambient,
        shot.visual,
      ),
    }),
    {
      purpose: "video-shot",
      model: model.id,
      sessionId: job.sessionId,
      scriptId: job.scriptId,
      shot: shot.index,
      attempt: shot.sending,
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
    fixtureNetwork();
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
  if (url.startsWith("fixture:")) fixtureNetwork();
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

// ---------------------------------------------------------------------------
// Experiment branch: the live plan's keyframes and shots, by one generic
// executor (docs/LIVE_DIRECTOR_EXPERIMENT.md). Endpoint and input come from
// the plan; code resolves the placeholders, uploads the files, submits through
// the queue (the request id is saved before anything else), polls the same
// endpoint and reads the first image or video URL from the result.
// ---------------------------------------------------------------------------

/** Local files behind a keyframe's placeholders: the place's and the cast's photos, earlier keyframes. */
export interface LiveFiles {
  place?: Asset;
  /** Characters in order of first speaking (the director's cast1, cast2…). */
  cast: Asset[];
  /** The job folder, where earlier keyframes are. */
  dir: string;
}

function placeholderPath(job: VideoJob, name: string, files: LiveFiles): string {
  const place = /^place-(\d+)$/.exec(name);
  if (place && files.place) {
    const image = files.place.images[Number(place[1]) - 1];
    if (image) return join(assetDir(files.place.id), image.file);
  }
  const cast = /^cast(\d+)-(\d+)$/.exec(name);
  if (cast) {
    const person = files.cast[Number(cast[1]) - 1];
    const image = person?.images[Number(cast[2]) - 1];
    if (person && image) return join(assetDir(person.id), image.file);
  }
  const keyframe = /^keyframe:(.+)$/.exec(name);
  if (keyframe) {
    const file = job.frames.find((f) => f.id === `kf:${keyframe[1]}`)?.file;
    if (file) return join(files.dir, file);
  }
  throw new Error(`Không tìm thấy tệp cho {{${name}}}`);
}

/** The input with every placeholder replaced by an uploaded URL (each file uploaded once). */
async function resolveInput(
  client: Fal,
  input: Record<string, unknown>,
  paths: Map<string, { path: string; audio?: boolean }>,
): Promise<Record<string, unknown>> {
  const urls = new Map<string, string>();
  for (const [name, { path, audio }] of paths) {
    urls.set(
      name,
      audio
        ? await uploadFile(client, path, "audio/mpeg")
        : ((await uploadImages(client, [path], 2048))[0] as string),
    );
  }
  const walk = (v: unknown): unknown => {
    const p = placeholderOf(v);
    if (p) {
      const url = urls.get(p);
      if (!url) throw new Error(`Không tìm thấy tệp cho {{${p}}}`);
      return url;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(input) as Record<string, unknown>;
}

/** Adds the operator's correction and the still check's reason to the request's prompt. */
function withCorrections(input: Record<string, unknown>, frame: JobFrame): Record<string, unknown> {
  const extra = [
    frame.redone && frame.check
      ? `A previous attempt was rejected because it showed: ${frame.check}. Avoid that.`
      : "",
    frame.note ? `Important correction, follow it exactly: ${frame.note}` : "",
  ].filter(Boolean);
  if (!extra.length || typeof input.prompt !== "string") return input;
  return { ...input, prompt: `${input.prompt} ${extra.join(" ")}` };
}

/** Submits a planned keyframe; returns the request id and the endpoint it went to. */
export async function submitLiveFrame(
  job: VideoJob,
  frame: JobFrame,
  files: LiveFiles,
): Promise<{ requestId: string; endpoint: string }> {
  const keyframe = job.live?.plan.keyframes.find((k) => k.id === frame.keyframe);
  if (!keyframe) throw new Error("Không tìm thấy khung hình trong kế hoạch");
  const paths = new Map(
    placeholdersIn(keyframe.input).map((name) => [
      name,
      { path: placeholderPath(job, name, files) },
    ]),
  );
  if (isFixture()) {
    fixtureNetwork();
    return { requestId: `fixture-${randomUUID()}`, endpoint: keyframe.endpoint };
  }
  const client = await fal();
  const input = await resolveInput(client, withCorrections(keyframe.input, frame), paths);
  const requestId = await falSubmit(client, keyframe.endpoint, input, {
    purpose: "video-frame",
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    frame: frame.id,
    attempt: frame.sending,
  });
  return { requestId, endpoint: keyframe.endpoint };
}

/** Polls a planned keyframe at the endpoint it was sent to. */
export async function pollLiveFrame(job: VideoJob, frame: JobFrame): Promise<StepPoll> {
  const unit = frameUsd(job, frame);
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(frame.submittedAt ?? new Date().toISOString());
    return elapsed < FIXTURE_FRAME_MS
      ? { state: "pending" }
      : { state: "done", url: "fixture:cover", costUsd: unit };
  }
  const client = await fal();
  const result = await falPoll<unknown>(
    client,
    frame.endpoint as string,
    frame.requestId as string,
    {
      purpose: "video-frame",
      // The plan's price for it, from the session's recorded rates.
      cost: () => unit,
      costIsEstimate: true,
      sessionId: job.sessionId,
      scriptId: job.scriptId,
    },
  );
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = readMediaUrl(result.data, "image");
  if (!url) return { state: "failed", message: "Không nhận được ảnh" };
  return { state: "done", url, costUsd: unit };
}

/**
 * Submits a planned lip-sync or motion shot. Lip-sync audio shorter than the
 * model's minimum is padded with silence first (trimmed again in assembly);
 * a motion clip is asked to last at least the shot.
 */
export async function submitLiveShot(
  job: VideoJob,
  shot: JobShot,
  framePath: string,
  audioPath: string | undefined,
  dir: string,
): Promise<{ requestId: string; endpoint: string }> {
  const live = job.live;
  const route = live?.plan.routes[shot.index];
  if (!live || !route?.endpoint || !route.input)
    throw new Error("Cảnh này không có trong kế hoạch");
  const endpoint = route.endpoint;
  // Every paid clip is told never to put text on screen, whoever wrote its prompt.
  let input = withNoCaptions(route.input);
  const paths = new Map<string, { path: string; audio?: boolean }>();
  for (const name of placeholdersIn(input)) {
    if (name === "keyframe") paths.set(name, { path: framePath });
    else if (name === "audio") {
      if (!audioPath) throw new Error("Thiếu âm thanh");
      let path = audioPath;
      const min = live.rates[endpoint]?.minSeconds;
      if (min && (shot.audioSec ?? 0) < min) {
        path = join(dir, `min${min}-${basename(audioPath)}`);
        await padAudio(audioPath, min, path);
      }
      paths.set(name, { path, audio: true });
    } else paths.set(name, { path: placeholderPath(job, name, { cast: [], dir }) });
  }
  if (route.route === "motion")
    input = fitDuration(live.schemas[endpoint], input, liveSeconds(shot)).input;
  if (isFixture()) {
    fixtureNetwork();
    return { requestId: `fixture-${randomUUID()}`, endpoint };
  }
  const client = await fal();
  const requestId = await falSubmit(client, endpoint, await resolveInput(client, input, paths), {
    purpose: "video-shot",
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    shot: shot.index,
    attempt: shot.sending,
  });
  return { requestId, endpoint };
}

/** Polls a planned shot at the endpoint it was sent to. */
export async function pollLiveShot(job: VideoJob, shot: JobShot): Promise<StepPoll> {
  const usd = shotEstimateUsd(job, shot);
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(shot.submittedAt ?? new Date().toISOString());
    if (shot.failures < fixtureFailures(shot.index + 1) && elapsed > fixtureShotMs(shot) * 0.6) {
      return { state: "failed", message: "Lỗi giả lập" };
    }
    if (elapsed < fixtureShotMs(shot)) return { state: "pending" };
    return { state: "done", url: "fixture:shot", costUsd: usd, seconds: liveSeconds(shot) };
  }
  const client = await fal();
  const result = await falPoll<unknown>(client, shot.endpoint as string, shot.requestId as string, {
    purpose: "video-shot",
    // The plan's price for it, from the session's recorded rates and its real length.
    cost: () => usd,
    costIsEstimate: true,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    shot: shot.index,
  });
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = readMediaUrl(result.data, "video");
  if (!url) return { state: "failed", message: "Không nhận được video" };
  return { state: "done", url, costUsd: usd };
}
