import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ModelsSection } from './ModelsSection'
import { IconCheckOutline16 } from '../primitives/icons'
import { api, probeMethod } from '../../api'
import { sendToShell } from '../../host'
import rowsCss from '../SettingsRows.module.css'
import { ModelsSettingsStore } from './store'
import { createSettingsSchemaOperations } from './schema-operations'
import { SettingsSchemaService } from './schema-service'
import { createApiContext, createModelsOperations } from './api-context'
import type { ModelsSettingsState } from './store'
import { en } from './locales'
import '../settings-tokens.css'

/** Full-featured Models settings pane: the official ui-settings-models
 *  section driven by our gateway (store + schema + operations wired to
 *  same-origin fetches instead of the cordis context). */

const t = (key: keyof typeof en) => en[key]

/** Minimal settings mirror face over our describe call. */
function createMirrorFace() {
  let view: { writable: boolean; namespaces: readonly { ns: string; value: unknown; base: unknown; user: unknown; schema: unknown; revision: number; writable: boolean }[] } | undefined
  let error: string | undefined
  return {
    async ensure(): Promise<void> {
      const { api } = await import('../../api')
      try {
        const d = await api.settingsDescribe()
        view = { writable: d.writable ?? true, namespaces: (d.namespaces ?? []) as never }
        error = undefined
      } catch (err) {
        error = String((err as Error)?.message ?? 'settings unavailable')
      }
    },
    getSnapshot() {
      return { view, error }
    },
  }
}

/** The renderer's useSnapshot seat: a selector hook over the store. */
function makeUseSnapshot(store: ModelsSettingsStore) {
  return function useSnapshot<T>(selector: (snapshot: ModelsSettingsState) => T): T {
    const facade = store.store as unknown as {
      subscribe: (onChange: () => void) => () => void
      getSnapshot: () => ModelsSettingsState
    }
    return useSyncExternalStore(
      (onChange) => facade.subscribe(onChange),
      () => selector(facade.getSnapshot()),
    )
  }
}

export function ModelsSettingsPane() {
  // SPEC-ENGINE-RUNTIME §4.2: the provider directory/operations are
  // version-sensitive (absent on rc.2). Probe first — absent adapters fall
  // back to the simple default-model + key page instead of failing.
  const [adapterAvailable, setAdapterAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    void probeMethod('llm.listProviders').then(async (ok) => {
      const configurable = ok ? await probeMethod('llm.listConfigurableProviders') : false
      setAdapterAvailable(ok && configurable)
    })
  }, [])

  const schemaOps = useMemo(
    () => createSettingsSchemaOperations(new SettingsSchemaService()),
    [],
  )
  const mirror = useMemo(() => createMirrorFace(), [])
  const operations = useMemo(() => createModelsOperations(), [])
  const storeRef = useRef<ModelsSettingsStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = new ModelsSettingsStore(createApiContext(), schemaOps, {
      ensure: () => mirror.ensure(),
      getSnapshot: () => mirror.getSnapshot(),
    } as never)
  }
  const store = storeRef.current
  const useSnapshot = useMemo(() => makeUseSnapshot(store), [store])

  if (adapterAvailable === null) {
    return <div className="set-pane-loading">…</div>
  }
  return adapterAvailable ? (
    <ModelsSection
      controller={store}
      useSnapshot={useSnapshot}
      operations={operations}
      schema={schemaOps}
      t={t}
    />
  ) : (
    <FallbackModelsSection />
  )
}

/** rc.2-era fallback (adapter absent): default-model pick from `llm.models`
 *  plus the credential rows — the SPEC §4.2 graceful degradation. */
export function FallbackModelsSection() {
  const [groups, setGroups] = useState<Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>>([])
  const [namespaces, setNamespaces] = useState<Record<string, { value: unknown; revision: unknown }>>({})
  const [creds, setCreds] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    void (async () => {
      const { api } = await import('../../api')
      try {
        const r = await api.llmModels()
        setGroups(r.groups ?? [])
      } catch { /* engine booting */ }
      try {
        const d = await api.settingsDescribe()
        const map: Record<string, { value: unknown; revision: unknown }> = {}
        const refs = new Set<string>(['DEEPSEEK_API_KEY'])
        for (const ns of d.namespaces ?? []) {
          map[ns.ns] = { value: ns.value, revision: ns.revision }
          const v = ns.value as { apiKeyEnv?: string } | null
          if (v?.apiKeyEnv) refs.add(v.apiKeyEnv)
        }
        setNamespaces(map)
        const r2 = await api.credentialsDescribe({ refs: [...refs] })
        const cm: Record<string, boolean> = {}
        for (const [ref, info] of Object.entries(r2.credentials ?? {})) cm[ref] = !!info.configured
        setCreds(cm)
      } catch { /* engine booting */ }
    })()
  }, [])

  const entry = namespaces['agent-default-model']
  const currentProvider = (entry?.value as { provider?: string } | null)?.provider ?? ''
  const currentModel = (entry?.value as { model?: string } | null)?.model ?? ''

  const pick = async (provider: string, model: string) => {
    if (!entry) return
    const base = (entry.value ?? {}) as { provider?: string; model?: string }
    try {
      await api.settingsUpdate({ ns: 'agent-default-model', patch: { ...base, provider, model }, expectedRevision: entry.revision })
      const d = await api.settingsDescribe()
      for (const ns of d.namespaces ?? []) if (ns.ns === 'agent-default-model') setNamespaces((m) => ({ ...m, [ns.ns]: { value: ns.value, revision: ns.revision } }))
    } catch { /* surfaced by reload */ }
  }

  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.title}>当前使用</div>
      <div className={rowsCss.rows}>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowHead}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>默认模型</div>
              <div className={rowsCss.rowCaption}>{currentProvider ? `${currentProvider} / ${currentModel}` : '引擎默认'}</div>
            </div>
          </div>
        </div>
      </div>
      <div className={rowsCss.title} style={{ marginTop: 24 }}>模型目录（点击即选用为默认）</div>
      <div className={rowsCss.rows}>
        {groups.map((g) => (
          <div key={g.id}>
            <div className={rowsCss.subgroupTitle}>{g.name}</div>
            {g.models.map((m) => {
              const picked = currentModel === m.id
              return (
                <div key={m.id} className={rowsCss.rowCard}>
                  <div className={rowsCss.rowHead}>
                    <div className={rowsCss.rowIdentity}>
                      <div className={rowsCss.rowName}>{m.name}</div>
                    </div>
                    <div className={rowsCss.rowActions}>
                      {picked
                        ? <IconCheckOutline16 size={14} />
                        : <button className={rowsCss.secondaryButton} onClick={() => void pick(g.id, m.id)}>选用</button>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className={rowsCss.title} style={{ marginTop: 24 }}>API Key</div>
      <div className={rowsCss.intro}>凭据只写、不读回；配置后若引擎因缺凭据未启动会自动拉起。</div>
      <div className={rowsCss.rows}>
        {Object.entries(creds).map(([ref, configured]) => (
          <div key={ref} className={rowsCss.rowCard}>
            <div className={rowsCss.rowHead}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName}>{ref}</div>
                <div className={rowsCss.rowCaption}>{configured ? '已配置' : '未配置'}</div>
              </div>
              <div className={rowsCss.rowActions}>
                <input
                  className={rowsCss.textField}
                  type="password"
                  placeholder={configured ? '输入以替换' : '输入 API Key'}
                  value={drafts[ref] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [ref]: e.target.value }))}
                />
                <button className={rowsCss.primaryButton} onClick={async () => {
                  const value = drafts[ref]
                  if (!value) return
                  const { api } = await import('../../api')
                  try {
                    await api.credentialsSet({ ref, value })
                    setDrafts((d) => ({ ...d, [ref]: '' }))
                    setCreds((c) => ({ ...c, [ref]: true }))
                    sendToShell({ type: 'restart-engine' })
                  } catch { /* surfaced by reload */ }
                }}>保存</button>
                {configured && (
                  <button className={rowsCss.secondaryButton} onClick={async () => {
                    const { api } = await import('../../api')
                    try {
                      await api.credentialsUnset({ ref })
                      setCreds((c) => ({ ...c, [ref]: false }))
                    } catch { /* surfaced by reload */ }
                  }}>删除</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
