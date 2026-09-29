/**
 * `SessionPersistence.delete` on the JSONL backend: one stored session's whole
 * directory goes (every generation, the lock file, leftovers), the in-process
 * registrations go with it, and a live write owner is refused instead of having
 * its storage unlinked from under it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { projectDir, sessionDir } from '../src/format.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One mounted backend over its own temp root (`compression: 'none'` = readable paths). */
async function mount(): Promise<{ persistence: SessionPersistence; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return { persistence: ctx.sessionPersistence, root }
}

/** Persist one whole log (create + append + close). */
async function store(persistence: SessionPersistence, id: string, cwd?: string): Promise<SessionId> {
  const sessionId = SessionId(id)
  const handle = await persistence.create(meta(id, cwd))
  try {
    await handle.append(oneTurnLog())
  } finally {
    await handle.close()
  }
  return sessionId
}

async function exists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

describe('jsonl delete', () => {
  it('removes the whole session directory and its durable visibility', async () => {
    const { persistence, root } = await mount()
    const id = await store(persistence, 'gone', '/tmp/project')
    const directory = sessionDir(root, '/tmp/project', id)
    expect(await exists(directory)).toBe(true)

    expect(await persistence.delete(id)).toBe(true)

    expect(await exists(directory)).toBe(false)
    expect(await persistence.stat(id)).toBeUndefined()
    await expect(persistence.open(id, 'read')).rejects.toThrow()
    expect((await persistence.list()).map(s => s.header.id)).not.toContain(id)
  })

  it('is invisible to a fresh backend instance over the same root (no in-memory illusion)', async () => {
    const { persistence, root } = await mount()
    const id = await store(persistence, 'cross-instance')
    await persistence.delete(id)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const fresh = ctx.sessionPersistence
    expect(await fresh.stat(id)).toBeUndefined()
    expect((await fresh.list()).map(s => s.header.id)).not.toContain(id)
  })

  it('returns false for an id this backend never had', async () => {
    const { persistence } = await mount()
    expect(await persistence.delete(SessionId('never-existed'))).toBe(false)
  })

  it('frees the id for a fresh create (no stale ownership claim left behind)', async () => {
    const { persistence } = await mount()
    const id = await store(persistence, 'reusable')
    await persistence.delete(id)
    // create would throw SessionAlreadyExistsError if the claim survived.
    const handle = await persistence.create(meta('reusable'))
    try {
      await handle.append(oneTurnLog())
    } finally {
      await handle.close()
    }
    expect(await persistence.stat(id)).toBeDefined()
  })

  it('refuses while a write handle owns the session, and the log survives', async () => {
    const { persistence, root } = await mount()
    const id = await store(persistence, 'busy')
    const writer = await persistence.open(id, 'write')
    try {
      await expect(persistence.delete(id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      expect(await exists(sessionDir(root, undefined, id))).toBe(true)
      expect(await persistence.stat(id)).toBeDefined()
    } finally {
      await writer.close()
    }
    // The owner is gone: deletion is allowed again and leaves nothing behind.
    expect(await persistence.delete(id)).toBe(true)
  })

  it('removes a leftover session directory that holds no readable generation', async () => {
    const { persistence, root } = await mount()
    const id = SessionId('leftover')
    // A lease acquisition can create the directory before anything materializes.
    await mkdir(sessionDir(root, '/tmp/project', id), { recursive: true })
    expect(await exists(projectDir(root, '/tmp/project'))).toBe(true)

    expect(await persistence.delete(id)).toBe(true)
    expect(await exists(sessionDir(root, '/tmp/project', id))).toBe(false)
  })

  it('leaves other sessions untouched', async () => {
    const { persistence, root } = await mount()
    const keep = await store(persistence, 'keep')
    const drop = await store(persistence, 'drop')
    expect(await persistence.delete(drop)).toBe(true)
    expect(await exists(sessionDir(root, undefined, keep))).toBe(true)
    expect((await persistence.list()).map(s => s.header.id)).toEqual([keep])
  })
})
