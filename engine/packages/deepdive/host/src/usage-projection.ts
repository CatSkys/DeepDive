/**
 * Per-session usage, as a projection unit.
 *
 * The stats page used to fold this itself by replaying every session's log
 * (`session/follow` + `session/page` per session — 159 sessions took ~17s,
 * `PITFALLS §4.16`). Folding it in the engine means the client reads one value
 * off the session list it already fetches.
 *
 * The semantics are copied from the client's fold on purpose, so the numbers do
 * not move: tokens are `inputTokens + outputTokens` (cache reads and reasoning
 * are itemized elsewhere and not counted), turns are `user/message` events whose
 * source is the user, and "active time" is the wall clock of
 * `step/start → assistant/message` plus `tool/call → tool/result` pairs. Days
 * are the engine host's local days — the same machine as the desktop app.
 *
 * The bookkeeping fields (`openStepStart`, `pendingCalls`) are fold state, not
 * wire data: the wire view carries only the folded totals, and losing the
 * bookkeeping at a checkpoint is harmless because checkpoints land on turn
 * boundaries, where no step or tool call is open.
 *
 * @module usage-projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (a summary carries usage
// too — a compaction is a real model call and the stats page counts it).
import type {} from '@deepseek-ai/dsh-compaction'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Per-session usage totals (days, turns, active time). */
    usage: UsageState
  }
  interface SessionProjectionMap {
    /** The client-visible half: folded totals only, no fold bookkeeping. */
    usage: UsageValue
  }
}

/** One local day's totals. */
export interface UsageDayState {
  tokens: number
  turns: number
  byModel: Record<string, number>
}

/** The unit's full state: folded totals plus the fold's own bookkeeping. */
export interface UsageState {
  days: Record<string, UsageDayState>
  activeMs: number
  /** Timestamp of the open step, when one is in flight. */
  openStepStart: number | null
  /** Dispatched tool calls awaiting their result, by call id. */
  pendingCalls: Record<string, number>
}

/** What goes on the wire (and into the projection cache). */
export interface UsageValue {
  days: Record<string, UsageDayState>
  activeMs: number
}

// Defaults matter on the restore path: the cached row holds only the wire view,
// so the fold's own bookkeeping comes back as its default — which is exactly
// right at a checkpoint boundary (checkpoints land between turns, where no step
// or tool call is open).
const usageDaySchema = z.object({
  tokens: z.number().default(0),
  turns: z.number().default(0),
  byModel: z.record(z.string(), z.number()).default({}),
})

const usageStateSchema: z.ZodType<UsageState> = z.object({
  days: z.record(z.string(), usageDaySchema).default({}),
  activeMs: z.number().default(0),
  openStepStart: z.number().nullable().default(null),
  pendingCalls: z.record(z.string(), z.number()).default({}),
})

const usageValueSchema: z.ZodType<UsageValue> = z.object({
  days: z.record(z.string(), usageDaySchema).default({}),
  activeMs: z.number().default(0),
})

/** Local-time `yyyy-mm-dd`, the same key the client's fold produced. */
export function localDayKey(timeMs: number): string {
  const date = new Date(timeMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** The mutable day record for one timestamp, created on first use. */
function dayOf(state: UsageState, timeMs: number): UsageDayState {
  const key = localDayKey(timeMs)
  const existing = state.days[key]
  if (existing !== undefined) return existing
  const created: UsageDayState = { tokens: 0, turns: 0, byModel: {} }
  state.days[key] = created
  return created
}

/** Tokens of one usage block: input + output only. */
function tokensOf(usage: { inputTokens?: number; outputTokens?: number } | undefined): number {
  return (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
}

/**
 * Fold one committed event. Mirrors the client's `foldSessionEvents` case by
 * case; unknown event types advance nothing.
 * @param state - current unit state (mutated in place, as the registry expects).
 * @param event - the committed session event.
 * @returns the same state.
 */
export function applyUsageEvent(state: UsageState, event: SessionEvent): UsageState {
  switch (event.type) {
    case 'step/start':
      state.openStepStart = event.time
      break
    case 'assistant/message': {
      if (state.openStepStart !== null) {
        state.activeMs += Math.max(0, event.time - state.openStepStart)
        state.openStepStart = null
      }
      const data = event.data as {
        usage?: { inputTokens?: number; outputTokens?: number }
        message?: { source?: { model?: string; provider?: string } }
      }
      const tokens = tokensOf(data.usage)
      if (tokens > 0) {
        const model = data.message?.source?.model ?? data.message?.source?.provider ?? 'unknown'
        const day = dayOf(state, event.time)
        day.tokens += tokens
        day.byModel[model] = (day.byModel[model] ?? 0) + tokens
      }
      break
    }
    case 'compaction/summary': {
      const data = event.data as { usage?: { inputTokens?: number; outputTokens?: number } }
      const tokens = tokensOf(data.usage)
      if (tokens > 0) dayOf(state, event.time).tokens += tokens
      break
    }
    case 'tool/call': {
      const data = event.data as { callId?: string; id?: string }
      state.pendingCalls[data.callId ?? data.id ?? ''] = event.time
      break
    }
    case 'tool/result': {
      const data = event.data as {
        message?: { source?: { callId?: string } }
        callId?: string
        toolCallId?: string
      }
      const callId = data.message?.source?.callId ?? data.callId ?? data.toolCallId
      if (callId === undefined) break
      const dispatched = state.pendingCalls[callId]
      if (dispatched === undefined) break
      state.activeMs += Math.max(0, event.time - dispatched)
      delete state.pendingCalls[callId]
      break
    }
    case 'user/message': {
      const data = event.data as { source?: { kind?: string } }
      if (data.source?.kind === 'user') dayOf(state, event.time).turns += 1
      break
    }
    default:
      break
  }
  return state
}

/** The unit's initial state (also the restore fallback for absent bookkeeping). */
export function usageInit(): UsageState {
  return { days: {}, activeMs: 0, openStepStart: null, pendingCalls: {} }
}

/** The client-visible half of the state. */
export function usageValueOf(state: UsageState): UsageValue {
  return { days: state.days, activeMs: state.activeMs }
}

/**
 * Register the unit when a projection registry is composed.
 * @param ctx - Host context whose optional `sessionProjections` owns the registry.
 */
export function registerUsageProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    // The literal is passed inline: the registry's definition type makes `wire`
    // optional, and only a literal with `wire` present selects the overload that
    // publishes this unit to clients.
    projectionCtx.sessionProjections.register<'usage', UsageState>({
      key: 'usage',
      stateSchema: usageStateSchema,
      init: usageInit,
      apply: applyUsageEvent,
      wire: { viewSchema: usageValueSchema, view: usageValueOf },
      stateVersion: 1,
    })
  })
}
