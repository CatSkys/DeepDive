# Worked example: Mood

A complete small app that builds and type-checks as written: a one-tap daily check-in kept in SQLite, five weeks at a glance, a streamed AI look back, a refresh when data changes, and one widget. Use it to calibrate scope, design and style, not as a template: its look follows from its own purpose, and an app with another purpose comes out differently. `index.html` and `main.tsx` are as in `starter.md`, and it keeps Atd's window surface (`starter.md`, "The window surface").

## How its look was decided

- **Primary task:** telling the app how today feels, in one tap. The check-in is the hero: the first thing in the window, a large question and five large choices on a surface washed with the accent.
- **Looked at next:** how the last weeks went. A five-week grid shows each day as a tint of the accent, stronger for a better day, which reads at a glance where a list of dates would not. The streak is the one number, so it is large, in tabular numerals.
- **On demand:** the AI look back waits below, behind a button.
- **Identity:** a calm violet (`#8b5cf6`) suits a reflective subject; the icon is a face drawn on it, and the widget colors today's mood and the week's bars with `accent`.
- **Motion:** the highlight slides to the chosen face and a new streak number rises into place; `MotionConfig reducedMotion="user"` drops the movement and keeps only the fade when the system asks for reduced motion.

## What to notice

- One schema and one `dayKey` in `shared/` serve the backend validation and the page.
- `onStart` is idempotent and additive; a check-in is an upsert by day that publishes an event and reloads the widget.
- `lookBack` is a generator, so the page shows text as it arrives; a model failure or a missing grant throws a readable error that the page shows.
- The accent reaches the page through tokens only: `bg-primary` with its opacity steps, and the `--checkin` surface that `styles.css` defines from `--primary`, mixed with `transparent` so the window's glass still shows through it.
- The title row is the first row and stays put while the content below it scrolls, so nothing slides under the window controls.
- The widget supports both families it declares; `link('/', …)` opens the app on tap.
- `atd-app.json` lists `ai` with a purpose; storage and the widget need no capability.

Build, then test the backend before telling the user it is done:

```
app build  { dir: "app", summary: "Mood with a daily check-in, five-week grid, look back and widget" }
app call   { appId, name: "checkIn", input: { mood: 4 } }
app call   { appId, name: "checkIn", input: { mood: 9 } }   // expect a validation error
app call   { appId, name: "recent" }
```

### `atd-app.json`

```json
{
  "name": "Mood",
  "description": "Check in with how you feel once a day, see the last five weeks at a glance, and get an AI look back.",
  "accentColor": "#8b5cf6",
  "window": { "width": 600, "height": 692, "minWidth": 380, "minHeight": 472, "surface": "glass" },
  "capabilities": ["ai"],
  "purposes": { "ai": "Writes a short look back at your recent check-ins." }
}
```

### `icon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#8b5cf6"/><circle cx="32" cy="32" r="17" fill="none" stroke="#fafafa" stroke-width="3.5"/><circle cx="25.5" cy="28" r="2.5" fill="#fafafa"/><circle cx="38.5" cy="28" r="2.5" fill="#fafafa"/><path d="M24.5 37.5c4.5 4.5 10.5 4.5 15 0" fill="none" stroke="#fafafa" stroke-width="3.5" stroke-linecap="round"/></svg>
```

### `web/src/styles.css`

```css
@import '@atd/ui/styles.css';

/* The check-in's surface: a wash of the accent over the window's glass. Mood is dark like Atd,
   so one value is enough. */
:root {
  --checkin: color-mix(in oklab, var(--primary) 14%, transparent);
}

@theme inline {
  --color-checkin: var(--checkin);
}
```

### `shared/schema.ts`

```ts
import { Type, type Static } from 'typebox';

export const MOOD_LABELS = ['Rough', 'Low', 'Okay', 'Good', 'Great'] as const;

export const CheckIn = Type.Object({
  day: Type.String(),
  mood: Type.Integer({ minimum: 1, maximum: 5 }),
});
export type CheckIn = Static<typeof CheckIn>;

export const CheckInInput = Type.Object({ mood: Type.Integer({ minimum: 1, maximum: 5 }) });
export type CheckInInput = Static<typeof CheckInInput>;

/** The channel the backend publishes on after every check-in. */
export const CHECKINS_CHANNEL = 'checkins';

/** A local calendar day as `YYYY-MM-DD`: the key of a check-in. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
```

### `server/index.ts`

```ts
import { defineBackend, defineWidget, w, type BackendContext } from '@atd/app-kit/server';
import Value from 'typebox/value';
import {
  CHECKINS_CHANNEL,
  CheckInInput,
  dayKey,
  MOOD_LABELS,
  type CheckIn,
} from '../shared/schema.ts';

/** Check-ins of the last `days` days, oldest first. */
function recent(ctx: BackendContext, days: number): CheckIn[] {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const rows = ctx.db
    .prepare('SELECT day, mood FROM checkins WHERE day >= ? ORDER BY day')
    .all(dayKey(since));
  return rows.map((row) => ({ day: String(row.day), mood: Number(row.mood) }));
}

const today = defineWidget({
  id: 'today',
  title: 'Mood today',
  description: "Today's check-in and your last week.",
  families: ['systemSmall', 'systemMedium'],
  refreshMinutes: 180,
  render(ctx, { family }) {
    const week = recent(ctx, 7);
    const mine = week.find((entry) => entry.day === dayKey(new Date()));
    const summary = w.vstack(
      [
        w.text('Mood', { style: 'headline' }),
        mine
          ? w.text(MOOD_LABELS[mine.mood - 1] ?? '', { style: 'title', color: 'accent' })
          : w.text('Not checked in yet', { style: 'footnote', color: 'secondary' }),
        w.spacer(),
      ],
      { alignment: 'leading', spacing: 4 },
    );
    const chart = w.chart(
      'bar',
      week.map((entry) => ({ x: entry.day.slice(5), y: entry.mood })),
      { color: 'accent' },
    );
    return w.timeline(
      w.link('/', family === 'systemSmall' ? summary : w.hstack([summary, chart], { spacing: 12 })),
    );
  },
});

export default defineBackend({
  // Idempotent and additive: a reverted version runs against data a newer one wrote.
  onStart(ctx) {
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS checkins (
      day TEXT PRIMARY KEY,
      mood INTEGER NOT NULL
    )`);
  },
  api: {
    recent: (_input: undefined, ctx) => recent(ctx, 35),
    checkIn(input: CheckInInput, ctx): CheckIn {
      const { mood } = Value.Parse(CheckInInput, input);
      const entry = { day: dayKey(new Date()), mood };
      ctx.db
        .prepare(
          `INSERT INTO checkins (day, mood) VALUES (?, ?)
           ON CONFLICT(day) DO UPDATE SET mood = excluded.mood`,
        )
        .run(entry.day, entry.mood);
      ctx.events.publish(CHECKINS_CHANNEL, entry);
      ctx.widgets.reload('today');
      return entry;
    },
    // A generator streams: each yield reaches the page as a chunk, the return value is the result.
    async *lookBack(_input: undefined, ctx) {
      const entries = recent(ctx, 28);
      if (entries.length < 3) throw new Error('Check in on a few more days first.');
      const stream = ctx.ai.stream({
        system: 'In three short sentences, reflect kindly on how these days went.',
        messages: [
          {
            role: 'user',
            content: entries.map((e) => `${e.day}: ${MOOD_LABELS[e.mood - 1]}`).join('\n'),
          },
        ],
        maxTokens: 300,
      });
      for await (const chunk of stream) yield chunk.delta;
      return (await stream.result).text;
    },
  },
  widgets: [today],
});
```

### `web/src/App.tsx`

```tsx
import { createApi, events } from '@atd/app-kit/client';
import { Button } from '@atd/ui/components/button';
import { cn } from '@atd/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Annoyed, Frown, Laugh, Meh, Smile, Sparkles } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type backend from '../../server/index.ts';
import { CHECKINS_CHANNEL, dayKey, MOOD_LABELS } from '../../shared/schema.ts';

const api = createApi<typeof backend>();
const FACES = [Frown, Annoyed, Meh, Smile, Laugh];
/** A day as a tint of the accent: the better the day, the stronger the color. */
const TINTS = ['bg-primary/15', 'bg-primary/35', 'bg-primary/55', 'bg-primary/75', 'bg-primary'];

/** The last `count` days, oldest first, so the grid reads like a calendar. */
function lastDays(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (count - 1 - index));
    return dayKey(date);
  });
}

/** Checked-in days in a row, up to today, or to yesterday while today is still open. */
function streak(days: string[], checked: Set<string>): number {
  let count = 0;
  for (const day of days.slice(0, checked.has(dayKey(new Date())) ? undefined : -1).reverse()) {
    if (!checked.has(day)) break;
    count++;
  }
  return count;
}

export function App() {
  const queryClient = useQueryClient();
  const [lookBack, setLookBack] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const checkins = useQuery({ queryKey: ['checkins'], queryFn: () => api.call('recent') });
  const days = lastDays(35);
  const byDay = new Map((checkins.data ?? []).map((entry) => [entry.day, entry]));
  const todayKey = dayKey(new Date());
  const today = byDay.get(todayKey);
  const save = useMutation({ mutationFn: (mood: number) => api.call('checkIn', { mood }) });
  useEffect(
    () =>
      events.subscribe(
        CHECKINS_CHANNEL,
        () => void queryClient.invalidateQueries({ queryKey: ['checkins'] }),
      ),
    [queryClient],
  );

  const run = streak(days, new Set(byDay.keys()));

  async function reflect() {
    setLookBack('');
    setLookError(null);
    setLooking(true);
    try {
      const stream = api.stream('lookBack');
      for await (const delta of stream) setLookBack((current) => current + delta);
      await stream.result;
    } catch (error) {
      setLookError(error instanceof Error ? error.message : 'The look back failed.');
    } finally {
      setLooking(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col text-foreground">
        <header className="atd-titlebar">
          <span className="text-sm font-medium">Mood</span>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <section className="bg-checkin flex flex-col gap-4 px-6 pt-7 pb-6">
            <h1 className="text-2xl font-semibold tracking-tight">How are you today?</h1>
            <div role="group" aria-label="Today's mood" className="grid grid-cols-5 gap-1.5">
              {FACES.map((Face, index) => {
                const chosen = today?.mood === index + 1;
                return (
                  <Button
                    key={index}
                    variant="ghost"
                    aria-pressed={chosen}
                    disabled={save.isPending}
                    className="relative h-auto flex-col gap-1.5 py-3"
                    onClick={() => save.mutate(index + 1)}
                  >
                    {chosen ? (
                      <motion.span
                        layoutId="chosen"
                        className="absolute inset-0 rounded-2xl bg-primary"
                        transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }}
                      />
                    ) : null}
                    <Face className={cn('relative size-7', chosen && 'text-primary-foreground')} />
                    <span
                      className={cn(
                        'relative text-xs',
                        chosen ? 'text-primary-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {MOOD_LABELS[index]}
                    </span>
                  </Button>
                );
              })}
            </div>
            {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
          </section>

          <section className="flex flex-col gap-3 px-6 py-5">
            <div className="flex items-end justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Last five weeks</h2>
              <p className="flex items-baseline gap-1.5 text-sm text-muted-foreground">
                <motion.span
                  key={run}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="text-4xl font-semibold text-foreground tabular-nums"
                >
                  {run}
                </motion.span>
                day streak
              </p>
            </div>
            {checkins.error ? (
              <p className="text-sm text-destructive">{checkins.error.message}</p>
            ) : null}
            <ol aria-busy={checkins.isPending} className="grid max-w-sm grid-cols-7 gap-1.5">
              {days.map((day) => {
                const entry = byDay.get(day);
                const date = new Date(`${day}T12:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <li
                    key={day}
                    className={cn(
                      'aspect-square rounded-lg transition-colors duration-300',
                      entry ? TINTS[entry.mood - 1] : 'border',
                      day === todayKey && 'ring-2 ring-ring ring-offset-2 ring-offset-transparent',
                    )}
                  >
                    <span className="sr-only">
                      {date}: {entry ? MOOD_LABELS[entry.mood - 1] : 'no check-in'}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="flex flex-col gap-2 px-6 pb-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Look back</h2>
              <Button
                size="sm"
                variant="secondary"
                disabled={looking}
                onClick={() => void reflect()}
              >
                <Sparkles /> Reflect
              </Button>
            </div>
            {lookError ? <p className="text-sm text-destructive">{lookError}</p> : null}
            <p aria-live="polite" className="text-sm leading-relaxed">
              {lookBack}
            </p>
          </section>
        </main>
      </div>
    </MotionConfig>
  );
}
```
