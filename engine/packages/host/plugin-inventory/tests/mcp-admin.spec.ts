/**
 * The MCP store and its patch block. The two formats are a contract with files
 * users already have (written by the shell implementation this replaces), so
 * they are pinned byte-for-byte — and the secret values must never reach the
 * patch, which is the reason the store exists at all.
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import {
  adoptLegacyMcpStore, composeMcpPatch, loadMcpStore, mcpConfigured, mcpEnvironment,
  mcpEnvName, mcpRowId, saveMcpStore, validateMcpServers,
} from '../src/mcp-admin.ts'
import type { McpServerRow } from '../src/types.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-admin-'))
  dirs.push(dir)
  return dir
}

function stdio(name: string, env: readonly string[] = [], enabled = true): McpServerRow {
  return {
    rowId: mcpRowId(name), name, transport: 'stdio', command: 'npx',
    args: ['-y', '@x/y'], url: '', env, headers: [], enabled,
  }
}

describe('mcp patch block', () => {
  it('writes an insert row whose secret values are environment references only', () => {
    const text = composeMcpPatch('', [stdio('github', ['GITHUB_TOKEN'])])
    expect(text).toContain('- insert:')
    expect(text).toContain('- id: "mcp-github"')
    expect(text).toContain('name: "@deepseek-ai/dsh-mcp-client"')
    expect(text).toContain('disabled: false')
    expect(text).toContain('serverName: "github"')
    expect(text).toContain('GITHUB_TOKEN: !!js process.env.MCP_GITHUB_GITHUB_TOKEN')
  })

  it('uses the streamable-http keys for the http transport', () => {
    const server: McpServerRow = {
      rowId: 'mcp-web', name: 'web', transport: 'streamable-http', command: '', args: [],
      url: 'https://x/mcp', env: [], headers: ['Authorization'], enabled: true,
    }
    const text = composeMcpPatch('', [server])
    expect(text).toContain('transport: "streamable-http"')
    expect(text).toContain('url: "https://x/mcp"')
    expect(text).toContain('Authorization: !!js process.env.MCP_WEB_Authorization')
    expect(text).not.toContain('command:')
  })

  it('an empty table removes the block and keeps everything outside it verbatim', () => {
    const foreign = '- id: my-own\n  config:\n    port: 1\n'
    const once = composeMcpPatch(foreign, [stdio('a')])
    expect(composeMcpPatch(once, [])).toBe('- id: my-own\n  config:\n    port: 1')
  })

  it('leaves the plugin-switch block alone (two managed blocks in one file)', () => {
    const switches = [
      '# >>> DeepDive managed — plugin switches (do not edit) >>>',
      '- id: "hmr"',
      '  disabled: true',
      '# <<< DeepDive managed <<<',
    ].join('\n')
    const both = composeMcpPatch(switches, [stdio('alpha')])
    expect(both).toContain(switches)
    expect(both).toContain('mcp-alpha')
  })
})

describe('mcp store', () => {
  it('round-trips servers and secrets with 0600 permissions', () => {
    const dir = tempDir()
    const file = join(dir, 'mcp-servers.json')
    const patch = join(dir, 'cordis.patch.yml')
    const saved = saveMcpStore(file, patch, {
      servers: [stdio('github', ['GITHUB_TOKEN'])],
      secrets: { github: { GITHUB_TOKEN: 'ghp_secret' } },
    })
    expect(saved.secrets.github?.GITHUB_TOKEN).toBe('ghp_secret')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    // The secret never reaches the patch file.
    expect(readFileSync(patch, 'utf8')).not.toContain('ghp_secret')
    expect(loadMcpStore(file).servers).toHaveLength(1)
  })

  it('merges typed secrets over stored ones and forgets keys no longer referenced', () => {
    const dir = tempDir()
    const file = join(dir, 'mcp-servers.json')
    const patch = join(dir, 'cordis.patch.yml')
    saveMcpStore(file, patch, {
      servers: [stdio('s', ['A', 'B'])],
      secrets: { s: { A: 'one', B: 'two' } },
    })
    const next = saveMcpStore(file, patch, {
      servers: [stdio('s', ['A'])],
      secrets: { s: {} },
    })
    expect(next.secrets.s).toEqual({ A: 'one' })
    const replaced = saveMcpStore(file, patch, {
      servers: [stdio('s', ['A'])],
      secrets: { s: { A: 'three' } },
    })
    expect(replaced.secrets.s).toEqual({ A: 'three' })
  })

  it('refuses a bad table without writing anything', () => {
    const dir = tempDir()
    const file = join(dir, 'mcp-servers.json')
    const patch = join(dir, 'cordis.patch.yml')
    expect(() => saveMcpStore(file, patch, { servers: [stdio('bad name')], secrets: {} })).toThrow(/letters, digits/)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(patch)).toBe(false)
  })

  it('names environment variables with the server prefix so same-named keys stay apart', () => {
    expect(mcpEnvName('my-server', 'API_KEY')).toBe('MCP_MY_SERVER_API_KEY')
    const env = mcpEnvironment({
      servers: [stdio('a', ['API_KEY']), stdio('b', ['API_KEY'])],
      secrets: { a: { API_KEY: '1' }, b: { API_KEY: '2' } },
    })
    expect(env).toEqual({ MCP_A_API_KEY: '1', MCP_B_API_KEY: '2' })
  })

  it('reports configured key names but never values', () => {
    const configured = mcpConfigured({
      servers: [stdio('a', ['TOKEN'])],
      secrets: { a: { TOKEN: 'secret' } },
    })
    expect(configured).toEqual({ a: ['TOKEN'] })
    expect(JSON.stringify(configured)).not.toContain('secret')
  })

  it('adopts the shell\'s store file once when this home has none', () => {
    const base = tempDir()
    const home = join(base, 'harness')
    const legacy = join(base, 'mcp-servers.json')
    writeFileSync(legacy, JSON.stringify({ servers: [stdio('old')], secrets: {} }))
    const file = join(home, 'mcp-servers.json')
    adoptLegacyMcpStore(file, home)
    expect(existsSync(file)).toBe(true)
    expect(loadMcpStore(file).servers[0]?.name).toBe('old')
    // An existing store is never overwritten by the legacy one.
    writeFileSync(file, JSON.stringify({ servers: [stdio('mine')], secrets: {} }))
    adoptLegacyMcpStore(file, home)
    expect(loadMcpStore(file).servers[0]?.name).toBe('mine')
  })
})

describe('mcp validation', () => {
  it('accepts the engine\'s serverName shape and refuses everything else', () => {
    expect(validateMcpServers([stdio('ok-1_A')])).toBeUndefined()
    expect(validateMcpServers([stdio('')])).toMatch(/must not be empty/)
    expect(validateMcpServers([stdio('a'.repeat(33))])).toMatch(/longer than 32/)
    expect(validateMcpServers([stdio('bad.name')])).toMatch(/letters, digits/)
    expect(validateMcpServers([stdio('dup'), stdio('dup')])).toMatch(/duplicate/)
    expect(validateMcpServers([{ ...stdio('x'), command: '' }])).toMatch(/stdio transport needs a command/)
    expect(validateMcpServers([{ ...stdio('x'), transport: 'streamable-http', command: '' }]))
      .toMatch(/http transport needs a URL/)
  })
})
