/**
 * The conversation-behaviour section of the host user-settings document.
 *
 * Ownership note: this namespace used to be registered by the official client's
 * `dsh-client-ui-conversation` host half (`ui-conversation`). DeepDive's SPA
 * reads exactly this one value and nothing else from that package, so the
 * registration moved here and the upstream row (and its 4.4 MB browser bundle)
 * left the composition. The namespace is renamed to `conversation` on the way
 * in: an upstream UI package's name is the wrong owner for a setting our app
 * owns, and there are no stored values to migrate.
 *
 * @module conversation-settings
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by DeepDive's engine host. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviours accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Durable conversation section shared by the host schema and the SPA's scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
}

/** Durable conversation schema; also the envelope the SPA validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
})
