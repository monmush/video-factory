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

## Editing a line by hand (21 November 2026)

The operator reviews scripts and often wants to fix one line without asking the chat.

- **Click a line to edit it** (Lời thoại tab, on a full card and in the list view's reader). Selecting text to copy does not open the editor; hover shows a light background and a pencil; the line is focusable and Enter opens it. In the editor Enter saves, Esc cancels, leaving the field saves; an empty or unchanged text is a cancel. No new lines inside a line; the text is cleaned like written lines (`cleanCues`, one trailing cue such as `[cười]` kept). The speaker, adding and reordering lines stay in the chat; removing a line is below. The length in the footer follows the draft.
- **Not editable** while the script is being written or its product is changing, and on a dimmed card of the "Chọn làm video thử" nudge (the click still picks the card).
- **In place or a new version, one rule** (`editsInPlace` in `src/shared/edit-in-place.ts`, also used by product changes and their undo): in place when the script is not sent, or sent but its video is untouched (no job, idle with nothing paid and no dialogue, staging in progress, or staging failed before anything was paid). Otherwise the edit goes to a new version and the original script, job and video are never touched. The editor says so before anything is typed: "Đã có video nên thay đổi lưu thành bản mới. Video cũ giữ nguyên." The copy is made only when a changed text is saved, in the same write as the edit, right after the version chain; the board then moves to it (list: active row; gallery: scrolled into view and focused) with the edited line marked against its source. The copy is not added to the chat's references.
- **After saving**: the new text shows at once (no replay of the lines' reveal), the card reads "· Vừa sửa" (or "· Mới" for a new version), the line is marked like a product change, and a toast "Đã sửa lời thoại #N" or "Đã lưu thành bản mới #N" offers "Hoàn tác" until closed or until the next board change takes the undo away. A failed save shows the error in the toast and reopens the editor with the draft. If the line changed meanwhile (chat or another edit) the save is refused with "Kịch bản vừa thay đổi, hãy thử lại".
- **Removing a line** (23 November 2026): while a line is open in the editor, a quiet trash button at the end of its row ("Xóa lời thoại") removes it in one click, without a confirmation, because it can be undone. It follows the edit's rules exactly: the line must still read what the editor opened with, the same in-place-or-new-version rule and note, the same undo, mark and chat notice; the toast reads "Đã xóa lời thoại" or "Đã lưu thành bản mới". A script keeps at least one line, so the button is hidden on a single-line script and the save refuses it. Pressing the button does not also save the draft text. The Dàn dựng follows like after an edit (one removed line that is not the last one is a small restage, otherwise a full one). Still left out: adding and reordering lines, renaming a speaker, and deleting a scene of the Dàn dựng.
- **One undo on the board**: `Script.changeUndo` (was `productUndo`) and `board:undo-change` serve product changes and hand edits; an in-place undo is refused once the video has started. Each hand edit clears the other marks, so the undo covers the last edit only.
- **Dàn dựng follows** through the existing board listener: an unstarted job whose words changed is staged again from the previous plan (partial when the edit is small), an outdated staging is aborted, several quick edits restage from the original basis. A job whose staging failed before any spend is now replaced and staged again too. When a plan is made again because the words changed, the job records what changed by comparing the shown plan's scenes with the new ones (`src/shared/reworded.ts`, independent of which AI path ran): "Đã cập nhật N cảnh theo lời thoại mới" with a "Vừa sửa" badge on those scenes, or "Đã lên lại toàn bộ theo lời thoại mới" when nothing recognisable was kept; " · Đã bỏ N ý của bạn" counts scene wishes whose words are gone. Shown only while the video is untouched; a first plan shows nothing.
- **The chat agent is told**: scripts edited outside the chat (by hand, by the product picker, or by an undo) are listed on the board (`Board.handEdited`) and the next turn starts with a hidden note naming them by number, asking the agent to read them again before changing them. The list is cleared when that turn starts.

## Dàn dựng is its own step (23 November 2026)

Decided by the owner after the second user test: every script edit staged again (40–60 s each, mostly wasted), and the Dàn dựng was hidden behind a tab on the script card. Built, walked through once in a test copy with the user's own AI; not yet tested by the owner. Where an earlier section of this document or of [video generation](VIDEO_GENERATION_DECISIONS.md) and [scripts to videos](VIDEO_COMMIT_DECISIONS.md) says staging runs by itself, that a change stages again, or that the Video tab holds unstarted videos, this section is the newer decision.

- **Three steps in a session: Kịch bản › Dàn dựng › Video.** Kịch bản owns the words, Dàn dựng what is seen and the price, Video the paid result. The shortest path for a batch is one click ("Dàn dựng N kịch bản"), a wait, one hold.
- **Dàn dựng runs only when asked**: the Kịch bản button, a card's "Dàn dựng" / "Cập nhật" / "Thử lại" / "Dàn dựng lại", or the chat (`direct_video`, `stage_scripts`). Never after an edit, never when a script is written. A chat request stages once, at the end of the turn.
- **A change never deletes a Dàn dựng; it makes it outdated** (`src/shared/staging-status.ts`): the words, the product (when it cannot be patched in code), the Quality level (to or from Nhanh) or a scene wish not yet applied. The old scenes stay, dimmed, with the reason and "Cập nhật". Outdated is worked out by comparison, not stored, so undoing the change makes the Dàn dựng current again with no call. This replaces the old behaviour where changing Quality threw every unpaid staging away.
- **Nothing is paid from an outdated or missing Dàn dựng**: no price, no hold, and the main process refuses to start or commit it.
- **Kịch bản step**: the button counts scripts whose words are ahead of their Dàn dựng; with none it is "Xem dàn dựng →". The card has no Dàn dựng tab; a quiet mark ("Đang dàn dựng", "Đã dàn dựng", "Dàn dựng cũ", "Lỗi dàn dựng") links to the step.
- **Dàn dựng step** (`src/renderer/src/components/staging.tsx`): one card per unstarted script, open in a grid up to six, folded in one column beyond; started videos listed below, read-only. Each card: title, a status line, Quality for that video, one action, the cost fold and the scenes. The header carries the hold for everything ready; the batch Quality and, when something is ready, the button for the scripts still to stage sit in a bar on the page. The "one video first" nudge lives here.
- **Editing a scene by hand saves a wish** and marks the Dàn dựng outdated; several wishes are applied by one "Cập nhật".
- **"Sent to video" still means paid**: a script is committed when its hold is pressed. The Video step lists only committed scripts.
- **Editing while a staging runs** stops that staging; nothing restarts by itself.

Known gaps: once "Cập nhật" starts, the old scenes are replaced by the progress steps, and a stopped update leaves the script without a Dàn dựng until it is run again; a missing character is checked before paying, not before staging; deleting a scene is not built.
