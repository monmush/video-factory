import { boardOrder } from "./board";
import type { Asset, Script, Session } from "./ipc";
import { lengthFit, scriptSeconds, scriptTargetSec } from "./pace";
import { flaggedPlaces } from "./place-check";
import { characterVoice, voiceKey } from "./voices";

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

export type Blocker =
  | { kind: "unknown-speaker"; speaker: string }
  | { kind: "no-image"; characterId: string };

export interface ScriptCheck {
  script: Script;
  seconds: number;
  targetSec: number;
  blockers: Blocker[];
  overTarget: boolean;
}

export interface ReadyCheck {
  checks: ScriptCheck[];
  makeable: ScriptCheck[];
  blocked: ScriptCheck[];
  characters: Map<string, Asset>;
  sharedVoices: Asset[][];
  seconds: number;
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
  seriesTargetSec: number,
): ScriptCheck {
  const seconds = scriptSeconds(script, seriesTargetSec);
  const targetSec = scriptTargetSec(script, seriesTargetSec);
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
  return {
    script,
    seconds,
    targetSec,
    blockers,
    overTarget: lengthFit(seconds, targetSec) === "long",
  };
}

export function readyCheck(
  scripts: Script[],
  scope: readonly string[],
  assets: readonly Asset[],
  { placeIds = [], seriesTargetSec }: { placeIds?: readonly string[]; seriesTargetSec: number },
): ReadyCheck {
  const checks = finishedScripts(scripts)
    .filter((s) => scope.includes(s.id))
    .map((s) => checkScript(s, assets, seriesTargetSec));
  const makeable = checks.filter((c) => c.blockers.length === 0);
  const blocked = checks.filter((c) => c.blockers.length > 0);

  const characters = new Map(assets.filter((a) => a.kind === "character").map((a) => [a.id, a]));

  return {
    checks,
    makeable,
    blocked,
    characters,
    sharedVoices: sharedVoices(checks, characters, assets),
    seconds: makeable.reduce((n, c) => n + c.seconds, 0),
    toMake: makeable,
    places: flaggedPlaces(placeIds, assets),
  };
}

function sharedVoices(
  checks: readonly ScriptCheck[],
  characters: ReadonlyMap<string, Asset>,
  assets: readonly Asset[],
): Asset[][] {
  const cast = [
    ...new Set(checks.flatMap((c) => c.script.lines.flatMap((l) => l.characterId ?? []))),
  ].flatMap((id) => characters.get(id) ?? []);
  const byVoice = new Map<string, Asset[]>();
  for (const character of cast) {
    const key = voiceKey(characterVoice(character, assets));
    byVoice.set(key, [...(byVoice.get(key) ?? []), character]);
  }
  return [...byVoice.values()].filter((group) => group.length > 1);
}

export const needsAttention = (check: ReadyCheck) =>
  check.blocked.length > 0 ||
  check.makeable.some((c) => c.overTarget) ||
  check.sharedVoices.length > 0 ||
  check.places.length > 0;
