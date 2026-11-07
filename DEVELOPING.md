# Developing

Working copy for `Abdulelah444/openchamber-artifact-gallery` — a fork of
[sofianbll/openchamber-artifact-gallery](https://github.com/sofianbll/openchamber-artifact-gallery) (MIT).

## Layout

- `src/` — TypeScript sources. `panel.ts` (browser UI), `service.ts` (local service),
  `library.ts` (scan + index), `store.ts` (reads OpenChamber's SQLite store), `artifacts.ts`,
  `cache.ts`, `preview.ts`, `locale.ts`.
- `panel/main.js`, `service/main.js` — built bundles. They are committed on purpose so the
  extension installs straight from the repository URL. Rebuild them with every change.
- `test/`, `src/*.test.ts` — tests (`bun test`).

## Commands

```sh
bun install          # once (bun: npm i -g bun if missing)
bun run build        # rebuild panel/main.js and service/main.js
bun test             # src tests (26)
bun run deploy       # build, copy into the live extension, stop its service
```

`bun run deploy` copies into `/opt/openchamber/data/extensions/artifact-gallery` by default.
Override with `GALLERY_LIVE=/path bun run deploy`. Afterwards reload the Artifact Gallery
panel (or the OpenChamber page) — the host respawns the service with the new bundle.

## How it reads data

The service runs under OpenChamber's environment, so it inherits
`XDG_DATA_HOME=/opt/openchamber/oc-data` and opens that `opencode/opencode.db` read-only
(`session_v2`, `session_message`, `project`). This is why it sees every project and chat,
archived or not, without any credentials. If `node:sqlite` is unavailable (Node < 22.5) it
falls back to `Service.discover()`, the old behaviour.

## Upstream

`upstream` points at sofianbll's repository; `origin` at Abdulelah444's fork. To pull upstream
changes: `git fetch upstream && git merge upstream/main`.
