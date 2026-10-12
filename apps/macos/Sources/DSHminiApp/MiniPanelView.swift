import SwiftUI
import AppKit

// 迷你面板 SwiftUI 树（全原生重做，Atd 同构——用户 2026-10-12 拍板 web 混合方案
// 打回，他用 Swift 就用 Swift）。本文件只管三样视觉件：收起态状态点、展开条目列
// （钮 + 悬停标签）、命令卡；窗口/玻璃/点击与拖动归 `MiniPanelWindow.swift`。
// 图标 = Lucide SVG 经 `BrandPanelIcons` 转 NSImage（与主应用同一收口，无第二图标源）。

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

    func perform(_ action: String) {
        onAction?(action)
    }

    func toggleFlyout() {
        guard quickSessionId != nil else { return }
        flyoutOpen.toggle()
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

    /// 展开态：右缘模式 钮条在右、卡在左；左缘模式镜像。
    private var expandedStack: some View {
        HStack(alignment: .center, spacing: 8) {
            if model.side == "left" {
                CommandFlyout(model: model)
                ItemStrip(model: model)
            } else {
                ItemStrip(model: model)
                CommandFlyout(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

// MARK: - 收起态（8×44 玻璃小胶囊上面的状态点）

private struct TuckedStatusDot: View {
    @ObservedObject var model: MiniPanelModel
    @State private var breathing = false

    var body: some View {
        Group {
            if model.running {
                Capsule()
                    .fill(Color.white.opacity(breathing ? 0.35 : 0.95))
                    .frame(width: 3, height: 15)
                    .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: breathing)
                    .onAppear { breathing = true }
            } else if model.attention {
                Capsule().fill(Color.white).frame(width: 3, height: 21)
            } else if model.unseen {
                Capsule().fill(Color.white.opacity(0.85)).frame(width: 3, height: 8)
            }
        }
        .frame(width: 8, height: 44)
    }
}

// MARK: - 展开态条目列（44 宽玻璃竖条；玻璃由窗口铺，这里只有钮/点/标签）

private struct ItemStrip: View {
    @ObservedObject var model: MiniPanelModel

    var body: some View {
        VStack(spacing: 8) {
            if model.running || model.attention || model.unseen {
                StatusDot(model: model)
                    .padding(.top, 2)
            }
            ItemButton(model: model, action: "openMain", tip: "打开本体", icon: .panelLeft)
            ItemButton(model: model, action: "newSession", tip: "新会话", icon: .squarePen)
            ItemButton(model: model, tip: "命令", icon: .command, active: model.flyoutOpen) {
                model.toggleFlyout()
            }
        }
        .padding(.vertical, 8)
        .frame(width: 44)
    }
}

// MARK: - 条目钮（28pt 圆钮；hover 白 9% / 按下 16%，Atd 按钮族的黑白移植）

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
                .frame(width: 15, height: 15)
                .foregroundColor(Color.white.opacity(0.92))
                .frame(width: 28, height: 28)
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
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(white: 0.09, opacity: 0.96))
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
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
            VStack(alignment: .leading, spacing: 1) {
                Text("/\(name)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.92))
                if !description.isEmpty {
                    Text(description)
                        .font(.system(size: 12))
                        .lineLimit(1)
                        .foregroundStyle(Color.white.opacity(0.55))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(hovered ? 0.10 : 0)))
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
            .padding(.vertical, 8)
    }
}

// MARK: - 状态点（条目列顶端的那枚；黑白符号+亮度）

private struct StatusDot: View {
    @ObservedObject var model: MiniPanelModel
    @State private var breathing = false

    var body: some View {
        Group {
            if model.running {
                Capsule().fill(Color.white.opacity(breathing ? 0.35 : 0.95))
                    .frame(width: 3, height: 15)
            } else if model.attention {
                Capsule().fill(Color.white).frame(width: 3, height: 21)
            } else {
                Capsule().fill(Color.white.opacity(0.85)).frame(width: 3, height: 8)
            }
        }
        .onAppear { breathing = true }
    }
}
