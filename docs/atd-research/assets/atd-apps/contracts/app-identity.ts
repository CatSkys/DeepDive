import { Type, type Static } from 'typebox';

/**
 * Identity and capability vocabulary of user apps (the "Create App" feature), shared by the app
 * records (`apps.ts`), the backend IPC (`apps-ipc.ts`), widgets (`widgets.ts`) and task origins.
 * Kept free of other contract imports so each of those can depend on it without a cycle.
 */

/** `app-` and ten lowercase alphanumerics: also a valid host of the app's `ai-userapp://` URL. */
export const APP_ID_PATTERN = '^app-[a-z0-9]{10}$';
/** A user app id; the service generates it when the first build publishes the app. */
export const AppIdSchema = Type.String({ pattern: APP_ID_PATTERN });
export type AppId = Static<typeof AppIdSchema>;

export const APP_NAME_MAX_LENGTH = 64;
export const APP_DESCRIPTION_MAX_LENGTH = 500;
/** An app's display name, from its manifest or a rename. */
export const AppNameSchema = Type.String({ minLength: 1, maxLength: APP_NAME_MAX_LENGTH });

/**
 * The per-app `WKWebsiteDataStore(forIdentifier:)` id: an uppercase canonical UUID the service
 * generates once per app and never changes, so the app's web storage survives new versions.
 */
export const DataStoreIdSchema = Type.String({
  pattern: '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$',
});
export type DataStoreId = Static<typeof DataStoreIdSchema>;

/**
 * An app's accent color as `#RRGGBB`: its identity color, as an asset catalog's AccentColor is for
 * a native app. The page's primary controls and focus rings, the app's widgets and Atd's own views
 * of the app take it, each adapting the one value to light and dark appearance.
 */
export const AppAccentColorSchema = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });
export type AppAccentColor = Static<typeof AppAccentColorSchema>;

/**
 * Service capabilities an app backend reaches through the parent's capability proxy, each behind
 * a per-app consent. Storage (db, kv, files) and logs need no consent and run inside the backend.
 */
export const APP_CAPABILITIES = ['ai', 'agent', 'memory', 'mcp', 'web'] as const;
export const CapabilitySchema = Type.Union([
  Type.Literal('ai'),
  Type.Literal('agent'),
  Type.Literal('memory'),
  Type.Literal('mcp'),
  Type.Literal('web'),
]);
/** Kept literal so the static type stays a union; update it together with `APP_CAPABILITIES`. */
export type Capability = Static<typeof CapabilitySchema>;

/** The user's answer to a capability consent; an absent grant means not asked yet. */
export const GrantStateSchema = Type.Union([Type.Literal('granted'), Type.Literal('denied')]);
export type GrantState = Static<typeof GrantStateSchema>;

/** One app's stored consents (`app.json` `grants`): a capability without a key was never asked. */
export const AppGrantsSchema = Type.Object(
  {
    ai: Type.Optional(GrantStateSchema),
    agent: Type.Optional(GrantStateSchema),
    memory: Type.Optional(GrantStateSchema),
    mcp: Type.Optional(GrantStateSchema),
    web: Type.Optional(GrantStateSchema),
  },
  { additionalProperties: false },
);
export type AppGrants = Static<typeof AppGrantsSchema>;

/**
 * The name of one backend API function (a key of `defineBackend({ api })`), as it appears in
 * `POST /v1/apps/:appId/api/:name` and the IPC `call`: a JavaScript identifier without `$`.
 */
export const AppApiNameSchema = Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' });
export type AppApiName = Static<typeof AppApiNameSchema>;

/**
 * A failure an app call or capability request ends with, on the NDJSON stream and over IPC.
 * `code` is a service error code (`protocol.ts`) for failures the service raises, or the code the
 * backend threw; `message` is shown to the app as is.
 */
export const AppErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_.-]+$' }),
    message: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);
export type AppError = Static<typeof AppErrorSchema>;
