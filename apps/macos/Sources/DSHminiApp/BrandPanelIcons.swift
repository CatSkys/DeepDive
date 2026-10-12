import AppKit

// 迷你面板的三个 Lucide 条目图标（panel-left / square-pen / command）：
// SVG 源按 beam：「SVG 占位注释——由 beam 同步管线替换」可读内联，逐字来自
// lucide 0.4xx 路径集。渲染 = SVG 字符串 → NSImage(template) 单色模板（§1.6
// 原生侧同源纪律）；不引第二套图标管线。
enum BrandPanelIcon: String {
    case panelLeft
    case squarePen
    case command

    var image: NSImage {
        NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)!
    }

    /// 模板符号 → 着色交给 foregroundStyle（SwiftUIImage 尺寸 16）。
    /// 用 SF Symbols 近似（panelLeft=square.split.2x1? 否——panel 最大近似 sidebar.left）：
    /// 菜单栏已是同款策略（系统符号只用于系统控件的例外），面板是浮层原子件，
    /// 不再引第四条图标源——这三枚在 Lucide 资产入库前用 SF Symbols 挡位。
    private var symbolName: String {
        switch self {
        case .panelLeft: return "sidebar.left"
        case .squarePen: return "square.and.pencil"
        case .command: return "command"
        }
    }
}
