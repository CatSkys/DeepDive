/**
 * The usage unit's fold. Its semantics are copied from the client's own fold
 * (`frontend/src/stats/usageStats.ts`) so the numbers do not move when the
 * client switches to reading this projection — every case here mirrors one
 * there.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyUsageEvent, localDayKey, usageInit, usageValueOf } from '../src/usage-projection.ts'

/** A local-time timestamp for a given day at noon (avoids DST edges). */
function noon(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1, 12, 0, 0).getTime()
}

function event(type: string, time: number, data: Record<string, unknown> = {}): SessionEvent {
  return { type, seq: 0, time, data } as unknown as SessionEvent
}

function fold(events: readonly SessionEvent[]) {
  const state = usageInit()
  for (const e of events) applyUsageEvent(state, e)
  return state
}

describe('usage projection', () => {
  it('counts input + output tokens per local day and per model', () => {
    const day = '2026-03-04'
    const state = fold([
      event('assistant/message', noon(day), {
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 999, reasoningTokens: 999 },
        message: { source: { model: 'deepseek-v4.1-flash' } },
      }),
    ])
    expect(state.days[day]).toEqual({
      tokens: 120,
      turns: 0,
      byModel: { 'deepseek-v4.1-flash': 120 },
    })
    // Cache reads and reasoning are itemized elsewhere, never counted here.
    expect(localDayKey(noon(day))).toBe(day)
  })

  it('falls back to the provider when the model is absent', () => {
    const state = fold([
      event('assistant/message', noon('2026-03-05'), {
        usage: { inputTokens: 5, outputTokens: 5 },
        message: { source: { provider: 'opencode-go' } },
      }),
    ])
    expect(state.days['2026-03-05']?.byModel).toEqual({ 'opencode-go': 10 })
  })

  it('counts turns from user messages only', () => {
    const day = '2026-03-06'
    const state = fold([
      event('user/message', noon(day), { source: { kind: 'user' } }),
      event('user/message', noon(day), { source: { kind: 'plugin' } }),
    ])
    expect(state.days[day]?.turns).toBe(1)
  })

  it('adds step and tool wall clock to active time', () => {
    const base = noon('2026-03-07')
    const state = fold([
      event('step/start', base),
      event('assistant/message', base + 1000, { usage: { inputTokens: 1, outputTokens: 0 } }),
      event('tool/call', base + 2000, { callId: 'c1' }),
      event('tool/result', base + 2500, { callId: 'c1' }),
      // An unmatched result contributes nothing.
      event('tool/result', base + 3000, { callId: 'never-dispatched' }),
    ])
    expect(state.activeMs).toBe(1500)
    // A step left open by the end of the log is not counted yet.
    expect(state.openStepStart).toBeNull()
  })

  it('counts compaction summaries as real model calls', () => {
    const day = '2026-03-08'
    const state = fold([
      event('compaction/summary', noon(day), { usage: { inputTokens: 40, outputTokens: 10 } }),
    ])
    expect(state.days[day]?.tokens).toBe(50)
    expect(state.days[day]?.byModel).toEqual({})
  })

  it('publishes folded totals only, never the fold bookkeeping', () => {
    const base = noon('2026-03-09')
    const state = fold([event('step/start', base), event('tool/call', base, { callId: 'open' })])
    expect(usageValueOf(state)).toEqual({ days: {}, activeMs: 0 })
  })

  it('is a pure fold: the same events from an empty state give the same totals', () => {
    const base = noon('2026-03-10')
    const events = [
      event('step/start', base),
      event('assistant/message', base + 10, { usage: { inputTokens: 3, outputTokens: 4 }, message: { source: { model: 'm' } } }),
    ]
    expect(fold(events)).toEqual(fold(events))
  })
})
