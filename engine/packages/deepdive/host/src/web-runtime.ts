/**
 * The Web runtime DeepDive's engine needs: the loopback URL line the app's
 * supervisor parses for readiness, the `/` answer the shell's cookie exchange
 * verifies against, and the trust snapshot the `/api` fence reads.
 *
 * This replaces the official `web-app` row (`web-runtime`). That row does four
 * things and DeepDive wants one and a half of them:
 *   · provides `webRuntime` (trust)          — needed, kept here;
 *   · prints `dsh web: <url>`                — needed: it IS the readiness signal
 *                                              the shell and the boot smoke wait for;
 *   · serves the official frontend dist as a static fallback — replaced by one
 *                                              `/` route, so `@deepseek-ai/dsh-web-frontend`
 *                                              (4.6 MB of a page we never load) leaves the tree;
 *   · injects a system-prompt section saying the user is looking at the official
 *     Web GUI (with an HMR contract) — dropped on purpose: it is false here, and
 *     DeepDive's own surface is the app window.
 *
 * The `/` contract (from `client-connection`'s `authorizeIndex`): a root request
 * carrying the launch token is answered 303 + Set-Cookie by the auth fence
 * itself; the same request carrying that cookie is answered by whoever owns the
 * index seat — us. Nothing else ever fetches `/` (the SPA is served by the app's
 * bridge), so the body is a marker page, not a UI.
 *
 * @module web-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { networkInterfaces } from 'node:os'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Service key the `/api` trust fence reads its authorities from. */
const WEB_RUNTIME_SERVICE = 'webRuntime'

const LOOPBACK_HOST = '127.0.0.1'
const ALL_INTERFACES_HOST = '0.0.0.0'

/** The marker page served at `/` once the auth fence has accepted the caller. */
const INDEX_BODY = [
  '<!doctype html><html><head><meta charset="utf-8"><title>DeepDive engine</title></head>',
  '<body><p>DeepDive engine is running. The app UI is served by the app itself.</p></body></html>',
].join('')

/** What the `/api` fence and the ready line read from the provided runtime. */
export interface WebRuntimeValues {
  /** LAN IPv4 literals of this host, present only when bound to all interfaces. */
  readonly lanAddresses: readonly string[]
  /** Authorities the browser-trust fence accepts. */
  readonly trustedHosts: readonly string[]
}

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and an
 * OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(bindHost: string, extra: readonly string[]): WebRuntimeValues {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> =>
        iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] }
}

/** The loopback URL of the running webserver, token-free. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('deepdive-host: webServer service missing while resolving the web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/**
 * Provide the web runtime, own the `/` seat, and announce readiness.
 * @param ctx - Host context carrying the webserver and connection services.
 */
export function applyWebRuntime(ctx: Context): void {
  const bindHost = ctx.get('webServer')?.host ?? LOOPBACK_HOST
  const trustedHosts = ctx.get('webStartup')?.trustedHosts ?? []
  ctx.provide(WEB_RUNTIME_SERVICE, resolveLanTrust(bindHost, trustedHosts))

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/',
      handler: (req, res) => {
        if (!webCtx.connection.authorizeIndex(req, res)) return
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(INDEX_BODY)
      },
    }), 'deepdive-host: index seat')

    // The URL line is a readiness signal: the supervisor RPCs as soon as it
    // observes it, so it must not run while sibling rows (the /api route owner
    // among them) are still mounting. Wait for Loader settlement, exactly as the
    // official row does; a hand-built tree without a Loader is already complete.
    const announce = (): void => {
      if (webCtx.get('webServer') === undefined || webCtx.get('connection') === undefined) return
      console.log(`dsh web: ${webCtx.connection.authenticatedUrl(localWebUrl(webCtx))}`)
    }
    const settled = webCtx.get('loader')?.await()
    if (settled === undefined) announce()
    else void settled.then(announce, () => {})
  })
}
