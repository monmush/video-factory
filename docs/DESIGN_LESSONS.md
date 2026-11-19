# What we learned from the owner's feedback

Updated 19 November 2026. These principles are inferred from repeated, explicit feedback. They guide future design; they are not research findings about all users. Validate them with the pilot client's staff.

| Feedback pattern | What we learned | Rule to carry forward |
| --- | --- | --- |
| Staff want many acceptable videos, little refinement, and most attention on the human channel | Throughput and low active effort define product value | Judge flows by intervention count and accepted output, not by number of editing controls |
| Users cannot specify lighting, emotion or camera per line | Users describe intent; AI develops the professional treatment | Ask for story/vibe and offer concrete samples, not directing homework |
| Bulk import; minimal product name/images; avoid structured forms | Reusing existing inputs matters more than collecting exhaustive metadata | Use shared assets and AI-assisted preparation; never fill missing product facts creatively |
| Scan hooks/topics, inspect a few scripts, approve together | Review should support sampling and exceptions | Make the board useful without opening every item; keep full content available |
| B's scanability, C's persistent detail and gallery references each helped | Different review tasks need different reading density | Retain gallery and list/detail with shared state rather than overwriting one during navigation work |
| Repeated requests for free-form chat and scoped references | Prompting is a primary action, not a rigid form for every command | One conversation per working context; support explicit targets and global requests; retain scope visibly |
| Remove parent labels and “use this version”; make deletion obvious | Alternatives should be easy to compare and discard | Variants are independent items, originals stay, delete/undo is easy, counts are honest |
| Long scripts cannot fit video-card accordions | Access to detail must not damage scanning | Put long content in a dedicated reader; keep video cards focused on progress/results |
| Confusion about production stage, then rejection of the separate direction item | Navigation must reflect the lifetime of the work | Series landing owns reusable context; sessions own scripts/videos; stages stay inside sessions |
| Rejection of creation modal and redundant video count | A setup gate is costly if the next screen already supports the task | Open the working area directly; derive values already represented by board state |
| Codex/T3 references, compact shell and consistent toggles | Stable spatial habits reduce attention spent navigating | Reuse shell positions and hierarchy across screens; do not redesign chrome per page |
| Too many background shades; intentional T3 theme requested | Neutral colors can still create clutter | Define shared surface roles; use spacing/type before adding fills or dividers |
| “Cả lô”, “Dùng được”, obscure icons and decorative metadata rejected | Copy and controls must make sense to the operator immediately | Use natural Vietnamese and outcome labels; reserve metadata for actual decisions; label unfamiliar actions |
| Concern about lost features when combining prototypes | A newer artifact is not automatically a complete specification | List unbuilt concepts as open work and distinguish missing simulations from intentional removals |
| Feedback can inform system prompts, but avoid deep memory design now | Learn from recurring failures without expanding the MVP indiscriminately | Capture examples and acceptance criteria; defer complex feedback infrastructure |
| Cost tracking desired, hard enforcement questioned | Measurement is essential; full budget orchestration is not yet justified | Show targets/estimates for paid actions and track outcomes; do not silently add hard caps |
| Third-party workflows supplied with warnings against bias | References reveal possibilities, not our product requirements | Start from the pilot client's task and constraints; verify actual capabilities separately |

## What this changes in our working method

1. Establish the task and state being explored before changing a screen.
2. Carry accepted interactions forward through the integration checklist. Archive superseded proposals instead of leaving conflicting current instructions.
3. For a requested review, walk through concrete actions and list proposed changes before editing. That was explicitly requested in the latest flow review; it is not a new blanket approval rule for every small fix.
4. Use realistic long content, multiple outputs, partial failure and correction paths. Small polished happy-path examples can conceal the actual workload.
5. Distinguish the owner's concept acceptance, prototype checks, staff usability evidence and real generation quality. None substitutes for the others.
6. Keep design discussions proportional to the pilot. Record future concerns without designing all of them immediately.

## Still hypotheses

Staff may share the owner's preference for free-form prompting, selective review and this navigation model; that has not been observed directly. Natural Vietnamese quality may require more operator intervention than the concept assumes. Timestamp feedback may improve communication without enabling local-only regeneration. Exact branding and character consistency remain unproven. The next feasibility work should expose these limits instead of hiding them behind the prototype.

## Lessons from real media experiments

- Listen to voices together: individually plausible voices can sound like different rooms. Age, pacing and acoustic compatibility matter together. Preserve the accepted sample instead of restarting selection.
- Evaluate quality alongside cost: the owner preferred VEED sharpness but accepted lower-end Kling as a candidate for the client to judge. Neither acceptance proves repeatability or full-video economics. Since 19 November quality comes before cost: budget is not a limit for now, and prices still show.
- Save approved reusable inputs before paying to generate equivalents. Keep character identity separate from scene-specific views, and keep original packaging distinct from generated interpretations.
- Separate attractive composition from factual fidelity: the product edit looked convincing while changing lettering, artwork and props. Prompt instructions are not evidence that these were preserved.
- Library organization should support setup in place. The fal screenshots are a useful reference, not a reason to require users to complete multiple asset forms or adopt another multi-panel shell.

## No dead ends (12 Nov 2026)

The owner, mid-way through creating a series, followed "Mở thư viện" from the empty product picker to create a product and lost the way back and the draft. Rules:

- **Create prerequisites in place.** When a form needs something that does not exist yet (a character, a product), offer creation inside the current flow, on top of it, and select the result. Never link away from unsaved work to make it.
- **Leaving never loses work.** Unsent drafts survive navigating to another screen and back (`useDraft` in `src/renderer/src/lib/drafts.ts`; in memory, so not across app restarts).
- **Every screen has a way back** to where the user came from: the rail returns to the last place in each area, and breadcrumbs name the parent.

## Primary colour (12 Nov 2026)

At most two primary-coloured actions on screen at once. Selected states, badges and secondary actions use neutral tones (foreground/accent), so the primary colour always marks where to act next.

On the Video tab (16 Nov 2026): the batch button at the top is the only primary action; every per-card action is an outline button.

## Prices (16 Nov 2026)

The owner could not tell which price on a video card was already paid and which was a guess (status line, hold button, plan table, all different numbers). One rule everywhere:

- **Spent has no "~"; an estimate always has one.** The status line reads "Đã chi $1.05", never a bare figure (a bare number beside "Lời thoại" read as the dialogue's price).
- **A button's price is what that press will spend**, and nothing else.
- **The plan table** marks charged rows with a check and their real cost; once anything is paid its total reads "Đã chi · Còn · Tổng", and "Còn" equals the hold button's price.
- **Every paid action is a hold with its price.** Nothing in the interface spends on a plain click; the hold shows what it will spend. The cost breakdown ("Chi phí") is visible before, during and after a video.
- **Names describe what a thing does.** No provider or model names in the interface; operators pick a Quality level, not a model.
