/** Skill-admin pure-function semantics pinned from the shell's SkillAdmin. */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSkillAdmin,
  installSkillAdmin,
  listSkillAdmin,
  removeSkillAdmin,
  skillFrontmatter,
} from '../src/skill-admin.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A non-existent skills root (the pre-first-create state). */
function absentRoot(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'skill-admin-')), 'skills')
  roots.push(root)
  return root
}

/** An existing skills root, ready to be populated by the test itself. */
function tempRoot(): string {
  const root = absentRoot()
  mkdirSync(root, { recursive: true })
  return root
}

/** Run a throwing admin op and return its RemoteError code. */
function code(run: () => unknown): string {
  try {
    run()
    return 'no-throw'
  } catch (error: unknown) {
    return error instanceof RemoteError ? error.code : 'non-remote-error'
  }
}

describe('listSkillAdmin', () => {
  it('returns an empty list when the root does not exist yet', () => {
    expect(listSkillAdmin(absentRoot())).toEqual({ skills: [] })
  })

  it('lists one-level directories with frontmatter fields and missing keys', () => {
    const root = tempRoot()
    mkdirSync(join(root, 'alpha'))
    writeFileSync(join(root, 'alpha', 'SKILL.md'), '---\nname: "alpha"\ndescription: "first: one"\n---\n\nbody\n')
    mkdirSync(join(root, 'broken'))
    writeFileSync(join(root, 'broken', 'SKILL.md'), '# no frontmatter\n')
    mkdirSync(join(root, '.hidden'))
    writeFileSync(join(root, '.hidden', 'SKILL.md'), '---\nname: h\n---\n')
    writeFileSync(join(root, 'loose-file.md'), 'not a directory\n')

    const { skills } = listSkillAdmin(root)
    expect(skills.map(skill => skill.id)).toEqual(['alpha', 'broken'])
    expect(skills[0]).toMatchObject({ title: 'alpha', detail: 'first: one', missing: [] })
    expect(skills[0]?.manifest).toBe(join(root, 'alpha', 'SKILL.md'))
    expect(skills[1]?.missing).toEqual(['name', 'description'])
    expect(skills[1]?.title).toBe('broken')
  })
})

describe('createSkillAdmin', () => {
  it('creates a skeleton whose frontmatter round-trips through the reader', () => {
    const root = tempRoot()
    expect(createSkillAdmin(root, { name: ' my-skill ', description: 'does "things": yes' })).toEqual({ ok: true })
    const { skills } = listSkillAdmin(root)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ id: 'my-skill', title: 'my-skill', detail: 'does "things": yes', missing: [] })
  })

  it('rejects empty names, path-shaped names, and duplicates with stable codes', () => {
    const root = tempRoot()
    createSkillAdmin(root, { name: 'dup', description: '' })
    expect(code(() => createSkillAdmin(root, { name: '', description: '' }))).toBe('skills-admin/invalid-name')
    expect(code(() => createSkillAdmin(root, { name: 'a/b', description: '' }))).toBe('skills-admin/invalid-name')
    expect(code(() => createSkillAdmin(root, { name: '..', description: '' }))).toBe('skills-admin/invalid-name')
    expect(code(() => createSkillAdmin(root, { name: '.hide', description: '' }))).toBe('skills-admin/invalid-name')
    expect(code(() => createSkillAdmin(root, { name: 'dup', description: '' }))).toBe('skills-admin/exists')
  })
})

describe('removeSkillAdmin', () => {
  it('removes the whole one-level directory and refuses anything else', () => {
    const root = tempRoot()
    createSkillAdmin(root, { name: 'gone', description: 'd' })
    expect(removeSkillAdmin(root, { id: 'gone' })).toEqual({ ok: true })
    expect(existsSync(join(root, 'gone'))).toBe(false)

    expect(code(() => removeSkillAdmin(root, { id: 'gone' }))).toBe('skills-admin/missing-manifest')
    expect(code(() => removeSkillAdmin(root, { id: '../escape' }))).toBe('skills-admin/not-one-level')
    expect(code(() => removeSkillAdmin(root, { id: '' }))).toBe('skills-admin/not-one-level')
    mkdirSync(join(root, 'nolink'))
    expect(code(() => removeSkillAdmin(root, { id: 'nolink' }))).toBe('skills-admin/missing-manifest')
  })
})

describe('installSkillAdmin', () => {
  it('copies the SKILL.md layer into the root and refuses overlaps', () => {
    const root = tempRoot()
    const source = join(mkdtempSync(join(tmpdir(), 'skill-src-')), 'picked')
    roots.push(source)
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), '---\nname: picked\n---\n')
    writeFileSync(join(source, 'extra.txt'), 'asset')

    expect(installSkillAdmin(root, { sourceDirectory: source })).toEqual({ ok: true })
    expect(existsSync(join(root, 'picked', 'extra.txt'))).toBe(true)

    expect(code(() => installSkillAdmin(root, { sourceDirectory: source }))).toBe('skills-admin/exists')
    expect(code(() => installSkillAdmin(root, { sourceDirectory: root }))).toBe('skills-admin/missing-manifest')
    expect(code(() => installSkillAdmin(root, { sourceDirectory: join(tmpdir(), 'missing-dir-xyz') }))).toBe('skills-admin/missing-manifest')
    // The freshly installed layer is itself inside the root: refuse to reinstall it.
    expect(code(() => installSkillAdmin(root, { sourceDirectory: join(root, 'picked') }))).toBe('skills-admin/inside-root')
  })
})

describe('skillFrontmatter', () => {
  it('unescapes JSON-style double quotes and strips single quotes', () => {
    expect(skillFrontmatter('---\nname: "a\\"b"\ndescription: \'plain: value\'\nother: bare\n---\n')).toEqual({
      name: 'a"b',
      description: 'plain: value',
      other: 'bare',
    })
    expect(skillFrontmatter('no frontmatter')).toEqual({})
  })
})
