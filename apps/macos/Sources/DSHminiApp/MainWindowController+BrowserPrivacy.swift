// 主窗口的浏览器接线之二：隐私相关的三条桥消息（拦截 `browser-shield`、权限回答
// `browser-permission`、cookie 导入 `browser-cookies`），以及给 SPA 的拦截状态推送。
//
// 拆出来的理由与 `MainWindowController+Browser.swift` 同一份（那份本来是浏览器接线的家，
// 加上隐私这一摊就过 300 行了）：这一份只管"隐私"，那边管槽位/导航/标签/查找/快捷键。

import AppKit
import WebKit

extension MainWindowController {
    /// SPA 发来的拦截相关（`browser-shield`）：设置页的开关、面板菜单的"本站暂停/恢复"、
    /// 两条"忘记"。
    ///
    /// 暂停/恢复要**重载当前标签**才算数：规则表在导航那一刻加减，已经渲染出来的页面（尤其
    /// 是 cosmetic 隐藏）不会自己回滚——浏览器们也都是这么做的（Brave 关 shields 会刷新）。
    func handleBrowserShield(_ body: [String: Any]) {
        switch BrowserShield.command(body) {
        case .sync:
            pushShield()
        case .setEnabled(let on):
            BrowserShield.shared.setEnabled(on)
            BrowserShield.shared.apply(to: browserTabs.controllers)
            pushShield()
            browser.reload()
        case .pause(let host):
            setShieldPaused(true, host: host)
        case .resume(let host):
            setShieldPaused(false, host: host)
        case .forgetPaused:
            BrowserShield.shared.forgetPaused()
            // 忘掉之后每个站点都按全局开关来：已经开着的页面重挂规则（重新加载才看得出差别）
            BrowserShield.shared.apply(to: browserTabs.controllers)
            pushShield()
        case nil:
            EngineLog.shared.append("[browser] unknown shield command")
        }
    }

    /// SPA 发来的权限回答（`browser-permission`）：页面还挂在 WebKit 那边等这个决定。
    func handleBrowserPermission(_ body: [String: Any]) {
        switch BrowserPermissions.command(body) {
        case .answer(let host, let kind, let allow):
            BrowserPermissions.resolve(host: host, kind: kind, allow: allow)
        case .forgetAll:
            BrowserPermissions.forgetAll()
            pushShield()
        case nil:
            EngineLog.shared.append("[browser] unknown permission command")
        }
    }

    /// 按站暂停/恢复拦截：改记忆、重挂当前页的规则、重载（规则表在导航那一刻才算数）。
    private func setShieldPaused(_ paused: Bool, host: String) {
        BrowserShield.shared.setPaused(paused, host: host)
        BrowserShield.shared.tune(browser.view.configuration.userContentController, for: host)
        pushShield()
        browser.reload()
    }

    /// 把拦截状态推给 SPA（设置页那几行 + 面板菜单的当前站状态）。
    func pushShield() {
        pushHostCommand("browserShield", payload: AppDelegate.jsonPayload([
            "enabled": BrowserShield.shared.enabled(),
            "paused": BrowserShield.shared.pausedHosts(),
            "permissions": BrowserPermissions.rememberedCount(),
            // 规则没编译成功时设置页要能说出来（否则开关写着"开"、实际什么都没挡）
            "trouble": BrowserShield.shared.trouble ?? "",
            "hidden": BrowserHidden.shared.totalCount(),
        ]))
    }

    /// SPA 发来的 cookie 导入相关（`browser-cookies`）：列来源 / 导一个来源 / 清浏览数据。
    /// 导入要读别的浏览器（Chromium 系会读 keychain、等人点头）+ 写 cookie store，都在别处做。
    func handleBrowserCookies(_ body: [String: Any]) {
        switch BrowserCookies.command(body) {
        case .sources:
            pushHostCommand("browserCookieSources", payload: AppDelegate.jsonPayload(BrowserCookies.payload(BrowserCookies.installed())))
        case .importSource(let id):
            guard let source = BrowserCookies.installed().first(where: { $0.id == id }) else {
                pushHostCommand("browserCookieResult", payload: AppDelegate.jsonPayload(["source": id, "code": "missing", "total": 0, "imported": 0]))
                return
            }
            EngineLog.shared.append("[browser] import cookies from \(id)")
            BrowserCookieImport.run(source: source, store: browserTabs.store) { [weak self] payload in
                self?.pushHostCommand("browserCookieResult", payload: AppDelegate.jsonPayload(payload))
            }
        case .clear:
            BrowserDataStore.clear(browserTabs.store) { [weak self] in
                guard let self else { return }
                self.pushHostCommand("browserCookieResult", payload: AppDelegate.jsonPayload(["source": "", "code": "cleared", "total": 0, "imported": 0]))
                // 页面上还留着已经失效的登录态：重载一次才看得见"退出来了"
                self.browser.reload()
            }
        case nil:
            EngineLog.shared.append("[browser] unknown cookies command")
        }
    }

}
