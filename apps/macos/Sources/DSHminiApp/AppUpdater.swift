import AppKit
import Sparkle

/// DeepDive 自身的应用更新（Sparkle）。管什么：检查/下载/安装的编排，以及「已下载待装
/// 的版本」这一份状态；不管什么：下载与校验（Sparkle 自己做，EdDSA 公钥在 Info.plist 的
/// `SUPublicEDKey`）、界面（原生入口在 MainMenu / StatusItemController，设置页那一屏
/// 经桥事件 `updateState`）。
///
/// 「多久查一次、要不要自动装」全部由 Info.plist 的 `SU*` 键定（每小时后台查、静默下载、
/// 退出即装，与 Atd 同档）；这里只补两件壳才知道的事——下载好的更新先不弹窗，把版本号
/// 交给界面自己给入口；那一次安装由 Sparkle 存下来的 immediate 回调触发。
final class AppUpdater: NSObject {
    /// 这个构建会不会更新——**唯一的那一处判断**，菜单摆不摆「检查更新…」与设置页显不
    /// 显示更新入口都看它。
    ///
    /// Debug 构建永不更新：`make dev` 跑的是开发包，被 Release 覆盖掉等于白改。所以入口
    /// 也一并收掉：一个点下去什么都不发生的菜单项，比没有这个菜单项更难查。
    static var isSupported: Bool {
        #if DEBUG
        false
        #else
        true
        #endif
    }

    /// 已下载待安装的版本号（还没有就是 nil）。
    private(set) var readyVersion: String?
    /// 状态变化（壳据此把新状态推给设置页）。
    var onChange: (() -> Void)?

    /// 不支持的构建里它就是 nil——这是设计出来的状态，不是没接好。
    private var controller: SPUStandardUpdaterController?
    /// Sparkle 给的「立刻装」回调：调它即替换应用并重启。退出时的安装也走它。
    private var installHandler: (() -> Void)?

    /// 当前应用版本。事实源是 apps/macos/project.yml 的两个版本键（Info.plist 由
    /// xcodegen 从它生成），这里只读、不另存一份。
    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    /// 起更新器：距上次检查超过间隔就立刻查一次（间隔与判断都归 Sparkle）。
    func start() {
        guard Self.isSupported else { return }
        controller = SPUStandardUpdaterController(
            startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil
        )
    }

    /// 用户主动要的一次检查：走 Sparkle 自己的进度与结果窗。它可能在后台，先激活本应用，
    /// 否则窗口出现在别的应用后面（看起来像没反应）。
    func checkForUpdates() {
        NSApp.activate()
        controller?.checkForUpdates(nil)
    }

    /// 立刻装下已下载的那一份并重启。
    func installNow() {
        installHandler?()
    }

    /// 设置页「关于」那一屏的状态载荷（桥事件 `updateState`）。键名即契约
    /// （docs/ARCHITECTURE.md §2 通信矩阵），改这里要同步 frontend/src/host.ts。
    /// 写成纯函数是为了让两种构建的各一态都有可钉住的断言。
    static func statusPayload(
        currentVersion: String, readyVersion: String?, canUpdate: Bool
    ) -> [String: Any] {
        [
            "currentVersion": currentVersion,
            // null 而不是空串：前端据此区分「没有待装更新」与「待装但版本号读不到」。
            "readyVersion": readyVersion ?? NSNull(),
            "canUpdate": canUpdate,
        ]
    }

    var status: [String: Any] {
        Self.statusPayload(
            currentVersion: Self.appVersion, readyVersion: readyVersion, canUpdate: Self.isSupported
        )
    }
}

extension AppUpdater: SPUUpdaterDelegate {
    /// 静默下载完的更新在等退出时装它。返回 true = 这一次不惊动用户（界面自己有入口），
    /// 但装照装：退出时装它，点「立即安装」也装它。
    func updater(
        _ updater: SPUUpdater,
        willInstallUpdateOnQuit item: SUAppcastItem,
        immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
    ) -> Bool {
        installHandler = immediateInstallHandler
        readyVersion = item.displayVersionString
        onChange?()
        return true
    }
}
