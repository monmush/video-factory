import { boardOrder, type EstimateOpts, estimateSeconds, estimateUsd } from "./board";
import type { Asset, Script, Session } from "./ipc";
import { flaggedPlaces } from "./place-check";
import { cutoutUsd } from "./product-shot";
import { resolveVoice, takenVoiceIds, type VoiceId } from "./voices";

// What the operator sees before money is spent (docs/VIDEO_COMMIT_DECISIONS.md,
// "Ready check" and "One video first"). Pure, so the board, the Video tab and
// tests share one answer.

/** A script is warned about past its own target by more than this share. */
export const OVER_TARGET_MARGIN = 0.2;

/** Finished scripts that can become videos, in board order. */
export const finishedScripts = (scripts: Script[]) =>
  boardOrder(scripts).filter((s) => s.status === "ready");

/**
 * Scripts already committed to video. An approved session saved before
 * commits were recorded committed everything on its board at approval;
 * scripts added since are not committed.
 */
export function committedIds(session: Session, scripts: Script[]): string[] {
  const approvedAt = session.approvedAt;
  if (!approvedAt) return [];
  return (
    session.committedScriptIds ??
    finishedScripts(scripts)
      .filter((s) => s.createdAt <= approvedAt)
      .map((s) => s.id)
  );
}

export const NOT_COMMITTED = "Kịch bản này chưa chốt để làm video";

/**
 * Nothing is spent on a script that is not committed: planning (free) may run
 * before, every step that pays refuses.
 */
export function assertCommitted(session: Session, scripts: Script[], scriptId: string): void {
  if (!committedIds(session, scripts).includes(scriptId)) throw new Error(NOT_COMMITTED);
}

/**
 * The "one video first" nudge shows for a series' first batch: no other
 * session of the series is approved yet. MVP proxy for "has a kept video".
 */
export const isFirstBatch = (session: Session, sessions: Session[]) =>
  !sessions.some((s) => s.seriesId === session.seriesId && s.id !== session.id && s.approvedAt);

/** Why a video cannot be made yet. */
export type Blocker =
  | { kind: "unknown-speaker"; speaker: string }
  | { kind: "no-image"; characterId: string };

export interface ScriptCheck {
  script: Script;
  seconds: number;
  usd: number;
  blockers: Blocker[];
  /** Estimated well past its own target length (never a fixed length). */
  overTarget: boolean;
}

export interface CastMember {
  character: Asset;
  voiceId: VoiceId;
  /** Another speaking character in the batch resolves to the same voice. */
  sharesVoice: boolean;
}

export interface ReadyCheck {
  /** Scripts in scope, in board order. */
  checks: ScriptCheck[];
  /** Scripts in scope that can be made, in board order. */
  makeable: ScriptCheck[];
  blocked: ScriptCheck[];
  cast: CastMember[];
  /** Characters by id, for showing blockers. */
  characters: Map<string, Asset>;
  seconds: number;
  usd: number;
  /** Null when the balance is unknown. */
  balance: { before: number; after: number; affordable: number } | null;
  /** What the make button makes: the makeable scripts the balance covers. */
  toMake: ScriptCheck[];
  /** The series' places that still have a photo showing people or packaging (a warning). */
  places: Asset[];
}

const speakerKey = (name: string) => name.trim().toLocaleLowerCase("vi");

/** Speakers of `script` that are not library characters, by name, once each. */
export function unknownSpeakers(script: Script, assets: readonly Asset[]): string[] {
  const names = script.lines
    .filter((l) => !l.characterId || !assets.some((a) => a.id === l.characterId))
    .map((l) => l.speaker.trim() || "?");
  return [...new Map(names.map((n) => [speakerKey(n), n])).values()];
}

export function checkScript(
  script: Script,
  assets: readonly Asset[],
  opts: EstimateOpts = {},
): ScriptCheck {
  const seconds = estimateSeconds(script.lines);
  const blockers: Blocker[] = unknownSpeakers(script, assets).map((speaker) => ({
    kind: "unknown-speaker",
    speaker,
  }));
  const speaking = new Set(script.lines.flatMap((l) => l.characterId ?? []));
  for (const id of speaking) {
    const character = assets.find((a) => a.id === id);
    if (character && character.images.length === 0) {
      blockers.push({ kind: "no-image", characterId: id });
    }
  }
  const target = script.brief.targetSec;
  return {
    script,
    seconds,
    usd: estimateUsd(script.lines, {
      ...opts,
      cutoutUsd: opts.cutoutUsd ?? cutoutUsd(script.productIds, assets),
    }),
    blockers,
    overTarget: target ? seconds > target * (1 + OVER_TARGET_MARGIN) : false,
  };
}

/**
 * The ready check for `scope` (script ids; order follows the board).
 * `balanceUsd` is null when the balance is unknown: the check never blocks on it.
 */
export function readyCheck(
  scripts: Script[],
  scope: readonly string[],
  assets: readonly Asset[],
  balanceUsd: number | null,
  /** The series has an environment, so each video needs new start frames. */
  {
    placeIds = [],
    ...opts
  }: EstimateOpts & {
    /** The series' places, to warn about photos showing people or packaging. */
    placeIds?: readonly string[];
  } = {},
): ReadyCheck {
  const checks = finishedScripts(scripts)
    .filter((s) => scope.includes(s.id))
    .map((s) => checkScript(s, assets, opts));
  const makeable = checks.filter((c) => c.blockers.length === 0);
  const blocked = checks.filter((c) => c.blockers.length > 0);

  // Cast: library characters who speak in the scope, in order of appearance.
  const characters = new Map(assets.filter((a) => a.kind === "character").map((a) => [a.id, a]));
  const castIds = [
    ...new Set(checks.flatMap((c) => c.script.lines.flatMap((l) => l.characterId ?? []))),
  ].filter((id) => characters.has(id));
  const voices = castIds.map((id) => {
    const character = characters.get(id) as Asset;
    return { character, voiceId: resolveVoice(character, takenVoiceIds(assets, id)) };
  });
  const cast = voices.map((v) => ({
    ...v,
    sharesVoice: voices.some((o) => o !== v && o.voiceId === v.voiceId),
  }));

  const sum = (list: ScriptCheck[], key: "seconds" | "usd") => list.reduce((n, c) => n + c[key], 0);

  let toMake = makeable;
  let balance: ReadyCheck["balance"] = null;
  if (balanceUsd !== null && Number.isFinite(balanceUsd)) {
    // Cards in board order, as many as the balance covers.
    let left = balanceUsd;
    toMake = [];
    for (const c of makeable) {
      if (c.usd > left) break;
      left -= c.usd;
      toMake.push(c);
    }
    balance = {
      before: balanceUsd,
      after: balanceUsd - sum(toMake, "usd"),
      affordable: toMake.length,
    };
  }

  return {
    checks,
    makeable,
    blocked,
    cast,
    characters,
    seconds: sum(makeable, "seconds"),
    usd: sum(makeable, "usd"),
    balance,
    toMake,
    places: flaggedPlaces(placeIds, assets),
  };
}

/**
 * Whether the operator must look before this batch starts: a video that cannot
 * be made, a warning, or a balance that does not cover it. Otherwise the click
 * starts after a short cancel window, with no dialog.
 */
export const needsAttention = (check: ReadyCheck) =>
  check.blocked.length > 0 ||
  check.makeable.some((c) => c.overTarget) ||
  check.cast.some((m) => m.sharesVoice) ||
  check.places.length > 0 ||
  (check.balance !== null && check.balance.affordable < check.makeable.length);
