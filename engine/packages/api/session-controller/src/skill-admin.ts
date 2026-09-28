/**
 * DSH_HOME skills admin behind the `skills/admin*` Remote methods.
 *
 * Semantics pinned by the shell's SkillAdmin (the implementation this
 * replaces): `<dshHome>/skills` holds ONE directory per skill whose
 * `SKILL.md` frontmatter names it for the model. Directories the engine would
 * silently ignore (frontmatter missing `name`/`description`) are listed with
 * their missing keys instead of hidden. Wire failures are stable codes — the
 * SPA renders them in its own words.
 *
 * @module skill-admin
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SkillAdminCreateRequest,
  SkillAdminEntry,
  SkillAdminInstallRequest,
  SkillAdminListValue,
  SkillAdminOk,
  SkillAdminRemoveRequest,
} from './types.ts'

const invalidName = (message: string): RemoteError =>
  new RemoteError('skills-admin/invalid-name', message, {})
const internal = (what: string, error: unknown): RemoteError =>
  new RemoteError('gateway/internal', `${what}: ${String(error)}`, {})

/** The user skills root the filesystem provider discovers at rank 400. */
export function skillAdminRoot(dshHome: string): string {
  return join(dshHome, 'skills')
}

/** List one-level skill directories under the root, sorted by id. */
export function listSkillAdmin(root: string): SkillAdminListValue {
  let ids: string[]
  try {
    ids = existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort()
      : []
  } catch (error: unknown) {
    throw internal('skill listing failed', error)
  }
  const skills: SkillAdminEntry[] = []
  for (const id of ids) {
    const directory = join(root, id)
    const manifest = join(directory, 'SKILL.md')
    let text: string
    try {
      text = readFileSync(manifest, 'utf8')
    } catch {
      continue
    }
    const head = skillFrontmatter(text)
    const title = head['name'] ?? ''
    const detail = head['description'] ?? ''
    const missing = [
      ...(title.trim().length === 0 ? ['name'] : []),
      ...(detail.trim().length === 0 ? ['description'] : []),
    ]
    skills.push({
      id,
      title: title.trim().length === 0 ? id : title,
      detail,
      manifest,
      directory,
      missing,
    })
  }
  return { skills }
}

/** Create `<root>/<name>/SKILL.md` with a minimal skeleton; the user writes the body. */
export function createSkillAdmin(root: string, request: SkillAdminCreateRequest): SkillAdminOk {
  const id = request.name.trim()
  if (id.length === 0) throw invalidName('skill name must not be empty')
  if (id.includes('/') || id.includes('..') || id.startsWith('.')) {
    throw invalidName('skill name must not contain slashes or dots')
  }
  const directory = join(root, id)
  if (existsSync(directory)) throw new RemoteError('skills-admin/exists', `skill "${id}" already exists`, { id })
  const body = [
    '---',
    `name: ${JSON.stringify(id)}`,
    `description: ${JSON.stringify(request.description.trim())}`,
    '---',
    '',
    `# ${id}`,
    '',
    '',
  ].join('\n')
  try {
    mkdirSync(root, { recursive: true })
    mkdirSync(directory)
    writeFileSync(join(directory, 'SKILL.md'), body)
  } catch (error: unknown) {
    throw internal(`skill "${id}" could not be created`, error)
  }
  return { ok: true }
}

/** Remove the one-level skill directory `<root>/<id>`; the whole directory goes. */
export function removeSkillAdmin(root: string, request: SkillAdminRemoveRequest): SkillAdminOk {
  const target = resolve(root, request.id)
  const rootReal = resolve(root)
  const contained = target !== rootReal && dirname(target) === rootReal && basename(target) === request.id
  if (!contained) {
    throw new RemoteError('skills-admin/not-one-level', 'only one-level directories under the skills root can be removed', {})
  }
  if (!existsSync(join(target, 'SKILL.md'))) {
    throw new RemoteError('skills-admin/missing-manifest', 'that directory has no SKILL.md; nothing was removed', {})
  }
  try {
    rmSync(target, { recursive: true })
  } catch (error: unknown) {
    throw internal(`skill "${request.id}" could not be removed`, error)
  }
  return { ok: true }
}

/** Install one skill from a picked directory: copy the SKILL.md layer into the root. */
export function installSkillAdmin(root: string, request: SkillAdminInstallRequest): SkillAdminOk {
  const source = resolve(request.sourceDirectory)
  const rootReal = resolve(root)
  if (!existsSync(join(source, 'SKILL.md'))) {
    throw new RemoteError('skills-admin/missing-manifest', 'that directory has no SKILL.md', {})
  }
  if (source === rootReal || dirname(source) === rootReal) {
    throw new RemoteError('skills-admin/inside-root', 'it is already inside the skills root', {})
  }
  const id = basename(source)
  if (id.length === 0 || id.startsWith('.')) throw invalidName('that directory name cannot be a skill name')
  const target = join(root, id)
  if (existsSync(target)) throw new RemoteError('skills-admin/exists', `skill "${id}" already exists`, { id })
  try {
    mkdirSync(root, { recursive: true })
    cpSync(source, target, { recursive: true })
  } catch (error: unknown) {
    throw internal(`skill "${id}" could not be installed`, error)
  }
  return { ok: true }
}

/** SKILL.md body → frontmatter key/values. Starts at a lone `---`; ends at the next one. */
export function skillFrontmatter(text: string): Record<string, string> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if ((lines[0] ?? '').trim() !== '---') return {}
  const out: Record<string, string> = {}
  for (const raw of lines.slice(1)) {
    const line = raw.trim()
    if (line === '---') break
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      // Double-quoted values are JSON string literals (the create writer's own
      // escaping); an unparseable literal falls back to stripping the quotes.
      try {
        const parsed: unknown = JSON.parse(value)
        if (typeof parsed === 'string') value = parsed
        else value = value.slice(1, -1)
      } catch {
        value = value.slice(1, -1)
      }
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    if (key.length > 0) out[key] = value
  }
  return out
}
