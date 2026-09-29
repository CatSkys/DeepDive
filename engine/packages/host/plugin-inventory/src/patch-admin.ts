/**
 * Plugin-switch ledger in the home patch's managed block, behind the
 * `pluginInventory/patch*` Remote methods.
 *
 * The block format is pinned to the shell's ManagedPatchBlock (the
 * implementation this replaces) BYTE FOR BYTE: marker lines, JSON-style
 * quoted scalars, sorted `- id:`/`disabled:` pairs, and verbatim preservation
 * of everything outside the markers — existing homes written by the shell are
 * taken over as-is. The engine's live patch watcher (`patchReload: live`)
 * observes the file no matter who writes it.
 *
 * @module patch-admin
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginPatchListValue, PluginPatchSetOk, PluginPatchSetRequest, PluginPatchToggle } from './types.ts'

/** One managed block inside the home patch file. */
export interface ManagedMarker {
  readonly begin: string
  readonly end: string
}

/** The plugin-switch block's markers (shared file: MCP rows own another pair). */
export const PLUGIN_PATCH_MARKER: ManagedMarker = {
  begin: '# >>> DeepDive managed — plugin switches (do not edit) >>>',
  end: '# <<< DeepDive managed <<<',
}

/** The failure callers see when no supervised home exists ($DSH_HOME unset). */
export const unavailable = (): RemoteError =>
  new RemoteError('plugin-patch/unavailable', 'no supervised DSH_HOME is set', {})

/** The home patch path: the engine's live-watched user preference layer. */
export function pluginPatchFile(dshHome: string): string {
  return join(dshHome, 'cordis.patch.yml')
}

/** Block-inner lines (markers excluded); empty without a block or half a marker. */
export function linesOf(text: string, marker: ManagedMarker): string[] {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  const begin = all.indexOf(marker.begin)
  if (begin === -1) return []
  const end = all.indexOf(marker.end, begin)
  if (end === -1) return []
  return all.slice(begin + 1, end)
}

/** Remove the block (with one adjacent blank line), keeping everything else. */
export function stripBlock(text: string, marker: ManagedMarker): string {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  const begin = all.indexOf(marker.begin)
  if (begin === -1) return all.join('\n')
  const end = all.indexOf(marker.end, begin)
  if (end === -1) return all.slice(0, begin).join('\n')
  return [...all.slice(0, begin), ...all.slice(end + 1)].join('\n')
}

/** Replace the block body; an empty body removes the block. Shared by both managed blocks. */
export function replaceBlock(text: string, marker: ManagedMarker, body: string[]): string {
  let kept = stripBlock(text, marker)
  while (kept.endsWith('\n\n')) kept = kept.slice(0, -1)
  if (body.length === 0) return kept.trim()
  const block = [marker.begin, ...body, marker.end].join('\n')
  if (kept.trim().length === 0) return block
  return kept.endsWith('\n') ? kept + block : `${kept}\n${block}`
}

/** YAML scalar after `key`, paired double quotes stripped; null when unmatched. */
export function scalar(line: string, key: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(key)) return null
  let value = trimmed.slice(key.length).trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
  return value
}

/** JSON string literal as a YAML double-quoted scalar; JS never escapes `/`. */
export function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** Parse the managed block's `- id:` / `disabled:` pairs; outside content is ignored. */
export function parsePluginPatch(text: string, marker: ManagedMarker = PLUGIN_PATCH_MARKER): PluginPatchToggle[] {
  const out: PluginPatchToggle[] = []
  let pending: string | null = null
  for (const line of linesOf(text, marker)) {
    const id = scalar(line, '- id:')
    if (id !== null) {
      pending = id
      continue
    }
    const flag = scalar(line, 'disabled:')
    if (flag !== null && pending !== null) {
      out.push({ rowId: pending, disabled: flag === 'true' })
      pending = null
    }
  }
  return out.sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0))
}

/** Existing text + toggle table → new text (stable, sorted, human-diffable). */
export function composePluginPatch(
  existing: string,
  toggles: PluginPatchToggle[],
  marker: ManagedMarker = PLUGIN_PATCH_MARKER,
): string {
  const body = [...toggles]
    .sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0))
    .flatMap(toggle => [`- id: ${yamlString(toggle.rowId)}`, `  disabled: ${toggle.disabled ? 'true' : 'false'}`])
  return replaceBlock(existing, marker, body)
}

/** Current managed entries; a missing file reads as no ledger. */
export function readPluginPatch(file: string): PluginPatchListValue {
  if (!existsSync(file)) return { toggles: [] }
  try {
    return { toggles: parsePluginPatch(readFileSync(file, 'utf8')) }
  } catch (error: unknown) {
    throw new RemoteError('gateway/internal', `plugin patch could not be read: ${String(error)}`, {})
  }
}

/** Upsert one toggle and atomically rewrite the file (same-directory rename). */
export function writePluginPatch(file: string, request: PluginPatchSetRequest): PluginPatchSetOk {
  const rowId = request.rowId.trim()
  if (rowId.length === 0 || /[\r\n]/.test(rowId)) {
    throw new RemoteError('plugin-patch/invalid-row', 'row id must be a single non-empty line', { rowId: request.rowId })
  }
  let existing = ''
  try {
    if (existsSync(file)) existing = readFileSync(file, 'utf8')
  } catch (error: unknown) {
    throw new RemoteError('gateway/internal', `plugin patch could not be read: ${String(error)}`, {})
  }
  const next = parsePluginPatch(existing).filter(toggle => toggle.rowId !== rowId)
  next.push({ rowId, disabled: request.disabled })
  const text = composePluginPatch(existing, next)
  try {
    const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`)
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch (error: unknown) {
    throw new RemoteError('gateway/internal', `plugin patch could not be written: ${String(error)}`, {})
  }
  return { ok: true }
}
