import SwiftUI
import AppKit

// 迷你面板 SwiftUI 树（全原生重做，Atd 同构——用户 2026-10-12 拍板 web 混合方案
// 打回，他用 Swift 就用 Swift）。本文件只管三样视觉件：收起态药丸、展开条目列
// （状态槽 + 分隔线 + 钮）、命令卡；窗口/玻璃/点击与拖动归 `MiniPanelWindow.swift`。
// 图标 = Lucide SVG 经 `BrandPanelIcons` 转 NSImage（与主应用同一收口，无第二图标源）。
// 几何常量（胶囊 44×157 / 卡宽 224 / 行高 28）的事实源在窗口文件，这里只用布局镜像。

// MARK: - 模型（状态与动作的唯一拥有者；宿主回填）

/// 非 @MainActor：控制器（非隔离）回填与 SwiftUI 主线程消费都是同一线程族；
/// ObservableObject 的 didChange 派发本来就必须主线程，标注反成编译摩擦。
final class MiniPanelModel: ObservableObject {
    struct CommandItem: Identifiable {
        let name: String
        let description: String
        var id: String { name }
    }

    @Published var expanded = false
    @Published var flyoutOpen = false
    @Published var side = "right" // "left" | "right"
    @Published var running = false
    @Published var attention = false
    @Published var unseen = false
    @Published var quickSessionId: String?
    @Published var commands: [CommandItem] = []

    /// openMain / newSession —— 宿主闭包（窗口文件接，调回 AppDelegate）。
    var onAction: ((String) -> Void)?
    /// 跑一条命令：宿主闭包（切本体 → 快捷会话执行）。
    var onRunCommand: ((String) -> Void)?
    /// 命令卡开合后由宿主窗口重排（窗口宽/高随卡变）。
    var onFlyoutChanged: (() -> Void)?

    func perform(_ action: String) {
        onAction?(action)
    }

    func toggleFlyout() {
        guard quickSessionId != nil else { return }
        flyoutOpen.toggle()
        onFlyoutChanged?()
    }

    func runCommand(_ name: String) {
        onRunCommand?(name)
    }

    func setStatus(running: Bool, attention: Bool, unseen: Bool) {
        self.running = running
        self.attention = attention
        self.unseen = unseen
    }
}

// MARK: - 根（收起/展开两态由宿主窗口尺寸裁切；同一棵树换态无闪）

struct MiniPanelView: View {
    @ObservedObject var model: MiniPanelModel

    var body: some View {
        ZStack {
            if model.expanded {
                expandedStack
            } else {
                TuckedStatusDot(model: model)
            }
        }
    }

    /// 展开态：卡贴玻璃胶囊（条目列）。右缘 = 条目列贴右、卡在左；左缘镜像。
    private var expandedStack: some View {
        HStack(alignment: .center, spacing: 8) {
            if model.side == "left" {
                ItemStrip(model: model)
                CommandFlyout(model: model)
            } else {
                CommandFlyout(model: model)
                ItemStrip(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

// MARK: - 收起态（8×44 玻璃小胶囊上的状态符）

private struct TuckedStatusDot: View {
    @ObservedObject var model: MiniPanelModel

    var body: some View {
        StatusGlyph(model: model)
            .frame(width: 8, height: 44)
            // Atd pill-v2：未着色玻璃的小胶囊在纯色壁纸上不可见——玻璃内加一层
            // 中性色调（labelColor 20% 的黑白移植），黑壁纸上有轮廓。
            .background(Capsule().fill(Color.white.opacity(0.16)))
    }
}

// MARK: - 状态符（运行呼吸条 / 注意长条 / 未读短条；空闲空内容）——两态共用

private struct StatusGlyph: View {
    @ObservedObject var model: MiniPanelModel
    @State private var breathing = false

    var body: some View {
        Group {
            if model.running {
                Capsule()
                    .fill(Color.white.opacity(breathing ? 0.35 : 0.95))
                    .frame(width: 3, height: 15)
                    .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: breathing)
            } else if model.attention {
                Capsule().fill(Color.white).frame(width: 3, height: 21)
            } else if model.unseen {
                Capsule().fill(Color.white.opacity(0.85)).frame(width: 3, height: 8)
            }
        }
        .onAppear { breathing = true }
    }
}

// MARK: - 展开态条目列（状态槽 + 分隔线 + 三钮；玻璃胶囊由窗口裁形铺底）

private struct ItemStrip: View {
    @ObservedObject var model: MiniPanelModel

    var body: some View {
        VStack(spacing: 4) {
            StatusSlot(model: model)
            Capsule().fill(Color.white.opacity(0.18)).frame(width: 20, height: 1)
            ItemButton(model: model, action: "openMain", tip: "打开本体", icon: .panelLeft)
            ItemButton(model: model, action: "newSession", tip: "新会话", icon: .squarePen)
            ItemButton(model: model, tip: "命令", icon: .command, active: model.flyoutOpen) {
                model.toggleFlyout()
            }
        }
        .padding(.vertical, 6)
        .frame(width: 44)
    }
}

// MARK: - 状态槽（条目列第一格 32×32；Atd 此处是 logo，用户拍板不带品牌——空闲空槽）

private struct StatusSlot: View {
    @ObservedObject var model: MiniPanelModel

    var body: some View {
        StatusGlyph(model: model)
            .frame(width: 32, height: 32)
    }
}

// MARK: - 条目钮（32pt 圆钮；hover 白 9% / 按下 16%，Atd 按钮族的黑白移植）

private struct ItemButton: View {
    @ObservedObject var model: MiniPanelModel
    var action: String? = nil
    var tip: String
    var icon: BrandPanelIcon
    var active = false
    var onOpen: (() -> Void)? = nil

    @State private var hovered = false
    @State private var pressed = false

    private var fill: Color {
        pressed ? .white.opacity(0.16) : hovered ? .white.opacity(0.09) : .clear
    }

    var body: some View {
        Button {
            if let onOpen { onOpen() }
            if let action { model.perform(action) }
        } label: {
            Image(nsImage: icon.image)
                .resizable()
                .frame(width: 16, height: 16)
                .foregroundColor(Color.white.opacity(0.92))
                .frame(width: 32, height: 32)
                .background(Circle().fill(fill))
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .help(Text(tip))
    }
}

// MARK: - 命令卡（条目列旁的近实色浮卡；数据=主 SPA 推来的引擎命令目录）

private struct CommandFlyout: View {
    @ObservedObject var model: MiniPanelModel

    var body: some View {
        if model.flyoutOpen {
            VStack(alignment: .leading, spacing: 2) {
                if model.quickSessionId == nil {
                    FlyoutCaption("还没有快捷会话")
                } else if model.commands.isEmpty {
                    FlyoutCaption("暂无命令")
                } else {
                    ForEach(model.commands) { cmd in
                        FlyoutRow(name: cmd.name, description: cmd.description) {
                            model.runCommand(cmd.name)
                        }
                    }
                }
            }
            .padding(6)
            .frame(width: 224)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(white: 0.09, opacity: 0.96))
            )
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }
}

private struct FlyoutRow: View {
    let name: String
    let description: String
    let onRun: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: onRun) {
            HStack(spacing: 8) {
                Text("/\(name)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(description)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.white.opacity(0.5))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .frame(height: 28)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(hovered ? 0.10 : 0)))
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

private struct FlyoutCaption: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(Color.white.opacity(0.55))
            .padding(.horizontal, 10)
            .frame(height: 28)
    }
}
