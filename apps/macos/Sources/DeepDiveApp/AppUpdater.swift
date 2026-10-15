import AppKit
import Sparkle

/// DeepDive 自身的应用更新（Sparkle）。管什么：检查/下载/安装的编排，以及「正在下载的
/// 版本」与「已下载待装的版本（含它的发布日期与说明正文）」这两份状态；不管什么：下载与
/// 校验（Sparkle 自己做，EdDSA 公钥在 Info.plist 的 `SUPublicEDKey`）、界面的样子（原生
/// 入口在 MainMenu / StatusItemController，前端那颗标题栏钮与设置页那一屏经桥事件
/// `updateState`；菜单项那行文案由 `menuTitle(for:)` 给）。
///
/// 「多久查一次、要不要自动装」全部由 Info.plist 的 `SU*` 键定（每小时后台查、静默下载、
/// 退出即装，与 Atd 同档）；这里只补 Sparkle 不知道的三件事——下载**开始**时就把版本号
/// 交出去（本来只有下完才知道，整段下载是空白的）、下载完不弹窗而是把版本号交给界面自己给
/// 入口，以及那一次安装由 Sparkle 存下来的 immediate 回调触发。
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
    /// 发现且正在下载的那个版本号。Sparkle 是静默下载，界面若只在下载完才出现，整个下载期
    /// 用户看不到任何痕迹——所以「发现」与「下好」是两个状态（对照 ZCode 的
    /// 发现新版本 / 正在下载 / 已准备就绪三态）。
    private(set) var downloadingVersion: String?
    /// 那一版的发布日期（appcast 的 pubDate → ISO8601）与说明正文（`sparkle:releaseNotesLink`
    /// 指的 Markdown）。说明要另拉一次，所以它比版本号晚到；拉不到就是 nil，卡片少一段正文。
    private(set) var readyDate: String?
    private(set) var readyNotes: String?
    /// 状态变化（壳据此把新状态推给前端）。
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

    /// 菜单那一项该长什么样。App 菜单与状态栏菜单是两份 NSMenu，文案与动作必须同源——
    /// 判断与文案都收在这里（与 `isSupported` 同一套做法：一处判断，两处引用）。
    enum MenuState: Equatable {
        case check
        case downloading(String)
        case restart(String)

        /// 下载中那一项是**状态展示**而非入口：点它没有意义，菜单里禁用它
        /// （一个点下去什么都不发生的菜单项比没有它更难查）。
        var isActionable: Bool {
            switch self {
            case .check, .restart: return true
            case .downloading: return false
            }
        }
    }

    /// 待装的压过在下的：下载完那一刻两个字段会同时短暂为真，显示「重启以更新」才对。
    var menuState: MenuState {
        if let readyVersion { return .restart(readyVersion) }
        if let downloadingVersion { return .downloading(downloadingVersion) }
        return .check
    }

    static func menuTitle(for state: MenuState) -> String {
        switch state {
        case .check: return "检查更新…"
        case .downloading(let version): return "正在下载 \(version)…"
        case .restart(let version): return "重启以更新（\(version)）"
        }
    }

    /// 设置页「关于」与标题栏那颗钮的状态载荷（桥事件 `updateState`）。键名即契约
    /// （docs/ARCHITECTURE.md §2 通信矩阵），改这里要同步 frontend/src/host.ts。
    /// 写成纯函数是为了让两种构建的各一态都有可钉住的断言。
    static func statusPayload(
        currentVersion: String, readyVersion: String?, downloadingVersion: String?,
        readyDate: String?, readyNotes: String?, canUpdate: Bool
    ) -> [String: Any] {
        [
            "currentVersion": currentVersion,
            // null 而不是空串：前端据此区分「没有待装更新」与「待装但版本号读不到」。
            "readyVersion": readyVersion ?? NSNull(),
            "downloadingVersion": downloadingVersion ?? NSNull(),
            "readyDate": readyDate ?? NSNull(),
            "readyNotes": readyNotes ?? NSNull(),
            "canUpdate": canUpdate,
        ]
    }

    var status: [String: Any] {
        Self.statusPayload(
            currentVersion: Self.appVersion, readyVersion: readyVersion,
            downloadingVersion: downloadingVersion, readyDate: readyDate,
            readyNotes: readyNotes, canUpdate: Self.isSupported
        )
    }

    /// 拉 appcast 指的那份发布说明，回来后把状态再推一次（卡片先出「已下载 x.y.z」，
    /// 正文随后补上）。拉不到不是错误——卡片少一段正文照常能用，但别静默（铁律 5）。
    private func refreshNotes(from url: URL) {
        Task { @MainActor in
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let text = String(data: data, encoding: .utf8), !text.isEmpty
                else {
                    EngineLog.shared.append("[update] release notes unusable: \(url.absoluteString)")
                    return
                }
                readyNotes = text
                onChange?()
            } catch {
                // 症状是这个：发布仓改名 / 资产没传上去 / 没网。卡片退化成「只有版本与日期」。
                EngineLog.shared.append("[update] release notes fetch failed: \(error.localizedDescription)")
            }
        }
    }
}

extension AppUpdater: SPUUpdaterDelegate {
    /// 找到一个比当前新的版本，Sparkle 这就开始静默下载。此刻就把版本号交出去，界面在
    /// 下载期也有东西可显示（否则整段下载是空白的，只有下完那一瞬才冒出来）。
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        downloadingVersion = item.displayVersionString
        onChange?()
    }

    /// 下载落地。真正「待装」的状态由下面 `willInstallUpdateOnQuit` 给（它带安装回调），
    /// 这里只把「正在下载」收掉。
    func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) {
        clearDownloading()
    }

    /// 这一轮没有可用的更新（已经是最新）。
    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        clearDownloading()
    }

    /// 下载失败与整轮会话中断，都要把「正在下载」收掉——否则那一行会一直挂在界面上。
    func updater(_ updater: SPUUpdater, failedToDownloadUpdate item: SUAppcastItem, error: Error) {
        EngineLog.shared.append("[update] download failed: \(error.localizedDescription)")
        clearDownloading()
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        EngineLog.shared.append("[update] aborted: \(error.localizedDescription)")
        clearDownloading()
    }

    private func clearDownloading() {
        guard downloadingVersion != nil else { return }
        downloadingVersion = nil
        onChange?()
    }

    /// 静默下载完的更新在等退出时装它。返回 true = 这一次不惊动用户（界面自己有入口），
    /// 但装照装：退出时装它，点「重启以安装」也装它。
    func updater(
        _ updater: SPUUpdater,
        willInstallUpdateOnQuit item: SUAppcastItem,
        immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
    ) -> Bool {
        installHandler = immediateInstallHandler
        readyVersion = item.displayVersionString
        downloadingVersion = nil
        // pubDate 给的是 RFC822，转成 ISO8601 再上桥（前端 `new Date()` 两种都认，
        // 但 ISO 没有时区陷阱）。
        readyDate = item.date.map { ISO8601DateFormatter().string(from: $0) }
        readyNotes = nil
        onChange?()
        if let notesURL = item.releaseNotesURL { refreshNotes(from: notesURL) }
        return true
    }
}
