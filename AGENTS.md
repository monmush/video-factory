# Hy An Video Factory

Read `PROJECT_CONTEXT.md` for the pilot's scope and constraints, and `docs/TECH_STACK_AND_SKILLS.md` for agreed technology choices. Research recommendations are not automatically agreed decisions.

Keep the solo workflow lean. Do not introduce a full CI, review orchestration, or project-management framework by default. Use checks appropriate to the actual change. Providers (fal.ai, ElevenLabs) and the MVP architecture (Electron, macOS first, single machine, no backend or database) are agreed. Detailed screen design, job execution and deployment details remain open; do not settle them during unrelated work.

Ask the user only one question at a time, including during grilling sessions. Continue with the next question after their answer.

## Project tracking

Work is tracked in `project/TODO.md`. Read it at the start of a task. When you finish, start or change a piece of work, update it (move items to Done with the date). Keep it a short list; detail belongs in `docs/`.

## App development

- `pnpm dev` runs the app (fixture mode, keys from `.env.local`). It restarts the app when main-process or preload code changes (`--watch`); renderer changes hot-reload. Use `HYAN_DATA_DIR=<tmp folder>` to avoid touching real data.
- Run `pnpm check` (typecheck, Biome, Vitest, build) before handing work back. `pnpm format` fixes formatting. Tests sit beside pure, Electron-free modules (`*.test.ts`).
- Every paid fal call goes through `falCall` (`src/main/fal.ts`); provider clients refuse to exist in fixture mode.
- Renderer code never imports Node or Electron. Add a channel to `src/shared/ipc.ts`, handle it in `src/main/ipc.ts`; the preload allow-list comes from the same file.
- Use the semantic tokens in `src/renderer/src/styles.css` and the `components/ui` primitives; port further primitives from `references/t3code/` rather than restyling ad hoc. UI copy is Vietnamese.
- `<Placeholder` marks reserved screen regions still to build. Interaction references: `prototypes/` and `docs/PROTOTYPE_INTEGRATION_CHECKLIST.md`.
- Never make a paid fal/ElevenLabs call without Minh's explicit approval of model, scope and estimate.

## Project-local skills

- `.agents/skills/grilling/SKILL.md`: clarify requirements or stress-test a decision. For this pilot, use small rounds with recommendations; stop at the scope the user asks to resolve. Record unsettled assumptions rather than interviewing every possible future feature. Existing authorization still applies.
- `.agents/skills/user-flow/SKILL.md`: map an agreed task from the operator's perspective, including recovery states.
- `.agents/skills/prototype/SKILL.md`: resolve a specific interaction or state uncertainty with a disposable prototype. Keep the experiment focused. Local files are sufficient unless the user asks for issue tracking or a branch workflow; do not adopt that skill's branch/issue archival convention automatically.
- `.agents/skills/make-interfaces-feel-better/SKILL.md`: interface craft. Preserve the agreed T3-derived primitives, tokens and visual direction; its general styling suggestions do not override that direction. Use motion only when it serves the interaction and the performance budget.

Read the relevant skill when its task arises, rather than running all skills on every request. These skills do not authorize implementation, purchases, publishing or contacting others beyond the user's requested scope.
