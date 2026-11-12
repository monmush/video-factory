#!/usr/bin/env python3
"""Fill the script-writer prompt with a video-type profile.

Usage:
  python3 templates/video-script/assemble.py hyan-tea-philosophy \
      --batch "Write 5 scripts. Promotion mode: series default." \
      [--avoid "theme one; theme two"] > prompt.md

Profile sections headed "## N. `{{SLOT}}`" fill the matching slots. The
example JSON named in the profile's EXAMPLE_SCRIPT section is inlined.
Without --avoid, the profile's default avoid list is used.
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
TEMPLATE = ROOT / "script-writer-prompt.md"
PROMPT_START = "## Role"


def profile_sections(text):
    sections = {}
    parts = re.split(r"^## \d+\. `\{\{([A-Z_]+)\}\}`\s*$", text, flags=re.M)
    for i in range(1, len(parts), 2):
        body = parts[i + 1]
        body = re.split(r"^## ", body, flags=re.M)[0]
        sections[parts[i]] = body.strip()
    return sections


def default_avoid(text):
    match = re.search(r"`\{\{AVOID_LIST\}\}`:(.*)$", text, flags=re.M | re.S)
    if not match:
        return "None yet."
    tail = match.group(1)
    found = re.search(r"list the four original Hy An themes: (.+)", tail)
    return found.group(1).strip().rstrip(".") if found else tail.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_type")
    parser.add_argument("--batch", required=True, help="Batch request text")
    parser.add_argument("--avoid", help="Semicolon-separated themes to avoid")
    args = parser.parse_args()

    profile_path = ROOT / "video-types" / f"{args.video_type}.md"
    profile = profile_path.read_text(encoding="utf-8")
    slots = profile_sections(profile)

    example_link = re.search(r"\(\.\./(examples/[^)]+\.json)\)", slots.get("EXAMPLE_SCRIPT", ""))
    if example_link:
        example = (ROOT / example_link.group(1)).read_text(encoding="utf-8").strip()
        slots["EXAMPLE_SCRIPT"] = f"```json\n{example}\n```"

    slots["BATCH_REQUEST"] = args.batch
    avoid = args.avoid or default_avoid(profile)
    slots["AVOID_LIST"] = "\n".join(f"- {item.strip()}" for item in avoid.split(";") if item.strip())

    template = TEMPLATE.read_text(encoding="utf-8")
    prompt = template[template.index(PROMPT_START):]
    unused = sorted(name for name in slots if "{{" + name + "}}" not in prompt)
    if unused:
        sys.exit(f"Profile slots missing from the template: {', '.join(unused)}")
    for name, value in slots.items():
        prompt = prompt.replace("{{" + name + "}}", value)

    missing = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", prompt)))
    if missing:
        sys.exit(f"Unfilled slots: {', '.join(missing)}")
    sys.stdout.write(prompt)


if __name__ == "__main__":
    main()
