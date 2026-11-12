# Video script template

Created 12 November 2026. A reusable prompt structure for writing batches of fully directed short-video scripts that an AI video agent can execute shot by shot. **This is a working proposal, tested twice with a fresh model. It is not an approved production prompt.** Hy An has not reviewed the generated scripts, and no video has been generated from them.

## How it fits together

```
video-type profile  ─┐
(what this series is) │
                      ├─► assemble.py ─► full prompt ─► writer model ─► batch JSON ─► validate.py ─► staff review ─► video agent
script-writer prompt ─┘
(fixed structure)            + batch request and avoid list per call
```

| File | Changes per project? | Contents |
| --- | --- | --- |
| [script-writer-prompt.md](script-writer-prompt.md) | **No.** Fixed structure. | Role, format rules, directing vocabulary (shot size, composition, angle, movement, lens, light, emotion), generation rules, batch rules, JSON output shape, self-check |
| [video-types/](video-types/) | **Yes.** One profile per video type. | Characters, world and look, story beats, writing style, products and approved facts, allowed directing options, reference frames, one example |
| [examples/](examples/) | One per profile | A complete script in the output format, used as the few-shot example |
| [assemble.py](assemble.py) | No | Fills the template's `{{slots}}` from a profile and adds the per-call batch request |
| [validate.py](validate.py) | No | Mechanical checks: vocabulary, disallowed options, durations against syllable counts, speaking-shot rules, total length, first-line length |

A new video type (for example a single presenter, a product demo or a different pair of characters) needs only a new profile and example. The vocabulary and output shape stay the same, so the video agent and the validator do not change.

## Directing vocabulary

The camera options follow the option sets Minh shared on 12 November 2026, with "Auto" removed because the writer resolves every choice per shot:

- **Shot size:** extreme wide, wide, medium, medium close-up, close-up, extreme close-up.
- **Angle:** eye level, high, low, bird's eye, worm's eye, POV, Dutch tilt.
- **Movement:** static, push in, pull out, pan, tilt, orbit, handheld, dolly zoom, whip pan, crane up.
- **Lens:** 14, 24, 35, 50, 85, 135 mm.
- **Light:** front, 45° key, side, top, rim, silhouette.
- **Format:** always 9:16.

The template adds **composition** (single, two-shot, over-shoulder, insert), because the originals use over-shoulder and two-character shots, and an **emotion** list with a required visible cue per character. "Look" from the shared screenshots is handled once per video type in the profile's world and look section, not per shot.

Each profile then narrows these lists. Hy An's calm tea series, for example, excludes Dutch tilt, worm's eye, whip pan and 14 mm.

## Usage

```sh
# Build the prompt for a batch
python3 templates/video-script/assemble.py hyan-tea-philosophy \
  --batch "Write 5 scripts. Promotion mode: series default." \
  --avoid "dục tốc bất đạt; tốt gỗ hơn tốt nước sơn; có công mài sắt có ngày nên kim" > prompt.md

# Check the model's JSON output
python3 templates/video-script/validate.py batch.json \
  --disallow extreme_wide,worms_eye,pov,dutch_tilt,handheld,dolly_zoom,whip_pan,crane_up,14,top,silhouette
```

The validator checks only what a machine can check. Joke quality, natural Vietnamese, real proverbs, approved product facts and brand fit still need human review.

For 10–40 scripts, calling the writer in chunks of about 5 and adding each chunk's themes to the avoid list is likely more reliable than one very long response. This is a recommendation; the orchestration and provider remain undecided.

## Test results (12 November 2026)

Two fresh-agent runs of 3 scripts each, given only the assembled prompt:

- All 6 scripts passed the validator and ran 35–41 s on 97–110 syllables.
- The models used real proverbs (có công mài sắt…, chín người mười ý, lời nói chẳng mất tiền mua…, của cho không bằng cách cho, một cây làm chẳng nên non…), each with a clear twist joke, a natural product mention and flags for new start frames.
- **Run 1** found two missing slots (directing rules and reference frames never reached the model), inconsistencies in the example, a hook rule that could not be met, and single-product shots. These were fixed, and `assemble.py` now fails if a profile slot is unused.
- **Run 2** found missing sachet and product reference IDs, confusion between close-up and medium close-up stills, and unclear short product names. These were fixed in the Hy An profile.

Test outputs were kept in the session scratchpad and are not saved here.

## Assumptions and open items

- **Speech rate 3.7 syllables/s** comes from one approved dialogue sample. Recalibrate after a complete video exists.
- **Lip-sync rules** (one speaking face per shot, static or slow push-in, hands clear of the face) reflect the current speaking-shot experiments. They should relax if a provider handles two-person dialogue shots reliably.
- **Language split:** dialogue and staff-facing fields are in Vietnamese; directions are in English, because current image and video models follow English most reliably.
- **Closing line** defaults to off. Whether it should be on-screen text, a voiceover or a character line is still open.
- **Product facts** from Hy An's scripts (Hà Giang highlands, white down, ancient trees) are blocked from dialogue until Hy An confirms them.
- **Music** is not specified. Only ambience and sound effects are included.
- Staff do not see this JSON. It is a background production plan built after script approval (agreed 12 November 2026; see "Shot plan stays in the background" in `docs/SCRIPT_BOARD_DECISIONS.md`). Not built yet.
