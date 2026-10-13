# The starter

`app scaffold` copies this starter into `app/` in the task folder when the folder is missing or empty. It is a small working Notes app: a React page, a SQLite-backed backend and one widget. It builds as it is, so you can build once to see the flow, then reshape it into the user's app. Its look, an amber accent and a composer above a list of notes, belongs to Notes; your app gets its own. Everything else the build needs (package manifest, Vite and TypeScript configuration, Tailwind) is written by the service, never by you.

```
app/
  atd-app.json          manifest: name, description, accent color, window, capabilities
  icon.svg              64x64 icon drawn in the accent color
  web/
    index.html
    src/main.tsx        mounts React with the query client
    src/App.tsx         a data hook, then the Notes layout with loading, empty and error states
    src/styles.css      the @atd/ui import, then the app's own tokens
  server/index.ts       defineBackend: onStart migration, two api functions, one widget
  shared/schema.ts      typebox schemas and the event channel name, used by both sides
```

Required: `atd-app.json` and `web/index.html`. `server/index.ts` is what gives the app a backend; delete `server/` and `shared/` for a pure-UI app (and drop the `createApi` import from the page). Relative imports include the `.ts`/`.tsx` extension.

## What to keep, what to replace

- **Keep:** `web/index.html` structure (rename the `<title>`), `web/src/main.tsx` (the query client), `class="dark"` on `<html>`, the `atd-titlebar` row that opens `App.tsx`, the `@atd/ui` import that opens `web/src/styles.css`, and the patterns in `server/index.ts` and `App.tsx`: the idempotent `CREATE TABLE IF NOT EXISTS` in `onStart`, `Value.Parse` on every input, `ctx.events.publish` plus `events.subscribe` for refresh, `ctx.widgets.reload` after writes, data access in a hook on `useQuery`/`useMutation`, components styled with tokens, and loading, empty and error states.
- **Replace:** the manifest values, `accentColor` included, `icon.svg`, the schemas, the api functions and table, the widget, and the page's layout, which you build from your design rather than restyle. Rename `NOTES_CHANNEL` and the `notes` table to fit the app. Remove the widget if it adds nothing.
- Apps are dark by default, like Atd. An app that follows the system appearance must also take over the window surface (see "The window surface") and bring its own `matchMedia` block that toggles the `dark` class.

## atd-app.json

```json
{
  "name": "Notes",
  "description": "A minimal notes app: a React page on @atd/ui, a SQLite-backed backend and a desktop widget.",
  "accentColor": "#f59e0b",
  "window": { "width": 720, "height": 612, "minWidth": 420, "minHeight": 412, "surface": "glass" },
  "capabilities": []
}
```

- `name` 1-64 characters, `description` up to 500. Window sizes are points between 200 and 4000; the minimum keeps the layout usable, so choose one the page really supports.
- `window.surface` is `glass` (Atd's window material, the scaffold's default) or `opaque` (a conventional window whose page paints everything and needs no title row; the value of apps created before it existed). `window.height` and `minHeight` include the 52 px title row of a glass window.
- `accentColor` is the app's identity color as `#RRGGBB`, chosen for its subject; set it here only. The build applies it to the page's `--primary` and `--primary-foreground`, `--ring`, `--chart-1` and the sidebar primary, right after the `@atd/ui` defaults. For each appearance it keeps the hue and moves the lightness only as far as legibility needs: the accent stands 3:1 against the page, and the text on it 4.5:1 at rest and on hover, so a pale yellow, for example, turns deeper in light appearance. Widgets take it as `accent`. Without it the app keeps the neutral look.
- `capabilities` is any of `ai`, `agent`, `memory`, `mcp`, `web` (empty when none). Add `"purposes": { "ai": "one plain sentence" }` for each, shown in the consent.
- `dependencies` is optional: npm packages the app needs beyond the provided ones, as `{ "date-fns": "^4.1.0" }`, at most 24, under each package's lowercase npm name, each an exact version, a `^`/`~` range or an x-range such as `4` or `4.x` (no tags, `*`, `||`, comparators, URLs, git, `file:` or `npm:`). Never list a provided package. No other keys are allowed.

## icon.svg

A 64x64 `viewBox`: a rounded square filled with the accent color and one simple glyph in colors that contrast with it, such as a tint or a shade of the accent, white or near-black; no external references or scripts. Redraw the glyph for the app and color it from its accent:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f59e0b"/><rect x="17" y="13" width="30" height="38" rx="5" fill="#fffbeb"/><path d="M24 24h16M24 31h16M24 38h9" stroke="#b45309" stroke-width="3" stroke-linecap="round"/></svg>
```

## web/index.html

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Notes</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

## web/src/main.tsx

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

## web/src/styles.css

```css
@import '@atd/ui/styles.css';

/* The build adds to the @atd/ui styles above what atd-app.json asks for: the accentColor's tokens,
   and with "surface": "glass" the window's fill on #root (the task panel's --ata-surface-panel) and
   the .atd-titlebar row. The app's rules go below and win over all of it. Another background:
   redefine --ata-surface-panel (an opaque value too under :root[data-reduced-transparency='true'])
   or give #root a background, never html or body, which only show through the fill. The app's own
   tokens: raw colors only inside :root (and .dark for an app that follows the system appearance),
   mapped with @theme inline. */
```

The import comes first, and the build places the accent's tokens right after it. Below it, define the tokens your design needs beyond `@atd/ui`'s, such as a surface or a scale: a raw color, or a `color-mix()` of tokens, appears only in a definition: under `:root` alone for a dark app, or under `:root` and `.dark` for an app that follows the system appearance, and `@theme inline` turns a token into utilities. Redefining an `@atd/ui` token here changes it for the whole page, the accent's included. Components use tokens, never a raw color; add other rules only when utility classes cannot express them. Never use `@plugin`, `@config`, `@source` or `@reference`.

```css
:root {
  --paper: oklch(0.985 0.012 85);
}
.dark {
  --paper: oklch(0.24 0.012 85);
}
@theme inline {
  --color-paper: var(--paper); /* bg-paper, text-paper, border-paper */
}
```

## The window surface

With `"surface": "glass"` the build gives the page what Atd's own windows have:

- `#root` is filled with `var(--ata-surface-panel)`: a translucent dark (opaque when the user turned on Reduce transparency) that lets the window's glass show through, and `min-height: 100dvh`.
- `<html class="dark">`: the page is dark in every system appearance.
- `.atd-titlebar` is the first row of the page: 52 px high with 88 px of leading padding so the window controls are clear. Put the app's title and its primary actions in it, and keep it outside the region that scrolls. The top 52 px of the window drags the window except over buttons, links, inputs and anything else interactive; add `data-no-drag` to an element that must receive clicks but is not an obvious control.

```tsx
<header className="atd-titlebar">
  <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Notes</h1>
  <Button size="icon-sm" variant="ghost" aria-label="Settings">
    <Settings />
  </Button>
</header>
```

Take the surface over only when the user's description calls for another background. All edits go in `web/src/styles.css` after the import:

1. Retint, one line: `:root { --ata-surface-panel: oklch(0.22 0.04 260 / 85%); }`. A translucent value needs its opaque twin, because the reduced-transparency rule of `@atd/ui` is more specific: `:root[data-reduced-transparency='true'] { --ata-surface-panel: oklch(0.22 0.04 260); }`.
2. Replace the page fill: define the color or gradient as a token (`:root { --page-surface: …; }`) and set `#root { background: var(--page-surface); }`.
3. Cover it with a full-size child that has its own background.
4. A conventional window: `"surface": "opaque"` in `atd-app.json`; then the page paints everything and has no title row.

A background on `html` or `body` does not replace the default: it is painted under the translucent fill and shows through it. When the app takes over with light colors, remove `class="dark"` from `<html>`, add a block that follows the system appearance, and define both the light and the dark value of every token the page relies on.

## web/src/App.tsx, server/index.ts, shared/schema.ts

The scaffolded versions are the Notes app: read them first, then edit them in place. `useNotes` in `App.tsx` shows the data side a page needs; the layout under it serves Notes' own task, so lay out your page from your design rather than restyling it. `example.md` shows a finished app (Mood) whose design came out differently: a one-tap check-in as the hero, a five-week grid instead of a list, and a streamed AI call.

## Hash routing (only when the app has several views or widgets that link into it)

The page is always loaded at `/` and a widget tap or link arrives as `#/route`, so routing must read the hash. A few lines are enough, and need no package:

```tsx
import { useSyncExternalStore } from 'react';

function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

/** The current route, `/` when the hash is empty. */
export function useRoute(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash.slice(1) || '/');
}
```

Match on the string (`/entries/3`) to pick the view, and set `location.hash` to navigate.

## Components and icons

`@atd/ui/components/<name>` for: alert, alert-dialog, avatar, badge, button, card, collapsible, command, context-menu, dialog, dropdown-menu, empty, highlighted-text, input, input-group, item, kbd, label, popover, scroll-area, select, separator, sheet, spinner, switch, tabs, textarea, toolbar, tooltip. `cn` is in `@atd/ui/lib/utils`. Use the shadcn names and props (`Button` takes `variant` and `size`, `Item` composes `ItemContent`/`ItemTitle`/`ItemDescription`/`ItemActions`, `Select` is the Radix composition). The type check reports a wrong prop. Icons: named imports from `lucide-react`.
