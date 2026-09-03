import AppKit

/// Native recovery surface: shown when the engine fails to boot repeatedly.
/// Carries the reason, a tail of the engine log, copy-diagnostics, and retry.
/// Per SPEC-ENGINE-RUNTIME §4.4 it also closes the credentials cold-start
/// loop: a missing `.credentials.yaml` offers "open settings" (configure the
/// key via `credentials.set`) and, when `~/.dsh/.credentials.yaml` exists, a
/// one-click import instead of telling the user to copy files by hand.
final class RecoveryWindowController: NSWindowController {
    var onRetry: (() -> Void)?
    var onOpenSettings: (() -> Void)?

    private let textView = NSTextView()
    private let reasonLabel = NSTextField(labelWithString: "")
    private let openSettingsButton = NSButton(title: "打开设置（配置 API Key）", target: nil, action: nil)
    private let importButton = NSButton(title: "从 ~/.dsh 导入凭据", target: nil, action: nil)

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 400),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "DSHmini — 引擎异常"
        window.isReleasedWhenClosed = false
        // 恢复屏是"当次启动"的诊断面：不参与 macOS 窗口状态恢复，否则引擎
        // 健康的新实例会被历史恢复窗骚扰（实测：pkill 交付链反复复现）。
        window.isRestorable = false
        super.init(window: window)
        window.center()

        let content = NSView()
        window.contentView = content

        reasonLabel.translatesAutoresizingMaskIntoConstraints = false
        reasonLabel.font = .systemFont(ofSize: 13)
        reasonLabel.textColor = .secondaryLabelColor
        reasonLabel.maximumNumberOfLines = 3
        reasonLabel.lineBreakMode = .byWordWrapping

        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder

        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.textContainerInset = NSSize(width: 8, height: 8)
        scroll.documentView = textView

        let copy = NSButton(title: "复制诊断", target: self, action: #selector(copyDiagnostics(_:)))
        let retry = NSButton(title: "重试", target: self, action: #selector(retry(_:)))
        retry.keyEquivalent = "\r"
        copy.bezelStyle = .rounded
        retry.bezelStyle = .rounded
        openSettingsButton.bezelStyle = .rounded
        openSettingsButton.target = self
        openSettingsButton.action = #selector(openSettings(_:))
        importButton.bezelStyle = .rounded
        importButton.target = self
        importButton.action = #selector(importCredentials(_:))
        for b in [copy, retry, openSettingsButton, importButton] {
            b.translatesAutoresizingMaskIntoConstraints = false
        }

        content.addSubview(reasonLabel)
        content.addSubview(scroll)
        content.addSubview(copy)
        content.addSubview(retry)
        content.addSubview(openSettingsButton)
        content.addSubview(importButton)

        NSLayoutConstraint.activate([
            reasonLabel.topAnchor.constraint(equalTo: content.topAnchor, constant: 16),
            reasonLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            reasonLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),

            scroll.topAnchor.constraint(equalTo: reasonLabel.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            scroll.bottomAnchor.constraint(equalTo: retry.topAnchor, constant: -12),

            retry.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -16),
            retry.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            copy.centerYAnchor.constraint(equalTo: retry.centerYAnchor),
            copy.trailingAnchor.constraint(equalTo: retry.leadingAnchor, constant: -8),
            openSettingsButton.centerYAnchor.constraint(equalTo: retry.centerYAnchor),
            openSettingsButton.trailingAnchor.constraint(equalTo: copy.leadingAnchor, constant: -8),
            importButton.centerYAnchor.constraint(equalTo: retry.centerYAnchor),
            importButton.trailingAnchor.constraint(equalTo: openSettingsButton.leadingAnchor, constant: -8),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 200),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(reason: String, log: String) {
        reasonLabel.stringValue = reason
        textView.string = log
        refreshContextualActions()
        guard let window else { return }
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func hide() {
        window?.orderOut(nil)
    }

    /// §4.4 cold-start loop: credentials missing → offer settings + import.
    private func refreshContextualActions() {
        let creds = AppPaths.harnessHome.appendingPathComponent(".credentials.yaml")
        let missing = !FileManager.default.fileExists(atPath: creds.path)
        let legacy = FileManager.default.fileExists(
            atPath: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".dsh/.credentials.yaml").path
        )
        openSettingsButton.isHidden = !missing
        importButton.isHidden = !(missing && legacy)
    }

    @objc private func copyDiagnostics(_ sender: Any?) {
        let payload = "\(reasonLabel.stringValue)\n\n[engine log]\n\(textView.string)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(payload, forType: .string)
    }

    @objc private func openSettings(_ sender: Any?) {
        onOpenSettings?()
    }

    @objc private func importCredentials(_ sender: Any?) {
        let src = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".dsh/.credentials.yaml")
        let dst = AppPaths.harnessHome.appendingPathComponent(".credentials.yaml")
        do {
            try FileManager.default.createDirectory(at: AppPaths.harnessHome, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: dst.path) {
                try FileManager.default.copyItem(at: src, to: dst)
            }
            EngineLog.shared.append("[recovery] credentials imported from ~/.dsh/.credentials.yaml")
            hide()
            onRetry?()
        } catch {
            EngineLog.shared.append("[recovery] import failed: \(error.localizedDescription)")
            reasonLabel.stringValue = "导入失败：\(error.localizedDescription)"
            refreshContextualActions()
        }
    }

    @objc private func retry(_ sender: Any?) {
        hide()
        onRetry?()
    }
}
