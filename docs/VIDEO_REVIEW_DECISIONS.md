# Reviewing and fixing videos

## Fixing a video after seeing it — agreed with the owner and built, 13 November 2026

Driven end to end in fixture mode on a copy of the real data, with the real chat on Claude. **No fix has run live yet**, so how a remade shot or still actually looks is unproven. Code: `src/shared/video-fix.ts` (pure, tested), `src/main/video/runner.ts`, `src/main/video/look.ts`, chat tools in `src/main/chat/tools.ts`, `src/renderer/src/components/videos.tsx`.

### Who and why

Content staff spending company money, not directors, judged on accepted videos per hour and cost per accepted video. A bad video has three exits: accept it, throw it away, or fix it. Throwing away costs a whole video and no effort, so a fix is only worth offering if it costs less than a new video and takes under a minute. Hence the rule: **the operator says what is wrong in one sentence; the app answers with what it will make again and the price; only the changed parts are paid for.**

### The price follows what changes

| What is wrong | What is made again | Rough cost |
| --- | --- | --- |
| One shot glitched (odd mouth, hands, expression) | That shot | $0.10–0.25 |
| An action or object is not shown; wrong kind of shot at a moment | One new still, moved locally | About $0.12 |
| A character looks wrong everywhere (direction, outfit) | Their still and all their speaking shots | About half the video |
| Voice wrong (pronunciation, tone) | Voice and every shot; stills stay | Nearly full |
| Words wrong | A new script version ([scripts to videos](VIDEO_COMMIT_DECISIONS.md)) | Full |

The operator never classifies the problem. The chat does, and code computes the price.

### Rules

1. **Picture fixes happen in place.** One script stays one card with one video. Only a change to the words makes a new version. This narrows the 12 November rule "a new version reuses nothing": that rule existed because a re-voiced line sounds different, which does not apply when the voice is unchanged.
2. **The old video stays until the new one is ready**, playable on the card while the fix runs.
3. **"Bản trước"** swaps the video with the cut before the last fix, free, and "Bản sau" swaps back. A stopped or failed fix can be abandoned the same way. Nothing is deleted; one earlier cut is kept.
4. **Two ways in.** Click a shot on a finished video: "Giữ để làm lại" with its price (no words needed), or "Nhắc trong chat" (puts "Cảnh N: " in the composer). On the card, "Sửa video" references the whole video and opens the chat (13 Nov: renamed from "Nhắc trong chat" so the label names the outcome; while a video is still being made it stays "Nhắc trong chat"). Hovering a pickable shot shows "Làm lại", so the click is discoverable.
5. **The chat proposes, the operator holds.** A proposal is a card in the chat: one line saying what changes, how much is made again, the price, and a hold button (a plain button when free). The chat never spends. A proposal is spent once used and goes stale when the video changes.
6. **This video, and later ones.** Every piece of video feedback ends with both paths in one short reply: the fix for this video (rule 5) and one question, "Chỉ video này", "Cả series" or "Mọi series". A series or all-series answer saves a [learned preference](#learned-preferences-ghi-nhớ--agreed-and-built-13-november-2026) (since 13 Nov; before, it was appended to the series direction).
7. **One pause, on a video made on its own.** A planned video made by its own button stops after the voice and the stills: status "Nghe và xem cảnh chính", larger stills, "▶ Lời thoại", and "Giữ để tạo video" with the remaining price (the first hold is "Giữ để tạo các cảnh chính", priced to the pause). Fixes at the pause cost only the still. The batch button never pauses.
8. **Keeping a video teaches the series.** Downloading a video counts as keeping it. Its generated character stills are saved as the series' look and reused by later videos (free, same faces and seats), unless the automatic check complained about them, or the character or place was edited since. A correction from the operator always generates a fresh still. The same marker ends the pause for the series.
9. **Costs never go down.** Parts a fix replaces stay in the video's total.
10. **The chat never names providers or models**; it describes what they do. It says before any spending when something is not possible yet.
11. **Every proposal is logged** to `feedback.jsonl` in the data folder (the operator's words, the changes, the price), so repeated complaints can become built-in [directing rules](DIRECTING_RULES.md). The chat also reads the series' latest lines, to notice a repeat.

### What a fix can change

| Change | Effect |
| --- | --- |
| Redo a shot | The same shot again; optionally with a new direction. A wide or detail shot remakes its still. A product's own photo cannot be remade. |
| Redo a still | A character's or the scene's still again with a correction, and every shot made from it. |
| Re-plan a line | Different shots during one dialogue line. The words must be reproduced exactly and split only after punctuation; identical shots are reused. Since 13 Nov it can also add a hold (1–2 s of silence after the line, on its last shot; 4 s in all): that shot is made again with the silence, and every later shot and subtitle moves for free. |
| Redo the voice | The voice and every shot. |

### Not possible yet (the chat says so)

Characters walking or standing up; detail shots with real motion (they are a still with a slow push-in); two people speaking in one shot; correcting a subtitle on its own (subtitles are timed from the voice's own text); music.

### Open

- A remade shot uses the same still, so it should match its neighbours. Untested live.
- Reusing stills across videos of a series is untested live.
- The make button's estimate does not know yet that a series with a kept look needs fewer stills.
- Videos made before shot plans can be fixed too, but their old clips were cut slightly differently, so lips may be off by a fraction of a second after a fix.
- Whether "downloaded" is the right meaning of "kept".
- The failed attempt row ("Tính cách sửa…" with a warning mark) shows when the chat corrects its own proposal; consider hiding it.

## Learned preferences ("Ghi nhớ") — agreed and built, 13 November 2026

Results should improve with use: what an operator says they like or dislike is kept and applied to later scripts and videos. Code: `src/shared/notes.ts` (pure, tested), `src/main/store.ts`, chat tools `list_notes`, `save_note`, `remove_note` in `src/main/chat/tools.ts` (they replace `save_series_direction`; old transcripts keep their saved row labels), rules in `src/main/chat/runtime.ts`, `src/renderer/src/components/notes-list.tsx`. Built and driven in fixture mode only; the chat's judgement (when to offer, area, wording, duplicates) needs the real chat.

- **A note** is one short sentence in the operator's language, saying what to do, with an area (`script` wording and story, `picture` look, staging and shots, `voice`, `editing` pacing, holds, subtitles), a scope (this series, or every series), when it was saved, and where from (session, script, the operator's own words).
- **Storage.** Series notes on the series, all-series notes in the workspace. The series' direction (`guidance`) stays the operator's own text; nothing was migrated.
- **Who reads what.** The script writer (new scripts, variants, rewrites, the routing step) gets `script` and `voice` notes; voice generation itself takes no instructions, so voice notes act through wording and punctuation. The director gets `picture` and `editing` notes, next to the series direction. The chat itself gets every area, since it writes fixes and edits scripts. All-series notes come first, then the series'. Notes only reach the director when the series has a place (without one the plan is rules only, as before).
- **Cap.** 30 notes per scope. At the cap a save is refused and the chat asks which note to drop or replace. Saving the same sentence again, or passing a note's id, replaces instead of adding.
- **Ways in, all through the chat.** (1) The operator states a lasting preference or says "nhớ…": the chat asks the scope once with choices and confirms in a few words. (2) After every fix proposal, one question: "Chỉ video này", "Cả series", "Mọi series". (3) Feedback this video cannot get yet is still saved when the writer or director can follow it next time ("Cả series", "Mọi series", "Không lưu"); when nothing can follow it (real motion in detail shots, two speakers in one shot, subtitles alone, music, which side someone sits on) the chat says so and saves nothing. (4) The chat reads the series' last 8 lines of `feedback.jsonl`; a complaint seen before is named as a repeat. A prompt rule, no classifier.
- **Before saving**, the chat lists the notes and replaces a duplicate or contradicting one.
- **Seen and edited** on the series page ("Ghi nhớ", below "Gần đây": text, area, click to edit, × removes) and in Cài đặt ("Ghi nhớ cho mọi series"). Both appear only when there are notes. Remove is immediate and has no undo: neither screen has an undo pattern.
- **Out of scope:** learning across customers, rules extracted without the operator's yes, changing built-in directing rules.

Open:
- Every video complaint now ends with the remember question, including one-off glitches (a bent mouth) where there is nothing to remember. Owner's call (13 Nov); watch whether it annoys.
- Seats are fixed by who speaks first, so "Bà luôn ngồi bên trái" cannot be followed; the chat refuses it. A writer rule ("Bà speaks first") would make it work.
- Whether 30 per scope is the right cap, and whether notes need a per-batch on/off.

## Takes with another model — built 13 November 2026, hidden since 16 November

**The feature is hidden in the interface since the Quality levels replaced the model choice (16 November), and whether to bring it back or delete its UI and code is open.** Driven in fixture mode only (disposable data folder); two takes were made live on video #2. Code: `src/shared/video-takes.ts` (pure, tested), `src/main/video/runner.ts` (`take`), `src/renderer/src/components/videos.tsx`.

- **Try the same video with another model.** "Thử mô hình khác" on a finished video opens a menu of the registered models (hover cards included); models that already have a take are disabled. Picking one shows "Giữ để tạo" with the take's price.
- **A take reuses everything but the speaking shots.** Voice, stills, shot plan and the free wide and detail shots are reused; every speaker and listener shot is made again by the new model, then the video is assembled. The price is only those shots, at the model's rate and minimum billed length. The resolution is the video's, fitted to the model; if that changes the size, the free shots are remade too (free).
- **Tabs, named by model.** The original is a take too. The chosen take has a check mark; a running take shows its progress on its tab ("· 3/8", "· chờ"). Switching tabs keeps the playback time. Status and actions follow the selected tab.
- **"Dùng bản này"** makes a finished take the video: download, the series look and anything that reads "the video" use it. **"Xóa bản này"** removes a take that is not the video: its own files are deleted, its cost stays. The original can be deleted once another take is the video.
- **Cost:** the card shows everything spent on the video, all takes included. Takes never change what the batch or series follows.
- **One at a time:** a take queues and runs like any video.

**How it is stored.** One job per script holds every take. The top-level fields are the take being worked on, so the runner, fixes, "Bản trước", stop, resume and never-pay-twice work unchanged. Other takes are parked in `job.takes` (model, resolution, status, cut, previous cut); `job.chosen` names the video; `job.takeOrder` keeps tab order. Starting a take parks the current one and raises the shared revision counter, so files are never overwritten. `pastCostUsd` always holds everything outside the working cut, so the total spent never changes when takes are switched or deleted.

**Fix rule.** A fix acts on the take being worked on, with that take's model. Fixing, remaking a shot, "Bản trước" or "Sửa video" on another tab first makes that take the one worked on (free). Switching is refused while anything is with the provider, so a paid result is never left behind. Each take keeps its own "Bản trước".

**Card layout and cost per take (revised 13 November 2026, after the owner's live test).** Row 1: number and title, the one main button for the selected take and a "⋯" menu (Sửa kịch bản, Sửa video, Nhắc trong chat, Bản trước, Xóa bản này; with several takes also a disabled "Tổng đã chi $X"). Row 2: the take tabs, named by model, with "Cảnh 4/15" while running or the take's cost when done, and "+ Thử mô hình khác" at the end. Row 3: the muted status line and "▷ Lời thoại". A take's cost is what a whole video with that model cost: the shared voice and stills plus the take's own shots and fixes, kept per take in `job.takeLedger` (`src/shared/video-takes.ts`). Before the ledger existed, parking a take merged its spend into the total, so the tabs of video #2 all read the same total ($8.75); its ledger was rebuilt by hand from `usage.jsonl` (voice $0.10 and stills $0.94 shared, VEED Fabric $4.31, Kling Pro $3.40: $5.35 and $4.44 per take). Other old jobs with takes show no per-take cost unless their cuts add up. The Kịch bản tab no longer names the model; the ready check and the Video tab do.

## Earlier concepts (10–12 November prototypes)

The prototype-era review concepts that are not built yet (parallel generation, bulk download, a quality marker, remove with undo, timestamp references) are tracked as open work in the owner's private task list. Where they differ from the sections above, the sections above win.
