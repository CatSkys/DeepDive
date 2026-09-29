/**
 * Deletion orchestration: one delete touches four stores (stored log,
 * projection-cache row, archive entry, workspace accounting), a live session is
 * refused instead of having its log unlinked, and a batch is partial — every
 * refusal comes back with a reason instead of sinking the call.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionDeleteController } from '../src/delete.ts'
import { testSessionPersistence } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

interface HarnessOptions {
  /** Ids with a durable log this backend knows. */
  stored?: readonly string[]
  /** Ids that have a live (attached) Session. */
  live?: readonly string[]
  /** Ids whose agent is running. */
  running?: readonly string[]
  /** Ids whose storage delete throws this message. */
  fail?: Readonly<Record<string, string>>
  /** Make the projection-cache evict throw. */
  evictFails?: boolean
}

function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  const stored = new Set(options.stored ?? [])
  const calls = {
    deleted: [] as string[],
    evicted: [] as string[],
    forgotten: [] as string[][],
  }
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    delete: async (id: SessionId) => {
      const failure = options.fail?.[id]
      if (failure !== undefined) throw new Error(failure)
      if (!stored.delete(id)) return false
      calls.deleted.push(id)
      return true
    },
  }) as never)
  ctx.provide('sessionProjectionCache', {
    evict: async (id: SessionId) => {
      if (options.evictFails === true) throw new Error('cache is read-only')
      calls.evicted.push(id)
      return true
    },
  } as never)
  ctx.provide('workspaceRegistry', {
    forgetSessions: async (ids: readonly SessionId[]) => {
      calls.forgotten.push([...ids])
    },
  } as never)
  ctx.provide('sessions', {
    get: (id: SessionId) => (options.live ?? []).includes(id) ? { id } : undefined,
  } as never)
  ctx.provide('agents', {
    get: (id: SessionId) => (options.running ?? []).includes(id) ? { status: 'running' } : undefined,
  } as never)
  return { controller: new SessionDeleteController(ctx), calls, ctx }
}

describe('SessionDeleteController', () => {
  it('deletes a stored session from every derived store', async () => {
    const { controller, calls } = harness({ stored: ['gone'] })
    const result = await controller.deleteSessions({ sessionIds: [sid('gone')] })

    expect(result).toEqual({ deleted: [sid('gone')], refused: [] })
    expect(calls.deleted).toEqual(['gone'])
    expect(calls.evicted).toEqual(['gone'])
    expect(calls.forgotten).toEqual([['gone']])
  })

  it('refuses a live or running session without touching its log', async () => {
    const { controller, calls } = harness({
      stored: ['attached', 'busy'],
      live: ['attached'],
      running: ['busy'],
    })
    const result = await controller.deleteSessions({ sessionIds: [sid('attached'), sid('busy')] })

    expect(result.deleted).toEqual([])
    expect(result.refused).toEqual([
      { sessionId: sid('attached'), reason: 'busy' },
      { sessionId: sid('busy'), reason: 'busy' },
    ])
    expect(calls.deleted).toEqual([])
    expect(calls.forgotten).toEqual([])
  })

  it('reports an unknown id as missing rather than as a deletion', async () => {
    const { controller, calls } = harness()
    const result = await controller.deleteSessions({ sessionIds: [sid('never')] })

    expect(result).toEqual({
      deleted: [],
      refused: [{ sessionId: sid('never'), reason: 'missing' }],
    })
    expect(calls.evicted).toEqual([])
    expect(calls.forgotten).toEqual([])
  })

  it('reports a storage refusal as failed, with the storage message', async () => {
    const { controller, calls } = harness({ stored: ['stuck'], fail: { stuck: 'directory is read-only' } })
    const result = await controller.deleteSessions({ sessionIds: [sid('stuck')] })

    expect(result.deleted).toEqual([])
    expect(result.refused).toEqual([
      { sessionId: sid('stuck'), reason: 'failed', detail: 'directory is read-only' },
    ])
    // The log survived, so nothing downstream may forget it.
    expect(calls.forgotten).toEqual([])
  })

  it('is partial: one refusal never sinks the rest of the batch', async () => {
    const { controller, calls } = harness({ stored: ['ok'], running: ['busy'] })
    const result = await controller.deleteSessions({
      sessionIds: [sid('ok'), sid('busy'), sid('never')],
    })

    expect(result.deleted).toEqual([sid('ok')])
    expect(result.refused).toEqual([
      { sessionId: sid('busy'), reason: 'busy' },
      { sessionId: sid('never'), reason: 'missing' },
    ])
    // Only the ids that are actually gone are forgotten by the registry.
    expect(calls.forgotten).toEqual([['ok']])
  })

  it('treats a repeated id once', async () => {
    const { controller, calls } = harness({ stored: ['dup'] })
    const result = await controller.deleteSessions({ sessionIds: [sid('dup'), sid('dup')] })

    expect(result.deleted).toEqual([sid('dup')])
    expect(calls.deleted).toEqual(['dup'])
    expect(calls.forgotten).toEqual([['dup']])
  })

  it('keeps the deletion when the projection cache cannot drop its row', async () => {
    const { controller, ctx, calls } = harness({ stored: ['gone'], evictFails: true })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    try {
      const result = await controller.deleteSessions({ sessionIds: [sid('gone')] })
      expect(result.deleted).toEqual([sid('gone')])
      expect(calls.forgotten).toEqual([['gone']])
      expect(warn).toHaveBeenCalledOnce()
      expect(String(warn.mock.calls[0]?.[0])).toContain('projection cache row')
    } finally {
      warn.mockRestore()
    }
  })
})
