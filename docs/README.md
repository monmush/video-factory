# Hy An Video Factory — docs

Updated 23 November 2026. The Electron app under `src/` covers series, the shared library, the script board with a session chat agent, a staged plan per script ("Dàn dựng"), and video generation (voice, stills, speaking and motion shots, local assembly with subtitles, fixes in place). Two videos were finished live on 13 November and three more on 21 November, when a future operator went from first launch to a finished video in 27 minutes; parts built since 16 November have still run in fixture mode only. No video has been accepted by the pilot client, and repeatable economics are not validated.

These documents are the lasting product reference and are tracked in git. Private material (business context, client observations, expenses, research) is kept locally in `docs/private/` and `docs/archive/`, which are not published. `PROJECT_CONTEXT.md` and `project/TODO.md` are also private local files.

**Start here:** read [video generation](VIDEO_GENERATION_DECISIONS.md) for how a script becomes a video, then the document for the area you are changing. Agreed technology: [stack and skills](TECH_STACK_AND_SKILLS.md).

## Documents

| Document | Owns | Status |
| --- | --- | --- |
| [Stack and skills](TECH_STACK_AND_SKILLS.md) | Stack, MVP architecture, data folder, bring-your-own-AI rules, code rules, project skills | Agreed |
| [Series setup and workspace](SERIES_SETUP_DECISIONS.md) | Series as a saved record, the direction drafted from a rough description, library references, clean place photos, series page, the shell (rail, sidebar, steps, appearance) | Built; direction tried with real AI on scripts only; place photo check fixture only |
| [Script board](SCRIPT_BOARD_DECISIONS.md) | From a series request to approved scripts: cards, references, variants, session chat agent, Dàn dựng, product per video | Built; fixture mode for the newest parts |
| [Scripts to videos](VIDEO_COMMIT_DECISIONS.md) | Ready check, all-in price, the series' models ("Mô hình"), "one video first", moving between Kịch bản and Video, batch button | Built |
| [Video generation](VIDEO_GENERATION_DECISIONS.md) | Recipe, shot list and build, pipeline (the video model speaks), video models, subtitles, stop and resume, never pay twice | Built; two videos finished live, the rest fixture mode |
| [Directing rules](DIRECTING_RULES.md) | Rules that turn a script into a shot plan, prompt building, still checks, product shots, failure table, flexible direction | Built; the 19 November changes not yet seen live |
| [Reviewing and fixing videos](VIDEO_REVIEW_DECISIONS.md) | Fixes in place, the pause, series look, learned preferences ("Ghi nhớ"), videos made the old way | Built, fixture mode only |
| [Series material](SERIES_MATERIAL_DECISIONS.md) | What a series keeps from its videos ("Tư liệu"), the shared scene, when a later video reuses a picture or a moving clip, the operator's controls | Built 25 November; fixture mode and one real staging |
| [Voices](VOICE_DECISIONS.md) | A character's voice as text, default and suggestions, the voice sample by content, the voices step, unverified points | Built 25 Nov; fixture mode only |
| [Design lessons](DESIGN_LESSONS.md) | What repeated feedback teaches: no dead ends, primary colour, prices, holds | Current rules |

## Reading rules

- **Agreed requirement:** explicit owner direction. **Tested result:** an actual artifact and a recorded judgment; one good sample does not establish reliability.
- **Estimate:** not a final charge; unknown cost is not zero. Prices and limits of AI models are snapshots (video models 13 November, motion and cut-out 16 November); recheck them before new paid work.
- More recent explicit feedback takes precedence. Update the owning document instead of appending conflicting instructions across files.
- Production retry concepts do not authorize paid experimental retries. Never make a paid fal call (ElevenLabs is reached only through fal) without the owner's approval of model, scope and estimate.

## Local only (not published)

- `docs/private/`: users and goals (read first: who we build for, the product goals in order, the current project goal), the product brief, feasibility results, the two user sessions at the pilot client and the observation guide, the pilot's script reference and the expense log.
- `docs/archive/`: finished one-time material, by date (`2026-11-19/README.md` says what each item was and where its content went).
- `PROJECT_CONTEXT.md`, `project/TODO.md`, `assets/`, `experiments/`, `prototypes/`, `references/hyan/`, `references/ui-patterns/`.
- Tracked reference: [T3 Code reference pack](../references/t3code/README.md), the source of the ported UI primitives.
