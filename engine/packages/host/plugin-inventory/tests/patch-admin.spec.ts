/** Plugin-patch ledger semantics pinned from the shell's ManagedPatchBlock. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  composePluginPatch,
  parsePluginPatch,
  readPluginPatch,
  writePluginPatch,
} from '../src/patch-admin.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

const files: string[] = []

afterEach(() => {
  for (const file of files.splice(0)) rmSync(file, { force: true })
})

function tempFile(initial?: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'patch-admin-')), 'cordis.patch.yml')
  files.push(file)
  if (initial !== undefined) writeFileSync(file, initial)
  return file
}

/** The exact bytes the shell's PluginPatchAdmin writes (existing homes carry this). */
const SHELL_BLOCK = `# user's own layer, preserved verbatim
# >>> DeepDive managed — plugin switches (do not edit) >>>
- id: "everos-memory"
  disabled: true
- id: "import-claude"
  disabled: false
# <<< DeepDive managed <<<
`

describe('parsePluginPatch', () => {
  it('reads the shell-written block and ignores outside content', () => {
    expect(parsePluginPatch(SHELL_BLOCK)).toEqual([
      { rowId: 'everos-memory', disabled: true },
      { rowId: 'import-claude', disabled: false },
    ])
    expect(parsePluginPatch('no block here')).toEqual([])
  })
})

describe('composePluginPatch', () => {
  it('rewrites the block in place, sorted, preserving outside content byte for byte', () => {
    const next = composePluginPatch(SHELL_BLOCK, [
      { rowId: 'import-claude', disabled: true },
      { rowId: 'hmr', disabled: false },
    ])
    expect(next).toBe(`# user's own layer, preserved verbatim
# >>> DeepDive managed — plugin switches (do not edit) >>>
- id: "hmr"
  disabled: false
- id: "import-claude"
  disabled: true
# <<< DeepDive managed <<<`)
  })

  it('removes the block when the ledger empties, and creates one in an empty file', () => {
    expect(composePluginPatch(SHELL_BLOCK, [])).toBe(`# user's own layer, preserved verbatim`)
    const created = composePluginPatch('', [{ rowId: 'hmr', disabled: true }])
    expect(created.split('\n')[0]).toBe('# >>> DeepDive managed — plugin switches (do not edit) >>>')
  })
})

describe('readPluginPatch / writePluginPatch', () => {
  it('round-trips an upsert through the shell format and a missing file reads empty', () => {
    expect(readPluginPatch(join(tmpdir(), 'patch-admin-no-such-file.yml'))).toEqual({ toggles: [] })

    const file = tempFile(SHELL_BLOCK)
    expect(writePluginPatch(file, { rowId: 'everos-memory', disabled: false })).toEqual({ ok: true })
    expect(readPluginPatch(file)).toEqual({
      toggles: [
        { rowId: 'everos-memory', disabled: false },
        { rowId: 'import-claude', disabled: false },
      ],
    })
    // The on-disk shape stays the shell's: quoted id, explicit false, sorted.
    expect(readFileSync(file, 'utf8')).toContain('- id: "everos-memory"\n  disabled: false')
  })

  it('rejects malformed row ids without touching the file', () => {
    const file = tempFile(SHELL_BLOCK)
    const before = readFileSync(file, 'utf8')
    const run = (): unknown => writePluginPatch(file, { rowId: 'two\nlines', disabled: true })
    expect(run).toThrow(RemoteError)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
