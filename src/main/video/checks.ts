import type { ShotPlan } from "../../shared/shot-plan";
import type { JobFrame } from "../../shared/video-job";
import { askClaudeCode } from "../claude-code";
import { providerMode } from "../providers";
import { parseJsonObject, textAiMode } from "../text-ai";
import { logUsage } from "../usage";
import { characterPeopleProblem } from "./still-people";

interface Seen {
  people?: number;
  looks?: "frame_left" | "frame_right" | "camera";
  text?: string | null;
  packaging?: string | null;
}

const SYSTEM = "You inspect images for a video production. Answer with one JSON object only.";

const QUESTION = `Look at the image and answer:
{"people": number of people visible (count faces or bodies),
 "looks": for the main person, where their face and eyes point: "frame_left" (toward the viewer's left edge), "frame_right" (toward the viewer's right edge) or "camera",
 "text": any visible lettering, signs or labels, quoted; null if none. Lettering or a logo printed or embroidered on someone's clothing, at any size, is part of their costume: never report it,
 "packaging": any product packaging (box, bag, pouch, tin, carton, bottle or jar with a label) or any box, bag or label with lettering on it, in a few words; null if none}`;

export const checksEnabled = () => providerMode() === "live" && textAiMode() === "claude-code";

export async function checkStill(
  frame: JobFrame,
  path: string,
  plan: ShotPlan,
  sessionId: string,
): Promise<string | null> {
  if (!checksEnabled() || (frame.kind === "product" && !frame.cutout)) return null;
  try {
    const answer = await askClaudeCode({
      system: SYSTEM,
      prompt: QUESTION,
      imagePaths: [path],
      maxImageSide: 768,
      model: "sonnet",
      effort: "low",
      timeoutMs: 90_000,
    });
    await logUsage({
      provider: "claude-code",
      purpose: "video-frame-check",
      sessionId,
      notionalCostUsd: answer.notionalCostUsd,
      durationMs: answer.durationMs,
    });
    const seen = parseJsonObject<Seen>(answer.text);
    const problems: string[] = [];
    if (seen.text) problems.push(`unexpected text ${seen.text}`);
    if (frame.kind !== "character" && seen.packaging) {
      problems.push(`packaging ${seen.packaging}`);
    }
    if (frame.kind === "character") {
      const people = characterPeopleProblem(frame, seen.people);
      if (people) problems.push(people);
      const seat = plan.seats.find((s) => s.characterId === frame.characterId);
      const expected = plan.seats.length < 2 ? "camera" : seat?.looks;
      if (expected && expected !== "camera" && seen.looks && seen.looks !== expected) {
        problems.push(`looks ${seen.looks}, should look ${expected}`);
      }
    } else if (frame.kind === "wide") {
      if (seen.people !== undefined && seen.people !== plan.seats.length) {
        problems.push(`${seen.people} people, should be ${plan.seats.length}`);
      }
    }
    return problems.length ? problems.join("; ") : null;
  } catch (error) {
    console.warn("[video] still check skipped:", (error as Error).message);
    return null;
  }
}
