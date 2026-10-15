import AVFoundation
import Speech

/// 听写（Apple 自带语音识别）：AVAudioEngine 采集麦克风 →
/// SFSpeechAudioBufferRecognitionRequest 流式识别。partial 实时回推，
/// isFinal 回推终稿。识别语言见 `resolveLocale`——**不是** `SFSpeechRecognizer()`
/// 默认构造，那个在未声明本地化的 app 里恒落回英文。
///
/// 权限：语音识别授权 + 麦克风授权（macOS 14+ 走 AVAudioApplication，
/// 更早系统没有显式 API，首次采集由 TCC 自动弹窗）。音频会话配置同样
/// 仅 macOS 14+ 可用，旧系统跳过——引擎直接采集不受影响。
final class DictationController: NSObject {
    static let shared = DictationController()

    /// 识别中间结果（随说话持续更新）。
    var onPartial: ((String) -> Void)?
    /// 终稿（用户停止或识别器判定说完后触发一次）。
    var onFinal: ((String) -> Void)?
    /// 权限缺失 / 引擎启动失败等不可恢复错误。
    var onError: ((String) -> Void)?

    private(set) var running = false

    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// 授权是异步的：连点两次 start 会穿破 `running` 检查，beginRecording
    /// 跑两遍并漏拆第一套 AVAudioEngine tap（AUD-030）——starting 位封住窗口。
    private var starting = false

    func start() {
        guard !running, !starting else { return }
        starting = true
        SFSpeechRecognizer.requestAuthorization { [weak self] _ in
            self?.requestMicAccess { [weak self] granted in
                DispatchQueue.main.async {
                    self?.starting = false
                    granted ? self?.beginRecording()
                            : self?.fail("麦克风未授权（系统设置 → 隐私与安全性）")
                }
            }
        }
    }

    /// 用户主动停止：结束喂音并让识别器产出终稿（onFinal 随后到达）。
    func stop() {
        guard running else { return }
        request?.endAudio()
        engine?.stop()
        task?.finish()
    }

    /// 识别语言：从用户偏好语言里挑一个识别器支持的那个。
    ///
    /// **不能用 `SFSpeechRecognizer()` 的默认构造**（纯函数，单测钉子）：它取
    /// `Locale.current`，而 macOS 上那是"用户偏好 ∩ App 自身本地化"——本 app 没有声明
    /// 任何本地化（`CFBundleDevelopmentRegion` = 开发语言 `en`），于是它恒落回英文，
    /// **与系统语言无关**。用户实测报的"一直是英文"就是这个（中文系统 + 识别成英文）。
    ///
    /// 匹配交给 Foundation 而不是自己写前缀比较：偏好语言是**脚本形式**
    /// （`zh-Hans-CN`），识别器支持的是**区域形式**（实测 `zh-CN` / `zh-HK` / `zh-TW`），
    /// 前缀匹配对不上；`Bundle.preferredLocalizations` 正是为这件事设计的，
    /// 实测 `zh-Hans-CN → zh-CN`、`zh-Hant-TW → zh-TW`、`ja-JP → ja-JP`。
    ///
    /// 一个不直观但已实测的兜底：一个都匹配不上时（含支持集为空），Foundation 回的是
    /// **bundle 的开发语言**（我们是 `en`），不是空数组。所以这里不必再垫 nil 分支；
    /// 真递出一个不受支持的标识时，`SFSpeechRecognizer(locale:)` 会返回 nil，
    /// 调用方走"找不到可用的识别语言"。
    static func resolveLocale(preferred: [String], supported: [String]) -> Locale? {
        guard let best = Bundle.preferredLocalizations(from: supported, forPreferences: preferred).first else {
            return nil
        }
        return Locale(identifier: best)
    }

    private func beginRecording() {
        // 识别语言显式解析，不用默认构造——理由见 resolveLocale。
        let supported = SFSpeechRecognizer.supportedLocales().map(\.identifier)
        let preferred = Locale.preferredLanguages
        guard let locale = Self.resolveLocale(preferred: preferred, supported: supported),
              let recognizer = SFSpeechRecognizer(locale: locale) else {
            fail("找不到可用的识别语言")
            return
        }
        guard recognizer.isAvailable else {
            fail("语音识别当前不可用")
            return
        }
        // 选中的语言是"看不见的决定"，落一行日志：用户报"识别成英文"时这里是第一现场。
        EngineLog.shared.append("[dictation] locale \(locale.identifier) (可用 \(supported.count) 种；偏好 \(preferred.prefix(3).joined(separator: ", ")))")
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            fail("麦克风格式不可用")
            return
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            fail("无法启动麦克风：\(error.localizedDescription)")
            return
        }
        // macOS 没有 AVAudioSession（iOS 专属）：引擎直接采集即可。

        self.engine = engine
        self.request = request
        running = true

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let text = result?.bestTranscription.formattedString, !text.isEmpty {
                DispatchQueue.main.async {
                    if result?.isFinal == true {
                        self.onFinal?(text)
                        self.teardown()
                    } else {
                        self.onPartial?(text)
                    }
                }
            }
            if error != nil {
                DispatchQueue.main.async { self.teardown() }
            }
        }
    }

    private func requestMicAccess(_ completion: @escaping (Bool) -> Void) {
        if #available(macOS 14.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: completion)
        } else {
            completion(true)
        }
    }

    private func fail(_ message: String) {
        teardown()
        onError?(message)
    }

    private func teardown() {
        guard running else { return }
        running = false
        if let engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        request?.endAudio()
        task?.finish()
        task = nil
        request = nil
        engine = nil
    }
}
