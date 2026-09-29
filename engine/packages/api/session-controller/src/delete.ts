/**
 * Session deletion: the one operation that spans every store derived from a
 * session — its stored log, its projection-cache row, its archive entry, and
 * its workspace accounting.
 *
 * Why this lives in the session domain and not the workspace one: only this
 * package declares all three seams (persistence, projection cache, workspace
 * registry), and the deletion *is* a session operation — the archive set is
 * merely one of the things that must forget the id. Unarchiving stays on the
 * workspace namespace, where the archive set and `archiveSession` live.
 *
 * Refusals are data, not errors: a batch is partial by design, and the caller
 * needs to say which ids survived and why. Order is deliberate — stored log
 * first, registry second: a crash in between leaves a session that is still
 * accounted but no longer stored (harmless, and re-deleting is idempotent),
 * whereas the reverse order would let a deleted log return through the header
 * index after a restart.
 *
 * @module delete
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionDeleteRefusal, SessionDeleteSessionsRequest, SessionDeleteSessionsValue } from './types.ts'

/** Deletes sessions across every store derived from them. */
export class SessionDeleteController {
  /** @param ctx - Host context carrying persistence, the projection cache, and the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Delete a batch of sessions, reporting every id that survived.
   * @param request - Session identities to delete.
   * @returns what was deleted, and every refusal with its reason.
   */
  async deleteSessions(request: SessionDeleteSessionsRequest): Promise<SessionDeleteSessionsValue> {
    const persistence = this.ctx.get('sessionPersistence')
    const deleted: SessionId[] = []
    const refused: SessionDeleteRefusal[] = []
    for (const sessionId of new Set(request.sessionIds)) {
      if (this.isLive(sessionId)) {
        refused.push({ sessionId, reason: 'busy' })
        continue
      }
      if (persistence === undefined) {
        // No persistence in this composition: there is nothing durable to
        // delete, and pretending otherwise would report a deletion that never
        // happened.
        refused.push({ sessionId, reason: 'missing' })
        continue
      }
      let stored: boolean
      try {
        stored = await persistence.delete(sessionId)
      } catch (error) {
        // The log is still on disk: report it instead of pretending it went.
        refused.push({ sessionId, reason: 'failed', detail: errorMessage(error) })
        continue
      }
      if (!stored) {
        refused.push({ sessionId, reason: 'missing' })
        continue
      }
      await this.evictProjection(sessionId)
      deleted.push(sessionId)
    }
    if (deleted.length > 0) await this.ctx.workspaceRegistry.forgetSessions(deleted)
    return { deleted, refused }
  }

  /**
   * Drop one session's cached projection row. Derived state, so a failure is
   * logged and the deletion still stands: nothing lists a deleted id, and the
   * row's own identity check keeps a later reuse of the id from seeding off it.
   */
  private async evictProjection(sessionId: SessionId): Promise<void> {
    const cache = this.ctx.get('sessionProjectionCache')
    if (cache === undefined) return
    try {
      await cache.evict(sessionId)
    } catch (error) {
      this.ctx.logger.warn(
        `session deletion: projection cache row for "${sessionId}" was not removed `
        + `(a stale document stays under storages/): ${String(error)}`,
      )
    }
  }

  /**
   * Whether a session is live or running. Either way its log is still being
   * written, so removing the storage underneath it would corrupt an in-flight
   * session — and on POSIX unlink a directory whose `flock` is held, forfeiting
   * the lease exclusion that guards it.
   */
  private isLive(sessionId: SessionId): boolean {
    if (this.ctx.sessions.get(sessionId) !== undefined) return true
    return this.ctx.agents.get(sessionId)?.status === 'running'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
