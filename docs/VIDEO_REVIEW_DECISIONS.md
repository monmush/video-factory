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
8. **Keeping a video teaches the series.** Downloading a video counts as keeping it. Its generated character stills are saved as the series' look and reused by later videos (free, same faces and seats), unless the automatic check complained about them, or the character or place was edited since. A correction from the operator always generates a fresh still. The same marker ends the pause for the series. Since 25 November 2026 videos made from a staged plan use the series' material instead ([series material](SERIES_MATERIAL_DECISIONS.md)): filed when a video finishes, not when it is downloaded; the look described here remains only for videos made without a plan.
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

## Another quality level for a finished video — built 19 November 2026

Replaces "takes with another model" (built 13 November, hidden since 16 November): versions are now keyed by Quality level, never by model, and work for planned videos. Driven in fixture mode only, on a copy of a finished 18-shot Cân bằng video; no paid call. Code: `src/shared/video-takes.ts` (pure, tested), `routeAtLevel` in `src/shared/build-direction.ts`, `src/main/video/runner.ts` (`version`), `src/renderer/src/components/videos.tsx`.

- **"Thử chất lượng khác"** in a finished video's "⋯" menu lists the offered levels the video does not have yet, each with the price of making that version; picking one shows "Giữ để tạo ~$X" with "Hủy". The new version is made from the version being viewed and keeps the others.
- **Same plan, only what the level changes is made.** Shots, lines, timing, subtitles, voice and stills are the plan's and are never made again (every offered level draws its stills with the same request; the unused per-level picture size was removed). For each shot the level's route is worked out (`routeAtLevel`): a speaking shot uses the level's speaking model with the plan's own prompt; a moving shot keeps its motion at a level with motion and becomes the local still with a push-in at Nhanh; a wide or listener shot that is a still only because the plan was made at Nhanh becomes motion with a fixed sentence (`MOTION_OF_A_STILL_MOMENT`), since a Nhanh plan has no motion text. A clip carries over, at no cost, when any version already made that shot with the same route, picture and model (local clips also need the same output size); otherwise it is made again. Sounds carry over from a version that has them; a level without sound drops them. Prompt wording that changed since a clip was made does not count as a difference.
- **Measured on the 18-shot video (fixture, recipe prices):** Cân bằng → Cao cấp $4.84 (11 speaking shots at the new model, short ones billed at its 4 s minimum; 5 motion clips, 2 product shots, 17 stills and the voice carried); Cân bằng → Nhanh $0 (speaking clips carried; 5 motion shots and 2 product shots made locally at 720p); Cao cấp → Nhanh $0 (speaking clips taken from the Cân bằng version). Nhanh → Cân bằng pays only the moving shots (tests); it adds no background sound, because a plan made at Nhanh has none.
- **Switching and picking.** With more than one version the "Chất lượng" row becomes the switch: one tab per level, a check on the picked one, a spinner on one being made. "Dùng bản này" picks a finished version: download and the series look use it. After picking a version at another level than the batch, one quiet line offers "Dùng {level} cho N video chưa tạo?" with "Dùng" and ×; no dialog. "Xóa bản này" removes a version that is not the picked one; files another version still uses are kept.
- **Cost.** Each version owns what was spent while it was worked on (the first version everything up to the second, a later version its new parts and its fixes); the "Chi phí" disclosure shows the viewed version's own cost and the menu's "Tổng đã chi" the total, which never goes down. A deleted version's cost stays in the total and is not counted again if the level is made again.
- **Fixes act on the viewed version.** Clicking a shot, "Bản trước" or "Sửa video" first makes the viewed version the one worked on (free, refused while anything is with the provider). Switching raises the revision, so a chat proposal made for another version is refused as stale.
- **Clip check.** The automatic redo limits (2 per shot, 4 per video) are counted per video across all versions; making or deleting a version never resets them.
- **Safety.** A version starts only from a finished video with nothing in flight, one at a time like any video, through the same marks, request log and restart rules. Driven: the app was killed with 11 speaking clips rendering; after a restart each was polled by its saved request id and none was sent again.
- **Old jobs.** Versions saved by model before 19 November stay readable, switchable and deletable, labelled "Bản 1", "Bản 2"; they cannot get a level version. The model menu, model sample clips in the menu and the per-model hover card were removed.

## Saving several videos at once — built 20 November 2026

Code: `src/shared/video-export.ts` (pure, tested), `saveFinals` in `src/main/video/runner.ts`, `src/renderer/src/components/save-videos.tsx`. Driven in fixture mode on a copy of the data, with the folder picker stubbed; the real picker was only seen opening.

- **Entry.** An outline "Tải xuống" at the right end of the Video tab's "Thiết lập" row, shown only when the session has at least two finished files (two finished videos, or one video with two finished versions). The card's own "Tải xuống" stays for one video.
- **Dialog "Tải video xuống".** One row per finished video in board order (number, title, length m:ss); a video with several finished versions gets one indented row per version, labelled by level, the version in use marked with a check. Ticked at first: each video's version in use, or its first finished version when the one in use is not finished. "Chọn tất cả" ticks every file, versions included, and clears them all when everything is ticked. Footer "Hủy" and "Tải N video" (N files).
- **Saving.** "Tải N video" opens a folder picker ("Chọn thư mục lưu video"); cancelling returns to the dialog unchanged. Files are copied as `02 Title.mp4`; when two versions of one video go, each gets its level in brackets (`02 Title (Cao cấp).mp4`). Nothing is overwritten: a taken name gets " 2", " 3", … (compared ignoring case and accent encoding). The renderer sends only ids; the main process checks each version is finished. Saving a video's version in use also saves the series look, as the single download does.
- **After saving.** All saved: the dialog closes and the folder opens in Finder. Some failed: the dialog stays with "Chưa lưu được: #3, #5", and only the failed files stay ticked, so "Tải N video" retries just those.

## Earlier concepts (10–12 November prototypes)

The prototype-era review concepts that are not built yet (parallel generation, a quality marker, remove with undo, timestamp references) are tracked as open work in the owner's private task list. Where they differ from the sections above, the sections above win.
