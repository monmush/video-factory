import { correctionSteps, directorSteps } from "../../shared/plan-progress";
import { untouchedChanged } from "../../shared/restage";
import type { ReadShotList, ShotList, ShotListAnswer } from "../../shared/shot-list";
import { applyCorrection } from "../../shared/shot-list-correction";
import CORRECTION from "./shot-list-correction.md?raw";
import PARTIAL from "./shot-list-partial.md?raw";

export const DIRECTOR_CALLS = ["plan", "correction", "rewrite"] as const;
export const RESTAGE_CALLS = ["partial", ...DIRECTOR_CALLS] as const;
type DirectorCall = (typeof RESTAGE_CALLS)[number];

const CHECK = "Kiểm tra quy tắc";
const PRICE = "Tính giá";
const READ = "Đọc kịch bản";

export interface PartialStaging {
  previous: ShotListAnswer;
  open: number[];
  changes: string;
}

export interface StagingInput {
  prompt: string;
  ask: (request: string, onText: (soFar: string) => void) => Promise<string>;
  parse: (text: string) => unknown;
  read: (answer: ShotListAnswer) => ReadShotList;
  save: (name: string, text: string) => Promise<unknown>;
  onSteps?: (steps: string[]) => void;
  partial?: PartialStaging;
  signal?: AbortSignal;
}

export type Staged = { list: ShotList; ms: number } | { problems: string[] };

export class StagingStopped extends Error {
  constructor() {
    super("Staging stopped: the script changed");
  }
}

interface BrokenPlan {
  text: string;
  answer: ShotListAnswer;
  errors: string[];
}

interface CallPlan {
  request: string | null;
  file: string;
  steps: (soFar: string) => string[];
  answerOf: (text: string) => { answer: ShotListAnswer; merged?: boolean };
}

const bulleted = (problems: string[]) => problems.map((p) => `- ${p}`).join("\n");

const filled = (template: string, slots: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => slots[k] ?? "");

export function correctionRequest(prompt: string, broken: BrokenPlan): string {
  return `${prompt}\n\n${filled(CORRECTION, { problems: bulleted(broken.errors), previous: broken.text })}`;
}

export function partialRequest(prompt: string, partial: PartialStaging): string {
  const previous = JSON.stringify(partial.previous, null, 2);
  return `${prompt}\n\n${filled(PARTIAL, { previous, changes: partial.changes })}`;
}

export function rewriteRequest(prompt: string, broken: BrokenPlan): string {
  return `${prompt}\n\n## Your previous plan\n\n${broken.text}\n\n## It broke these rules\n\n${bulleted(broken.errors)}\n\nAnswer again with a corrected plan, as one JSON object.`;
}

class UnusableCorrection extends Error {}

function partialCall(input: StagingInput, partial: PartialStaging, n: number): CallPlan {
  const asks = partial.open.length > 0;
  return {
    request: asks ? partialRequest(input.prompt, partial) : null,
    file: `shot-list-partial-${n}.json`,
    steps: (soFar) => [READ, ...correctionSteps(soFar)],
    answerOf: (text) => {
      const result = asks
        ? applyCorrection(partial.previous, input.parse(text))
        : { answer: partial.previous };
      if ("unusable" in result) throw new UnusableCorrection(result.unusable);
      const moved = untouchedChanged(partial.previous, result.answer, partial.open);
      if (moved) throw new UnusableCorrection(moved);
      return { answer: result.answer, merged: true };
    },
  };
}

export async function stageShotList(input: StagingInput): Promise<Staged> {
  const startedAt = Date.now();
  let broken: BrokenPlan | null = null;
  let problems: string[] = [];
  let made = 0;
  const partial = input.partial;
  const restaged = (path: string) =>
    partial
      ? input.save(
          "shot-list-restage.json",
          JSON.stringify(
            { path, ms: Date.now() - startedAt, lines: partial.open.map((i) => i + 1) },
            null,
            2,
          ),
        )
      : Promise.resolve();

  const planCall = (kind: DirectorCall): CallPlan | null => {
    const file = `shot-list-answer-${made + 1}.json`;
    const asPlan = (text: string) => ({ answer: input.parse(text) as ShotListAnswer });
    if (kind === "partial") return partial ? partialCall(input, partial, made + 1) : null;
    if (kind === "plan") {
      return { request: input.prompt, file, steps: directorSteps, answerOf: asPlan };
    }
    if (kind === "correction") {
      if (!broken) return null;
      const from = broken;
      const opening = [
        ...directorSteps(from.text),
        CHECK,
        `Sửa ${from.errors.length} chỗ chưa đúng quy tắc`,
      ];
      return {
        request: correctionRequest(input.prompt, from),
        file: `shot-list-correction-${made + 1}.json`,
        steps: (soFar) => [...opening, ...correctionSteps(soFar)],
        answerOf: (text) => {
          const result = applyCorrection(from.answer, input.parse(text));
          if ("unusable" in result) throw new UnusableCorrection(result.unusable);
          return { answer: result.answer, merged: true };
        },
      };
    }
    const opening = [`Sửa ${problems.length} chỗ chưa đúng quy tắc, viết lại kế hoạch`];
    return {
      request: broken ? rewriteRequest(input.prompt, broken) : input.prompt,
      file,
      steps: (soFar) => [...opening, ...directorSteps(soFar)],
      answerOf: asPlan,
    };
  };

  for (const kind of partial ? RESTAGE_CALLS : DIRECTOR_CALLS) {
    if (input.signal?.aborted) throw new StagingStopped();
    const call = planCall(kind);
    if (!call) continue;
    made += 1;
    const n = made;
    const callStartedAt = Date.now();
    const note = (found: Record<string, unknown>) =>
      input.save(
        `shot-list-problems-${n}.json`,
        JSON.stringify({ call: kind, ms: Date.now() - callStartedAt, ...found }, null, 2),
      );
    input.onSteps?.(call.steps(""));
    try {
      const { request } = call;
      if (request !== null && kind === "partial") {
        await input.save(`shot-list-partial-request-${n}.md`, request);
      }
      const text =
        request === null
          ? ""
          : await input.ask(request, (soFar) => input.onSteps?.(call.steps(soFar)));
      if (request !== null) await input.save(call.file, text);
      input.onSteps?.([...call.steps(text), CHECK]);
      const { answer, merged } = call.answerOf(text);
      if (merged) await input.save(`shot-list-merged-${n}.json`, JSON.stringify(answer, null, 2));
      const { list, errors, repaired } = input.read(answer);
      if (errors.length || repaired.length) await note({ errors, repaired });
      if (!errors.length) {
        input.onSteps?.([...call.steps(text), CHECK, PRICE]);
        await restaged(kind === "partial" && request === null ? "carried" : kind);
        return { list, ms: Date.now() - startedAt };
      }
      if (kind === "correction" || kind === "partial") continue;
      problems = errors;
      if (kind === "plan") broken = { text, answer, errors };
    } catch (error) {
      if (input.signal?.aborted) {
        await note({ stopped: true });
        throw new StagingStopped();
      }
      const message = (error as Error).message;
      await note(error instanceof UnusableCorrection ? { unusable: message } : { failed: message });
      if (kind !== "correction" && kind !== "partial") problems = [message];
    }
  }
  await restaged("rules");
  return { problems };
}
