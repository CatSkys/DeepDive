export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/* Wire types copied verbatim from the official dsh sources:
   credentials/types, llm/types, api/settings-controller. */

export interface CredentialInfo {
  /** Whether resolving the reference would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether the active provider can write this reference. */
  writable: boolean
}

export interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  name: string
}

export interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[]
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  declared?: boolean
}

export interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}

export interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  provider?: string
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  baseURL?: string
  /** Wire protocol the endpoint speaks, when the draft names one. */
  api?: string
  /** Credential for this interrogation alone; the harness never stores it. */
  apiKey?: string
}

// MISSING SettingsSecretView

// MISSING SettingsPathOpView

// MISSING SettingsNamespaceView


export interface SettingsNamespaceView {
  /** Namespace key (`llm-deepseek`, `llm-pi-ai`, …). */
  ns: string
  /** Serialized schemastery schema envelope (`schema.toJSON()`); rehydrate with `new Schema(json)`. */
  schema: JsonValue
  /** Redacted resolved value (schema defaults → composition base → user layer). */
  value: JsonValue
  /** Redacted composition base layer, when the registrant declared one. */
  base?: JsonValue
  /** Redacted raw user section, when one exists; a field's presence here marks it user-overridden. */
  user?: JsonValue
  /** When the owner applies changes. */
  applies: 'live' | 'restart'
  /** Every schema-declared secret slot with its configured state. */
  secrets: SettingsSecretView[]
  /**
   * Monotonic revision of the raw user section this view was read at. Send it
   * back as `expectedRevision` on a write so a stale editor is refused rather
   * than silently overwriting a concurrent change.
   */
  revision: number
}

export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }

/** Every registered namespace with the deployment facts a configuration page renders around them. */
export interface SettingsDescribeValue {
  /** Whether the provider accepts writes; `false` disables every write control. */
  writable: boolean
  /** Whether a file-backed provider owns a local document, without exposing its Host path. */
  hasDocument: boolean
  /** One view per registered namespace. */
  namespaces: SettingsNamespaceView[]
}

export interface SettingsSecretView {
  /** Path from the section root to the removed field. */
  path: string[]
  /** Whether the slot currently holds a value; the value itself never rides. */
  set: boolean
}
