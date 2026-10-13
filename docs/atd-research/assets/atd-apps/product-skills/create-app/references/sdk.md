# SDK quick reference

Everything Atd itself gives an app to import is here; npm packages the app declares in `atd-app.json` `dependencies` come on top, imported by their name or a subpath they export (`react-day-picker/style.css`). React, `@atd/ui` and the other provided packages always come from Atd, also inside declared packages. The types are the source of truth: `tsc` reports a wrong call as a diagnostic after each build.

## Page: `@atd/app-kit/client`

```ts
import { createApi, events, native, AppApiError } from '@atd/app-kit/client';
import type backend from '../../server/index.ts'; // type-only: gives checked names, inputs, results
const api = createApi<typeof backend>();
```

| Call                                       | Does                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `await api.call(name, input?, { signal })` | Calls a backend function. A generator function resolves with an array of all its chunks.                       |
| `api.stream(name, input?)`                 | Returns a handle: `for await (const chunk of handle)`, `await handle.result` (final value), `handle.cancel()`. |
| `events.subscribe(channel, (data) => …)`   | Receives `ctx.events.publish(channel, data)`; returns an unsubscribe function (use it as an effect cleanup).   |
| `native.clipboard.write(text)`             | Copies text.                                                                                                   |
| `native.openLink(url)`                     | Opens an http(s) link in the user's browser, after the user confirms.                                          |
| `native.files.pick({ types?, multiple? })` | Open panel; resolves with `{ name, bytes: Uint8Array }[]` (empty when cancelled). Limits below.                |
| `native.files.save(suggestedName, data)`   | Save panel for a string, `Uint8Array`, `ArrayBuffer` or Blob; resolves with whether the user saved.            |

File limits: `pick` returns at most 10 files (the rest of a larger selection is dropped), and a file over 8 MiB rejects the whole call; `types` takes at most 32 entries, each a filename extension without the dot (`csv`) or a Uniform Type Identifier (`public.image`). `save` writes at most 8 MiB. Design file intake around these limits from the start.

A failed call rejects with `AppApiError` (`message`, `code`, `status`). Codes: `app_error` (the backend threw), `not_found` (no such function), `cancelled`, `payload_too_large` (a message is limited to 4 MiB). Inputs and results are JSON plus `Uint8Array`/`ArrayBuffer`; Blobs are read to bytes for you. On the wire bytes travel as `{"$atd:bytes": "<base64>"}`, which is also how you pass bytes to `app` `call`, whose input is JSON.

The page is always loaded at `/`, so use hash routing, never path routing. A widget tap opens the window at `#/route`; read `location.hash` at startup and on `hashchange`.

Page rules: no network, cookies or WebSocket; `localStorage` works for small UI preferences, but keep real data in the backend. Appearance: the page sits on Atd's dark glass window surface with a 52 px title row; components use semantic tokens, raw colors appear only in token definitions in `web/src/styles.css`, and the manifest's `accentColor` sets `--primary` (see `starter.md`, "The window surface", for the surface, the title row and how to take the surface over).

## Backend: `@atd/app-kit/server`

```ts
import { defineBackend, defineWidget, w, type BackendContext } from '@atd/app-kit/server';
export default defineBackend({ onStart(ctx) {…}, onStop(ctx) {…}, api: { name: (input, ctx) => value }, widgets: [] });
```

- An api function takes `(input, ctx)` and returns a JSON value or `Uint8Array`, or an async generator: each `yield` is a chunk and the `return` value is the result. `ctx.signal` aborts when the page cancels. The default call timeout is 5 minutes; streams are not limited.
- `onStart` runs once per backend process before it serves; a throw fails the start. Make it idempotent.
- Declare input types and validate: `Value.Parse(Schema, input)` from `typebox/value` throws a readable message on bad input.
- The backend starts on first use and stops when the windows have been closed for a while, so keep no state in memory that matters.

### `ctx`

| Member                                                                                                        | Needs capability | Notes                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.db`                                                                                                      | none             | `node:sqlite` `DatabaseSync` on `<data>/app.db`: `exec`, `prepare(sql).run/get/all`. Results are rows of unknown-typed columns; convert explicitly.                                                                         |
| `ctx.kv`                                                                                                      | none             | `get(key)`, `set(key, json)`, `delete(key)`, `keys(prefix?)`; small JSON values.                                                                                                                                            |
| `ctx.files`                                                                                                   | none             | Synchronous `read` (bytes), `readText`, `write(path, string \| Uint8Array)`, `delete`, `exists`, `list(dir?)` under `<data>/files`; relative paths only.                                                                    |
| `ctx.events.publish(channel, data?)`                                                                          | none             | To every open window of this app.                                                                                                                                                                                           |
| `ctx.widgets.reload(widgetId?)`                                                                               | none             | Re-render one widget or all after their data changed.                                                                                                                                                                       |
| `ctx.log.info/warn/error(...)`                                                                                | none             | Lands in the app's diagnostics.                                                                                                                                                                                             |
| `ctx.appId`, `ctx.dataDir`                                                                                    | none             | `dataDir` is the only writable directory and survives version changes.                                                                                                                                                      |
| `ctx.ai.generate(input)` / `ctx.ai.stream(input)`                                                             | `ai`             | `{ messages: {role: 'user'\|'assistant', content}[], system?, model?, maxTokens? }` -> `{ text, model, usage? }`; `stream` yields `{ type: 'text', delta }` and has `.result`.                                              |
| `ctx.agent.run({ prompt, tools?, skills? })`                                                                  | `agent`          | Runs a full agent task for the app; `tools` is a subset of `read write edit bash command`. Yields text, tool-progress and status chunks; `.result` is `{ taskId, runId, status, text }`. Permission prompts reach the user. |
| `ctx.memory.search({ query, limit? })`, `.read({ target? })`, `.write({ target: 'memory'\|'user', content })` | `memory`         | Entries are `{ id, target, content }`. `.write` is not available yet and fails with `not_implemented`; apps read memory only.                                                                                               |
| `ctx.mcp.listTools({ serverId? })`, `.callTool({ serverId, name, arguments })`                                | `mcp`            | Uses the user's configured MCP servers and their policy. Tools that require per-call approval are refused for apps.                                                                                                         |
| `ctx.web.search({ query, limit? })`, `.fetch({ url })`                                                        | `web`            | `search` -> `{ results: { title, url, snippet }[] }`; `fetch` -> `{ url, title, text }`.                                                                                                                                    |

Capabilities are declared in `atd-app.json` (`"capabilities": ["ai"]`, `"purposes": { "ai": "Summarizes your entries" }`), asked of the user on first use, and revocable. A denied or unlisted capability makes the call throw; catch it and show a useful message in the page.

A stream (`ctx.ai.stream`, `ctx.agent.run`) can be iterated with `for await`, and `await stream.result` gives the final value; leaving the loop early cancels it.

## Widgets

```ts
const w1 = defineWidget({
  id: 'today', // ^[a-z][a-z0-9-]{0,31}$, unique in the app
  title: 'Today',
  description: 'What is due today.', // title <= 64 chars, description <= 200
  families: ['systemSmall', 'systemMedium'], // 1-3 of systemSmall | systemMedium | systemLarge
  refreshMinutes: 60, // 15-1440; the system budgets refreshes, so ask for as little as the data allows
  render(ctx, { family }) {
    return w.timeline(view);
  }, // ctx is the backend context; render must be fast and read-only
});
```

`render` returns `w.timeline(view)` (one view shown from now on) or `w.timeline([w.entry(view, { date, route? }), …])` for 1-24 dated entries in ascending order (for example a schedule that changes through the day). Throwing, an invalid tree or an oversized snapshot drops that render and writes a diagnostic.

Builders (`w.*`, each returns a node; options in the second argument):

| Builder                                             | Options and notes                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vstack(children, opts)` / `hstack` / `zstack`      | `spacing`, `padding` (0-32), `background` (color token or `containerBackground`), `alignment`. At most 16 children.                                                                                                              |
| `spacer(minLength?)`, `divider()`                   | Layout.                                                                                                                                                                                                                          |
| `text(str, opts)`                                   | `style` largeTitle, title, title2, title3, headline, subheadline, body, callout, footnote; `weight` regular, medium, semibold, bold; `color`; `lineLimit` 1-10. Max 500 chars.                                                   |
| `symbol(name, opts)`                                | SF Symbol name (`^[a-z0-9.]+$`, e.g. `checkmark.circle.fill`); `size` 8-96, `color`.                                                                                                                                             |
| `image(src, opts)`                                  | PNG or JPEG of at most 256 KB. Put the file in `web/public/` (for example `web/public/images/chart.png`) and pass the path from the web root, `'images/chart.png'`. `contentMode`, `width`, `height`. Prefer symbols and charts. |
| `gauge(value, opts)`, `progress(value, opts)`       | `gauge`: `min`, `max`, `label`, `style` circular or linear. `progress`: `value` 0-1.                                                                                                                                             |
| `date(date, 'relative' \| 'time' \| 'timer', opts)` | The system keeps it current without re-rendering; `textStyle`, `color`.                                                                                                                                                          |
| `list(rows)`                                        | At most 8 rows of `{ title, subtitle?, symbol?, trailing?, color? }`; as many whole rows as fit are shown.                                                                                                                       |
| `chart('line' \| 'bar', points, opts)`              | At most 50 points `{ x: string, y: number }`.                                                                                                                                                                                    |
| `link(route, child)`                                | Tapping the child opens the app at `#route` (`/` followed by no whitespace, at most 512 chars).                                                                                                                                  |

Colors are semantic tokens only: `primary`, `secondary`, `accent`, `destructive`, `success`, `warning`; `accent` is the app's `accentColor` (the system accent when the manifest names none). Limits: tree depth 8, snapshot 64 KB serialized. A tap anywhere opens the app at the entry's `route`, or at `/`.

Sizing guide: small is 170x170 pt (one headline value plus a caption, or a short list), medium 364x170 (a list, or a value beside a short list or chart), large 364x382 (rows with subtitles, or a chart with a list). A list shows as many whole rows as fit and drops the rest, so return up to 8 rows in every family and let the size decide. On the desktop the user can resize a pinned widget within each family's range (small 170-320 x 170-270, medium 320-480 x 170-270, large 320-480 x 270-440): the tree of the family whose range holds the pin is laid out in that frame without scaling, so stacks and spacers take the space, lists show more rows, charts fill and text keeps its style. Build each family's tree to stretch: end a list with `spacer()`, keep text short with `lineLimit`, and give large a chart or two-line rows rather than eight bare titles.
