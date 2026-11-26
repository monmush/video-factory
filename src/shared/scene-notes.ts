import type { Mishap, MishapKind } from "./mishaps";
import { type ModelKind, modelName } from "./models";
import { frameFor, type JobShot, segmentAnchor, type VideoJob } from "./video-job";

type Made = "still" | "clip";
type Outcome = "made" | "making" | "failed";

const REDRAWN_KINDS: readonly MishapKind[] = ["lettering", "packaging", "people", "gaze"];
const NOTHING_REDONE_KINDS: readonly MishapKind[] = ["still-instead", "simpler", "cut-kept"];

const MODEL_KIND: Record<Made, ModelKind> = { still: "image", clip: "video" };

function who(made: Made, model: string | undefined): string {
  const name = model ? modelName(MODEL_KIND[made], model) : undefined;
  return name && name !== model ? name : "mô hình";
}

function cause(kind: MishapKind, made: Made, model: string | undefined): string {
  const by = who(made, model);
  const thing = made === "still" ? "hình" : "cảnh";
  switch (kind) {
    case "lettering":
      return `${by} tự thêm chữ vào ${thing}`;
    case "packaging":
      return `${by} tự vẽ thêm bao bì vào hình`;
    case "people":
      return "Hình vẽ sai số người";
    case "gaze":
      return "Nhân vật trong hình nhìn sai hướng";
    case "cut":
      return "Lời nói bị cắt ở cuối";
    case "cut-kept":
      return "Lời nói có thể bị cắt ở cuối, hãy nghe lại cảnh này";
    case "silent":
      return `${by} không nói lời thoại`;
    case "too-long":
      return `Câu thoại dài hơn mức ${by} nói được`;
    case "refused":
      return `${by} từ chối tạo ${thing} này`;
    case "error":
      return `${by} báo lỗi`;
    case "timeout":
      return `${by} không trả kết quả kịp`;
    case "app":
      return `Ứng dụng gặp lỗi khi ${made === "still" ? "vẽ hình" : "tạo cảnh"}`;
    case "still-instead":
      return "Không tạo được chuyển động, dùng ảnh tĩnh";
    case "simpler":
      return "Không vẽ được hình như dàn dựng, dùng cách vẽ đơn giản hơn";
  }
}

function consequence(kind: MishapKind, made: Made, outcome: Exclude<Outcome, "failed">): string {
  if (NOTHING_REDONE_KINDS.includes(kind)) return "";
  const tense = outcome === "made" ? "đã" : "đang";
  if (kind === "cut") return ` nên ${tense} tạo lại dài hơn`;
  if (REDRAWN_KINDS.includes(kind)) return ` nên ${tense} ${made === "still" ? "vẽ" : "tạo"} lại`;
  return `, ${tense} thử lại`;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Group {
  kind: MishapKind;
  model?: string;
  count: number;
}

function grouped(mishaps: readonly Mishap[]): Group[] {
  const groups: Group[] = [];
  for (const m of mishaps) {
    const same = groups.find((g) => g.kind === m.kind && g.model === m.model);
    if (same) same.count += 1;
    else groups.push({ kind: m.kind, model: m.model, count: 1 });
  }
  return groups;
}

function itemNotes(mishaps: readonly Mishap[] | undefined, made: Made, outcome: Outcome) {
  const groups = grouped(mishaps ?? []);
  return groups.map((g, i) => {
    const last = i === groups.length - 1;
    const after =
      outcome === "failed" && last
        ? ""
        : consequence(g.kind, made, outcome === "failed" ? "made" : outcome);
    const times = g.count > 1 ? ` ${g.count} lần` : "";
    return `${capitalized(cause(g.kind, made, g.model))}${times}${after}.`;
  });
}

const STILL_FAILED = "Chưa vẽ được hình này.";
const SCENE_FAILED = "Chưa tạo được cảnh này, giữ Thử lại để tạo lại.";
const SPEECH_OF_ANOTHER_SCENE_FAILED = "Chưa tạo được lời nói của cảnh này.";

const outcomeOf = (state: string): Outcome =>
  state === "done" ? "made" : state === "failed" ? "failed" : "making";

export function sceneNotes(job: VideoJob, shot: JobShot): string[] {
  const frame = frameFor(job, shot);
  const segment = job.segments?.find((s) => s.shots.includes(shot.index));
  const frameOutcome: Outcome = frame?.file ? "made" : frame?.error ? "failed" : "making";
  const segmentOutcome = segment ? outcomeOf(segment.state) : "making";
  const shotOutcome = outcomeOf(shot.state);
  const notes = [
    ...itemNotes(frame?.mishaps, "still", frameOutcome),
    ...itemNotes(segment?.mishaps, "clip", segmentOutcome),
    ...itemNotes(shot.mishaps, "clip", shotOutcome),
  ];
  const failed = [
    ...(frameOutcome === "failed" ? [STILL_FAILED] : []),
    ...(shotOutcome === "failed" ||
    (segment && segmentOutcome === "failed" && segmentAnchor(segment) === shot.index)
      ? [SCENE_FAILED]
      : segmentOutcome === "failed"
        ? [SPEECH_OF_ANOTHER_SCENE_FAILED]
        : []),
  ];
  return [...notes, ...failed];
}
