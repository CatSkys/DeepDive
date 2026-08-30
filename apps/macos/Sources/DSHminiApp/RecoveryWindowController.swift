import AppKit

/// Native recovery surface: shown when the engine fails to boot repeatedly.
/// Carries the reason, a tail of the engine log, copy-diagnostics, and retry.
final class RecoveryWindowController: NSWindowController {
    var onRetry: (() -> Void)?

    private let textView = NSTextView()
    private let reasonLabel = NSTextField(labelWithString: "")

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 400),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "DSHmini — 引擎异常"
        window.isReleasedWhenClosed = false
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
        copy.translatesAutoresizingMaskIntoConstraints = false
        retry.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(reasonLabel)
        content.addSubview(scroll)
        content.addSubview(copy)
        content.addSubview(retry)

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
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 200),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(reason: String, log: String) {
        reasonLabel.stringValue = reason
        textView.string = log
        guard let window else { return }
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func hide() {
        window?.orderOut(nil)
    }

    @objc private func copyDiagnostics(_ sender: Any?) {
        let payload = "\(reasonLabel.stringValue)\n\n[engine log]\n\(textView.string)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(payload, forType: .string)
    }

    @objc private func retry(_ sender: Any?) {
        hide()
        onRetry?()
    }
}
