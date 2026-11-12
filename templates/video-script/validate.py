#!/usr/bin/env python3
"""Check a script-writer JSON output against the template's mechanical rules.

Usage:
  python3 templates/video-script/validate.py output.json [--max 45] [--rate 3.7]
      [--disallow worms_eye,pov,dutch_tilt,...]

Checks the vocabulary, durations, syllable counts, speaking-shot rules and
screen-side consistency that do not need human judgment. Exit code 1 on errors.
"""
import argparse
import json
import re
import sys

VOCAB = {
    "shot_size": {"extreme_wide", "wide", "medium", "medium_close_up", "close_up", "extreme_close_up"},
    "composition": {"single", "two_shot", "over_shoulder", "insert"},
    "angle": {"eye_level", "high_angle", "low_angle", "birds_eye", "worms_eye", "pov", "dutch_tilt"},
    "movement": {"static", "push_in", "pull_out", "pan", "tilt", "orbit", "handheld", "dolly_zoom", "whip_pan", "crane_up"},
    "lens_mm": {14, 24, 35, 50, 85, 135},
    "light": {"front", "key_45", "side", "top", "rim", "silhouette"},
}
EMOTIONS = {
    "calm", "serene", "thoughtful", "curious", "puzzled", "impatient", "earnest", "proud", "smug",
    "teasing", "amused", "laughing", "surprised", "mock_offended", "embarrassed", "warm", "delighted", "skeptical",
}
ADVANCED = {"orbit", "handheld", "dolly_zoom", "whip_pan", "crane_up"}
SPEAKING_SIZES = {"medium", "medium_close_up", "close_up"}


def syllables(text):
    return len(re.sub(r"[^\w\s]", " ", text).split())


def check_script(script, args, disallowed):
    errors, warnings = [], []
    sid = script.get("script_id", "?")
    shots = script.get("shots", [])
    total = round(sum(s.get("duration_sec", 0) for s in shots), 2)
    spoken = 0
    advanced = 0

    for shot in shots:
        where = f"{sid} {shot.get('shot_id', '?')}"
        for field, allowed in VOCAB.items():
            value = shot.get(field)
            if value not in allowed:
                errors.append(f"{where}: {field}={value!r} is not in the vocabulary")
            elif str(value) in disallowed:
                errors.append(f"{where}: {field}={value!r} is not allowed for this video type")
        movement = shot.get("movement")
        if movement in ADVANCED:
            advanced += 1
        if movement != "static" and not shot.get("movement_detail"):
            warnings.append(f"{where}: movement {movement} has no movement_detail")

        duration = shot.get("duration_sec", 0)
        if not 1.5 <= duration <= 8:
            errors.append(f"{where}: duration {duration}s is outside 1.5–8s")

        for emo in shot.get("emotion") or []:
            for key in ("emotion", "transition_to"):
                if emo.get(key) is not None and emo[key] not in EMOTIONS:
                    errors.append(f"{where}: emotion {emo[key]!r} is not in the vocabulary")
            if not emo.get("cue"):
                errors.append(f"{where}: emotion for {emo.get('character')} has no visible cue")

        dialogue = shot.get("dialogue")
        if dialogue:
            counted = syllables(dialogue.get("text", ""))
            spoken += counted
            if counted != dialogue.get("syllables"):
                warnings.append(f"{where}: declared {dialogue.get('syllables')} syllables, counted {counted}")
            minimum = counted / args.rate + 0.3
            if duration + 0.05 < minimum:
                errors.append(f"{where}: {duration}s is too short for {counted} syllables (needs ≥{minimum:.1f}s)")
            if dialogue.get("speaker_on_screen"):
                subjects = shot.get("subjects", [])
                if subjects != [dialogue.get("speaker")]:
                    errors.append(f"{where}: on-screen speech needs exactly the speaker in frame, got {subjects}")
                if shot.get("shot_size") not in SPEAKING_SIZES:
                    errors.append(f"{where}: on-screen speech in a {shot.get('shot_size')} shot")
                if movement not in {"static", "push_in"}:
                    errors.append(f"{where}: on-screen speech with {movement} movement")
                if shot.get("light") == "silhouette":
                    errors.append(f"{where}: on-screen speech in silhouette")
        if shot.get("lens_mm") == 14 and shot.get("subjects") and shot.get("shot_size") in SPEAKING_SIZES | {"extreme_close_up"}:
            errors.append(f"{where}: 14mm on a face")

    if advanced > 1:
        errors.append(f"{sid}: {advanced} advanced movements (max 1)")
    if total > args.max:
        errors.append(f"{sid}: total {total}s exceeds {args.max}s")
    if abs(total - script.get("estimated_duration_sec", 0)) > 0.2:
        warnings.append(f"{sid}: estimated_duration_sec {script.get('estimated_duration_sec')} but shots sum to {total}")
    if spoken != script.get("total_spoken_syllables"):
        warnings.append(f"{sid}: total_spoken_syllables {script.get('total_spoken_syllables')} but counted {spoken}")
    first_line = next((s["dialogue"] for s in shots if s.get("dialogue")), None)
    if first_line and syllables(first_line.get("text", "")) > 14:
        errors.append(f"{sid}: first line has {syllables(first_line['text'])} syllables (max 14)")
    return errors, warnings, total, spoken


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--max", type=float, default=45)
    parser.add_argument("--rate", type=float, default=3.7, help="Syllables per second")
    parser.add_argument("--disallow", default="", help="Comma-separated IDs the video type forbids")
    args = parser.parse_args()
    disallowed = {d.strip() for d in args.disallow.split(",") if d.strip()}

    data = json.load(open(args.path, encoding="utf-8"))
    planned = {p.get("script_id") for p in data.get("batch_plan", [])}
    themes = [s.get("theme") for s in data.get("scripts", [])]
    all_errors = 0
    if len(themes) != len(set(themes)):
        print("ERROR batch: repeated theme")
        all_errors += 1
    for script in data.get("scripts", []):
        if script.get("script_id") not in planned:
            print(f"WARN  {script.get('script_id')}: not in batch_plan")
        errors, warnings, total, spoken = check_script(script, args, disallowed)
        print(f"{script.get('script_id')}: {len(script.get('shots', []))} shots, {total}s, {spoken} syllables")
        for e in errors:
            print(f"  ERROR {e}")
        for w in warnings:
            print(f"  WARN  {w}")
        all_errors += len(errors)
    sys.exit(1 if all_errors else 0)


if __name__ == "__main__":
    main()
