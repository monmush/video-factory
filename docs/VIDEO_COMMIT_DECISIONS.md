# From scripts to videos: ready check and cost — decisions, updated 19 November 2026

Agreed with the owner in design discussions (12–19 November 2026). Owns what happens between an approved script board and paid generation: what the user sees before spending, what is configurable, and the "one video first" nudge. Supersedes "Committing" in [script board decisions](SCRIPT_BOARD_DECISIONS.md). Reviewing and fixing finished videos: [video review](VIDEO_REVIEW_DECISIONS.md).

## Operator and moment

A non-technical staff member spending the company's money. At the button they worry about two things: "will this waste money?" and "will it look right?". They cannot judge models, quality tiers or audio options; offering them only adds anxiety.

## Design rule for other companies

The app will be sold to other companies, each with its own budget and its own idea of a ceiling per video. So the app never builds in one customer's thresholds: the pilot's cost target, its 45-second length and its currency are pilot goals, not app behaviour. Where a company setting is not designed yet, the MVP does the simplest thing.

## Nothing new to configure

Every choice already has a home:

| Choice | Lives on | Why |
| --- | --- | --- |
| Look, setting, subtitle style | Series | Consistency across videos; already agreed |
| Voice | Character | [Voices](VOICE_DECISIONS.md) |
| Dialogue, length, product, staging note | Script card | The per-video customisation |
| Format (9:16) | Fixed by us | Staff cannot evaluate it |
| Quality ("Chất lượng") | The series' default; a chip on the series page's prompt box and on the Video tab's settings bar for the batch | See below |

**Quality, not a model (since 16–17 November 2026).** The operator picks a level, never a model or a resolution: the earlier "Mô hình AI" and "Độ phân giải" pickers and the "Thiết lập" tab are gone, and no model or provider name appears anywhere in the interface. Two levels are offered, "Nhanh" and "Cân bằng" (default; wide, detail and listener shots really move). The menu shows each level's price for a 45-second video, computed from the recipe's rates, and a hover card shows what it buys (a still with a slow zoom against real motion). The level is set on the series form as the default, on the series page's prompt box for the batch about to start and on the Video tab; choosing the series' own level follows the series again. A video is planned at the batch's level at that moment and keeps it once paid for. Every price before spending (board total, "Tạo thử 1 video", "Tạo cả N video", the ready check, the Video tab's remaining videos) uses the batch's level. What the level makes, and the recipe behind it: [video generation](VIDEO_GENERATION_DECISIONS.md), "The plan". Changing the level after scripts exist re-stages every unpaid script without asking; that is a known problem with an undecided redesign. Trying the same video with another model ("Thử mô hình khác") is hidden; its fate is open.

Quality is the same for the whole batch. Customising one video means editing its card before committing.

**Later:** the user sets a video's length or its cost. They are one control, since almost all of the price is video seconds; set one and show the other. A company ceiling is then the maximum that control allows. In the MVP the card's existing length is the only control and the price follows from it.

## Price

- Every click that spends money shows its own price first, all-in (video and voice; images when new ones are needed). No split by provider.
- Only what this click spends. Redos are their own click with their own price, shown then.
- Shown in dollars through `formatCost` (`src/shared/credits.ts`). Currency or credits per company are later, in that one function.
- Labelled as an estimate until a full video has been measured. Once real costs exist, the estimate should use the series' own measured cost per second.

Guide prices for a 45-second video: Nhanh about $3.02, Cân bằng about $3.33 (`levelEstimateUsd`), from a typical mix that is out of date (7 pictures, 38 s speaking, 7 s moving; the usual mix is now about 15 pictures, 27 s speaking, 14 s moving). Voice is a few cents; planning, assembly and subtitles are $0 (the user's own AI or local). The breakdown ("Chi phí") shows before, during and after the video. Budget is not a limit for now (quality before cost): the build ignores a guide budget and no "over the suggested amount" warning is shown; whether it should warn or block is open.

## Ready check

Revised 12 November after the owner tried the first build: a dialog that repeated the count and price and listed the cast's voices gave the user nothing new. The voice is chosen on the character and its sample is a generic line; a wrong voice is what the test video is for.

- **Nothing to fix: no dialog.** The board is the decision surface: dimmed cards and priced buttons already say what will be made and what it costs. Every button that spends money is **hold to commit**: press and hold 3 seconds while it fills left to right ("Giữ để tạo video ~$3.33"). Releasing early undoes it; a quick tap nudges the button as a hint. Agreed with the owner 12 Nov, replacing a 5-second countdown with "Hủy": holding shows intent, a misclick does nothing, and nobody waits once sure.
- **Something to fix: the dialog opens** and shows only the problems, each fixable in place. Its button carries the count and price of what will actually be made.
  - Blocks that video: a line spoken by someone not in the library; a character with no photo.
  - Warns only: a script estimated well past its own target length; two characters sharing a voice.
  - Balance that does not cover the batch: `Số dư $A · đủ cho K/N video`, and the user can make those K. Unknown balance never opens the dialog. No provider name.

No settings, no checkboxes. Accepted consequence: on a normal day one 3-second hold on "Giữ để tạo cả 10 video ~$26.50" commits the batch.

## One video first (a nudge, never a gate)

- **When:** the first batch of a series, and again after its characters, voices or look change. Gone once the series has a finished video the user kept, so daily users see it once per series.
- **Board:** primary "Tạo thử 1 video", secondary "Tạo cả N video", each with its price. The other cards dim but stay readable and editable (not disabled-looking). Hovering "Tạo cả N video" lights all cards back up.
- **Which card:** the first by default; clicking a dimmed card makes it the test instead.
- **No extra warning** on "Tạo cả N video": dimming and the two prices are enough; experienced users are trusted.
- **After the test:** the other cards wait on the Video tab, dimmed, grouped under the made videos with a header "Còn N video" and the one primary "Giữ để tạo N video còn lại" (or "… video #2" for one). Each waiting card keeps an outline button to make just that one, hidden when it is the only one left (13 Nov: the batch button used to float alone at the top and every waiting card had a primary button). The test is the batch's first video, never paid twice.

## As built (12 November 2026)

- A warning for length means more than 20% past the script's own target; scripts without a target get none.
- The ready check counts finished cards only, in board order. Blocked cards stay out of the count and price and are listed with their number. When the balance is short, the button makes the cards that fit, in board order.
- The dialog no longer lists the cast; voices appear only in a shared-voice warning. A speaker not in the library is fixed by choosing a library character (or making a new one); that also adds the character to the series.
- Approval records which scripts were committed. Only committed scripts lock (see below); "Tạo N−1 video còn lại" commits the rest from the Video tab. Sessions approved before this count as having committed every finished script.
- Choosing the test: a click on a dimmed full card picks it (full cards have no click action of their own). On compact cards, the first click on a dimmed card picks it and "Mở" still opens it. In the list view, rows still open scripts; the open script offers "Chọn làm video thử". The right-click menu offers it everywhere.
- No nudge when the board has only one finished card: that video is already the test.
- On the Video tab the first paid step of a planned video is labelled "Giữ để tạo các cảnh chính" and priced to the pause ("Nghe và xem cảnh chính", after voice and stills); the hold after it reads "Giữ để tạo video".
- The toolbar's "Tạo cả N video" price covers every finished card; the ready check then leaves blocked ones out.

## Moving between Kịch bản and Video (agreed 12 November, built 13 November)

The board no longer locks as a whole at the first approval. Operators come back to the Script tab after the test video, while videos run, and after the batch, so the board stays a working surface.

- **A script locks when it is sent to video; nothing else does.** Unsent cards stay editable by hand and by chat; new cards can be added and deleted. Sent cards are read-only, with a mark ("Đang tạo" / "Có video") that jumps to its video. The chat may read them but not change them.
- **The board's make button counts only unsent finished cards**, the same action as "Tạo N−1 video còn lại" on the Video tab. Once any script has a video, its label says which it makes: "Giữ để tạo video #2" for one, "Giữ để tạo N video còn lại" for several (13 Nov; the owner could not tell whether it would remake #1).
- **Changing a sent script makes a copy.** "Sửa" on the script card and "Sửa kịch bản" on the video card both create an editable copy right after the original, marked as a new version, and open it. It is made with the normal hold button and full price; its video appears beside the old one.
- **Narrowed 13 November:** a new version is for changing the *words*. Changing only the picture is a fix in place, which reuses everything it does not touch ([reviewing and fixing videos](VIDEO_REVIEW_DECISIONS.md)).
- **A new version is an independent attempt.** Nothing is reused from the earlier video: voice, frames and shots are all made fresh. Simpler to build and explain, and avoids a re-voiced line sounding different from its neighbours. Shot reuse is not planned.
- **"Sửa" works while the original's video is still being made.** The copy does not touch the running video; it keeps going unless the user stops it (stopping keeps what is already paid for, see `lossIfStoppedUsd`).
- **The chat does the same as "Sửa".** Asked to change a sent script, it makes the copy, edits the copy and says so in one line ("#3 đã có video, nên mình sửa trên bản mới"). A request touching several sent scripts copies each. Nothing is spent until the user holds the make button on a copy.
- **The old version's cards look no different** once a new version exists (no dimming, no "Có bản mới"): the new one may turn out worse, so the user decides which to keep and deletes the other.
- **The original script and video stay** until deleted, so the two can be compared and nothing paid for is lost.

As built (13 November):

- A sent card shows "Đang tạo video", "Có video", "Video đã dừng" or "Video lỗi"; it links to the Video tab. Its new versions read "#2 · bản 2". "Sửa" opens the new version in the chat as a reference; editing is through the chat, as everywhere else.
- Versions are numbered after the versions still on the board, so an undone or deleted one leaves no gap.
- A chat edit to a sent script copies it once per turn and keeps editing that copy; the turn's Hoàn tác removes the copy. A copy the writer left unchanged is removed again.
- The chat agent never deletes a sent script; the operator can, except while its video is running or waiting.
- Hoàn tác of an older chat turn is refused once one of its scripts has been sent.

## Auto mode on the Video tab (agreed and built 13 November)

The app is meant for staff making videos at scale. One button on the Video tab runs the whole batch end to end, instead of steps on each video. Lives on the Video tab only; writing and choosing scripts stay as they are.

- One hold, every video, no stops. Videos in the batch never wait at "Nghe và xem cảnh chính".
- Listening and looking first stays possible, but only when the operator asks for it; the batch never needs it.
- The button covers every unfinished video on the tab: waiting ones, ones stopped at "Nghe và xem cảnh chính", and failed ones (retried). One total price, e.g. "Giữ để tạo hết 8 video ~$21".
- Listening first is chosen by making one video on its own ("Tạo thử 1 video" on the board, or a card's own button): in a series with no kept video it still stops at "Nghe và xem cảnh chính". The batch button never stops.

As built: the button sits at the top of the Video tab, "Còn N video" with "Giữ để tạo hết N video ~$X" (the old wording, e.g. "Giữ để tạo N video còn lại", while only unsent scripts are left). The scripts not yet sent follow under "Chưa tạo N video". A lone sent video that is waiting or stopped keeps its own card button and gets no batch button. Price: estimate for unsent scripts plus what each sent one still needs. If an unsent script needs the ready check, the button opens it first and everything runs once it is approved. `video:make-all` in main; `runThrough` in `src/shared/video-job.ts`.

## While running

- Voice is generated first and fixes each video's real length before the expensive step.
- Running total on the Video tab: `Đã dùng $7.90 / ~$26.50`.
- One automatic retry, then "Thử lại"; a restart never pays twice.
- Dropped for the MVP: pausing a batch that runs over estimate. It is a ceiling by another name; each company will set its own later.

## Still open

- Real all-in cost, redo rate and generation time: one live video measured so far ($2.61 against a ~$2.65 estimate, 13 Nov); every logged fal cost is an estimate until real charges can be read; redo rate and generation time unmeasured.
- What "a finished video the user kept" means exactly; until videos exist, the nudge shows for a series with no earlier approved session.
- What changes count as "look changed" for the nudge.
