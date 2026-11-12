# T3 Code design references

Source: https://github.com/pingdotgg/t3code

Snapshot: `c6ca6056309904f89b90b6055d797973be0a0939`, inspected 2026-11-09.

These are study references, not a working application or installed library. Files under `upstream/` are unmodified. `manifest.json` records their source paths and SHA-256 hashes. `default-colors.json` extracts the two default palettes without changing their values.

The upstream MIT notice is preserved in [upstream/LICENSE](upstream/LICENSE). Keep that notice with copied or substantially adapted code. Inspect any separately copied dependencies or assets for their own license requirements.

## Where to start

- `upstream/apps/web/components.json`: shadcn `base-mira`, Base UI family, zinc, CSS variables, Lucide.
- `default-colors.json`: readable default light/dark palette.
- `upstream/packages/shared/src/themePalettes.ts`: semantic color roles and additional themes.
- `upstream/apps/web/src/index.css`: geometry, typography, theme bindings and feature CSS.
- `upstream/apps/web/src/components/ui/button.tsx`: sizes, variants, focus, disabled and pressed treatment.
- `upstream/apps/web/src/components/ui/input.tsx`: input styling and responsive control sizing.

## Adapting into Hy An later

Start from the same primitive family and port a small set of tokens and variants. Do not paste the entire CSS file or theme engine into the application: they include chat, terminal, Electron and other feature-specific behavior.

The selected components use React, Base UI, Tailwind v4, class-variance-authority, tailwind-merge, and sometimes Lucide. Their `~/` imports need adapting. This is not a complete transitive dependency bundle. In particular, the original `lib/utils.ts` imports T3 contracts, Effect, and composer state; port only the class-merging helper needed by our primitives. The theme runtime likewise imports T3 application state and contracts.

Use named component variants rather than restyling buttons and inputs individually. Copy the visual language while choosing control density for Hy An staff, especially Vietnamese dialogue editing and review. Validate Vietnamese diacritics, long labels, keyboard focus, and readability in both appearances.

No active agent instructions or skills have been installed from the upstream repository.
