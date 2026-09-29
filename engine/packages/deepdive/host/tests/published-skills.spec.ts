/**
 * DeepDive's published skills are runtime registrations, not files: the model
 * sees them because the plugin owns them, and there is no directory a user (or
 * a stale install) can delete behind the app's back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { apply, PUBLISHED_SKILLS, RETIRED_SKILL_NAMES } from '../src/index.ts'

const contexts: Context[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function mount(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin({ name: 'deepdive-host', apply })
  return ctx
}

describe('published skills', () => {
  it('contributes both skills to the catalog with their frontmatter intact', async () => {
    const ctx = await mount()
    const listed = (await ctx.skills.list()).map(skill => skill.name).sort()
    expect(listed).toEqual(['deepdive-automation', 'deepdive-browser'])

    const automation = await ctx.skills.get('deepdive-automation')
    // The body keeps its frontmatter: the catalog parses it, and a malformed
    // name/description makes the skill disappear silently.
    expect(automation?.content).toContain('---\nname: deepdive-automation\n')
    expect(automation?.content).toContain('```automation')
    for (const kind of ['hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom']) {
      expect(automation?.content).toContain(`"kind":"${kind}"`)
    }

    const browser = await ctx.skills.get('deepdive-browser')
    expect(browser?.content).toContain('---\nname: deepdive-browser\n')
    expect(browser?.content).toContain('\ndescription: ')
  })

  it('registers nothing when the skills service is absent instead of inventing one', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    expect(() => { apply(ctx) }).not.toThrow()
    expect(ctx.get('skills')).toBeUndefined()
  })

  it('drops file-published and retired skill directories, and only those', async () => {
    const home = mkdtempSync(join(tmpdir(), 'deepdive-host-'))
    dirs.push(home)
    for (const name of [...RETIRED_SKILL_NAMES, 'my-own-skill']) {
      mkdirSync(join(home, 'skills', name), { recursive: true })
      writeFileSync(join(home, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n`)
    }
    vi.stubEnv('DSH_HOME', home)

    await mount()

    for (const name of RETIRED_SKILL_NAMES) {
      expect(existsSync(join(home, 'skills', name))).toBe(false)
    }
    // A user's own skill is never touched.
    expect(existsSync(join(home, 'skills', 'my-own-skill', 'SKILL.md'))).toBe(true)
  })

  it('skips the sweep when no supervised home is set', async () => {
    vi.stubEnv('DSH_HOME', '')
    await expect(mount()).resolves.toBeDefined()
  })

  it('keeps every published body free of the legacy invocation keys the catalog refuses', () => {
    for (const skill of PUBLISHED_SKILLS) {
      for (const legacy of ['modelInvocable', 'userInvocable', 'disableModelInvocation']) {
        expect(skill.content).not.toContain(legacy)
      }
    }
  })
})
