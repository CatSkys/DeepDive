/**
 * DeepDive's own engine host plugins.
 *
 * This package exists because the app must not depend on the official client's
 * host halves for behaviour it owns: each one is a browser bundle we never load
 * plus a few lines of host registration, and the registration is the only part
 * we need (`docs/PLAN-NATIVE-ENGINE.md §3.5`).
 *
 * Two contributions so far, both about state the shell used to own:
 *   · the conversation settings namespace the SPA reads (was `ui-conversation`),
 *   · the published skills, as runtime registrations (were files the shell wrote
 *     into `<DSH_HOME>/skills` on every launch).
 *
 * Registration discipline copied from the upstream halves: contribute only when
 * the owning service is composed, never invent a default for a missing host
 * service.
 *
 * @module @deepdive/engine-host
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import { CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema } from './conversation-settings.ts'
import { PUBLISHED_SKILLS, RETIRED_SKILL_NAMES } from './published-skills.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, ConversationSettingsSchema,
  type BusyEnterBehavior, type ConversationSettings,
} from './conversation-settings.ts'
export { PUBLISHED_SKILLS, RETIRED_SKILL_NAMES } from './published-skills.ts'

/**
 * Register DeepDive's own contributions.
 * @param ctx - Host context carrying the optional settings and skills services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      CONVERSATION_SETTINGS_NAMESPACE,
      ConversationSettingsSchema,
    )
  })
  ctx.inject(['skills'], (skillsCtx) => {
    for (const skill of PUBLISHED_SKILLS) {
      skillsCtx.effect(() => skillsCtx.skills.register(skill), `deepdive-host: skill ${skill.name}`)
    }
  })
  dropRetiredSkills()
}

/**
 * Delete the skill *directories* earlier DeepDive versions wrote into the user
 * skills root. The filesystem provider discovers everything under that root, so
 * a leftover directory keeps teaching the model a protocol nothing consumes.
 *
 * Kept here rather than in the shell because it is the same decision as
 * publishing (which skills this engine owns), and it reads `$DSH_HOME` directly
 * for the same reason `skills/admin*` does: importing the canonical resolver
 * would add a peer + lockfile delta to an upstream package. An unsupervised
 * engine (no `$DSH_HOME`) skips it — nothing was ever written for it to clean.
 */
function dropRetiredSkills(): void {
  const home = process.env.DSH_HOME
  if (home === undefined || home.trim().length === 0) return
  for (const name of RETIRED_SKILL_NAMES) {
    const directory = join(home, 'skills', name)
    if (!existsSync(directory)) continue
    try {
      rmSync(directory, { recursive: true })
    } catch (error: unknown) {
      // A directory we cannot remove is left for the next launch; failing the
      // whole plugin (and with it the engine) over a stale skill is worse.
      console.warn(`deepdive-host: retired skill "${name}" could not be removed: ${String(error)}`)
    }
  }
}
