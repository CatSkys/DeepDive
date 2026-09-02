import AVFoundation
import Speech

/// 听写（Apple 自带语音识别）：AVAudioEngine 采集麦克风 →
/// SFSpeechAudioBufferRecognitionRequest 流式识别。partial 实时回推，
/// isFinal 回推终稿。识别区域语言跟随系统（SFSpeechRecognizer() 默认构造）。
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

    func start() {
        guard !running else { return }
        SFSpeechRecognizer.requestAuthorization { [weak self] _ in
            self?.requestMicAccess { [weak self] granted in
                DispatchQueue.main.async {
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

    private func beginRecording() {
        let recognizer = SFSpeechRecognizer()
        guard recognizer?.isAvailable == true else {
            fail("语音识别当前不可用")
            return
        }
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

        task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
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
