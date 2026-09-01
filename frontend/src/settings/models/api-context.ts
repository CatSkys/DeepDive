import { api } from '../../api'
import type { ModelsOperations } from './operations'
import type { CredentialInfo, SettingsPathOpView } from './remotes-shim'

/** A Remote answer reduced to the official result shape. */
type ApiResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

async function call<T>(method: string, payload: unknown): Promise<ApiResult<T>> {
  try {
    return { ok: true, value: await api.callRaw<T>(method, payload) }
  } catch (err) {
    const message = String((err as Error)?.message ?? 'unknown')
    const sep = message.indexOf(': ')
    const code = sep > 0 && !message.startsWith('transport') ? message.slice(0, sep) : 'transport'
    const text = sep > 0 && !message.startsWith('transport') ? message.slice(sep + 2) : message
    return { ok: false, error: { code, message: text } }
  }
}

export interface ModelsApiContext {
  remote: {
    llm: {
      listProviders: () => Promise<ApiResult<Array<{ id: string; name: string }>>>
      listConfigurableProviders: () => Promise<ApiResult<Array<{ provider: string; displayName: string; settingsNs: string; settingsPath: string[]; declared?: boolean }>>>
      discoverModels: (settingsNs: string, request: object) => Promise<ApiResult<Array<{ id?: string; name?: string }>>>
    }
    credentials: {
      describe: (refs: string[]) => Promise<ApiResult<Record<string, CredentialInfo | undefined>>>
      set: (ref: string, value: string) => Promise<ApiResult<null>>
      unset: (ref: string) => Promise<ApiResult<null>>
    }
    settings: {
      mutate: (ns: string, ops: readonly SettingsPathOpView[], expectedRevision: number | undefined) => Promise<ApiResult<{ ns: string; value: unknown; base?: unknown; user?: unknown; schema?: unknown; revision: number; writable?: boolean }>>
    }
  }
}

export function createApiContext(): ModelsApiContext {
  return {
    remote: {
      llm: {
        listProviders: () => call('llm.listProviders', {}),
        listConfigurableProviders: () => call('llm.listConfigurableProviders', {}),
        discoverModels: (settingsNs, request) => call('llm.discoverModels', { settingsNs, ...(request as object) }),
      },
      credentials: {
        describe: (refs) => {
          return call<Record<string, CredentialInfo | undefined>>('credentials.describe', { refs }).then((r) =>
            r.ok
              // the wire wraps the catalog in a `credentials` key
              ? { ok: true as const, value: r.value.credentials ?? {} }
              : r,
          )
        },
        set: (ref, value) => call('credentials.set', { ref, value }),
        unset: (ref) => call('credentials.unset', { ref }),
      },
      settings: {
        mutate: (ns, ops, expectedRevision) => call('settings.mutate', { ns, ops, expectedRevision }),
      },
    },
  }
}

/** The official ModelsOperations bound to the same-origin gateway. */
export function createModelsOperations(): ModelsOperations {
  const ctx = createApiContext()
  return {
    describeCredential: async (ref) => {
      const response = await ctx.remote.credentials.describe([ref])
      if (!response.ok) return undefined
      return response.value[ref]
    },
    storeCredential: async (ref, value) => {
      const response = await ctx.remote.credentials.set(ref, value)
      return response.ok ? undefined : response.error.message
    },
    removeCredential: async (ref) => {
      const response = await ctx.remote.credentials.unset(ref)
      return response.ok ? undefined : response.error.message
    },
    writeSettings: async (ns, ops, expectedRevision) => {
      const response = await ctx.remote.settings.mutate(ns, ops, expectedRevision)
      if (response.ok) return { kind: 'written', view: response.value as never }
      const { code, message } = response.error
      return code === 'settings/conflict' ? { kind: 'conflict', message } : { kind: 'refused', message }
    },
    discoverModels: async (settingsNs, request) => {
      const response = await ctx.remote.llm.discoverModels(settingsNs, request as object)
      return response.ok
        ? { kind: 'found', models: response.value as never }
        : { kind: 'refused', message: response.error.message }
    },
  }
}
