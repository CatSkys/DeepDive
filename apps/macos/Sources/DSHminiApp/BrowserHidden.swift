// 按站隐藏：在某个站点上"把这块东西拿走"，下次来还在（参考实现的 Curtain 那一支）。
//
// 三部分：
//   · **记忆**：按 host 一组选择器（`deepdive.browser.hidden` 里一份 JSON）。
//   · **生效**：导航**开始之前**把 CSS 挂进这个标签的 `userContentController`（`WKUserScript`，
//     文档一开始就注入，所以不会"先看见再消失"）；改完记忆也立刻对当前页面再注入一次。
//   · **拾取**：点"隐藏页面上的元素…"后注入一段脚本：悬停高亮、点击算选择器回话、Esc 取消。
//     回话走页面 → 壳的 `deepdivePicker` 通道（见 BrowserHost+Hidden），只在拾取模式开着时认。
import WebKit

struct Veil: Codable, Equatable {
    var selector: String
    /// 它是什么（"div：相关推荐"这种），列表里给人看
    var label: String
}

final class BrowserHidden {
    static let shared = BrowserHidden()

    private static let storeKey = "deepdive.browser.hidden"
    private init() {}

    // MARK: - 记忆

    func veils(host: String) -> [Veil] {
        all()[normalize(host)] ?? []
    }

    func hide(selector: String, label: String, host: String) {
        guard !selector.isEmpty else { return }
        var map = all()
        var list = map[normalize(host)] ?? []
        guard !list.contains(where: { $0.selector == selector }) else { return }
        list.append(Veil(selector: selector, label: label))
        map[normalize(host)] = list
        save(map)
    }

    func restore(selector: String, host: String) {
        var map = all()
        let key = normalize(host)
        var list = map[key] ?? []
        list.removeAll { $0.selector == selector }
        if list.isEmpty { map[key] = nil } else { map[key] = list }
        save(map)
    }

    func restoreAll(host: String) {
        var map = all()
        map[normalize(host)] = nil
        save(map)
    }

    func totalCount() -> Int { all().values.reduce(0) { $0 + $1.count } }

    func forgetAll() { UserDefaults.standard.removeObject(forKey: Self.storeKey) }

    /// 一个站点用哪个键：与参考实现同一把尺子（小写、去 www.）。
    func normalize(_ host: String) -> String {
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    private func all() -> [String: [Veil]] {
        guard let text = UserDefaults.standard.string(forKey: Self.storeKey),
              let data = text.data(using: .utf8),
              let map = try? JSONDecoder().decode([String: [Veil]].self, from: data) else { return [:] }
        return map
    }

    private func save(_ map: [String: [Veil]]) {
        guard let data = try? JSONEncoder().encode(map), let text = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: Self.storeKey)
    }

    // MARK: - 生效

    /// 这一站要注入的 CSS（没隐藏过就是空串）。
    func css(host: String) -> String {
        let selectors = veils(host: host).map(\.selector)
        guard !selectors.isEmpty else { return "" }
        return selectors.joined(separator: ", ") + " { display: none !important; }"
    }

    /// 给这个标签挂上下一次导航要用的 CSS，并**立刻**对当前页面生效一次。
    ///
    /// 空 CSS 也要跑一遍注入脚本：它负责把上一次注入的那张表撤掉——不然"放回来"要等下次
    /// 导航才看得出来（实测过：恢复之后 display 还是 none）。
    func apply(_ host: BrowserHost, for hostName: String) {
        let css = css(host: hostName)
        host.armHiddenCSS(css)
        host.evaluate(Self.injectScript(css)) { _ in }
    }

    /// 马上注入用的那段（`apply` 对当前页面用；`armHiddenCSS` 用同一份代码包成 user script）。
    static func injectScript(_ css: String) -> String {
        let quoted = String(data: try! JSONEncoder().encode(css), encoding: .utf8) ?? "\"\""
        return """
        (function () {
          var css = \(quoted);
          var old = document.getElementById('deepdive-veils');
          if (old) old.remove();
          if (!css) return 'cleared';
          var sheet = document.createElement('style');
          sheet.id = 'deepdive-veils';
          sheet.textContent = css;
          (document.head || document.documentElement).appendChild(sheet);
          return 'ok';
        })()
        """
    }

    // MARK: - 拾取

    /// 拾取脚本：悬停画框、点击回话、Esc 取消。回话走 `deepdivePicker`（页面 → 壳的唯一一条）。
    static let pickerScript = """
    (function () {
      if (window.__deepdivePicker) { window.__deepdivePicker.stop(); return 'already'; }
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4c8dff;'
        + 'border-radius:4px;background:rgba(76,141,255,.14)';
      document.documentElement.appendChild(box);

      function post(payload) {
        try { window.webkit.messageHandlers.deepdivePicker.postMessage(payload); } catch (err) {}
      }

      function selectorFor(el) {
        var parts = [];
        var node = el;
        while (node && node.nodeType === 1 && parts.length < 5) {
          if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
          var part = node.tagName.toLowerCase();
          var classes = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
          if (classes.length) part += '.' + classes.map(function (c) { return CSS.escape(c); }).join('.');
          var parent = node.parentElement;
          if (parent) {
            var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
            if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
          }
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(' > ');
      }

      function labelFor(el) {
        var text = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 32);
        var tag = el.tagName.toLowerCase();
        return text ? tag + '：' + text : tag;
      }

      function outline(el) {
        if (!el || el === box || el === document.documentElement || el === document.body) return;
        var r = el.getBoundingClientRect();
        box.style.left = r.left + 'px';
        box.style.top = r.top + 'px';
        box.style.width = r.width + 'px';
        box.style.height = r.height + 'px';
        current = el;
      }

      var current = null;
      function move(event) { outline(event.target); }
      function click(event) {
        event.preventDefault();
        event.stopPropagation();
        var el = current || event.target;
        post({ selector: selectorFor(el), label: labelFor(el) });
        stop();
      }
      function key(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        post({ cancel: true });
        stop();
      }
      function stop() {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('click', click, true);
        document.removeEventListener('keydown', key, true);
        if (box.parentNode) box.parentNode.removeChild(box);
        window.__deepdivePicker = null;
      }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', key, true);
      window.__deepdivePicker = { stop: stop };
      return 'picking';
    })()
    """
}
