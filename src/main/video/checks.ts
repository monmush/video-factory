import type { ShotPlan } from "../../shared/shot-plan";
import type { JobFrame } from "../../shared/video-job";
import { askClaudeCode } from "../claude-code";
import { providerMode } from "../providers";
import { parseJsonObject, textAiMode } from "../text-ai";
import { logUsage } from "../usage";

// Layer C of docs/DIRECTING_RULES.md: the user's own AI looks at each
// generated still before the expensive step and compares it with the plan.
// A failed still is made again once (cents); after that it is kept and the
// finding saved on the frame. Only with Claude as the text AI and live
// providers; otherwise no check runs. A check that cannot run never blocks.

interface Seen {
  people?: number;
  /** For a single person: where their face points. */
  looks?: "frame_left" | "frame_right" | "camera";
  /** Visible lettering other than a logo on clothing. */
  text?: string | null;
  /** Product packaging, or any lettered box, bag or label. */
  packaging?: string | null;
}

const SYSTEM = "You inspect images for a video production. Answer with one JSON object only.";

const QUESTION = `Look at the image and answer:
{"people": number of people visible (count faces or bodies),
 "looks": for the main person, where their face and eyes point: "frame_left" (toward the viewer's left edge), "frame_right" (toward the viewer's right edge) or "camera",
 "text": any visible lettering, signs or labels other than a small logo on clothing, quoted; null if none,
 "packaging": any product packaging (box, bag, pouch, tin, carton, bottle or jar with a label) or any box, bag or label with lettering on it, in a few words; null if none}`;

export const checksEnabled = () => providerMode() === "live" && textAiMode() === "claude-code";

/** What is wrong with a still, in a few words, or null if it matches the plan. */
export async function checkStill(
  frame: JobFrame,
  path: string,
  plan: ShotPlan,
  sessionId: string,
): Promise<string | null> {
  // Product shots: only their generated plate is checked (it must be empty of packaging).
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
    // Products are never generated: a scene or detail still showing packaging is remade.
    if (frame.kind !== "character" && seen.packaging) {
      problems.push(`packaging ${seen.packaging}`);
    }
    if (frame.kind === "character") {
      if (seen.people !== undefined && seen.people !== 1) problems.push(`${seen.people} people`);
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
