# Series material ("Tư liệu") — designed 25 November 2026

Owns what a series keeps from the videos it has made, and how later videos use it again. Replaces the "series look" of [reviewing and fixing videos](VIDEO_REVIEW_DECISIONS.md), rule 8, on the planned path.

**Status.** Built 25 November 2026: the store, automatic filing, the "Tư liệu" tab, the shared scene, reuse chosen at staging, reuse when a video is made and the operator's controls. Driven in fixture mode on a copy of real data, with one real staging on the user's own AI. No paid call has been made with it, so a reused picture or clip has not been seen inside a real video. Detail under "As built".

## Why

**Agreed with the owner, 25 November 2026: a series reuses its pictures and its silent moving clips ("filler" clips: a pour, the room, a hand on the teapot). Speaking clips are never reused.**

Billed by the provider, the two live videos of the second user test (six shots each, Cân bằng):

| Video | Total | Pictures | Silent moving shots | Speaking | Voice and sounds |
| --- | --- | --- | --- | --- | --- |
| Voice first, 18 s | $2.78 | $0.32 (11%) | $1.51 (54%) | $0.90 (32%) | $0.05 (2%) |
| Video model speaks, 27 s | $4.87 | $0.26 (5%) | $1.76 (36%) | $2.79 (57%) | $0.06 (1%) |

At normal length, the 17 saved plans of 37–61 seconds priced again at the rates measured on 20 November (an estimate, none was paid at these rates): a median of 15 pictures (about $1.05, 16%), 5 silent moving shots of about 17 seconds in all (about $4.00, 57%) and speaking with the voice first (about $1.70, 25%), about $7 a video. When the video model speaks, speaking rises to roughly $4.50 and the video to about $10.

So the silent moving shots are the largest part of a video and the pictures a small one. Reusing pictures alone can save 16% at the very most, and under 8% with the limits below; the gain there is time and a face the operator has already accepted. The money is in the moving clips.

**The voice mode does not matter for what is reused.** Pictures and staging are the same in both modes, and a silent moving shot is the same request in both (checked on the two videos above: same model, 1080p, sound off). Only speaking clips depend on the mode, and they are tied to their own words anyway. What does stop a clip from being reused is another output size (Nhanh has no moving shots and is 720p), a clip shorter than the new shot, or a plan that asks for another action.

The same two videos, made minutes apart in one series, also show the limit: same person, same outfit, same room, but a different table, chair and seat background in each. A face close-up from one fits the other. A hand-and-table shot does not: the table changed. Reuse only works when the scene itself is kept.

## Three levels, one direction

| Level | Holds | Who fills it | Lives |
| --- | --- | --- | --- |
| Thư viện (library) | Originals: characters, products, places. The authority on identity. | The operator | Across series |
| Tư liệu (series material) | What the series generated: pictures and silent moving clips | The app, by itself | One series |
| A batch | Nothing of its own. It uses material and shows where it did. | — | — |

- **One store, on the series.** A picture is only right inside one cast and one place, which is what a series is. A batch is a filter and the place where reuse happens, not a second store.
- **"Sửa series" stays the list of inputs.** Characters, products and places in that dialog are what the series is made from. Material is what it has made. They differ in trust (an original is authoritative, a generated picture is derived), so they are not merged into one form.
- **The bridge upward is explicit.** "Thêm vào ảnh nhân vật" on a picture copies it into the character in the library, marked AI. This is how a character gains more angles and expressions than the photos it started with. It is never automatic.

## What is filed, and when

- **Filed when a video finishes**, and again after each fix or new version of it: every generated picture in the cut, and every clip of a moving shot without speech. Because videos are made one at a time, the second video of a first batch already finds what the first one made.
- **Not filed:** speaking clips, the voice, sounds, shots that are a picture with a local push-in (free to make again), a product's own photo and its cut-out (they already live on the product), and a product shot's empty plate (kept per video for now).
- **Retired, not reused:** a picture the automatic check complained about; a picture or clip the operator replaced with a fix (the strongest signal we have that it was wrong).
- **Finished videos made before this existed** are filed the first time the app starts with it.
- **Storage.** `media/<seriesId>/_material/` with `material.json`. Files are copy-on-write clones of the video's own files (`COPYFILE_FICLONE`: no extra room on the Mac's file system, a plain copy elsewhere), so they survive deleting the batch and neither side can overwrite the other. Hard links were tried first and dropped for that reason.

Each item keeps: what it is (picture or clip; scene, character or detail), the director's English framing and description, the Vietnamese line the operator saw for that shot, who is in it, the clip's length and motion text, what it cost, which video made it, which videos used it since, and which reference photos it was made from.

## Staying true to the originals

Asked by the owner: check in code, or leave it to the operator? Both, in layers, each cheap.

1. **Reuse means the same pixels.** A reused picture is the exact file that was already checked and seen. It is never fed back to draw another person's picture, so there is no copy of a copy. Reference photos from the library stay the only source of identity, unless the operator promotes a picture by hand.
2. **Products are never generated.** Unchanged: a product is its own photo, cut out. Nothing in the material store holds product pixels.
3. **An item goes out of date by itself** when a reference photo it was made from is no longer on the character or the place. Adding a photo does not outdate anything. Out-of-date items stay visible, dimmed, and are never reused.
4. **Signals the app already has:** the automatic still check, the lettering check on clips, the operator's fixes, and whether the video was downloaded (kept). Items from kept videos are offered first.
5. **The operator's eye, made easy.** The viewer shows a character picture beside that character's first library photo. One click, "Không dùng lại", takes an item out of circulation.

Not done, on purpose: an automatic "same face?" judgement. The user's own AI will not reliably compare faces, and a check that is sometimes wrong would either block good pictures or bless bad ones.

## How reuse is decided

### The series keeps its scene

A series has a **scene** per seating: the master picture, what is behind each seat, and the props. Seating is decided by code from who speaks first, so a two-person series has at most a handful of scenes. The first staging of a seating creates its scene; every later staging in the series is given it and stages inside it: same seats, same props (it may add one the story needs), same master. This is what a sitcom does with its set, and it is what makes a hand-and-table shot from one video fit the next.

- The scene is known from the first *plan*, before anything is paid, so the videos of a first batch share it too. When a seating has no scene yet, its first staging goes alone and the others wait for it.
- **The video that sets the scene is told to make a neutral one**: the cast at rest, hands empty, only what belongs to the place, both in the master and in the list of props. What its own story adds goes in other pictures. Found on real data: the first video of a test series had the character holding a phone in the master, which would have put a phone in every later video.
- A new scene is made when the cast, the seating or the place's photos change, or when the operator switches the scene's picture off in "Tư liệu" ("Không dùng lại"). A button of its own for this is not built.

### The director chooses, code limits

The director (the user's own AI, at "Dàn dựng") is the one who knows whether a shot "really looks the same". It is given the series' usable material for this scene, each with its description, and may start a shot from an existing item instead of describing a new picture. Material planned by other scripts of the same batch but not made yet is offered too; whichever video is made first makes it, the others pick it up.

Code then enforces what must hold, without a second AI call:

| Rule | Why |
| --- | --- |
| **The opening shot is always new.** | It is the hook and the thumbnail. A channel whose videos all open on one frame looks like one video posted forty times. |
| **At most half of a video's pictures are reused** (the scene's master not counted). | Every video adds new material, so the store grows and videos differ. |
| **An item rests** for the series' next video after a video makes or uses it (`REST_VIDEOS = 1`). | Two videos in a row never share a shot. Two was tried first and left nothing to offer in a batch of three. |
| **A moving clip is replayed only when the plan asks for exactly that clip**, it is long enough for the new shot, and it has the video's output size. | A shot for which the director wrote its own action gets that action, made from the reused picture. Never stretch or freeze paid footage. |
| Only items that are current (see above) and not switched off. | Identity. |

A plan that breaks the first two rules is repaired in code: the surplus reuse becomes a new picture with the same description. No extra staging call, no failure. The offer is at most 16 pictures, those from kept videos first, then the least used.

Why this is the right amount of sameness for these users: the operators judge a video as TikTok viewers and CapCut editors. A recurring cast in a recurring room is a show; stock cutaways (the pour, the steam) are normal editing; the same opening or the same faces doing the same thing is spam. The limits are constants in one file and name no brand, so another company's series inherits them.

### When the video is made

Each planned picture carries the key of the item it stands for. When its turn comes: the store has that item, current and switched on → the file is linked in, free and instant; otherwise the picture is generated as planned and filed under that key when the video finishes. A moving shot whose picture has a filed clip of sufficient length takes the clip. Everything else in the pipeline (prices, the cost panel, stop and resume, fixes) already treats "made without a charge" correctly, as it does for clips carried between quality versions.

Prices follow: the button's price counts a reused item as free only when the item exists at that moment. Within a first batch the estimate is therefore an upper bound and "Đã chi" comes in under it.

## The operator's controls

Automatic by default (goal 1: nothing to do per video), with a way out at every level:

| Where | Control |
| --- | --- |
| Series, "Tư liệu" tab | "Dùng lại tư liệu" on or off for the whole series (on by default). Off: the staging prompt is byte for byte what it was before this feature, and nothing is taken from the store. The switch shows once the series has material. |
| An item | "Không dùng lại" / "Cho dùng lại"; "Xóa"; "Thêm vào ảnh nhân vật". |
| A scene on "Dàn dựng" | A reused scene shows the real picture and "Dùng lại". "Tạo mới" makes that picture fresh for this video. |
| A finished video | A reused shot is marked. The existing "Làm lại" on a shot makes it fresh, at that shot's price. |

Trying reuse first never wastes money: reuse is free, and a fresh picture costs the same whether it is asked for before or after seeing the reused one.

## Screens

- **Series page.** The "Gần đây" heading becomes two tabs, "Gần đây" and "Tư liệu", once the series has material. The tab is a grid of portrait tiles with filter chips (Tất cả, one per character, Toàn cảnh, Chi tiết, Cảnh động). A clip tile plays muted on hover and shows its length. A tile shows how many videos used it. Out-of-date and switched-off items are dimmed.
- **Viewer.** The existing full-size viewer, with the item's Vietnamese line, the video it came from (a link to that batch), the character's first library photo beside a character picture, and the item actions.
- **Inside a batch.** No separate screen. Reuse shows where it happens: on the scene in "Dàn dựng" and on the shot in "Video".

## Later

- Picking an item by hand for a scene on "Dàn dựng" ("Chọn từ tư liệu").
- The product shot's plate, once scenes are shared and the spot can be the same.
- Opening the material tab from inside a batch, filtered to that batch.
- Rest and share limits as a per-series choice ("more alike" to "more varied") if operators ask.
- A "saved by reuse" line in the cost panel and the usage dialog.
- Material across series for the same character (today the library bridge covers it by hand).

## Open

- Whether the limits (half, rest of two) are right can only be judged on a real batch of ten or more.
- Stagings that run in parallel do not see each other's choices, so two videos staged together may pick the same item. The rest rule holds across batches and for stagings that run one after another.
- Whether a director given existing material writes weaker shots to fit it. Compare a staged plan with and without the switch on the same script.

## As built (25 November 2026)

Code: `src/shared/material.ts` (what a video files, when an item is current), `src/shared/material-offer.ts` (the offer, rest, availability, keys), `src/shared/shot-list.ts` (reading a plan with an offer, the repairs), `src/main/material.ts` (the store), `src/main/video/material-staging.ts` (the offer for a staging, one scene at a time, finding an item when a video is made), `src/main/video/shot-list-prompt.ts` and `.md` (the prompt section), hooks in `src/main/video/runner.ts`, `src/renderer/src/components/series-material.tsx`, `shot-brief.tsx`, `videos.tsx`.

- **Keys.** Every planned picture carries a key. A picture that stands for an existing or planned one carries that one's key; a new picture gets its own. The store files a generated picture under its key, so "the store has it" is a lookup, not a judgement.
- **Prices.** A picture or clip the store holds right now is free in the estimate, the hold price and the cost table; it is linked into the video's folder when its turn comes. Checked again at that moment, so an item removed or switched off meanwhile is simply generated.
- **A fix makes fresh.** "Làm lại" on a reused picture or clip, or "Tạo mới" on a scene in "Dàn dựng", marks the picture as fresh for that video; it is then generated and filed under a new key.

Driven on a copy of the second user test's data, media in fixture mode, the director real (the user's own AI), no paid call:

- **Filing.** Opening the app filed 11 pictures and 3 moving clips from the two finished videos. The master of one video had been flagged by the still check ("unexpected text") and was left out, with its clip.
- **The tab.** "Không dùng lại", "Thêm vào ảnh nhân vật" (the character gained an AI-marked photo) and the viewer with the original photo beside the picture were tried by hand.
- **A staging with only the scene.** One script was staged again. The plan passed at the first call and kept the scene; the master was taken from the store when the video was made and the use recorded. With a rest of two nothing else was on offer, which is why the rest is now one.
- **A staging with pictures on offer.** A copy of an already made script was staged (the easiest case for reuse, so read the numbers as an upper bound). Five pictures were offered, one with a clip, plus the master's clip. The director kept the opening shot new, started three of six shots from existing pictures, wrote two new pictures, and asked for both moving clips to be replayed. The plan passed at the first call with no repair. Estimate $3.06 against $4.87 paid for the original video of the same script.
- **Controls.** "Tạo mới" on the scene with the clip raised that estimate to $3.88; "Dùng lại" brought it back.
- **Making it.** The video was assembled (22.5 s) with four pictures from the store, two generated, and the two real moving clips replayed; no moving shot was charged. The four reused shots carry "Dùng lại" on the Video step. Its new pictures were filed under their keys in the same scene.

Not exercised yet: a live video (so a reused clip beside freshly generated ones has not been judged by eye); a script that is not a copy of an earlier one; the repairs on a real answer (the opening shot, the half limit); several stagings waiting for the first scene of a series; the neutral-scene instruction on a new series; a batch larger than three; a series with two characters.
