# Video generation — as built, updated 19 November 2026

Owns how an approved script becomes a video: the plan (recipe, shot list, build), the paid steps, what the Video tab shows meanwhile, and the stop, resume and never-pay-twice rules. What happens before committing: [scripts to videos](VIDEO_COMMIT_DECISIONS.md). Directing rules: [directing rules](DIRECTING_RULES.md). Code: `src/shared/video-job.ts` (pure job logic, tested), `src/shared/recipe.ts`, `shot-list.ts`, `build-direction.ts`, `src/main/video/` (director, runner, provider steps, FFmpeg), `src/renderer/src/components/videos.tsx`.

**Status.** Built 12–19 November. Two videos were finished live on 13 November (the first on Kling Avatar v2 Standard for $2.61; the second with the directing pass and two takes); later live runs were partial. Everything added since 16 November (recipe, shot list, build, Quality levels, flexible direction, restart safety, no cap on clips) has run in fixture mode only. No video has been accepted by the pilot client, and repeatable economics are not validated.

## The plan: recipe, shot list, build

A plan is made per video, before any paid step, in three parts split by how often each changes.

| Part | Made | By | Holds |
| --- | --- | --- | --- |
| 1. **Recipe** | per Quality level (built in; not yet per series) | the app (`src/shared/recipe.ts`) | which model plays each role (stills, speaking shots, motion shots), its request template, its price and limits |
| 2. **Shot list** | per video, free, about a minute | the user's own AI, no tools | the pictures (a full English description each) and the shots: words heard, who is on screen, the picture it starts from, a route, what moves, and a Vietnamese description for the operator |
| 3. **Build** | per video, instant, free | code only | the exact requests, the reference photos, the fixed sentences and the price |

Each question has one owner: the recipe chose the model, the director chose the shot, code wrote the request. The same shot list and recipe always give the same requests.

- **Routes** per shot: `speak` (the picture speaks the shot's words in the app's own voice, lip-synced), `motion` (the picture is animated without speech), `still-move` (slow push-in made locally), `product` (the product's cut-out on a generated plate; [directing rules](DIRECTING_RULES.md), "Product shots").
- **Built-in recipe:** the default image model for stills, Kling Avatar v2 Standard for speaking shots and, from "Cân bằng" up, Wan 3.0 Prime for motion shots. It is the only recipe; there is no second planner. `HYAN_RECIPE=<file>` (a saved recipe or live plan) replaces it in development.
- **Quality** ("Chất lượng"; offered: Nhanh and Cân bằng, older levels read as the one that makes the same video) sets the picture size (864×1536 at Nhanh, 1116×2000 at Cân bằng), the output size (720p, 1080p) and whether wide, detail and listener shots really move or are stills with a push-in. Staff choose Quality and nothing else; model and provider names never appear in the interface. Prices per level are computed from the recipe's rates (`levelEstimateUsd`).
- **Build** chooses the reference photos, writes the photo legend and the fixed sentences (`src/shared/prompt-text.ts`), fills the templates, checks every request against the recipe's schema and refuses a picture no shot starts from (it would be paid for).
- **Files in a video's folder:** `director-prompt.md`, `shot-list-prompt.md`, `shot-list-answer-1.json` (and `-2`), `shot-list.json`, `plan.json`, `live-plan.json`. Two attempts, then a rules-only shot list.
- **A product change patches the plan in code** (product shots show the new product, the plate is kept, the cut-out price follows) with no new staging when the words are unchanged or only the product's name was swapped; otherwise the script is staged again. A script counts as done only when its dialogue and its staging both exist. Staging runs by itself only when the text AI is the user's own.
- **Changing Quality after scripts exist** stages every unpaid script again without asking (paid videos keep their plan). This is a known design problem; the redesign is undecided.
- **Development switches** (fixture mode): `HYAN_FIXTURE_SHOT_LIST=<answer.json>` runs a saved shot-list answer through the checks; `HYAN_FIXTURE_LIVE_PLAN=<folder>` replays a saved plan.

Not built: a recipe made by an AI session with read-only planning tools (per series, with pinning and standby models), planning by itself after approval, and one executor for the fixed and the planned path (today both exist and duplicate pricing, state and request building).

## Pipeline, cheap steps first

1. **Shot plan** (free): the plan above.
2. **Voice** (cents): one multi-speaker dialogue request for the whole script, each line in its character's voice with the approved dry close-mic direction ([voices](VOICE_DECISIONS.md)). Line and character timings place every shot on the dialogue's timeline; speaking shots get their stretch of audio, listeners get silence. The provider's full timing is saved beside the audio as `*.timing.json`. A line may end with a sound (`[cười]`), sent as the voice model's own tag. **Holds:** the video's timeline is the dialogue's with each hold's silence added after its line; a held speaking shot is sent its words plus the silence. The silence is inserted locally (`withHolds`, `holdInserts` in `src/shared/shot-plan.ts`, `insertSilence` in `ffmpeg.ts`), with no new voice request.
3. **Stills** (cents each): the master picture first, then every other picture drawn from it with the characters' reference photos. A product shot is the product's cut-out on a generated plate. Each generated still is checked by the user's own AI and remade once if it is wrong.
4. **Shots** (almost all the cost): speaking shots by the speaking model, `motion` shots by the motion model. **Every clip that has what it needs is sent at once** (since 19 November; before, at most three; fal queues what is over the account's concurrency limit). One video still runs at a time and local shots one at a time. Shots without motion are the still with a slow push-in, made locally for free; a product shot moves its plate and its product at different rates.
5. **Assembly** (free, local): each clip cut to its exact place, joined, the whole dialogue laid underneath (with the holds' silence), subtitles burned in. Short-form style (`src/shared/subtitles.ts`): a phrase of up to five words, bold white with a black outline, centred below the faces; the word being spoken turns yellow and grows slightly, alone. Phrases split at sentence ends, at commas once a phrase has three words, then into balanced parts. Words are timed from the voice's saved character timing; without it, spread across each line in proportion to length. A phrase never runs into the next line. Needs `ffmpeg` installed; the job refuses before the voice step if it is missing, so nothing is paid for.

**Lip sync.** Measured on the first live video: the provider keeps our sound (within 30 ms), assembly does not drift (within ±40 ms of its cut), and the voice runs at a normal 3.7 syllables a second. The mouth itself runs late on some faces; a 150 ms shift was tried and removed on 13 November so each speaking model can be judged unshifted. Re-measure per model before adding any shift back.

Jobs saved before plans existed are read as one speaker shot per line.

The first paid step of a planned video stops at a pause after voice and stills ("Nghe và xem cảnh chính"). Its hold is labelled "Giữ để tạo các cảnh chính" and priced to the pause; the second hold ("Giữ để tạo video") makes the rest. A finished video can be fixed in place, paying only for what changes: [reviewing and fixing videos](VIDEO_REVIEW_DECISIONS.md). Files made by a fix carry its revision (`shot-07-r2.mp4`, `final-r2.mp4`). Files live in the session's media folder under `videos/<scriptId>/`.

## Speaking-shot models

The registry `src/shared/video-models.ts` (pure, tested) lists each model's id, level, name and maker, fal endpoint, what it makes and costs at each output size, its audio limits and whether it takes a prompt. How each endpoint is asked and answered lives in `src/main/video/shot-models.ts`. Prices are snapshots read from fal's public pages on 13 November. The pipeline uses only the recipe's model; the others serve takes with another model, which are hidden since 16 November ([reviewing and fixing videos](VIDEO_REVIEW_DECISIONS.md)). Model names are for developers; they never appear in the interface.

| Level | Model (maker) | Output at 720p / 1080p | $/s at 720p / 1080p | Limits |
| --- | --- | --- | --- | --- |
| Standard | Kling Avatar v2 Standard (Kuaishou), recipe default | 720p | 0.0562 | none listed |
| Standard | MiniMax H3 Max Lip Sync (MiniMax) | 768p / 1080p | 0.08 / 0.16 | audio at least 5 s; 1.2× rate over 15 s |
| Premium | OmniHuman 2.0 (ByteDance), provisional | 720p | 0.105 | audio 4–300 s |
| Premium | Kling Avatar v2 Pro (Kuaishou) | 1080p | 0.115 | none listed |
| Premium | VEED Fabric 1.0 (VEED) | 720p | 0.15 | none listed |

Run live so far: Kling Standard, VEED Fabric 1.0 and Kling Avatar v2 Pro. MiniMax H3 and OmniHuman 2.0 have not. Only Kling Avatar v2 Standard and Pro and OmniHuman 2.0 take a prompt, so only they hear the seat's ambient motion ([directing rules](DIRECTING_RULES.md), B8).

Rules that still hold:

- One speaking model per video, fixed when its first shot is sent and saved with the job before anything goes out, so a restart polls the right endpoint. Each shot records the model and request id the moment it is sent; polling always uses that endpoint.
- A shot longer than its model takes is made by the default model.
- Audio shorter than a model's minimum is padded with silence before sending and billed at the minimum; assembly trims the clip. Estimates add that minimum per shot.
- Every estimate, button price and job cost uses the shot's model (`shotModel`, `shotEstimateUsd`); `usage.jsonl` and `requests.jsonl` carry the model id.
- Images sent to fal are downscaled to 1536 px on the long side before upload. Every local step follows the video's output size, subtitles included, proportionally.

## Rules

- **Hold to spend.** Every paid action in the interface is a 3-second hold that shows its price ([scripts to videos](VIDEO_COMMIT_DECISIONS.md)).- **The cost breakdown is always visible.** "Chi phí" opens before (estimates with "~"), during and after the video (spent per row, no "~"). One price rule everywhere ([design lessons](DESIGN_LESSONS.md), "Prices").
- **Stop** (hold 1.2 s; the button shows what is lost): shots not yet sent are never sent. Shots already rendering finish, are charged and their clips kept. **"Giữ để tạo tiếp"** continues from what exists and pays only for what is missing.
- **Never pay twice, also across a restart.** Each still and clip is marked in `job.json` before it is sent, and its `requests.jsonl` line carries the mark. The request id is saved the moment the provider accepts it. On start, a request fal accepted but `job.json` never got is attached by its mark and polled, not resent (`src/shared/request-reconcile.ts`). Video cut-outs go through the queue and are picked up the same way. Paid voice and cut-out results are saved before the step is settled, so a failure or a restart reuses them. `job.json` writes are flushed before the rename, and leftover `.tmp` files are removed on start. Requests sent before the mark existed are not covered.
- **Deadlines.** A request past its deadline is cancelled at the provider and counts as one failed attempt: a still 30 minutes, a clip 90, a cut-out 20 (`src/shared/request-deadline.ts`).
- **Failures:** one automatic retry per shot, then "Thử lại" on that shot. A provider-side failure is not logged as a cost. Failed downloads and polls count as attempts instead of looping.
- **Network trouble is not a failure** (`src/shared/net-error.ts`): a lost connection, DNS, timeouts and HTTP 408, 429 and 5xx leave the step as it was, with saved request ids kept and polled. The job stays running and marked offline, retries after 5, 10, 20 and 40 seconds and then every minute, and the card says "Mất kết nối, sẽ thử lại" with "Thử lại" to try now. `HYAN_FIXTURE_OFFLINE=<seconds>` simulates an outage.
- **Subtitles go on last** and clips are kept without them, so restyling later is free.
- Scripts committed before jobs existed show as not started; nothing starts by itself on upgrade.

## Video tab

A card per script. What it is sits on the left, what can be done on the right: the title, and under it one muted line with the status and the cost; top right the one button that applies, and under it the quiet actions ("Bản trước", "Sửa kịch bản", "Sửa video"). The cost is not beside the button, where it read as that button's price. "▶ Lời thoại" appears when the voice is ready. While a video is being staged the card says "Đang lên dàn dựng". Finished: the player beside its shots, and "Tải xuống". Every word is a state, a number or an action; no guidance text.

## Fixture mode

`pnpm dev` simulates every provider step in a few seconds with sample media, so the whole flow can be driven for free. `HYAN_FIXTURE_FAIL="2,4x2"` makes shot 2 fail once and shot 4 twice. Real requests need `HYAN_PROVIDER_MODE=live`.

## Known risks

- The instant between fal accepting a request and the app logging it is not covered: a lost reply could still be paid twice. Rare; check the usage log after live runs.
- Whether a failed shot is billed by the provider is unverified; the app assumes not.
- Very short lines (one or two words) may be shorter than the speaking model accepts. Untested.
- The first live run with no cap on clips is still to be watched: total time from the first clip to assembly, and any clip that stays rendering for long.

## Not built

Several videos in parallel; generation while the app is closed; bundling FFmpeg.

**Caption styles (later, a likely differentiator):** a set of styles with size and position, chosen per series, building on today's word-by-word highlight. Drawn by the app itself, not a provider's caption service. Start by testing fonts against hard Vietnamese syllables (stacked accents such as "ễ", "ặ"): most display fonts used by caption tools do not cover them.
