// 拖放板上"能按路径处理的东西"的唯一一份读法：**文件与目录两类 URL**。
//
// 页面（DOM）拿不到本机路径——WebKit 给拖放的 `types` 只有 `["Files"]`、`getAsString` 对
// 文件项根本不回调（PITFALLS §4.36），所以凡是要按路径处理一投，都在壳里读拖放板。三处
// 拖放落点共用这一份，别再各写一遍：主窗 SPA（`TitlebarAwareWebView`）、迷你面板页
// （`QuickPanelController` 的同一类）、浏览器页上那颗悬浮对话卡（`ComposerOverlayView`）。
// 管什么：读 URL、分辨目录与否、给桥用的目录项形状。不管什么：谁接这一投、投完干什么。

import AppKit

enum DragPasteboard {
    /// 拖放板上的**文件与目录** URL（可执行文件等非 file URL 由读取选项滤掉）。
    static func fileURLs(_ sender: NSDraggingInfo) -> [URL] {
        sender.draggingPasteboard.readObjects(
            forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    }

    /// 拖放板上的**目录** URL。判据是**问磁盘**：实测 Finder 给的目录 URL `hasDirectoryPath`
    /// 是 `false`（URL 尾巴没有斜杠），只看 URL 认不出来（PITFALLS §4.36）。
    static func folderURLs(_ sender: NSDraggingInfo) -> [URL] {
        fileURLs(sender).filter {
            (try? $0.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
        }
    }

    /// 目录 URL → 桥的附件项（与前端 `PickedAttachment` 同形的最小集）：路径足够前端把它
    /// 转成 `@` 引用（引擎宿主侧读盘）。目录没有字节，也没有大小可报。
    static func folderItems(_ urls: [URL]) -> [[String: Any]] {
        urls.map { ["path": $0.path, "name": $0.lastPathComponent, "isDir": true] }
    }
}
