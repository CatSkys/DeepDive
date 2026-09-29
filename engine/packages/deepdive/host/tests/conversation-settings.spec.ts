/** The conversation section's shape: the SPA validates against this envelope. */

import { describe, expect, it } from 'vitest'
import {
  BUSY_ENTER_BEHAVIORS, CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema,
  DEFAULT_BUSY_ENTER_BEHAVIOR, type ConversationSettings,
} from '../src/conversation-settings.ts'

/** A stored document is untrusted JSON, so the schema is exercised untyped. */
const parse = (raw: unknown): ConversationSettings => ConversationSettingsSchema(raw as ConversationSettings)

describe('conversation settings section', () => {
  it('defaults to Enter-as-Queue and accepts only the two behaviours', () => {
    expect(CONVERSATION_SETTINGS_NAMESPACE).toBe('conversation')
    expect(DEFAULT_BUSY_ENTER_BEHAVIOR).toBe('queue')
    expect(BUSY_ENTER_BEHAVIORS).toEqual(['queue', 'steer'])
    expect(parse({})).toEqual({ busyEnter: 'queue' })
    expect(parse({ busyEnter: 'steer' })).toEqual({ busyEnter: 'steer' })
  })

  it('refuses a value outside the union instead of coercing it', () => {
    expect(() => parse({ busyEnter: 'later' })).toThrow()
  })
})
