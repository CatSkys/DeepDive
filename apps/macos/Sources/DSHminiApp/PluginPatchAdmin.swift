// 插件开关的落盘面（设置 → 插件）：把用户在列表里拨的启停写成引擎 **home 级**
// patch 层 `<DSH_HOME>/cordis.patch.yml` 里的托管块。
//
// 为什么是这一层（2026-09-17 实机验证）：引擎 web profile 以 `patchReload: live`
// 监视 profile 与 home 两层 cordis.patch.yml 并事务性重应用 —— 实测写入后 4 秒内
// `pluginInventory/list` 即翻转（enabled true → false → true 可逆），**不需要重启引擎**。
// app 自有的 engine-patch.yml 走 `--patch` overlay：每次启动被重写，也不在 live 监视之列，
// 那是部署级装配（automation / session-memory）的家，不是用户开关的家。
//
// 目标行的 id 是 **行 id**（`hmr`），不是 inventory 的 entryId（`include:hmr`）——
// 后者写进 patch 只会 warn `entry not found`，看着像"改了没生效"（PITFALLS §7.6）。
//
// 块读写原语在 ManagedPatchBlock（与 MCP server 行共用同一份文件）。纪律：托管块之外的
// 内容归用户，逐字保留。

import Foundation

enum PluginPatchAdmin {
    /// 插件开关的托管块。
    static let marker = ManagedPatchBlock.Marker(
        begin: "# >>> DeepDive managed — plugin switches (do not edit) >>>",
        end: "# <<< DeepDive managed <<<",
    )

    /// 一条用户显式设置过的开关。
    struct Toggle: Equatable {
        var rowId: String
        var disabled: Bool
    }

    /// home 级 patch 层路径（引擎 live 监视的两层之一）。
    static func fileURL(home: URL) -> URL {
        home.appendingPathComponent("cordis.patch.yml")
    }

    /// 当前托管块里的开关条目（按行 id 升序）。
    static func toggles(in home: URL) -> [Toggle] {
        guard let text = try? String(contentsOf: fileURL(home: home), encoding: .utf8) else { return [] }
        return parseManaged(text)
    }

    /// 拨一行：改写托管块并落盘。成功回 nil，否则回给用户看的原因。
    /// 同一行恒只留一条（拨多次是覆盖，不是追加）——`disabled: false` 同样要记下来：
    /// 对 bundle 默认就禁用的行（如 `hmr`），「打开」只能靠这条显式覆盖表达。
    static func set(rowId: String, disabled: Bool, in home: URL) -> String? {
        let url = fileURL(home: home)
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        var next = parseManaged(existing).filter { $0.rowId != rowId }
        next.append(Toggle(rowId: rowId, disabled: disabled))
        do {
            try compose(existing: existing, toggles: next).write(to: url, atomically: true, encoding: .utf8)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: - 纯函数（单测钉子）

    /// 现有正文 + 开关表 → 新正文（段外内容由 ManagedPatchBlock 逐字保留；
    /// 条目按行 id 排序，输出稳定便于人工 diff）。
    static func compose(existing: String, toggles: [Toggle]) -> String {
        ManagedPatchBlock.replacing(existing, marker: marker, body: body(of: toggles))
    }

    /// 托管块里的条目。块外内容不参与（用户手写的 patch 与我们无关）。
    /// 只认本文件写出的「`- id:` 一行 + `disabled:` 一行」形状。
    static func parseManaged(_ text: String) -> [Toggle] {
        var out: [Toggle] = []
        var pending: String?
        for line in ManagedPatchBlock.lines(of: text, marker: marker) {
            if let id = ManagedPatchBlock.scalar(line, key: "- id:") {
                pending = id
            } else if let flag = ManagedPatchBlock.scalar(line, key: "disabled:"), let rowId = pending {
                out.append(Toggle(rowId: rowId, disabled: flag == "true"))
                pending = nil
            }
        }
        return out
    }

    private static func body(of toggles: [Toggle]) -> [String] {
        toggles.sorted { $0.rowId < $1.rowId }.flatMap { toggle in
            ["- id: \(ManagedPatchBlock.yamlString(toggle.rowId))", "  disabled: \(toggle.disabled ? "true" : "false")"]
        }
    }
}
