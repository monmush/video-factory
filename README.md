# Hy An Video Factory

A macOS desktop app (Electron) for producing short AI-generated storytelling videos in batches: series setup, a script board with an AI chat agent, a character/product/environment library, and generation through fal.ai and ElevenLabs. Work in progress.

Start with [docs/README.md](docs/README.md) for the product reference and decisions. Business context, research and the task list are kept in private local files and are not published.

## Develop

Requires Node 22.12+ and pnpm 10 (`corepack enable`). macOS is the primary target.

```sh
pnpm install
pnpm dev            # app with hot reload; reads keys from .env.local; fixture mode
pnpm check          # typecheck + lint + build
pnpm package:mac    # unsigned arm64 .dmg in dist/
```

`HYAN_DATA_DIR=/some/folder pnpm dev` points the app at a disposable data folder. Fixture mode makes no paid calls; `HYAN_PROVIDER_MODE=live` allows real fal.ai and ElevenLabs requests, which cost money.

## Layout

- `src/main`: Electron main process (storage, providers, chat agent, IPC handlers)
- `src/preload`: preload bridge
- `src/shared`: types and the IPC contract shared by main and renderer
- `src/renderer`: React UI
- `references/t3code`: MIT-licensed design references from [T3 Code](https://github.com/pingdotgg/t3code)
