/**
 * MCP server rows in the home patch's managed block, behind the
 * `pluginInventory/mcp*` Remote methods.
 *
 * Ported from the shell's McpServerAdmin (the implementation this replaces) with
 * its two formats pinned byte-for-byte: the store file (config + secrets in ONE
 * 0600 document) and the patch block (`- insert:` rows naming
 * `@deepseek-ai/dsh-mcp-client`, secret values referenced as
 * `!!js process.env.MCP_<SERVER>_<KEY>`).
 *
 * Why the config source is our own JSON rather than the patch file: the row's
 * `env`/`headers` values must be `!!js` expressions, which a "read and edit the
 * patch" design cannot represent. Why secrets never reach the patch: the only
 * value shape the mcp-client accepts is an engine-process environment variable,
 * so the values live in the 0600 store and the engine exports them into its own
 * `process.env` at activation — before the MCP rows activate (they come from the
 * home layer, which applies after this package's bundle layer).
 *
 * @module mcp-admin
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { McpServerRow, McpStore } from './types.ts'
import { replaceBlock, yamlString, type ManagedMarker } from './patch-admin.ts'

/** The MCP rows' block (shared file: the plugin switches own another pair). */
export const MCP_PATCH_MARKER: ManagedMarker = {
  begin: '# >>> DeepDive managed — MCP servers (do not edit) >>>',
  end: '# <<< DeepDive managed <<<',
}

/** The plugin every server row mounts. */
export const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'

/** Environment-variable prefix for one server's secret: `MCP_<SERVER>_<KEY>`. */
export const MCP_ENV_PREFIX = 'MCP_'

/** The engine's own store: config plus secrets in one 0600 document. */
export function mcpStoreFile(dshHome: string): string {
  return join(dshHome, 'mcp-servers.json')
}

/** Row id for one server: `mcp-<name>` (the switch ledger's target). */
export function mcpRowId(name: string): string {
  return `mcp-${name}`
}

/** `MCP_<SERVER>_<KEY>`; the server prefix keeps two servers' same-named keys apart. */
export function mcpEnvName(server: string, key: string): string {
  return `${MCP_ENV_PREFIX}${server.toUpperCase().replace(/-/g, '_')}_${key}`
}

/** An empty store, for a first run or an unreadable document. */
export function emptyMcpStore(): McpStore {
  return { servers: [], secrets: {} }
}

/**
 * Read the store. A missing or unparsable document reads as empty — a broken
 * MCP configuration must not take the engine down with it (the same fail-soft
 * the shell implementation had).
 */
export function loadMcpStore(file: string): McpStore {
  if (!existsSync(file)) return emptyMcpStore()
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return emptyMcpStore()
    const record = parsed as { servers?: unknown; secrets?: unknown }
    return {
      servers: Array.isArray(record.servers) ? record.servers as McpServerRow[] : [],
      secrets: typeof record.secrets === 'object' && record.secrets !== null
        ? record.secrets as McpStore['secrets']
        : {},
    }
  } catch {
    return emptyMcpStore()
  }
}

/**
 * Adopt the shell's store file if this home has none yet. The shell kept it one
 * level above the harness home (`<support>/mcp-servers.json`); the engine now
 * owns it inside its own home. Copying once keeps an existing user's servers and
 * secrets across the migration.
 * @param file - the engine's store path.
 * @param dshHome - the harness home (the legacy file is its parent's sibling).
 */
export function adoptLegacyMcpStore(file: string, dshHome: string): void {
  if (existsSync(file)) return
  const legacy = join(dirname(dshHome), 'mcp-servers.json')
  if (!existsSync(legacy)) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    copyFileSync(legacy, file)
    chmodSync(file, 0o600)
  } catch {
    // Leaving the legacy file in place is the safe outcome: the user's servers
    // stay where they were and the settings page starts empty, which is visible.
  }
}

/** Validate one server table; returns the first refusal, or undefined. */
export function validateMcpServers(servers: readonly McpServerRow[]): string | undefined {
  const seen = new Set<string>()
  for (const server of servers) {
    const name = server.name.trim()
    if (name.length === 0) return 'server name must not be empty'
    if (name.length > 32) return 'server name is longer than 32 characters'
    // The engine's serverName shape is [A-Za-z0-9_-]{1,32}; anything else is refused there.
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return `server name may only use letters, digits, hyphen and underscore: ${name}`
    }
    if (seen.has(name)) return `duplicate server name: ${name}`
    seen.add(name)
    if (server.transport === 'streamable-http') {
      if (server.url.trim().length === 0) return `${name}: the http transport needs a URL`
    } else if (server.command.trim().length === 0) {
      return `${name}: the stdio transport needs a command`
    }
  }
  return undefined
}

/** The secret key names configured for each server (never the values). */
export function mcpConfigured(store: McpStore): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const server of store.servers) {
    const keys = Object.keys(store.secrets[server.name] ?? {})
    if (keys.length > 0) out[server.name] = keys.sort()
  }
  return out
}

/**
 * The environment the MCP rows read their secrets from: `MCP_<SERVER>_<KEY>`.
 * Both `env` (stdio) and `headers` (streamable-http) resolve this way — the
 * request-header value is an environment variable too, per the mounting shape.
 */
export function mcpEnvironment(store: McpStore): Record<string, string> {
  const out: Record<string, string> = {}
  for (const server of store.servers) {
    const secrets = store.secrets[server.name] ?? {}
    for (const key of [...server.env, ...server.headers]) {
      const value = secrets[key]
      if (value !== undefined) out[mcpEnvName(server.name, key)] = value
    }
  }
  return out
}

/** servers → the managed block body (empty table removes the block). */
export function composeMcpPatch(existing: string, servers: readonly McpServerRow[]): string {
  if (servers.length === 0) return replaceBlock(existing, MCP_PATCH_MARKER, [])
  const body = ['- insert:']
  for (const server of servers) {
    body.push(`    - id: ${yamlString(mcpRowId(server.name))}`)
    body.push(`      name: ${yamlString(MCP_PLUGIN_NAME)}`)
    body.push(`      disabled: ${server.enabled ? 'false' : 'true'}`)
    body.push('      config:')
    body.push(`        serverName: ${yamlString(server.name)}`)
    body.push(`        transport: ${yamlString(server.transport)}`)
    if (server.transport === 'streamable-http') {
      body.push(`        url: ${yamlString(server.url)}`)
      body.push(...secretLines(server.headers, server.name, 'headers'))
    } else {
      body.push(`        command: ${yamlString(server.command)}`)
      if (server.args.length > 0) {
        body.push(`        args: [${server.args.map(yamlString).join(', ')}]`)
      }
      body.push(...secretLines(server.env, server.name, 'env'))
    }
  }
  return replaceBlock(existing, MCP_PATCH_MARKER, body)
}

/** Secret reference lines: the value is `!!js process.env.<name>`. */
function secretLines(keys: readonly string[], server: string, key: string): string[] {
  if (keys.length === 0) return []
  return [`        ${key}:`, ...keys.map(k => `          ${k}: !!js process.env.${mcpEnvName(server, k)}`)]
}

/**
 * Save the store (0600, atomic) and rewrite the patch block.
 *
 * Secret merge, mirroring the shell: a key the caller supplied a value for
 * overwrites, a key still referenced by `env`/`headers` keeps its stored value,
 * and a key no longer referenced is dropped — so removing a variable from the
 * form also forgets its secret.
 * @param file - the store path.
 * @param patchFile - the home patch path.
 * @param incoming - servers and the secrets the caller typed this round.
 * @returns the saved store.
 * @throws {RemoteError} `mcp/invalid` when a server table is refused.
 */
export function saveMcpStore(file: string, patchFile: string, incoming: {
  readonly servers: readonly McpServerRow[]
  readonly secrets: Readonly<Record<string, Readonly<Record<string, string>>>>
}): McpStore {
  const refused = validateMcpServers(incoming.servers)
  if (refused !== undefined) throw new RemoteError('mcp/invalid', refused, { reason: refused })

  const previous = loadMcpStore(file)
  const secrets: Record<string, Record<string, string>> = {}
  for (const server of incoming.servers) {
    const kept: Record<string, string> = {}
    for (const key of [...server.env, ...server.headers]) {
      const typed = incoming.secrets[server.name]?.[key]
      const stored = previous.secrets[server.name]?.[key]
      if (typed !== undefined && typed.length > 0) kept[key] = typed
      else if (stored !== undefined) kept[key] = stored
    }
    if (Object.keys(kept).length > 0) secrets[server.name] = kept
  }
  const store: McpStore = { servers: [...incoming.servers], secrets }
  writeMcpStore(file, store)
  writeMcpPatch(patchFile, store.servers)
  return store
}

/** Write the store atomically with 0600 (it carries secret values). */
export function writeMcpStore(file: string, store: McpStore): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, file)
    chmodSync(file, 0o600)
  } catch (error) {
    throw new RemoteError('gateway/internal', `MCP store could not be written: ${String(error)}`, {})
  }
}

/** Rewrite the patch block (the engine's live watcher reloads it). */
export function writeMcpPatch(patchFile: string, servers: readonly McpServerRow[]): void {
  let existing = ''
  try {
    if (existsSync(patchFile)) existing = readFileSync(patchFile, 'utf8')
  } catch (error) {
    throw new RemoteError('gateway/internal', `the home patch could not be read: ${String(error)}`, {})
  }
  const text = composeMcpPatch(existing, servers)
  try {
    const tmp = join(dirname(patchFile), `.${basename(patchFile)}.${process.pid}.${Date.now()}.tmp`)
    writeFileSync(tmp, text)
    renameSync(tmp, patchFile)
  } catch (error) {
    throw new RemoteError('gateway/internal', `the home patch could not be written: ${String(error)}`, {})
  }
}
