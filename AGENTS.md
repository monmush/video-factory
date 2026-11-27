# M5 Studio

Read `docs/private/USERS_AND_GOALS.md` first (private, local): who the users are, the product goals in order and the current project goal. Every design or product decision is checked against it. Then `PROJECT_CONTEXT.md` (a private local file, not in the repository) for the pilot's terms and constraints, `docs/README.md` for the product reference and `docs/TECH_STACK_AND_SKILLS.md` for agreed technology choices. `docs/private/`, `docs/archive/`, `project/`, `prototypes/` and `experiments/` are private and local only; never publish or copy their content into tracked files. Research recommendations are not automatically agreed decisions.

Keep the solo workflow lean. Do not introduce a full CI, review orchestration, or project-management framework by default. Use checks appropriate to the actual change. Providers (fal.ai, ElevenLabs) and the MVP architecture (Electron, macOS first, single machine, no backend or database) are agreed. Detailed screen design, job execution and deployment details remain open; do not settle them during unrelated work.

Ask the user only one question at a time, including during grilling sessions. Continue with the next question after their answer.

## Project tracking

Work is tracked in `project/TODO.md` (a private local file). Read it at the start of a task. When you finish, start or change a piece of work, update it (move items to Done with the date). Keep it a short list; detail belongs in `docs/`.

## App development

- `pnpm dev` runs the app (fixture mode, keys from `.env.local`). It restarts the app when main-process or preload code changes (`--watch`); renderer changes hot-reload. Use `HYAN_DATA_DIR=<tmp folder>` to avoid touching real data.
- Test profiles (dev, or a packaged build launched with `HYAN_DEV=1`): Settings → "Hồ sơ thử nghiệm" creates empty data folders and restarts into one. `HYAN_PROFILES_ROOT=<tmp folder>` moves the default and test profiles there; `HYAN_DATA_DIR` turns profiles off.
- `pnpm dev:fresh` starts with a new empty data folder (first-run onboarding). `HYAN_FAKE_CLAUDE=missing` or `signed-out` fakes the Claude install/login state in development; install and login then advance it without touching the real Claude. `HYAN_FAKE_PRODUCT_KEY=missing` ignores `FAL_KEY` from `.env.local`, so the product key step in onboarding and Settings can be tried; the key check stays real (it is free).
- Run `pnpm check` (typecheck, Biome, comment check, Vitest, build) before handing work back. `pnpm format` fixes formatting.
- No comments in code. The code is the single source of truth: carry intent in names, small functions, types and tests. `pnpm check` fails on any comment (`pnpm check:comments [paths]`).
- No workaround explained by a comment. Implement it the correct way, even when that is more effort.
- Tests sit beside pure, Electron-free modules (`*.test.ts`). Each test must catch a real regression in behaviour that matters; never restate constants, test the language or cover dead code.
- Every paid fal call goes through `falCall` (`src/main/fal.ts`); provider clients refuse to exist in fixture mode.
- Renderer code never imports Node or Electron. Add a channel to `src/shared/ipc.ts`, handle it in `src/main/ipc.ts`; the preload allow-list comes from the same file.
- Use the semantic tokens in `src/renderer/src/styles.css` and the `components/ui` primitives; port further primitives from `references/t3code/` rather than restyling ad hoc. UI copy is Vietnamese.
- `<Placeholder` marks reserved screen regions still to build. Interaction references: `prototypes/` (local) and the not-yet-built video-stage concepts listed in `project/TODO.md`.
- Never make a paid fal/ElevenLabs call without Minh's explicit approval of model, scope and estimate.

## Project-local skills

- `.agents/skills/grilling/SKILL.md`: clarify requirements or stress-test a decision. For this pilot, use small rounds with recommendations; stop at the scope the user asks to resolve. Record unsettled assumptions rather than interviewing every possible future feature. Existing authorization still applies.
- `.agents/skills/user-flow/SKILL.md`: map an agreed task from the operator's perspective, including recovery states.
- `.agents/skills/prototype/SKILL.md`: resolve a specific interaction or state uncertainty with a disposable prototype. Keep the experiment focused. Local files are sufficient unless the user asks for issue tracking or a branch workflow; do not adopt that skill's branch/issue archival convention automatically.
- `.agents/skills/make-interfaces-feel-better/SKILL.md`: interface craft. Preserve the agreed T3-derived primitives, tokens and visual direction; its general styling suggestions do not override that direction. Use motion only when it serves the interaction and the performance budget.

Read the relevant skill when its task arises, rather than running all skills on every request. These skills do not authorize implementation, purchases, publishing or contacting others beyond the user's requested scope.
