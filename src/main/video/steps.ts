import { randomUUID } from "node:crypto";
import { copyFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { app } from "electron";
import { frameUsd, shotEstimateUsd } from "../../shared/cost/estimate";
import { calculated, type ResultCost } from "../../shared/cost/rates";
import { imageModel } from "../../shared/image-models";
import type { Asset } from "../../shared/ipc";
import { placeholderOf, placeholdersIn, readMediaUrl } from "../../shared/live-plan";
import { OUTPUT_SIZE } from "../../shared/output-size";
import { MOTION_OF_A_STILL_MOMENT, withCleanFrame } from "../../shared/prompt-text";
import {
  type Gaze,
  productFreeProps,
  type ShotPlan,
  withoutProducts,
} from "../../shared/shot-plan";
import {
  type JobFrame,
  type JobShot,
  liveSeconds,
  modelsOf,
  type VideoJob,
  videoModelOf,
} from "../../shared/video-job";
import { motionSec } from "../../shared/video-models";
import {
  type Canceller,
  type CancelOutcome,
  type Fal,
  falCancel,
  falPoll,
  falSubmit,
} from "../fal";
import { uploadImages } from "../fal-upload";
import { assetDir } from "../media";
import { falClient, providerMode } from "../providers";
import { fixtureClip } from "./ffmpeg";
import { fixtureNetwork, fixtureTimesForShot } from "./fixture-net";

const isFixture = () => providerMode() === "fixture";
const fixtureMedia = (file: string) => join(app.getAppPath(), "resources/fixtures/video", file);

let falPromise: Promise<Fal> | null = null;
function fal(): Promise<Fal> {
  falPromise ??= falClient().catch((error) => {
    falPromise = null;
    throw error;
  });
  return falPromise;
}

const assetImagePaths = (asset: Asset, max: number) =>
  asset.images.slice(0, max).map((img) => join(assetDir(asset.id), img.file));

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

const props = (plan: ShotPlan, productNames: readonly string[]) => {
  const list = productFreeProps(plan.props, productNames);
  return list.length
    ? `Objects in the scene, each exactly once: ${list.map((p) => `${p.name} (${p.where})`).join("; ")}. No other objects on the table.`
    : "";
};

const NO_PACKAGING =
  "No product packaging and no box, bag, pouch or label with lettering anywhere in the image.";

const stateAt = (plan: ShotPlan, shot: number) =>
  plan.stateChanges
    .filter((c) => c.fromShot <= shot)
    .map((c) => c.change)
    .join(" ");

export interface FrameInputs {
  plan: ShotPlan;
  place: Asset;
  cast: Map<string, Asset>;
  widePath?: string;
  lookPaths?: Map<string, string>;
  productNames: string[];
}

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
  if (frame.redone && frame.check) {
    prompt.push(`A previous attempt was rejected because it showed: ${frame.check}. Avoid that.`);
  }
  if (frame.note) prompt.push(`Important correction, follow it exactly: ${frame.note}`);
  const client = await fal();
  const urls = await uploadImages(client, paths);
  const model = stillModel(job);
  return falSubmit(
    client,
    model.endpoint,
    model.input(prompt.filter(Boolean).join(" "), urls, "9:16"),
    {
      purpose: "video-frame",
      sessionId: job.sessionId,
      scriptId: job.scriptId,
      frame: frame.id,
      attempt: frame.sending,
    },
  );
}

const stillModel = (job: VideoJob) => imageModel(modelsOf(job).image);

export type StepPoll =
  | { state: "pending" }
  | { state: "failed"; message: string }
  | { state: "done"; url: string; cost: ResultCost; seconds?: number };

const FIXTURE_FRAME_MS = 3000;

export async function pollFrame(job: VideoJob, frame: JobFrame): Promise<StepPoll> {
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(frame.submittedAt ?? new Date().toISOString());
    return elapsed < FIXTURE_FRAME_MS
      ? { state: "pending" }
      : { state: "done", url: "fixture:cover", cost: calculated(frameUsd(job)) };
  }
  const client = await fal();
  const result = await falPoll<{ images?: { url: string }[] }>(
    client,
    frame.endpoint ?? stillModel(job).endpoint,
    frame.requestId as string,
    {
      purpose: "video-frame",
      cost: () => frameUsd(job),
      sessionId: job.sessionId,
      scriptId: job.scriptId,
    },
  );
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = result.data.images?.[0]?.url;
  if (!url) return { state: "failed", message: "Không nhận được ảnh" };
  return { state: "done", url, cost: result.cost };
}

const fixtureShotMs = (shot: JobShot) => 5000 + ((shot.index * 7) % 5) * 1000;

const fixtureFailures = (shotNumber: number) =>
  fixtureTimesForShot("HYAN_FIXTURE_FAIL", shotNumber);

const NOTHING_BILLABLE_WAS_SENT: CancelOutcome = "removed";

export async function cancelFrame(
  job: VideoJob,
  frame: JobFrame,
  cancel: Canceller = falCancel,
): Promise<CancelOutcome> {
  if (isFixture() || !frame.requestId) return NOTHING_BILLABLE_WAS_SENT;
  return cancel(frame.endpoint ?? stillModel(job).endpoint, frame.requestId);
}

export async function cancelShot(
  job: VideoJob,
  shot: JobShot,
  cancel: Canceller = falCancel,
): Promise<CancelOutcome> {
  if (isFixture() || !shot.requestId) return NOTHING_BILLABLE_WAS_SENT;
  return cancel(shot.endpoint ?? videoModelOf(job).motionEndpoint, shot.requestId);
}

export async function download(
  url: string,
  out: string,
  fixture?: { framePath?: string; seconds?: number },
): Promise<void> {
  if (url.startsWith("fixture:")) fixtureNetwork();
  if (url === "fixture:cover" && fixture?.framePath) {
    await copyFile(fixture.framePath, out);
    return;
  }
  if (url === "fixture:shot" && fixture?.seconds) {
    await fixtureClip(fixtureMedia("shot.mp4"), fixture.seconds, out, OUTPUT_SIZE);
    return;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Đường dẫn tải không hợp lệ");
  const res = await fetch(parsed, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Không tải được (${res.status})`), { status: res.status });
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

export interface LiveFiles {
  place?: Asset;
  cast: Asset[];
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

async function resolveInput(
  client: Fal,
  input: Record<string, unknown>,
  paths: Map<string, { path: string }>,
): Promise<Record<string, unknown>> {
  const urls = new Map<string, string>();
  for (const [name, { path }] of paths) {
    urls.set(name, (await uploadImages(client, [path], 2048))[0] as string);
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

function stillRequest(job: VideoJob, keyframe: { input: Record<string, unknown> }) {
  const model = stillModel(job);
  const prompt = typeof keyframe.input.prompt === "string" ? keyframe.input.prompt : "";
  const references = placeholdersIn(keyframe.input).map((name) => `{{${name}}}`);
  return { endpoint: model.endpoint, input: model.input(prompt, references, "9:16") };
}

export async function submitLiveFrame(
  job: VideoJob,
  frame: JobFrame,
  files: LiveFiles,
): Promise<{ requestId: string; endpoint: string }> {
  const keyframe = job.live?.plan.keyframes.find((k) => k.id === frame.keyframe);
  if (!keyframe) throw new Error("Không tìm thấy khung hình trong kế hoạch");
  const { endpoint, input: body } = stillRequest(job, keyframe);
  const paths = new Map(
    placeholdersIn(body).map((name) => [name, { path: placeholderPath(job, name, files) }]),
  );
  if (isFixture()) {
    fixtureNetwork();
    return { requestId: `fixture-${randomUUID()}`, endpoint };
  }
  const client = await fal();
  const input = await resolveInput(client, withCorrections(body, frame), paths);
  const requestId = await falSubmit(client, endpoint, input, {
    purpose: "video-frame",
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    frame: frame.id,
    attempt: frame.sending,
  });
  return { requestId, endpoint };
}

export async function pollLiveFrame(job: VideoJob, frame: JobFrame): Promise<StepPoll> {
  const unit = frameUsd(job);
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(frame.submittedAt ?? new Date().toISOString());
    return elapsed < FIXTURE_FRAME_MS
      ? { state: "pending" }
      : { state: "done", url: "fixture:cover", cost: calculated(unit) };
  }
  const client = await fal();
  const result = await falPoll<unknown>(
    client,
    frame.endpoint as string,
    frame.requestId as string,
    {
      purpose: "video-frame",
      cost: () => unit,
      sessionId: job.sessionId,
      scriptId: job.scriptId,
    },
  );
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = readMediaUrl(result.data, "image");
  if (!url) return { state: "failed", message: "Không nhận được ảnh" };
  return { state: "done", url, cost: result.cost };
}

function motionPrompt(job: VideoJob, shot: JobShot): string {
  const planned = job.live?.plan.routes[shot.index]?.input?.prompt;
  return typeof planned === "string" && planned.trim() ? planned : MOTION_OF_A_STILL_MOMENT;
}

export async function submitMotion(
  job: VideoJob,
  shot: JobShot,
  framePath: string,
): Promise<{ requestId: string; endpoint: string }> {
  const model = videoModelOf(job);
  const body = withCleanFrame(
    model.motion({
      prompt: motionPrompt(job, shot),
      imageUrl: "{{keyframe}}",
      seconds: motionSec(model, liveSeconds(job, shot)),
    }),
  );
  if (isFixture()) {
    fixtureNetwork();
    return { requestId: `fixture-${randomUUID()}`, endpoint: model.motionEndpoint };
  }
  const client = await fal();
  const input = await resolveInput(client, body, new Map([["keyframe", { path: framePath }]]));
  const requestId = await falSubmit(client, model.motionEndpoint, input, {
    purpose: "video-shot",
    model: model.id,
    seconds: motionSec(model, liveSeconds(job, shot)),
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    shot: shot.index,
    attempt: shot.sending,
  });
  return { requestId, endpoint: model.motionEndpoint };
}

export async function pollMotion(job: VideoJob, shot: JobShot): Promise<StepPoll> {
  const usd = shotEstimateUsd(job, shot);
  if (isFixture()) {
    fixtureNetwork();
    const elapsed = Date.now() - Date.parse(shot.submittedAt ?? new Date().toISOString());
    if (shot.failures < fixtureFailures(shot.index + 1) && elapsed > fixtureShotMs(shot) * 0.6) {
      return { state: "failed", message: "Lỗi giả lập" };
    }
    if (elapsed < fixtureShotMs(shot)) return { state: "pending" };
    return {
      state: "done",
      url: "fixture:shot",
      cost: calculated(usd),
      seconds: liveSeconds(job, shot),
    };
  }
  const client = await fal();
  const endpoint = shot.endpoint ?? videoModelOf(job).motionEndpoint;
  const result = await falPoll<unknown>(client, endpoint, shot.requestId as string, {
    purpose: "video-shot",
    cost: () => usd,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
    shot: shot.index,
  });
  if (result.state === "pending") return { state: "pending" };
  if (result.state === "failed") return result;
  const url = readMediaUrl(result.data, "video");
  if (!url) return { state: "failed", message: "Không nhận được video" };
  return { state: "done", url, cost: result.cost };
}
