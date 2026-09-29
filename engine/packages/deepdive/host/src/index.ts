/**
 * DeepDive's own engine host plugins.
 *
 * This package exists because the app must not depend on the official client's
 * host halves for behaviour it owns: each one is a browser bundle we never load
 * plus a few lines of host registration, and the registration is the only part
 * we need. It registers what the SPA reads, so the upstream rows can leave the
 * composition (`docs/PLAN-NATIVE-ENGINE.md §3.5`).
 *
 * Registration discipline copied from the upstream halves: register only when a
 * settings provider is composed, and never invent a default for a missing host
 * service.
 *
 * @module @deepdive/engine-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema } from './conversation-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, ConversationSettingsSchema,
  type BusyEnterBehavior, type ConversationSettings,
} from './conversation-settings.ts'

/**
 * Register the durable conversation section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      CONVERSATION_SETTINGS_NAMESPACE,
      ConversationSettingsSchema,
    )
  })
}
