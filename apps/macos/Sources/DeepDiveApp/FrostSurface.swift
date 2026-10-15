// 浏览器页之上那颗悬浮对话卡的**原生磨砂底**。
//
// 为什么不是 CSS：卡片住在叠加层那个透明 WKWebView 里，网页的 `backdrop-filter`
// 只采样自己 webview 内的内容，采不到下面另一个 WKWebView（浏览器页）——模糊只能
// 由原生层给。这一块坐在叠加层之下、浏览器之上，位置与圆角跟着页面上报的卡片矩形走
// （`composer-pill`），`withinWindow` 混合的正是它下面的窗口内容 = 浏览器页。
//
// 只做"一块跟着矩形走、能淡进淡出的磨砂面"这一件事：拖拽、命中测试、显隐状态都归
// ComposerOverlayHost。

import AppKit

final class FrostSurface: NSVisualEffectView {
    /// 是否处于"该显示"的状态（含正在淡进/淡出）。**不是** `isHidden` 的镜像：
    /// 淡出期间它已经是 false，而 `isHidden` 要等动画跑完才翻。
    private var visible = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        // `.hudWindow` 是"盖在内容之上的浮层"那一档（深色、去饱和）；`.withinWindow`
        // 混合窗口内它下面的内容（浏览器那个 WKWebView），不是窗口后面的桌面。
        material = .hudWindow
        blendingMode = .withinWindow
        // `.active`：窗口失焦时也要保持磨砂，否则会渲染成一块死灰。
        state = .active
        // 圆角：自己这一层裁切——磨砂的合成结果是本层的子树，masksToBounds 把它一起裁圆。
        // `wantsLayer` 必须显式打开：NSVisualEffectView 默认不是 layer-backed，此时
        // `layer` 是 nil，`setRadius` 里的赋值会被可选链**静默吞掉**（圆角没了、不报错）。
        wantsLayer = true
        layer?.masksToBounds = true
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 跟上卡片的圆角（CSS px × 缩放；值由页面按实际渲染的 border-radius 报来）。
    func setRadius(_ radius: CGFloat) {
        layer?.cornerRadius = radius
    }

    /// 立刻回到"没显示"（新卡片来之前的清场）：不留淡出、不参与动画。
    func reset() {
        visible = false
        isHidden = true
        frame = .zero
    }

    /// 淡入：时长由页面按 token（`--dur-med`）报来，与卡片那层 CSS 的淡入同一时刻、
    /// 同一时长——两边分开算就会看出"一块东西分两次出现"。
    func fadeIn(duration: TimeInterval) {
        // 每 300ms 就有一条上报，这里必须幂等：否则入场动画会被反复重播。
        guard !visible else { return }
        visible = true
        // 只在真藏着的时候才归零：淡出途中又被叫出来时留着当前 alpha，接着淡回去，
        // 不闪一下。
        if isHidden {
            alphaValue = 0
            isHidden = false
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            animator().alphaValue = 1
        }
    }

    /// 淡出：跑完才藏起来并归零矩形（归零早了会当场少一块，看不出是淡出）。
    func fadeOut(duration: TimeInterval) {
        guard visible else { return }
        visible = false
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self else { return }
            // 淡出途中又被叫出来（可见态已翻回 true）：这次收尾作废，别把它藏了。
            guard !self.visible else { return }
            self.isHidden = true
            self.frame = .zero
        })
    }
}
