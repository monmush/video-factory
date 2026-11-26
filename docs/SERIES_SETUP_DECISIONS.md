# Series setup

Updated 25 November 2026 (the direction became a structured record the app drafts and the operator confirms; see "Direction"). Earlier: 19 November 2026, to match the app. The earlier conversational setup (rough idea → sample script → sample video → approve series, with a context sidebar) is superseded. This document also owns the workspace shell, since it frames the series and session screens.

## Series as a saved record

Built in the app; the owner is still to review the flow.

- **A series is a record, not a conversation.** Fields: name, the description typed at creation (`guidance`), the direction drafted from it (`guide`, see "Direction"), and characters, products and Bối cảnh chosen from the shared library. It works like a Claude Project: saved context every session inherits.
- **A session is the conversation.** Each request typed on the series page starts one session with its own scripts, videos and chat. The request becomes the first chat message.
- **No setup gate.** "Tạo series" is one plain page: optional name, a description and asset pickers. The app reads the description back as the direction; the series is usable at once, also while that runs. The first session doubles as the sample. Nothing is saved until sent.
- **Chat edits the record, it does not hold it.** Direction is edited in "Sửa series", and the chat can save a correction into it (see "Direction"). Other lessons from the chat are kept as separate [learned preferences](VIDEO_REVIEW_DECISIONS.md#learned-preferences-ghi-nhớ--agreed-and-built-13-november-2026), listed under "Ghi nhớ" on the series page. Changes apply to future sessions only; existing scripts and videos change only when explicitly targeted, never by automatic paid regeneration.
- **Delete** asks for confirmation, removes the series and its sessions, and moves their media folder to the Trash. Library assets are untouched.

## Direction ("Định hướng") — 25 November 2026

Built 25 November 2026 on the owner's request; tried in the built app with the user's own AI on three real descriptions and one batch of two scripts. No video was made from it yet.

**Why.** Operators describe a series in two or three rough lines. That text went unchanged into the writer's and the director's prompts, and three things followed in the saved test sessions: the writer's fixed rules imposed one format on every series (a wise idea and a laugh, the product named once), nobody saw how the app understood the description until scripts came out, and corrections made in a session were lost for the next one.

- **The description stays free text.** No form and no template to fill in. A structure is asked of the app, not of the operator.
- **The app reads it back.** The user's own AI turns the description, the chosen assets and the series' saved "Ghi nhớ" into a short direction: Nhân vật (who each character is and how they address each other), Câu chuyện, Giọng điệu (sample lines copied word for word), Câu kết, Hình và nhịp, Tránh, Khác, plus two settings, Sản phẩm (Không nhắc, Nhắc tự nhiên, Giới thiệu cuối video) and Độ dài. What the description states is kept in full; of what it leaves out, only what every script needs is filled in, marked "Tự điền". It also proposes a short series name when none was typed.
- **At most two questions, as buttons**, only where the answer changes the scripts and cannot be guessed (forms of address, the relationship, where each video ends). An option carries the whole new text of its line.
- **A missing character is said, not guessed around**: "Mô tả có 2 nhân vật, mới chọn 1" with "Thêm nhân vật".
- **Never a gate, never paid.** The prompt box works while the direction is read; a request sent meanwhile waits for it. The draft runs only on the user's own AI (a deterministic stand-in in fixture mode, nothing with a paid text AI). A series created before this gets its direction the first time its page opens.
- **Confirm once.** The card stays open until "Đúng rồi" or a save in "Sửa series"; after that the series page shows one line, as before. "Sửa series" edits each part, the product rule and the length.
- **The writer and the director read the direction, not the raw description** (`directionText` in `src/shared/series-guide.ts`). The writer's rules are composed from it (`src/shared/writing-rules.ts`): the default "one idea, one highlight" applies only when the direction states neither a story nor a tone; the product line follows the series' product rule and is absent for a script without a product; the last line follows "Câu kết" when there is one; idioms are optional. In a series whose rule is "Không nhắc", new scripts get no product unless one is named.
- **Length is the series' value**, 45 seconds unless the description says otherwise; a length named in a request still wins for that request.
- **Words follow the voice.** Each character is listed with its voice text; when that text names a region the writer keeps to that region's words ([voices](VOICE_DECISIONS.md)).
- **The chat saves a correction to the series.** When a correction to a script is about what the series is (address, roles, kind of story, tone, product, ending, length) the chat applies it, then asks once "Lưu cho cả series?"; "Cả series" rewrites that part of the direction (`update_series_direction`). Anything else, and "Mọi series", stays a "Ghi nhớ". Existing scripts and videos never change.

Code: `src/shared/series-guide.ts` (record and rules, tested), `src/main/series-guide.ts` (the draft and its prompt), `src/renderer/src/components/series-direction.tsx`.

Not done: example series to start from, a length control on the prompt boxes, the voice shown beside each character in the direction, drafting again after the description changes (the description is not edited after creation). Not yet seen: the chat's "Lưu cho cả series?" with real AI, dark mode, and any video made from a drafted direction.

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
- Per-series staging references (seated, opposite side, from behind).
- Which product each script features when a series has several: built, see [product per video](SCRIPT_BOARD_DECISIONS.md#product-per-video).
- How character voices relate to a series. Voices belong to the character as a text, with suggestions and a sample to listen to in the character dialog ([voices](VOICE_DECISIONS.md)).
- "Series" versus "Chuỗi video" in the UI; avoid "lô".

## Workspace shell, steps and appearance

Accepted by the owner; pilot-client staff have not used it yet.

- **Icon rail** on the left: Tạo video and Thư viện; balance and Cài đặt at the bottom. Each area returns to the last place visited in it.
- **Section sidebar** beside the rail, resizable (180–420 px, double-click resets). Under Tạo video: "Tạo series", then series with their sessions ("Xem thêm" for older ones). Click a series name to fold it; pin, rename and delete from the hover ⋯ or right-click. Under Thư viện: the asset kinds (characters, products, Bối cảnh). The sidebar's "+" on a series opens the series page with its prompt box focused; a session exists once a request is sent.
- **Content** sits in a bordered card with a breadcrumb naming the parent.
- **Series page** (`/series/$id`): a prompt box that starts a session, the direction on one line, the series' assets as thumbnails, session rows, and one "Sửa series" dialog. No setup conversation.
- **Session** (`/sessions/$id`): two numbered steps, Kịch bản then Video (the "Thiết lập" tab was removed on 16 November). Kịch bản is the [script board](SCRIPT_BOARD_DECISIONS.md) with the session chat on the right. Video (open once scripts are approved) holds a card per video ([video generation](VIDEO_GENERATION_DECISIONS.md), [reviewing and fixing](VIDEO_REVIEW_DECISIONS.md)).

Flow rules (built 16 November 2026):

- **A setting sits beside the button it changes.** The one setting for making videos is the series' "Mô hình" chip on the series page's prompt box (since 25 November 2026; it replaced "Chất lượng"). Products need no setting: they are shared across new scripts automatically and `@` in a prompt box names one.
- **No inheritance.** "Mô hình" belongs to the series only, on the series form and the series page's chip; a video takes it when its first paid request is sent ([scripts to videos](VIDEO_COMMIT_DECISIONS.md), "Models, named").
- **The header's right corner names the next thing to do.** On Kịch bản: "Duyệt N kịch bản" while scripts are unsent (approving sends them to the Video step and spends nothing), then an outline link to the Video step, "Xem video". On Video: the batch hold button.
- Each step shows a count (scripts on the board; videos done out of sent). Kịch bản shows a check once every finished script is sent. Video shows a dot while a sent video waits on the operator (not started, at "Nghe và xem cảnh chính", stopped or failed). Logic: `src/shared/session-steps.ts`.
- A sent script's mark on the board says where its video really stands: "Chờ tạo" until it is started, "Lên cảnh quay" while it is planned, then as before.

Shell principles: panel controls stay at consistent edges; breadcrumbs show location; the primary action names the outcome; task actions stay distinct from shell controls; no large branding areas, repeated metadata, stacked toolbars or persistent footers; collapsing the chat returns width to the content. Leaving a screen is not cancellation: drafts, references and order survive navigation ([design lessons](DESIGN_LESSONS.md), "No dead ends").

Appearance: a T3-derived light and dark theme. Roles: navigation background, a continuous canvas for header, board and chat, slightly raised cards and composer, restrained selection and hover; background differences must communicate a purpose. Blue marks primary actions and focus; at most two primary-coloured actions per screen ([design lessons](DESIGN_LESSONS.md), "Primary colour"). Tokens live in `src/renderer/src/styles.css`.

Still open: planning every video automatically after approval (the plan takes about a minute of the user's own AI per video; re-planning stays never automatic). To test with staff: finding daily work without instructions, recovering failures, understanding count changes and paid actions, and, later, continuing another staff member's work (multi-staff sharing is deferred by the single-machine MVP, [technology decisions](TECH_STACK_AND_SKILLS.md)).
