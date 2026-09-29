// home 级 patch 层（`<DSH_HOME>/cordis.patch.yml`）里「托管块」的读写原语。
//
// 这份文件属于用户（引擎的机器本地偏好层），DeepDive 只拥有带标记的那几段：
// **段外内容逐字保留** —— 纯字符串切分，不解析 YAML（别拿手搓解析器去碰用户的文件）。
//
// 这份文件里的两对标记都归引擎了：插件开关块（`- id/disabled`）与 MCP server 行
// （`- insert`），标记与写入格式逐字节钉在 packages/host/plugin-inventory/src/
// {patch-admin,mcp-admin}.ts。壳侧已无写者——本文件只剩读写原语，供未来需要时复用。

import Foundation

enum ManagedPatchBlock {
    /// 一对边界行。
    struct Marker {
        let begin: String
        let end: String
    }

    /// home 级 patch 层路径（引擎 `patchReload: live` 监视的两层之一）。
    static func homePatchURL(home: URL) -> URL {
        home.appendingPathComponent("cordis.patch.yml")
    }

    /// 块内行（不含标记本身）；没有块、或只有半个标记时为空。
    static func lines(of text: String, marker: Marker) -> [String] {
        let all = normalized(text)
        guard let begin = all.firstIndex(of: marker.begin), let end = all[begin...].firstIndex(of: marker.end) else {
            return []
        }
        return Array(all[all.index(after: begin)..<end])
    }

    /// 去掉块（连同紧邻的空行），保留其余内容。
    /// 只有半个标记（用户删过？）时切到标记处为止，不猜它的边界。
    static func strip(_ text: String, marker: Marker) -> String {
        let all = normalized(text)
        guard let begin = all.firstIndex(of: marker.begin) else { return all.joined(separator: "\n") }
        guard let end = all[begin...].firstIndex(of: marker.end) else {
            return all[..<begin].joined(separator: "\n")
        }
        return (all[..<begin] + all[all.index(after: end)...]).joined(separator: "\n")
    }

    /// 用 body 替换块；body 为空则移除块。空行归一：块前不留多余空行。
    static func replacing(_ text: String, marker: Marker, body: [String]) -> String {
        var kept = strip(text, marker: marker)
        while kept.hasSuffix("\n\n") { kept.removeLast() }
        guard !body.isEmpty else { return kept.trimmingCharacters(in: .whitespacesAndNewlines) }
        let block = ([marker.begin] + body + [marker.end]).joined(separator: "\n")
        if kept.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return block }
        return kept.hasSuffix("\n") ? kept + block : kept + "\n" + block
    }

    /// YAML 标量安全引用（JSON 字符串字面量是 YAML 双引号风格的子集）。
    /// `withoutEscapingSlashes`：默认会把 `/` 写成 `\/`（YAML 认这个转义，但路径与
    /// URL 满屏反斜杠既难读也难人工核）。 */
    static func yamlString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: [.withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(text.dropFirst().dropLast())
    }

    /// 取 `key` 后的标量，剥掉成对引号；不匹配回 nil。
    static func scalar(_ line: String, key: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix(key) else { return nil }
        var value = String(trimmed.dropFirst(key.count)).trimmingCharacters(in: .whitespaces)
        if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") {
            value = String(value.dropFirst().dropLast())
        }
        return value
    }

    private static func normalized(_ text: String) -> [String] {
        text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }
}
