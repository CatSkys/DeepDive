// Shell↔frontend bridge mount (SPEC-NOTIFICATIONS-FLOATING-BALL §3.1).
//
// The native shell pushes instructions via WKWebView evaluateJavaScript on
// `window.__dshminiHost.dispatch(cmd, payload)`; the frontend reports the
// mounted hook with a `host-ready` message on the "dshminiHost" script
// message handler. The shell stages at most one pending command until this
// hook reports ready, so a notification tap during cold start is never lost.
// Degradation: in a plain browser (no webkit messageHandlers) everything
// here no-ops silently — the bridge is an enhancement, not a dependency.

interface HostBridge {
  dispatch: (cmd: string, payload?: unknown) => void;
}

declare global {
  interface Window {
    __dshminiHost?: HostBridge;
    webkit?: { messageHandlers?: { dshminiHost?: { postMessage: (msg: unknown) => void } } };
  }
}

type HostEvent = (cmd: string, payload?: unknown) => void;
const listeners = new Set<HostEvent>();

export function onHostEvent(cb: HostEvent): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function sendToShell(message: Record<string, unknown>): void {
  window.webkit?.messageHandlers?.dshminiHost?.postMessage(message);
}

export function installHostBridge(handlers: {
  navigateToSession: (sessionId: string) => void;
  navigateToSettings: () => void;
  themeChanged: (dark: boolean) => void;
}): void {
  if (window.__dshminiHost) return; // idempotent mount (StrictMode/reloads)
  window.__dshminiHost = {
    dispatch(cmd: string, payload?: unknown) {
      switch (cmd) {
        case "navigateToSession": {
          const sessionId = (payload as { sessionId?: string } | undefined)?.sessionId;
          if (typeof sessionId === "string" && sessionId) handlers.navigateToSession(sessionId);
          break;
        }
        case "navigateToSettings": {
          handlers.navigateToSettings();
          break;
        }
        case "themeChanged": {
          const dark = (payload as { dark?: boolean } | undefined)?.dark ?? true;
          handlers.themeChanged(dark);
          break;
        }
        default:
          break;
      }
      for (const cb of listeners) cb(cmd, payload);
    },
  };
  sendToShell({ type: "host-ready" });
}

/** Frontend→shell ask (§3.1): open the native settings window. */
export function requestOpenSettings(): void {
  sendToShell({ type: "open-settings" });
}
