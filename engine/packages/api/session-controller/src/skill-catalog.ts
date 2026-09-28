/** Session-addressed, cold-readable skill catalog Remote. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SkillAdminCreateRequest,
  SkillAdminInstallRequest,
  SkillAdminListValue,
  SkillAdminOk,
  SkillAdminRemoveRequest,
  SkillListRequest,
  SkillListValue,
} from './types.ts'
import { createSkillAdmin, installSkillAdmin, listSkillAdmin, removeSkillAdmin, skillAdminRoot } from './skill-admin.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session-addressed `skills` Remote namespace. */
    sessionSkillCatalog: SessionSkillCatalog
  }
}

/** Host service backing `ctx.remote.skills` without activating a cold Agent. */
export class SessionSkillCatalog extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'typert']

  /** @param ctx - Host context carrying Session reads and optional skill/preset services. */
  constructor(ctx: Context) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
  }

  /**
   * List the user-invocable skills visible to one Session composition.
   * @param request - Session identity whose cwd and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
   * @returns user-invocable skill metadata without loading skill bodies.
   * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    void signal
    const { sessionId } = request
    let cwd: string | undefined
    let agentPreset: string | undefined
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      cwd = observation.header.cwd
      agentPreset = observation.projections.values.agentPreset ?? undefined
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `session "${sessionId}" could not be inspected: ${String(error)}`,
        {},
      )
    }
    if (cwd === undefined) {
      throw new RemoteError('gateway/internal', `session "${sessionId}" has no project cwd`, {})
    }

    const live = this.ctx.agents.get(sessionId)
    const presets = this.ctx.get('agentPresets')
    const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
    const skillRegistry = scoped ?? this.ctx.get('skills')
    if (skillRegistry === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill',
        {},
      )
    }

    const scope = await this.scopeFor(sessionId, agentPreset)
    try {
      const skills = (await skillRegistry.list({ cwd, scope })).filter(isUserInvocable)
      return {
        skills: skills.map(skill => ({
          name: skill.name,
          description: skill.description,
          ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
          modelInvocable: skill.invocation.modelInvocable,
        })),
      }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {})
    }
  }

  /** Resolve a live or standing preset scope without creating an Agent. */
  private async scopeFor(
    sessionId: SessionId,
    agentPreset: string | undefined,
  ): Promise<ScopeKey | undefined> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.standingKeyFor(agentPreset)
    } catch {
      // An unknown or unusable recorded preset falls back to the global registry.
      return undefined
    }
  }

  // ── skills admin ──────────────────────────────────────────────────────────
  // The `<dshHome>/skills` root CRUD behind the settings tab. The filesystem
  // provider watches these roots, so writes take effect without restart. The
  // admin surfaces a raw listing (including entries the engine would ignore)
  // while `list` above stays the model-facing view.
  //
  // The home comes from $DSH_HOME directly: the canonical resolver lives in
  // @deepseek-ai/dsh-home-paths, and importing it here would add a peer +
  // lockfile delta to an upstream package. Every supervised engine (the shell
  // launcher) exports DSH_HOME; headless contexts without it degrade with an
  // explicit error instead of guessing a fallback.

  /** The admin root, or the failure callers see when no supervised home exists. */
  private adminRoot(): string {
    const home = process.env.DSH_HOME
    if (home === undefined || home.trim().length === 0) {
      throw new RemoteError('skills-admin/unavailable', 'no supervised DSH_HOME is set', {})
    }
    return skillAdminRoot(home)
  }

  /** List administrable skill directories under `<dshHome>/skills`. */
  @Remote('adminList')
  async adminList(signal: AbortSignal): Promise<SkillAdminListValue> {
    void signal
    return listSkillAdmin(this.adminRoot())
  }

  /** Create one skill directory with a minimal SKILL.md skeleton. */
  @Remote('adminCreate')
  async adminCreate(request: SkillAdminCreateRequest, signal: AbortSignal): Promise<SkillAdminOk> {
    void signal
    return createSkillAdmin(this.adminRoot(), request)
  }

  /** Remove one skill directory; the whole directory goes. */
  @Remote('adminRemove')
  async adminRemove(request: SkillAdminRemoveRequest, signal: AbortSignal): Promise<SkillAdminOk> {
    void signal
    return removeSkillAdmin(this.adminRoot(), request)
  }

  /** Install one skill by copying a picked SKILL.md layer into the skills root. */
  @Remote('adminInstall')
  async adminInstall(request: SkillAdminInstallRequest, signal: AbortSignal): Promise<SkillAdminOk> {
    void signal
    return installSkillAdmin(this.adminRoot(), request)
  }
}

export default SessionSkillCatalog
