/** Read the current Cordis Loader plugin entries and carry the switch ledger. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  McpListValue,
  McpSaveOk,
  McpSaveRequest,
  PluginPatchListValue,
  PluginPatchSetOk,
  PluginPatchSetRequest,
} from './types.ts'
import { pluginPatchFile, readPluginPatch, unavailable, writePluginPatch } from './patch-admin.ts'
import {
  adoptLegacyMcpStore, loadMcpStore, mcpConfigured, mcpEnvironment, mcpStoreFile,
  saveMcpStore,
} from './mcp-admin.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    this.seedMcpEnvironment()
  }

  /**
   * Export the configured MCP secrets into this process's environment.
   *
   * The mcp-client's mounting shape takes an environment-variable reference
   * (`env: {TOKEN: !!js process.env.MCP_<SERVER>_<KEY>}`), and only the engine
   * can set its own environment — so the engine does it here, at activation.
   * This package's row is a bundle row, which the tree activates before the home
   * layer that carries the MCP rows, so the references resolve.
   *
   * A missing or unsupervised `$DSH_HOME` seeds nothing: there is no store to
   * read, and the MCP rows (if any exist) then simply have no secret to resolve.
   */
  private seedMcpEnvironment(): void {
    const home = process.env.DSH_HOME
    if (home === undefined || home.trim().length === 0) return
    const file = mcpStoreFile(home)
    adoptLegacyMcpStore(file, home)
    for (const [name, value] of Object.entries(mcpEnvironment(loadMcpStore(file)))) {
      process.env[name] = value
    }
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with per-preset
   * compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { entries }
    const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
      composition => ({
        ...composition,
        rows: composition.rows.map(({ fiberState, ...row }) => ({
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
        })),
      }),
    )
    return { entries, agentPresets }
  }

  // ── plugin switch ledger ──────────────────────────────────────────────────
  // The home patch's managed block is the user preference layer the live
  // watcher reloads; these methods replace the shell's PluginPatchAdmin.
  // The home comes from $DSH_HOME directly (the canonical resolver lives in
  // @deepseek-ai/dsh-home-paths; importing it here would add a peer + lockfile
  // delta to an upstream package). Supervised engines always export it.

  /** The switch ledger file, or the failure when no supervised home exists. */
  private patchFile(): string {
    const home = process.env.DSH_HOME
    if (home === undefined || home.trim().length === 0) throw unavailable()
    return pluginPatchFile(home)
  }

  /** Current user plugin switches (the managed block's ledger). */
  @Remote('patchList')
  async patchList(signal: AbortSignal): Promise<PluginPatchListValue> {
    void signal
    return readPluginPatch(this.patchFile())
  }

  // ── MCP servers ────────────────────────────────────────────────────────────
  // The store (config + secrets, 0600) and the patch block it generates both
  // live in the engine now; the shell only renders the settings page. Secrets
  // never leave here — `mcpList` returns key names, and the rows the engine
  // writes reference values as `!!js process.env.MCP_<SERVER>_<KEY>`, which the
  // engine exports into its own environment at activation (see the constructor).

  /** The MCP store path, or the failure when no supervised home exists. */
  private mcpFile(): string {
    const home = process.env.DSH_HOME
    if (home === undefined || home.trim().length === 0) throw unavailable()
    return mcpStoreFile(home)
  }

  /** Configured MCP servers plus which secret keys each one has (never values). */
  @Remote('mcpList')
  async mcpList(signal: AbortSignal): Promise<McpListValue> {
    void signal
    const store = loadMcpStore(this.mcpFile())
    return { servers: store.servers, configured: mcpConfigured(store) }
  }

  /** Replace the whole MCP table (add/edit/remove all go through it). */
  @Remote('mcpSave')
  async mcpSave(request: McpSaveRequest, signal: AbortSignal): Promise<McpSaveOk> {
    void signal
    const home = process.env.DSH_HOME
    if (home === undefined || home.trim().length === 0) throw unavailable()
    saveMcpStore(mcpStoreFile(home), pluginPatchFile(home), request)
    return { ok: true }
  }

  /**
   * Upsert one user switch. `disabled: false` is recorded explicitly so
   * bundle-default-disabled rows can be re-enabled; the write hot-reloads
   * through the engine's live patch watcher without a restart.
   */
  @Remote('patchSet')
  async patchSet(request: PluginPatchSetRequest, signal: AbortSignal): Promise<PluginPatchSetOk> {
    void signal
    return writePluginPatch(this.patchFile(), request)
  }
}

export default PluginInventoryGateway
