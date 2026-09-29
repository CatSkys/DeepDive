import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Effective enablement of one preset composition row. */
export type PresetPluginEnablement = boolean | 'conditional'

/** One plugin row an agent preset's composition names. */
export interface AgentPresetPluginRow {
  /** Composition row id, or null when the row declares none. */
  readonly entryId: string | null
  /** Module specifier the row names. */
  readonly moduleName: string
  /**
   * Effective enablement, including disabled ancestor groups. `'conditional'`
   * marks a `!!js` disabled expression on a composition no session has
   * mounted, which only a Loader context can decide.
   */
  readonly enabled: PresetPluginEnablement
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition?: string
  /** Root-fiber phase when the composition is live; null otherwise. */
  readonly fiberPhase: PluginFiberPhase
}

/** One agent preset's identity and flattened composition in the inventory. */
export interface AgentPresetPluginGroup {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Display name the preset published; a reader falls back to the id. */
  readonly name?: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Why this preset's composition cannot be read; absent when rows answer. */
  readonly broken?: string
  /** Plugin rows in composition order; empty when the preset is broken. */
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /**
   * Per-preset compositions, present only when an agent-preset roster is
   * composed in this deployment.
   */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
}

/** One user-set plugin switch in the home patch's managed block. */
export interface PluginPatchToggle {
  /** The composition ROW id (`hmr`), not the inventory entryId (`include:hmr`). */
  readonly rowId: string
  /** `false` is recorded explicitly: bundle-default-disabled rows can only be
   *  re-enabled through this override. */
  readonly disabled: boolean
}

/** The managed plugin-switch block's current entries, sorted by row id. */
export interface PluginPatchListValue {
  readonly toggles: readonly PluginPatchToggle[]
}

export interface PluginPatchSetRequest {
  readonly rowId: string
  readonly disabled: boolean
}

export interface PluginPatchSetOk {
  readonly ok: true
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No supervised `$DSH_HOME` to resolve the home patch from. */
    'plugin-patch/unavailable': {}
    /** The row id cannot be written as one patch line (empty or multi-line). */
    'plugin-patch/invalid-row': { readonly rowId: string }
    /** The MCP server table was refused (name shape, duplicate, missing endpoint). */
    'mcp/invalid': { readonly reason: string }
  }
}

// ── MCP servers (settings → plugins → MCP) ─────────────────────────────────

/** One MCP server row. Secret VALUES are never part of it, so it is safe to send. */
export interface McpServerRow {
  /** Row id (`mcp-<name>`): the switch ledger's patch target. */
  readonly rowId: string
  /** serverName; the model-side tool name is `mcp__<name>__<tool>`. */
  readonly name: string
  /** `stdio` | `streamable-http` (the engine's values, not `http`). */
  readonly transport: string
  readonly command: string
  readonly args: readonly string[]
  readonly url: string
  /** stdio: environment variable NAMES to inject (values live in the secrets). */
  readonly env: readonly string[]
  /** streamable-http: request header NAMES to inject (values live in the secrets). */
  readonly headers: readonly string[]
  readonly enabled: boolean
}

/** The store document: configuration plus secrets, in one 0600 file. */
export interface McpStore {
  readonly servers: readonly McpServerRow[]
  /** serverName → key → value. Never leaves the engine. */
  readonly secrets: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** What the settings page may see: the rows plus which keys are configured. */
export interface McpListValue {
  readonly servers: readonly McpServerRow[]
  /** serverName → configured key NAMES (values are never returned). */
  readonly configured: Readonly<Record<string, readonly string[]>>
}

export interface McpSaveRequest {
  readonly servers: readonly McpServerRow[]
  /** Only the secrets the user typed this round; stored values are merged in. */
  readonly secrets: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface McpSaveOk {
  readonly ok: true
}
