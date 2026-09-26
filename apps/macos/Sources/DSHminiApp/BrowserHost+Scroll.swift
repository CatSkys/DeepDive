// 页面 → 壳的**滚动回话**：阅读进度的来源（参考实现 ScrollRelay 的同一分工）。
// 标签栏那枚选中胶囊的灰底要"读到哪了"（0–1），只有页面自己知道滚动到哪——
// 壳没有别的方式拿到它，只有 script message handler 这条通道。
//
// 安全边界：只接受 {y, max} 两个数（页面伪造的最大后果是"灰底显示个假进度"）；
// 通道挂在弱代理上（WKUserContentController 强持有 handler，挂宿主自己会成环）。
import WebKit

/// 页面 → 壳的滚动回话代理：弱持有宿主。
final class BrowserScrollProxy: NSObject, WKScriptMessageHandler {
    weak var host: BrowserHost?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        host?.scrollReplied(message.body)
    }
}

extension BrowserHost {
    /// 注册滚动回话的 handler（宿主创建时调一次；脚本本体在每次页面落地后由
    /// `armScrollReport()` 经 evaluate 武装——WKUserScript 那条路在这台宿主上没跑起来，
    /// 而 evaluate 是图标/拾取都在用的既有通道）。
    func installScrollReport() {
        view.configuration.userContentController.add(scrollProxy, name: "deepdiveScroll")
    }

    /// 武装滚动上报：被动监听（scroll 事件 + requestAnimationFrame 合流），
    /// 一帧最多报一次，不与页面的平滑滚动抢帧。同一文档只武装一次，换页再武装。
    func armScrollReport() {
        evaluate(Self.scrollScript) { _ in }
    }

    func scrollReplied(_ body: Any) {
        guard let payload = body as? [String: Any],
              let y = payload["y"] as? Double,
              let max = payload["max"] as? Double
        else { return }
        onScroll?(y, max)
    }

    /// 与参考实现同一份逻辑：报 scrollY 与"还能滚多少"（scrollHeight - 视口，至少 1）。
    private static let scrollScript = """
    (function () {
      var waiting = false;
      function tell() {
        var root = document.documentElement;
        var y = window.scrollY || root.scrollTop || 0;
        var ceiling = Math.max(1, (root.scrollHeight || 0) - window.innerHeight);
        window.webkit.messageHandlers.deepdiveScroll.postMessage({ y: y, max: ceiling });
      }
      window.addEventListener('scroll', function () {
        if (waiting) return;
        waiting = true;
        requestAnimationFrame(function () { waiting = false; tell(); });
      }, { passive: true });
      tell();
    })();
    """
}
