import { boardOrder, type EstimateOpts, estimateSeconds, estimateUsd } from "./board";
import type { Asset, Script, Session } from "./ipc";
import { flaggedPlaces } from "./place-check";
import { cutoutUsd } from "./product-shot";
import { resolveVoice, takenVoiceIds, type VoiceId } from "./voices";

const WARNED_PAST_OWN_TARGET_SHARE = 0.2;

export const finishedScripts = (scripts: Script[]) =>
  boardOrder(scripts).filter((s) => s.status === "ready");

export function committedIds(session: Session, scripts: Script[]): string[] {
  const approvedAt = session.approvedAt;
  if (!approvedAt) return [];
  return session.committedScriptIds ?? savedBeforeCommitsWereRecorded(scripts, approvedAt);
}

const savedBeforeCommitsWereRecorded = (scripts: Script[], approvedAt: string) =>
  finishedScripts(scripts)
    .filter((s) => s.createdAt <= approvedAt)
    .map((s) => s.id);

export const NOT_COMMITTED = "Kịch bản này chưa chốt để làm video";

export function assertCommitted(session: Session, scripts: Script[], scriptId: string): void {
  if (!committedIds(session, scripts).includes(scriptId)) throw new Error(NOT_COMMITTED);
}

export const isFirstBatch = (session: Session, sessions: Session[]) =>
  !sessions.some((s) => s.seriesId === session.seriesId && s.id !== session.id && s.approvedAt);

export type Blocker =
  | { kind: "unknown-speaker"; speaker: string }
  | { kind: "no-image"; characterId: string };

export interface ScriptCheck {
  script: Script;
  seconds: number;
  usd: number;
  blockers: Blocker[];
  overTarget: boolean;
}

export interface CastMember {
  character: Asset;
  voiceId: VoiceId;
  sharesVoice: boolean;
}

export interface ReadyCheck {
  checks: ScriptCheck[];
  makeable: ScriptCheck[];
  blocked: ScriptCheck[];
  cast: CastMember[];
  characters: Map<string, Asset>;
  seconds: number;
  usd: number;
  balance: { before: number; after: number; affordable: number } | null;
  toMake: ScriptCheck[];
  places: Asset[];
}

const speakerKey = (name: string) => name.trim().toLocaleLowerCase("vi");

function unknownSpeakers(script: Script, assets: readonly Asset[]): string[] {
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
    overTarget: target ? seconds > target * (1 + WARNED_PAST_OWN_TARGET_SHARE) : false,
  };
}

export function readyCheck(
  scripts: Script[],
  scope: readonly string[],
  assets: readonly Asset[],
  balanceUsd: number | null,
  {
    placeIds = [],
    ...opts
  }: EstimateOpts & {
    placeIds?: readonly string[];
  } = {},
): ReadyCheck {
  const checks = finishedScripts(scripts)
    .filter((s) => scope.includes(s.id))
    .map((s) => checkScript(s, assets, opts));
  const makeable = checks.filter((c) => c.blockers.length === 0);
  const blocked = checks.filter((c) => c.blockers.length > 0);

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

export const needsAttention = (check: ReadyCheck) =>
  check.blocked.length > 0 ||
  check.makeable.some((c) => c.overTarget) ||
  check.cast.some((m) => m.sharesVoice) ||
  check.places.length > 0 ||
  (check.balance !== null && check.balance.affordable < check.makeable.length);
