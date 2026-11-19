# Directing rules — updated 19 November 2026

**Status: built. The directing pass ran live on video #2 (13 November; its failures are in the table below). Everything since is driven in fixture mode only, not yet seen live: the rules added after video #2 (products never props, holds, sounds without words, ambient motion, product shots from a cut-out), the recipe and shot-list path (how a plan is made now: [video generation](VIDEO_GENERATION_DECISIONS.md)) and the flexible direction of 19 November.** Written after the first live video, where both characters looked the same way, actions named in the dialogue were never shown and every shot was the same close-up.

## Principle

Staff are not directors. Whatever a competent director would never get wrong, the app must get right without being told, for any series and any company. So the rules are written about scripts in general and never mention a brand, a place or a product. A series supplies only its own cast, place, products and seating.

## Three layers

| Layer | What it is | Where it lives | Cost |
| --- | --- | --- | --- |
| A. Director | The user's own AI turns an approved script into a shot plan, following built-in rules. Code checks the answer. | [`director-prompt.md`](../src/main/video/director-prompt.md), `src/main/video/director.ts`, checks in `src/shared/shot-plan.ts` | Free (user's AI) |
| B. Prompt building | Code turns each planned shot into the request sent for generation, adding the same fixed clauses every time. | `frameRequest` in `src/main/video/steps.ts` | Free |
| C. Checks | The user's own AI looks at each generated still and compares it with the plan. A failed still is remade once. | `src/main/video/checks.ts` | Cents per redo |

A rule in a prompt is a request, not a guarantee: the first live video asked for opposite eyelines and did not get them. Layer C exists because of that.

## Layer A: the director

Four shot types (`speaker`, `listener`, `wide`, `detail`), five staging rules (S1–S5) and fifteen coverage rules (C1–C15). The prompt file is the single source; read it there.

As built:

- **Seats are decided by code, not the AI** (S1, S2): the first speaker sits on the left and looks toward frame right, the second on the right looking left; one character alone faces the camera. The director only describes what is behind each seat.
- **Mechanical checks on the answer:** every line reproduced exactly; a line split only right after punctuation, each part at least four words; shots in dialogue order; the right person in speaker and listener shots; products only from the script; never three alike in a row (since 19 Nov no rule on the first or last shot and no required wide shot, see "19 November 2026: flexible direction"); no prop, seat or `visual` outside a product `detail` shot names a product (its whole name or two of its words in a row, with or without accents) or packaging by kind (pouch, sachet, label, tea bag…); holds 1–2 s, only on the shot that ends a line, at most 4 s in all; each seat's ambient clause at most 14 words.
- **Products are never props (S4, C12; 13 Nov).** A product appears only in its own `detail` shot. Products and their packaging are never listed as props or described in any other shot, so no still request can ask for one.
- **Holds (C15; 13 Nov).** After the joke or turning point and after the final line, the shot that ends the line carries `hold`: 1–2 s of silence before the next line or the end. The last shot always holds at least 1 s (code sets it when the plan does not; the rules-only plan holds 1 s). Holds add up to at most 4 s, the last shot's included.
- **Sounds without words (13 Nov).** A line may end with `[cười]`, `[cười khẽ]` or `[thở dài]` ([voices](VOICE_DECISIONS.md)). It stays in the text of the line's last shot, is voiced, never subtitled, and the director holds after it.
- **Ambient motion (S3; 13 Nov, experiment).** Each seat also gets one short English clause of gentle motion that really happens behind that character in this place ("bamboo leaves stir in a light breeze"). Optional.
- **One retry** with the broken rules listed, then the **rules-only plan** (one speaker shot per line, correct eyelines), so a video is never blocked by the director. The rules-only plan is also used without a place or without text AI (fixture mode with fal selected).
- Prompt, answers and plan are saved in the video's folder (`director-prompt.md`, `director-answer-N.json`, `plan.json`) for whoever maintains the rules.

## 19 November 2026: flexible direction

**Status: built, not yet run live.**

Why: next to the pilot client's reference video, ours looked unnatural: a row of single talking faces, the listener never seen, the same pattern in every video, and rules shaped by saving money. It was decided that the director's rules become general and decided case by case, and that budget does not limit quality for now.

What changed:

- **General rules.** The prompt asks the director to read what kind of scene the script is and direct that, not a template. No wording tied to one brand or product.
- **The listener may be in frame.** A speaking shot may keep the other person partly in view (over the shoulder, their back or profile at the edge). A character picture may show several people; the still check accepts the number it lists.
- **No fixed opening, closing or wide shot.** The first and last shots no longer have to be speaking faces, and a wide shot is no longer required in the first three. The director must still show that the people share a place, as often as the scene needs.
- **No limit on pictures.** A new picture whenever a shot should look different. An unused picture is still refused, as a mistake in the list.
- **Camera moves on speaking shots.** A speaking or listening shot may ask for a slow camera move in its own text; the fixed text no longer says "stationary camera".
- **No fixed share per shot type and no maximum shot length.**
- **Budget is not a limit for now.** The prompt and the Quality levels no longer talk about saving money, and the "over the suggested amount" warning is gone from the recipe path and the cost table. Prices and estimates still show.

## Layer B: building the generation request

- **B1** One wide still of the whole scene is made first. Close-ups are made from it together with the character's reference photos, so seats, backgrounds and props agree.
- **B2** Every close-up request states the character's side, where they look and what is behind them, copied from the plan's seats.
- **B3** Only props in the plan's list may appear, each once. A close-up shows the part of the table on that character's side, not a second full set. Code drops any prop that names a product or packaging, and any sentence of a `visual` or state change that does, before the request is built, whatever the plan says; every still request also says "no product packaging and no box, bag, pouch or label with lettering".
- **B4** From the shot where a state change starts, its description is added to every later request.
- **B5** Identity clause on every request with a person: same face, age, hair, outfit, accessories; logos as in the references or left plain.
- **B6** A product close-up uses the product's original photo. Its label is never generated. Since 13 Nov: its cut-out on a generated plate of the spot (below, "Product shots").
- **B7** Stills for speaking shots: mouth closed, hands away from the face. When the picture shows several people (19 Nov), the sentence names the main person and adds that nobody else's mouth is clearly visible.
- **B8** Speaking and listening shots ask for the seat's ambient motion behind the person ("the place behind them stays exactly the same, with gentle natural motion: …; nothing new appears"), person faithful; the camera stays steady unless the shot's own text describes a camera move (19 Nov; before, always a still camera). Only models whose endpoint takes a prompt receive it (Kling Avatar v2 Standard and Pro, OmniHuman 2.0; not MiniMax H3 or VEED Fabric: `takesPrompt` in `src/shared/video-models.ts`).
- **B9** A hold is silence inserted locally into the saved dialogue after its line (no new voice request); every later shot and subtitle moves by it. A speaking shot that holds is sent its words plus that silence, so the person stays alive through it.

How each shot type is made in this slice (no new paid model):

| Shot | Still | Moving it | Paid |
| --- | --- | --- | --- |
| `speaker` | The character's still (one per character, drawn from the wide one). `close` is a crop of the same still. | The video's speaking-shot model with that stretch of dialogue (plus its hold's silence), asked for the seat's ambient motion when it takes a prompt | Video seconds, holds included |
| `listener` | Same still | The speaking-shot model with silence and a "listens, mouth closed" prompt, same ambient motion | Video seconds |
| `wide` | One generated still of the whole scene | Slow push-in, made locally | The still only |
| `detail` | A generated still from the wide one | Slow push-in, made locally | The still only |
| `detail` of a product | The product's cut-out (its own pixels, one capped uniform tone gain) standing on a generated plate of the planned spot, with a soft contact shadow. Without a place or a usable cut-out: the product's own photo on a blurred fill, as before | Two layers pushed in at different rates (plate 3.5%, product 7.5% over the shot), made locally; never an image-to-video model | The plate like any still; each photo's cut-out once ever (about $0.018) |

The whole dialogue now runs under the video as one track, so a line continues across a cutaway. Each shot is cut to its exact place on the timeline; cuts inside a line use the voice provider's character timing.

## Layer C: checks on each still

Proposed: right person, looks toward the planned side, background matches the seat, no extra people, no duplicated props, no invented or garbled text, state changes present.

Built (the checks a quick look can answer reliably): a character still has one person looking toward the planned side (since 19 Nov, a planned picture may have as many people as it lists; fewer is accepted, since someone only at the edge may not be counted); the wide still has the whole cast; no stray lettering; a wide or detail still shows no product packaging and no lettered box, bag or label (13 Nov). One automatic redo (one more still, cents) whose request now says what the first attempt was rejected for, then the still is kept and the finding saved on the job. Runs only live with Claude as the text AI; a check that cannot run never blocks. No storyboard pause yet.

## How the rules improve

Every rule comes from a real failure. When a video shows a new kind of mistake that any series could hit, add a rule or a check, note it below and re-run the saved examples. A team's own preferences are not rules: the operator saves them through the chat as [learned preferences](VIDEO_REVIEW_DECISIONS.md#learned-preferences-ghi-nhớ--agreed-and-built-13-november-2026) ("Ghi nhớ", per series or for every series), which the writer and director read. A preference that many teams save is a candidate rule for this table.

| Date | Seen in | Failure | Rule |
| --- | --- | --- | --- |
| 13 Nov | First live video | Both characters look the same way | S2, B2, check "looks toward the planned side" |
| 13 Nov | First live video | Both close-ups share one background | S3, B1 |
| 13 Nov | First live video | Each character has a full tea set | S4, B3 |
| 13 Nov | First live video | Pouring and overflowing tea never shown | C4, C5, C6 |
| 13 Nov | First live video | Every shot is the same close-up | C3, C9 |
| 13 Nov | Video #2 | An invented package with the product's name on the table in the wide and detail stills: the director listed the product as a prop "text side facing the camera", and props go to the image model | S4, C12, check "no prop or visual names a product or packaging", B3 (code drops such props and sentences), check "packaging" |
| 13 Nov | Video #2 | Backgrounds behind speakers frozen; the world looks like a photograph | S3 ambient clause, B8 (experiment) |
| 13 Nov | Video #2 | The product moment is its own photo (a hand holding the pouch over a wooden floor) on a blurred fill with a zoom: clashes with the scene | Product shots: cut-out on a generated plate, parallax (falls back to the old look without a usable cut-out) |
| 13 Nov | Video #2 | The video ends on the last syllable of the closing joke; no laugh, no beat | C15 holds, B9, sounds without words |
| 13 Nov | A place | The place's photos show two people seated at the table and a lettered gift box; the image model copies them into stills (the box and the seating redrawn) | Place photo check and clean version ([series setup](SERIES_SETUP_DECISIONS.md#clean-place-photos)), ready-check warning |

Two sources feed this table from real use: `feedback.jsonl` in the data folder records every fix an operator asks the chat for, with the check findings of that video; and each video's folder keeps its plan, prompts and answers ([reviewing and fixing videos](VIDEO_REVIEW_DECISIONS.md)).

For the MVP the rules ship inside the app and improve with each release. Collecting feedback across customers needs a backend and is tracked in the owner's private task list.

## First test (13 November, free)

A 12-line script through the director on Sonnet, about one minute. The plan was kept as a local example (written with the first draft of the prompt).

- 17 shots, about 40 seconds: 77% speaker, 19% detail (four shots), 5% wide.
- Correct: girl left looking right, old man right looking left, different backgrounds, one set of props; the pouring is shown during the girl's line before she notices it; the product appears when it is named; the full cup returns on the closing line, which ends on the old man's face.
- Wrong or weak: one cut falls inside a phrase ("Ông pha ấm | <product name>"), against C1; no `listener` shot was used; four speaker shots are under 2 seconds, shorter than the speaking-shot model is known to accept.

Second run (13 November, in the app, Sonnet): 16 shots, plan accepted at the first attempt, one wide, two details (the overflowing cup during the girl's line, the full cup at the closing line). Still no listener shot, and the product named in line 3 was not shown.

Re-check (13 November, free): video #2's saved answer (`director-answer-1.json` in its folder) put through the new checks is refused with three findings: the product as a prop, "tea bag" in the bamboo mat's place and in the wide shot's visual. It now goes back to the director once with those listed. Its last shot would get a 1-second hold. There is no saved answer for the first video, and the kept example is a plan, not an answer, so it cannot be re-checked as is (it also lists the product as a prop). In fixture mode, `HYAN_FIXTURE_SHOT_LIST=<answer.json>` puts a saved shot-list answer through the same checks in place of the rules-only plan (the old `HYAN_FIXTURE_PLAN` format was removed on 19 Nov 2026).

## Product shots (13 November)

Principle: the product's own pixels are never generated or altered beyond one uniform, mild tone adjustment; everything around it may be generated. Code: `src/shared/product-shot.ts` (pure, tested), `src/main/video/product-shot.ts`, `productShot` in `src/main/video/ffmpeg.ts`.

1. **Cut-out, once per photo.** The product's photos are tried in order (originals only): background removed on fal (since 16 Nov Bria Guided Remove Background, `bria/guided-remove-background`, $0.03 per image, prompt "only the product package, without the hand holding it"; output a PNG with alpha at the input's size. Before: Bria RMBG 2.0, $0.018, which kept the holding hand as part of the subject. Live test 16 Nov on Bạch Trà photo 1 with "only the tea pouch, without the hand": hand gone, no bites where the fingertips overlapped, bottom seal slightly ragged, usable), saved beside the original in the asset's folder as `<imageId>.cutout.png` and recorded on the photo (`cutout: { file, usable }`), so no video pays for it again. The original is never modified or replaced; removing the photo removes its cut-out. **Since 16 Nov** the product dialog can also make it by hand: "Giữ để tách nền" on any photo (free, "Tách nền", when a video already made it), the result beside the original, then "Dùng ảnh này" puts the cut-out in the photo's place (the original stays, "Dùng ảnh gốc" brings it back) and records it as that photo's cut-out, so videos use it without paying. A cut-out that touches an edge shows "Chạm mép ảnh, video không dùng được" right away. Fixture mode stages a stand-in. Code: `src/main/product-cutout.ts`. Fixture mode makes a stand-in in the video's folder only, never on the asset.
2. **Which photo.** No per-photo record of "alone or held" exists (the description step writes one paragraph per product), so a simple rule decides after the cut-out: **usable only if the cut-out stands free of every edge of the photo** and is not a speck. A hand or arm holding the product enters from an edge; the guided removal drops it, and if it stays anyway the photo is refused, as are products cropped by the frame. The first usable photo is used.
3. **Plate.** The product detail shot's still is a generated close shot of the planned spot without the product (from the wide still, the same path and checks as any detail still; the check also refuses packaging). The director's `visual` for a product shot names the spot. Not reused through the series look: the spot differs per plan.
4. **Composite** (free, local): the cut-out scaled to 40% of the frame's height (narrower if wide), base at 63% of the height (above the subtitles), centred; a soft contact shadow from its own outline; one gain per channel toward the plate's colour around the spot, half way, capped at ±8% (`TONE_MATCH` switches it off). This replaces the blurred fill whenever a plate and a cut-out exist; otherwise the old behaviour stays.
5. **Movement.** The plate and the product are pushed in at different rates (a small parallax), worked at twice the size and scaled down once.

Prices: before the plan, the make button adds the cut-outs a script's products still need (every untried photo, at most; only with a place). After the plan a product shot counts as one still plus those cut-outs until made. A cut-out's cost goes on the first video that makes it.

**Only a live run can show:** whether the plate model leaves the spot really empty and framed as asked (the base line is fixed, not measured, so a plate whose surface sits elsewhere makes the product float or sink); whether the lighting matches (the cut-out keeps the photo's own light, and a dappled scene will not fall on it); whether 40% of the frame looks believable; how clean Bria's edges are on a glossy pouch.

**A pilot product:** both photos of one product show a hand holding the pouch. With plain removal (RMBG) the hand stayed and the rule refused them. Since 16 Nov the guided removal drops the hand: on one photo the cut-out was clean and passed the rule (16 Nov live test). A finger that covers the product still leaves a gap, so a photo of the product standing alone stays the safest source.

**Research, not built (13 Nov): placement models on fal that generate around a product.** None states pixel-exact preservation in its schema; each would need a paid comparison against the composite.

| Endpoint | Price | Takes the scene? | Notes |
| --- | --- | --- | --- |
| `bria/embed-product` | $0.04 per image | Yes: `image_source` is the scene, `products[]` each with `image_source` and `coordinates` (x, y, width, height) | Closest fit: our plate plus the cut-out at our own box; claims "pixel-perfect control, automatic perspective and natural lighting". Whether the product's pixels survive untouched is unverified. |
| `fal-ai/bria/product-shot` | $0.04 per generation | A reference image (`ref_image_url`) or `scene_description`; placement `original`, `automatic`, `manual_placement` or `manual_padding` | Generates a new scene around the product photo; the reference guides style, it is not our scene. |
| `fal-ai/bria/background/replace` | $0.04 per generation | `ref_image_url` or `prompt` | Replaces the background behind the product; same caveat. |
| `fal-ai/image-apps-v2/product-photography` | not checked | No: product image and aspect ratio only | Studio shots; regenerates the product, likely not pixel-faithful. |

## Life in the background (experiment, 13 November)

Built but **unproven until seen live**: whether the speaking-shot models move the background at all from a prompt, whether the motion stays gentle and in place, and whether it costs face or lip quality. MiniMax H3 and VEED Fabric take no prompt, so their backgrounds stay as they were. If it does nothing or harms the face, remove the clause from `SHOT_PROMPT`/`LISTEN_PROMPT` in `src/main/video/steps.ts`; the plan field can stay.

## Open

- **Moving details** (the pour itself, rather than a still with a push-in) need an image-to-video model. A small paid comparison, approved by the owner first.
- **Listener shots from silence** are unproven: the avatar model may move the mouth or freeze. The same question now applies to the 1–2 s of silence at the end of a held speaking shot.
- **Price before the plan:** the make button still estimates one speaking shot per line. Wide and detail seconds are now free but each adds a still (about $0.12); the two roughly cancel. Re-measure after the first live run. Holds: the length and price before the plan assume 4 s of silence (`SILENT_SEC` = `MAX_HOLDS_SEC` in `src/shared/board.ts`), all at the model's rate, so they err slightly high; after the plan each shot is priced with its own hold.
- Where saved seating lives on a series; three or more characters (eyelines then depend on who is addressed).
- An older, more detailed script template (one pass, full camera vocabulary) existed before the app and is archived locally. The director replaced its directing part with four shot types; its story rules live in the script writer.
- Camera and light guidance for the director (prompt order, beats by second, emotion as a sequence) is not written; it must stay inside the director prompts, never in script writing.
