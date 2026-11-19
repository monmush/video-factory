# Script board — decisions, updated 19 November 2026

Agreed with the owner in design discussions; a second round followed the first live run and a design review (12 November), and later additions are dated below. Built and walked through in fixture mode; the session chat was also driven with real Claude. The second round is not yet re-tested by the owner with real AI, nor by pilot-client staff. Covers the path from a series page to an approved set of scripts; video generation and review stay with [video review](VIDEO_REVIEW_DECISIONS.md). Where this differs from the prototype notes, this document is the newer decision.

## Operator and job

A content staffer at the pilot client whose main work is the human channel. On this screen they judge scripts; they do not write them. Their concerns are brand safety and correct product facts, stories that are not all alike, and not paying for a video from a script they would have rejected. The screen's job is to reach "make these" with as little reading as possible.

## Arriving from the series page

- Sending the request opens the session directly: no modal, no setup. The session appears in the sidebar under its series.
- The request becomes the first message of the session chat. The chat panel is open on arrival and collapses as before.
- Topics first, dialogue after. One planning pass produces a title and hook for every requested script, so cards appear within seconds and the stories differ by construction. The planner also sees topics from earlier sessions in the series. Dialogue then writes into each card in parallel.
- No approval step between topics and dialogue. A card can be deleted or replaced while others are still writing.

## Script card

- Shows title, hook, dialogue as speaker turns, the product featured and the estimated length (`43 giây`, neutral, never coloured, no "~"). Staging and camera notes sit behind a toggle.
- Title: the main idea, at most 8 words. Hook: the opening question or surprise, at most 14 words, never a story summary (the first live run produced 4-line summaries that made cards too tall). Both are clamped to two lines as a guard.
- No warnings or status on the card. The owner rejected flags such as "Dài hơn 45 giây". The writer checks and corrects its own output before a card appears: length near the target, product claims limited to the product description, and stories that are too alike. If length correction still misses, the honest length estimate is the only signal.
- Length: about 45 seconds unless the request names one ("30 giây", "1 phút"). Variants keep their source's length; an edit that names a length changes it.
- Actions: Tạo biến thể (instant) and Tùy chỉnh (instruction field), on full and compact cards alike; pin; delete (with undo).

## Density follows the count

- Up to six scripts: full cards side by side, at least 400 px wide, aligned left (no centred column). A 45-second script is roughly ten lines.
- More than six: the board opens in the list/detail reader (supersedes "compact cards, click opens the reader"). The toggle still offers compact cards (title, hook, length).
- The threshold of six is a starting value to adjust in use.
- The chat panel's left edge drags (280–560 px, remembered); dragging well past the minimum closes it, and it reopens at its last width.

## Referencing scripts in chat

Cards are not selected (agreed 12 November 2026). Selection was doing three jobs at once (looked like "pick videos to make", bulk delete, and a silent chat attachment) and confused.

- A click on a compact card opens it; in the list a click reads the row. Keyboard: arrows move between cards, Enter opens, Delete removes the focused card (with undo).
- A script goes into the chat only on purpose, two ways:
  - "Nhắc trong chat" in a card's hover actions (full, compact and the reader). It adds the script as a chip in the composer and focuses it, opening the chat panel if it is closed. Clicking again, or the chip's x, removes it.
  - `#` in the composer opens a picker of scripts (`#2 Đi chậm không có nghĩa là đi lạc`). Digits filter by number, a word by title (accents ignored); arrows and Enter or a click choose, Esc closes. Choosing adds the chip and removes the typed `#query`.
  - Drag a card or list row onto the chat panel ("Thả để nhắc trong chat"). Drags start anywhere on the card except dialogue and staging, which stay selectable as text.
- Referenced cards show a small chat mark beside their number. Chips clear after sending.
- Selection came back in a narrow form (the owner, 12 November, later the same day): a box dragged over empty board space, or Cmd/Shift-click, selects several cards (blue ring). Selection only feeds a drag or a right-click; it never attaches anything by itself. Esc or a click on empty space clears it.
- Right-click on a card or row offers the same actions as its buttons (Mở, Tạo biến thể, Tùy chỉnh, Thử lại, Nhắc trong chat, Ghim, Xóa). On a selected card, the menu acts on the whole selection: Nhắc N kịch bản trong chat, Ghim/Bỏ ghim N, Xóa N, with one undo. Bulk delete is also possible from the chat ("xóa #2 và #4").

## Changing scripts: where you act decides the result

| Where | Result |
| --- | --- |
| On a card: Tạo biến thể, or the card's prompt for a guided variant | One new independent card per click, inserted directly after the original. Neighbours slide aside and the new card grows out of the original. It carries a "Mới" mark (since 16 Nov plain grey text in the card's top row: "#4 · Mới") until the next request (never on a session's first batch, where everything is new). The count on the primary button rises at the same moment. |
| In the chat: any edit request, for one script, several or all | Scripts are edited in place. The count does not change. |
| In the chat: a request for more scripts | New cards are appended at the end, marked "Mới". |

In-place edits:

- Every targeted card shows a writing state at once and swaps to its new text as it finishes.
- Changed cards keep a "Đã sửa" mark (since 16 Nov "#2 · Vừa sửa" in the top row) until the next request. Scripts the request did not need to change stay unmarked.
- The chat shows one line with the number changed and a single "Hoàn tác" that restores all of them.
- A card that fails to update keeps its old text, and the chat line says how many were skipped.
- No per-card version history for the pilot.

If the changed card is off screen, the board scrolls to it before the transition plays.

Superseded from the prototype: separate "Viết lại" and three-variants-at-once buttons, variants appended at the end of the board, and chat revisions that append alternatives.

## Session chat (agent), 12 November 2026

Built after a local feasibility spike (12 November). With Claude selected as the text AI, the chat is one conversation per session with the user's own Claude (Agent SDK on their installed `claude`; see "Bring your own agent" in `docs/TECH_STACK_AND_SKILLS.md`). With fal it keeps the one-shot pipeline above; fixture mode replays sample turns.

- The agent changes the board only through typed tools: list, read, update one script (writes it itself and gets back length and speaker/product warnings to correct), add (plans titles and hooks, the script writer fills dialogue in parallel), rewrite many (script writer, parallel), delete, and offer choices (buttons; a click sends the option). No files, shell or other tools.
- No title on the panel (the owner, 12 Nov: "Trợ lý" felt dated); it is plainly a chat, and "Chat" names it only for the toggle tooltip and screen readers. The placeholder follows the board: "Bạn muốn làm video về chủ đề gì" when empty, "Hỏi hoặc yêu cầu thay đổi kịch bản" with scripts, "Kịch bản đã chốt" after approval.
- Replies stream. Tool work shows as short rows ("Đọc #1", "Sửa #3", "Viết 3 kịch bản mới"); a card being written dims as soon as the call names it.
- One undo per turn. Each script is saved the first time the turn touches it, in the same write, so a stopped or crashed turn undoes completely; added scripts are removed.
- Dừng replaces send while a reply runs and ends the turn at once. Writing already under way finishes on its cards. Messages sent during a reply wait, dashed, and can be removed; any still waiting when the app quits come back as "Chưa gửi" with Gửi.
- Attachments: images, PDF and text files (drop, paste, paperclip), up to 10, copied into the session folder.
- Model and effort menu in the composer, always naming both ("Opus 5.5 Vừa"), like T3 Code. No "default" or "automatic" entries: they hid what runs. Fable is not offered: it uses up a plan's limits too fast (the owner, 12 Nov). Default Opus 5.5 · Vừa (the owner, 12 Nov); the last choice is remembered for new sessions. The script writer (new scripts, variants, bulk rewrites) uses the same choice, so what the composer shows is what writes. The conversation continues across a change.
- Errors say what to do, read from Claude's typed signals (as T3 Code does) rather than message text:
  - Not installed or signed out (including account on hold, billing or verification problems): a banner with Cài đặt or Đăng nhập opens Terminal on Anthropic's own command, and sending is disabled. Returning to the app re-checks, so the banner clears by itself.
  - Plan limit reached: Claude Code holds the turn until the window reopens, so the reply shows "Hết lượt dùng Claude đến HH:mm" while it waits, alongside Dừng. Paid extra usage does not count as a limit.
  - Claude does not start within 3 minutes, crashes, or any other failure: the message says so, with Thử lại.
  - Switching the text AI in Cài đặt takes effect on the next message.
  - "Tạo N video" waits while the chat is still working.
- The conversation resumes after an idle close or restart. Claude keeps the transcript under the app's own working folder; deleting a series deletes them.
- Choices replace the planned json-render replies for now: the tool's typed input is the UI spec, rendered by our own component. Revisit json-render if replies need richer layouts.

## Committing

Superseded by [scripts to videos](VIDEO_COMMIT_DECISIONS.md) (12 November): a ready check with an all-in price and a "one video first" nudge. Two points from the earlier version still stand: the board shows a total price, not one per card (the owner, 12 November: thirty identical per-card prices are noise), and 45 seconds stays the pilot default so quality is judged at the intended length.

## Shot plan stays in the background

Agreed with the owner, 12 November 2026. Built on 13 November as the directing pass, with four shot types instead of a full camera vocabulary ([directing rules](DIRECTING_RULES.md)); since 16 November it is the shot list and build of the [plan](VIDEO_GENERATION_DECISIONS.md).

- The card stays the approval surface: title, hook, dialogue, product, length, and the one-line "Dàn dựng" note. Staff never see shot sizes, camera, light or start frames.
- The plan is made per script after it is sent to video, so deleted, edited and variant cards never pay for one.
- Dialogue is locked at approval: the director chooses shots but may not change a word.
- Mechanical checks run on the plan with one automatic retry, not in front of staff (`src/shared/shot-plan.ts`, `shot-list.ts`). The plan is saved in the video's folder.
- Story rules (beats, hook types, humour devices, batch variety) belong in the board writer, where they shape cards invisibly.
- A different look is set on the series, not per script.
- Shots surface at video review as clips to redo, not as camera settings.
- **Since 17 Nov every written script is staged by itself** (free, the user's AI, about 3 s after it is written), sent or not; the line above about planning only after sending no longer holds. **Since 19 Nov a new script is done only when its words and its Dàn dựng both exist** (`stagingState` in `src/shared/session-steps.ts`): until then the card's "Dàn dựng" tab shimmers (a compact card says "Đang lên dàn dựng", a sent one's badge "Lên dàn dựng", the Video tab's status line "Đang lên dàn dựng"), and the tab shows the director at work. A failed staging marks the tab and shows "Lên dàn dựng" to try again, never "done". Approving the words is not blocked while staging runs; a sent script's hold appears once its plan exists. A plan dropped because the script or the Quality level changed is staged again by itself (before 19 Nov it could stay without one until "Lên dàn dựng").

## Still open

- Running work stops if the app quits; interrupted cards come back as failed (with Thử lại) or keep their previous text. Background execution remains open.
- Earlier chat edits keep their Hoàn tác after later requests; undoing an old edit restores those scripts' text even if they changed since.

- Default number of scripts when the request names none (5 for now).

## Product per video

Built 15–19 November, in `main`, fixture mode only.

- **One product per video**, or none. On the card the product chip ("<product name> · 46 giây") is a picker: the series' products first, then the rest of the library (picking one adds it to the series, so the writer knows it), then "Không có sản phẩm".
- **A change is a narrow revision** (`reviseProduct` in `src/main/script-writer.ts`): only the lines that name or describe the product are rewritten, checked against the new product's library description (so one tea never keeps another's taste); the product's part of "Dàn dựng" is rewritten, the rest kept; title, hook and every other line stay word for word. Fixture mode swaps the name deterministically.
- The card shows "Đang đổi sản phẩm…", then "Vừa sửa" in the top row with the rewritten lines marked; a toast "Đã đổi sản phẩm #N · Hoàn tác" (since 16 Nov, instead of a button on the card) brings back product, lines and staging (or removes the new version). The toast stays, not on a timer, until closed or until the next change to the board takes the undo away.
- **Scripts sent to video**: if the video has started (anything made or spent), the change goes onto a new version (`src/shared/versions.ts`). Otherwise the script changes in place, sent or not.
- **Dàn dựng follows the product without being made again** (19 Nov 2026, `src/shared/product-follow.ts`): when the words are unchanged, or changed only by swapping the product's name (the shots still say each line exactly), the plan is patched in code with no directing call: product shots show the new product, their plate picture (the empty spot) is kept, the cut-out and its price follow the new product, and wishes written on the old name follow it. It is staged again (minutes of the user's AI) when other words changed, the product was removed, the plan has no product shot to carry the new one (the director decides where a product goes), or a script has several products. A change while the staging is still being made is applied (it used to be refused with "Đang lên kế hoạch"): the staging follows it when it lands. Undo follows the same way.
- **Sharing products across new scripts** (agreed with the owner 16 November, `newTopicProducts` in `src/shared/product-mix.ts`, tested): nobody is asked. A topic with a product named for it keeps it. The others, in order: shared evenly among the products the request mentions by `@handle` (board's own write path; counts only that request; a mentioned library product joins the series); the batch's saved mix; otherwise an even split over the series' products, balanced against the board, starting one product later for each batch of the series. A series with one product or none: the writer chooses, as before. Existing scripts change only on request.
- **Batch product mix**: whole percentages summing to 100, now set only by asking in the chat (`set_product_mix`); the "Sản phẩm" chip and its editor were removed on 16 November, so a saved mix is not shown anywhere on screen. An empty mix means the even split above.
- **`@` picks a product** in both prompt boxes (series page and session chat; `src/shared/mentions.ts`, `mention-picker.tsx`): the series' products first, then the library; filtered by name or handle without diacritics; writes `@handle` as plain text. Shares the popup and keys with the `#` script picker.
- **"Chọn tất cả" / "Bỏ chọn"** in the asset picker's footer when it lists two or more.
- **Chat tools**: `set_product_mix` (products by @handle with percentages), `assign_products` (script numbers to a product, the same revision as the picker, reports which lines and the staging changed, new versions included in the turn's undo), and an optional `product` per topic on `add_scripts` (overrides the mix).
- Variants keep their source's product.

Not verified: the real writer's revision (only the fixture swap ran), and the three chat tools with Claude.

## Card header (16 November 2026)

Agreed with the owner after a review of everything the header showed (number, version, chat and pin marks, title, hook, "Mới"/"Đã sửa", "Hoàn tác", the video status), all in one row that squeezed the title to two clipped lines.

- **Top row, small and grey:** `#N`, "· bản N", "· Mới" or "· Vừa sửa" (a coloured dot was tried first and was unclear), the chat mark and the pin on the left; the video status ("Đang tạo video", "Có video"…, a link to the Video tab) on the right; in the reader also "Chọn làm video thử".
- **The title below, full width**, balanced wrapping, never clipped on a full card. Compact cards keep two lines.
- **No hook on full cards:** it is the first line of dialogue. Compact cards and the list keep it, since they hide the dialogue.
- **One undo pattern on the board:** toasts (deleting, changing a product). Chat edits keep theirs in the chat.
- The toolbar no longer shows the product mix or the total length; "Tạo video" reads "Tạo N video" for several scripts.

