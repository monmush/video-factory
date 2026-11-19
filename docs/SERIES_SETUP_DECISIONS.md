# Series setup

Updated 19 November 2026 to match the app. The earlier conversational setup (rough idea → sample script → sample video → approve series, with a context sidebar) is superseded. This document also owns the workspace shell, since it frames the series and session screens.

## Series as a saved record

Built in the app; the owner is still to review the flow.

- **A series is a record, not a conversation.** Fields: name, direction text (`guidance`), and characters, products and Bối cảnh chosen from the shared library. It works like a Claude Project: saved context every session inherits.
- **A session is the conversation.** Each request typed on the series page starts one session with its own scripts, videos and chat. The request becomes the first chat message.
- **No setup gate.** "Tạo series" is one plain page: optional name, a description and asset pickers. The description becomes the first direction. The series is usable at once; the first session doubles as the sample. Nothing is saved until sent.
- **Chat edits the record, it does not hold it.** Direction is edited in "Sửa series" today. Later, AI can expand a rough description. Lessons from the chat are kept as separate [learned preferences](VIDEO_REVIEW_DECISIONS.md#learned-preferences-ghi-nhớ--agreed-and-built-13-november-2026), listed under "Ghi nhớ" on the series page; the direction stays the operator's own text. Changes apply to future sessions only; existing scripts and videos change only when explicitly targeted, never by automatic paid regeneration.
- **Delete** asks for confirmation, removes the series and its sessions, and moves their media folder to the Trash. Library assets are untouched.

## Reference images live in the library

A place or look the operator likes is saved as a "Bối cảnh" asset (images plus a description of the space; the AI description skips people and products), then chosen by the series like characters and products. Reason: the approved courtyard pack is reused across series, and one copy keeps edits consistent. Images dropped on the new-series composer open as a new Bối cảnh and are added to the series on save. Styles ("Phong cách") may follow the same pattern if mood references turn out to differ from places. Editing a shared asset must not silently change approved work.

## Clean place photos

Built 13 November 2026, fixture mode only. A Bối cảnh's photos are what the image model sees as "this is the place" for every still, and it copies what it sees: one pilot place's photos show two people at the table and a lettered gift box, so stills redrew the box and the seating. Any customer can make the same mistake.

- **Check, free.** When photos are added to a place, and when a place whose photos were never checked is opened, the user's own AI looks at each photo: people? product packaging or any lettered box, bag, label or sign? The finding is saved on the photo (`placeCheck`) and not asked again. Like the still checks, it runs only live with Claude as the text AI; otherwise nothing is checked and nothing is marked. It never blocks saving. Code: `src/shared/place-check.ts` (pure, tested), `src/main/place-check.ts`.
- **Warning.** A flagged photo has a small mark and one line: "Có người trong ảnh", "Có hộp có chữ" or "Có người và hộp có chữ".
- **Clean version, paid.** "Giữ để làm sạch ~$X" (the still's per-image estimate, about $0.12) sends the photo to the image-edit model the stills use, asking it to remove what was found and keep everything else, at the original's aspect ratio. The result appears beside the original and is checked again; "Dùng ảnh này" puts it in the original's place (marked AI), "Bỏ" discards it. The original stays in the asset's folder (`original` on the photo) and "Dùng ảnh gốc" brings it back. Logged like other image calls (`clean-place-photo`). Fixture mode copies the photo for free.
- **Ready check.** A series place that still has a flagged photo is a warning (never a block) with "Làm sạch ảnh", which opens the place in place.
- Fixture testing: `HYAN_FIXTURE_PLACE_CHECK=1` (fixture mode only) answers every photo as showing people and packaging, except photos cleaned in fixture mode.
- **Not yet seen live:** whether the user's AI flags reliably (signs and small labels), and whether the image model really leaves the place untouched (furniture, light, framing) while removing people seated at a table. Compare each cleaned photo with its original before using it.

## Series page layout

Agreed with the owner after mocking the page with two months of data (about 30 sessions, 6 products). The page is visited daily to start or resume a session; direction and assets change rarely. So: one column; direction as one line; assets as thumbnails in the composer footer (they are what the request inherits); one "Sửa series" dialog for name, direction and assets. Session rows show date, script titles and the state that needs the operator; only those rows stand out. Asset kinds are told apart by thumbnail shape (round character, square product, wide place) and, in forms, by labelled rows. Video states ("Đang tạo", "N video mới") are meant to join the row; generation exists but the rows do not show them yet.

## What the direction should eventually cover

From the earlier setup concept; still the target for AI-written direction. Staff describe intent in ordinary language and judge concrete examples; no professional directing fields.

- Characters: appearance, outfit, personality, voice and forms of address.
- World/style: setting, atmosphere, lighting and permitted variation.
- Writing: hooks, humour, natural dialogue, pacing and product promotion.
- Dàn dựng: recurring camera, performance and transition guidance.
- Brand rules: approved assets and product/logo accuracy.

## Products

Shared library, reusable across series; product name and original photos are enough. Bulk import with AI grouping and naming is built. No structured specs; spreadsheet/catalogue extraction is deferred. Scripts use only confirmed names, photos and label text, never unsupported claims. Unseen package sides stay plain rather than generated.

## Open

- Whether a sample video is required before the first real batch.
- AI-written direction; per-series staging references (seated, opposite side, from behind).
- Which product each script features when a series has several: built, see [product per video](SCRIPT_BOARD_DECISIONS.md#product-per-video).
- How character voices relate to a series. Voices belong to the character, with previews in the character dialog ([voices](VOICE_DECISIONS.md)).
- "Series" versus "Chuỗi video" in the UI; avoid "lô".

## Workspace shell, steps and appearance

Accepted by the owner; pilot-client staff have not used it yet.

- **Icon rail** on the left: Tạo video and Thư viện; balance and Cài đặt at the bottom. Each area returns to the last place visited in it.
- **Section sidebar** beside the rail, resizable (180–420 px, double-click resets). Under Tạo video: "Tạo series", then series with their sessions ("Xem thêm" for older ones). Click a series name to fold it; pin, rename and delete from the hover ⋯ or right-click. Under Thư viện: the asset kinds (characters, products, Bối cảnh). The sidebar's "+" on a series opens the series page with its prompt box focused; a session exists once a request is sent.
- **Content** sits in a bordered card with a breadcrumb naming the parent.
- **Series page** (`/series/$id`): a prompt box that starts a session, the direction on one line, the series' assets as thumbnails, session rows, and one "Sửa series" dialog. No setup conversation.
- **Session** (`/sessions/$id`): two numbered steps, Kịch bản then Video (the "Thiết lập" tab was removed on 16 November). Kịch bản is the [script board](SCRIPT_BOARD_DECISIONS.md) with the session chat on the right. Video (open once scripts are approved) holds a card per video ([video generation](VIDEO_GENERATION_DECISIONS.md), [reviewing and fixing](VIDEO_REVIEW_DECISIONS.md)).

Flow rules (built 16 November 2026):

- **A setting sits beside the button it changes.** Settings for making videos are chips in one bar at the top of the Video step; today that is "Chất lượng". Products need no setting: they are shared across new scripts automatically and `@` in a prompt box names one.
- **One inheritance rule, shown the same way.** "Chất lượng" is set on the series form as the default, and as the same chip on the series page's prompt box (for the batch about to start) and on the Video step (for the batch). The chip's menu shows each level's price for a 45-second video and tags the series' own level "Series". Choosing the series' level follows the series again.
- **The header's right corner names the next thing to do.** On Kịch bản: "Duyệt N kịch bản" while scripts are unsent (approving sends them to the Video step and spends nothing), then an outline link to the Video step, "Xem video". On Video: the batch hold button.
- Each step shows a count (scripts on the board; videos done out of sent). Kịch bản shows a check once every finished script is sent. Video shows a dot while a sent video waits on the operator (not started, at "Nghe và xem cảnh chính", stopped or failed). Logic: `src/shared/session-steps.ts`.
- A sent script's mark on the board says where its video really stands: "Chờ tạo" until it is started, "Lên cảnh quay" while it is planned, then as before.

Shell principles: panel controls stay at consistent edges; breadcrumbs show location; the primary action names the outcome; task actions stay distinct from shell controls; no large branding areas, repeated metadata, stacked toolbars or persistent footers; collapsing the chat returns width to the content. Leaving a screen is not cancellation: drafts, references and order survive navigation ([design lessons](DESIGN_LESSONS.md), "No dead ends").

Appearance: a T3-derived light and dark theme. Roles: navigation background, a continuous canvas for header, board and chat, slightly raised cards and composer, restrained selection and hover; background differences must communicate a purpose. Blue marks primary actions and focus; at most two primary-coloured actions per screen ([design lessons](DESIGN_LESSONS.md), "Primary colour"). Tokens live in `src/renderer/src/styles.css`.

Still open: planning every video automatically after approval (the plan takes about a minute of the user's own AI per video; re-planning stays never automatic), and showing a video card's level only when it differs from the batch's. To test with staff: finding daily work without instructions, recovering failures, understanding count changes and paid actions, and, later, continuing another staff member's work (multi-staff sharing is deferred by the single-machine MVP, [technology decisions](TECH_STACK_AND_SKILLS.md)).
