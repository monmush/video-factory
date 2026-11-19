# Agreed technology direction and skill setup

Originally recorded 2026-11-09 from the owner's explicit choices. Updated 2026-11-12 when the owner agreed the MVP architecture and the app shell was set up; status lines updated 2026-11-19.

## Agreed stack

| Area | Choice |
|---|---|
| Desktop | Electron 45, **macOS first** (Apple Silicon); Windows later |
| UI | React 19 and TypeScript |
| Routing | TanStack Router, code-based routes, hash history. No other TanStack packages yet |
| Styling | Tailwind CSS v4 |
| Components | shadcn `base-mira`, Base UI; primitives ported from the T3 Code reference |
| Icons | Lucide |
| Build tooling | Vite via electron-vite; electron-builder for packaging |
| Package manager | pnpm 10, single package (no monorepo) |
| Checks | `tsc` (TypeScript 7), Biome and Vitest (pure, Electron-free modules only) |
| AI providers | **fal.ai** (image/video and other models) and **ElevenLabs** (voice) |
| Backend / database | **None for the MVP.** Everything runs in the desktop app |
| Persistence | JSON files and media folders in the app's user-data directory |
| Chat agent | `@anthropic-ai/claude-agent-sdk` on the user's installed `claude`; `zod` for tool schemas |

## MVP architecture (agreed 2026-11-12)

- **Single machine.** One designated operator Mac holds the workspace. Shared multi-staff access from the product brief is deferred; the shared-workspace and handoff concepts stay as product direction, not MVP implementation.
- **Main process owns everything privileged:** provider SDKs and keys, file storage, video jobs and FFmpeg. The renderer talks to it only through the typed IPC contract in `src/shared/ipc.ts`.
- **Keys:** `.env.local` in development; in the packaged app the operator enters them in Cài đặt, and they are encrypted with Electron `safeStorage` (macOS Keychain). Keys never reach renderer code.
- **Fixture vs live:** development defaults to `fixture` mode, which must not make paid calls. `HYAN_PROVIDER_MODE=live` opts in. The packaged app defaults to `live`. Fixture mode returns sample descriptions, sample scripts (`src/main/script-fixtures.ts`), sample angle images, replayed chat turns and sample video media (`resources/fixtures/video/`).
- **Local media:** images are served to the renderer through the `hyan-media://` protocol (`src/main/media.ts`), never `file://`. Picked or dropped images are copied to `staging/` and moved into `assets/<assetId>/` on save.
- **Text and vision tasks** (describing assets, grouping product photos, planning and writing scripts) follow Cài đặt → "AI viết văn bản": the user's own Claude Code, or fal's `openrouter/router` (`/vision` for images) with `google/gemini-2.5-flash` (`src/main/describe.ts`, `src/main/text-ai.ts`). Script writing through fal has not been run live. Keep each text task behind one main-process function so the provider can change. Paid calls append provider cost to `usage.jsonl` in the data folder.
- **Bring your own agent (agreed 2026-11-12):** Cài đặt → "AI viết văn bản" can switch text tasks to **the user's own installed Claude Code CLI**, the pattern T3 Code uses. One-shot tasks run `claude -p` with all tools, MCP servers and settings disabled (`src/main/claude-code.ts`); images go in as stream-json content blocks. The session chat is an Agent SDK session with only typed board tools (`src/main/chat/`; rules in "Session chat" in `docs/SCRIPT_BOARD_DECISIONS.md`).
  - Rules from Anthropic's [Claude Code legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance), read 2026-11-12: accept Anthropic's Commercial Terms before shipping it; run the binary unmodified; the end user signs in through Anthropic's own flow (`claude auth login`), and the app never collects, stores or relays Claude credentials; usage is billed to each user's own plan or key, never paid for, resold or intermediated by us; no "Claude Code" name or logo in our product or feature names.
  - MVP (agreed 2026-11-12): runs on the owner's own fal, ElevenLabs and Claude accounts. Because a Claude subscription is per person, Hy An staff operating Claude Code features need their own Claude login, or text tasks use fal. Easy onboarding of other users' own AI is to be reviewed later (private task list).
  - Agent SDK (side-chat spike, 12 Nov 2026): it runs the same installed binary and bills the same login (verified: Claude Max, first-party). But the [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) says that, unless approved, third-party products built on the SDK may not offer claude.ai login or rate limits and should use API keys. The legal page still allows an end user to sign in to the unmodified binary with their own plan. T3 Code drives Claude through the Agent SDK on users' own subscriptions, and its FAQ says it "works with all of the labs" and is "within the TOS of Claude Code"; that approval is theirs, not ours. Decision (the owner, 12 Nov 2026): build on the SDK now; ask Anthropic for written confirmation before others use the chat, falling back to driving the unmodified `claude` binary directly if needed. T3's FAQ also reports that Agent SDK use drains the 5-hour limit faster than Claude Code directly (reported to Anthropic; weekly limits unaffected).
  - **No central AI account (the owner, 12 Nov 2026):** the product will not run a shared Claude/API plan billed to the owner. Text and agent work always runs on the user's own AI (their subscription or their own key), like T3 Code and Pen.dev. A central API plan costs too much for no clear benefit.
  - Open: whether batch orchestration counts as the "ordinary, individual usage" plan limits assume; a written confirmation from Anthropic (sales) for this use case and any partner route; a Codex (ChatGPT sign-in) equivalent.
- **Consequence:** generation only progresses while the app is open. Save provider request IDs and reconcile on restart so a closed app does not cause duplicate paid submissions.

## App layout

```
src/main/       Electron main process: window, IPC handlers, store, providers, settings
src/preload/    contextBridge exposing window.hyan.invoke (allow-listed channels only)
src/shared/     IPC contract and domain types shared by both sides
src/renderer/   React app: router.tsx, components/ (shell + ui primitives), screens/, lib/
```

Data folder (`~/Library/Application Support/Hy An Video Factory/`; `pnpm dev` uses `Hy An Video Factory (dev)/`, and `HYAN_DATA_DIR` overrides both): `workspace.json`, `settings.json`, `secrets.json`, `usage.jsonl`, `requests.jsonl`, `assets/<assetId>/` (library), `staging/` (unsaved picks), `feedback.jsonl` (video-fix requests), `media/<seriesId>/<sessionId>/` (`board.json` with scripts and chat, attachments, `videos/<scriptId>/` per video), and `claude-chat/`, `claude-code/` (working folders for Claude, so transcripts stay out of the user's other projects). One running copy per data folder (single-instance lock).

## Still open

- Video-stage interactions from the early prototypes that are not built yet (parallel videos, bulk download, a quality marker, removing videos with undo, time references) are tracked in the private task list.
- The video generation route is built but provisional: recipe, shot list and build, then paid steps and local FFmpeg assembly ([video generation](VIDEO_GENERATION_DECISIONS.md)). The recipe is built in; a recipe chosen per series by an AI session with read-only planning tools is not built.
- Generation continuing while the app is closed. FFmpeg must be installed today; bundling it is a packaging task (private task list).
- Code signing, notarisation, auto-update and the Windows build.

## Code rules

- No comments in code; `pnpm check` fails on one (`pnpm check:comments [paths]`). The code is the single source of truth: carry intent in names, small functions, types and tests.
- No workaround explained by a comment. Implement it the correct way, even when that is more effort.
- Tests are only for behaviour that matters; never restate constants, test the language or cover dead code.
- Renderer code never imports Node or Electron; every paid fal call goes through `falCall`.

## Project-local skills

Installed under `.agents/skills/` so the project carries its skill setup:

| Skill | Purpose | Source |
|---|---|---|
| `grilling` | Clarify requirements and stress-test decisions | Matt Pocock's upstream skill |
| `user-flow` | Map operator actions, decisions, system responses and recovery | Written for this project |
| `prototype` | Resolve uncertain interactions or state logic through a focused disposable experiment | Matt Pocock's upstream skill, including its supporting references |
| `make-interfaces-feel-better` | Typography, surfaces, feedback and interaction craft | Copied from the existing local installation, including supporting references |

The upstream `grilling` skill is installed directly; it does not need the `grill-me` wrapper. For interface craft, one existing skill was selected instead of adding overlapping design packages. No global skills were changed.

`AGENTS.md` routes tasks to these skills and keeps their use proportional to the pilot. These are tools to use when requested work calls for them, not a compulsory four-stage process.

## Source records

The Matt Pocock skills are pinned to commit `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` of https://github.com/mattpocock/skills:

- `skills/productivity/grilling/`
- `skills/engineering/prototype/`

Its license is preserved in `.agents/skills/MATT_POCOCK_LICENSE`. The interface-craft skill is a local copy of an existing installation and is not tracked. `.agents/skills/sources.json` (local only) records installed-file hashes for provenance.

The T3 Code visual sources and license remain in [the reference pack](../references/t3code/README.md). The app's tokens (`src/renderer/src/styles.css`) and button/input primitives are adapted from it, with attribution in those files. Earlier architectural suggestions from the T3 Code research, such as a browser UI with a cloud worker, are superseded by the MVP architecture above.
