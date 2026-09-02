
import type { SettingsNamespaceView } from './remotes-shim'

/* Shims replacing the official packages' context-bound faces with plain
   object implementations (DeepDive talks to the gateway via same-origin
   fetch, not cordis). */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** ui-settings schema service face (synchronous schema introspection). */
export interface SettingsSchemaService {
  rehydrate(serialized: unknown): any
  validate(schema: unknown, draft: unknown): string | undefined
  nodeAtPath(root: unknown, path: readonly string[]): any
  getPath(value: unknown, path: readonly string[]): any
  hasPath(value: unknown, path: readonly string[]): boolean
  setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown>
  deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown>
}

/** The shared mirror's describe face (namespace views + writability). */
export interface SettingsDescribeFace {
  ensure(): Promise<void>
  getSnapshot(): { view?: { writable: boolean; namespaces: readonly SettingsNamespaceView[] }; error?: string }
}
