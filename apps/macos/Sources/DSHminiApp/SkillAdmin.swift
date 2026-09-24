// 技能与插件管理面（设置 → 技能与插件）里属于壳的那一半：**技能**。
//
// 为什么技能由壳来做：技能是 `<DSH_HOME>/skills/<name>/SKILL.md` 的普通文件（引擎按
// rank 400 发现、chokidar 热生效），wire 上**没有任何 skill 方法**，前端读不到盘。
// 插件的清单来自引擎 `pluginInventory/list`（只读，前端直读），启停落在应用自己的
// overlay patch 上（`EngineSupervisor.enginePatchBody`）——那是另一个家。
//
// 纪律：技能目录只认技能根下的一层（拒路径穿越）；frontmatter 缺 `name`/`description`
// 的技能**引擎会静默忽略**（日志只留 warn），所以这里照样列出来并标注缺了什么，
// 不替它补默认值、也不把坏技能藏起来。

import Foundation

enum SkillAdmin {
    struct Skill: Equatable {
        /// 目录名 = 技能的发现单位，也是删除目标。
        var id: String
        /// frontmatter 的 name（模型看到的技能名）；缺失回退目录名。
        var title: String
        /// frontmatter 的 description；缺失为空串。
        var detail: String
        /// SKILL.md 的绝对路径（Finder 定位用）。
        var manifest: String
        /// 技能目录的绝对路径（删除用）。
        var directory: String
        /// frontmatter 缺的必填键；非空 = 引擎会忽略这个技能。
        var missing: [String]
    }

    /// 随应用发布、每次启动重写的技能：列表里标注来源，不提供删除（删了下次启动回来）。
    static var managedNames: Set<String> {
        [EngineSupervisor.automationSkillName]
    }

    /// 已停发、但旧版本铺在盘上的技能名。技能根是引擎自动发现的（rank 400），
    /// 留着等于继续教模型一个没人消费的协议——每次启动幂等清一次
    /// （同 ProfileComposer 的 retiredBundleNames）。
    static let retiredNames: Set<String> = ["deepdive-evolution", "deepdive-session-memory"]

    /// 清掉停发技能的目录，返回实际删掉的目录名（供调用方记日志）。
    @discardableResult
    static func removeRetired(in home: URL) -> [String] {
        var removed: [String] = []
        for name in retiredNames.sorted() {
            let directory = home.appendingPathComponent("skills/\(name)").path
            if FileManager.default.fileExists(atPath: directory), remove(directory: directory, home: home) == nil {
                removed.append(name)
            }
        }
        return removed
    }

    /// `<home>/skills/<name>/SKILL.md` 的清单（按目录名排序）。
    static func list(in home: URL) -> [Skill] {
        let root = home.appendingPathComponent("skills", isDirectory: true)
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles],
        )) ?? []
        var skills: [Skill] = []
        for dir in entries {
            var isDirectory: ObjCBool = false
            guard fm.fileExists(atPath: dir.path, isDirectory: &isDirectory), isDirectory.boolValue else { continue }
            let manifest = dir.appendingPathComponent("SKILL.md")
            guard let text = try? String(contentsOf: manifest, encoding: .utf8) else { continue }
            let head = frontmatter(text)
            let id = dir.lastPathComponent
            let title = head["name"] ?? ""
            let detail = head["description"] ?? ""
            var missing: [String] = []
            if title.isEmpty { missing.append("name") }
            if detail.isEmpty { missing.append("description") }
            skills.append(Skill(
                id: id,
                title: title.isEmpty ? id : title,
                detail: detail,
                manifest: manifest.path,
                directory: dir.path,
                missing: missing,
            ))
        }
        return skills.sorted { $0.id < $1.id }
    }

    /// 删除一个技能目录；成功回 nil，否则回给用户看的原因。
    static func remove(directory: String, home: URL) -> String? {
        let root = home.appendingPathComponent("skills", isDirectory: true).standardizedFileURL
        let target = URL(fileURLWithPath: directory).standardizedFileURL
        // 只认技能根下的**一层**目录：目录本身不是根、且父目录就是根
        guard target.path != root.path, target.deletingLastPathComponent().path == root.path else {
            return "只能删除技能根下的一层目录"
        }
        guard FileManager.default.fileExists(atPath: target.appendingPathComponent("SKILL.md").path) else {
            return "这个目录里没有 SKILL.md，没有删除"
        }
        do {
            try FileManager.default.removeItem(at: target)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// 新建一个技能：写 `<home>/skills/<name>/SKILL.md`（引擎 chokidar 热发现）。
    /// 成功回 nil，否则回给用户看的原因。名字即目录名，也是模型侧 `/<name>` 的调用名。
    /// 正文只放一个最小骨架——技能内容该由用户写，这里不替他编。
    static func create(name: String, description: String, home: URL) -> String? {
        let id = name.trimmingCharacters(in: .whitespaces)
        if id.isEmpty { return "名字不能为空" }
        if id.contains("/") || id.contains("..") || id.hasPrefix(".") {
            return "名字不能含斜杠或前后缀点"
        }
        if managedNames.contains(id) { return "这个名字随应用发布占用，换一个" }
        let dir = home.appendingPathComponent("skills", isDirectory: true).appendingPathComponent(id, isDirectory: true)
        if FileManager.default.fileExists(atPath: dir.path) { return "同名技能已存在" }
        let body = """
        ---
        name: \(ManagedPatchBlock.yamlString(id))
        description: \(ManagedPatchBlock.yamlString(description.trimmingCharacters(in: .whitespaces)))
        ---

        # \(id)

        """
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try body.write(to: dir.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    /// 从已有目录装一个技能：把 `<source>/SKILL.md` 所在的那一层整个拷进技能根。
    /// 成功回 nil，否则回给用户看的原因。同名已存在时拒绝（覆盖会静默丢掉用户原稿）。
    static func install(sourceDirectory: String, home: URL) -> String? {
        let source = URL(fileURLWithPath: sourceDirectory).standardizedFileURL
        let root = home.appendingPathComponent("skills", isDirectory: true).standardizedFileURL
        guard FileManager.default.fileExists(atPath: source.appendingPathComponent("SKILL.md").path) else {
            return "这个目录里没有 SKILL.md"
        }
        guard source.path != root.path, source.deletingLastPathComponent().path != root.path else {
            return "它已经在技能根里了"
        }
        let id = source.lastPathComponent
        if id.isEmpty || id.hasPrefix(".") { return "目录名不能作技能名" }
        let target = root.appendingPathComponent(id, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: target.path) else { return "同名技能已存在" }
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: source, to: target)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: - 纯函数（单测钉子）

    /// SKILL.md 正文 → frontmatter 键值。起始行必须是独立的 `---`；到下一个 `---` 结束；
    /// 值两端成对的引号剥掉（YAML 里 description 常带引号与冒号）。
    static func frontmatter(_ text: String) -> [String: String] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else { return [:] }
        var out: [String: String] = [:]
        for raw in lines.dropFirst() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line == "---" { break }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = String(line[line.startIndex..<colon]).trimmingCharacters(in: .whitespaces)
            var value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") {
                // 双引号值按 JSON 字符串字面量解转义 —— 与写出侧的 yamlString 对称
                // （skill create 写出的引号/换行会被转义，读回不还原就会留下反斜杠）。
                value = unescapeJSONString(value) ?? String(value.dropFirst().dropLast())
            } else if value.count >= 2, value.hasPrefix("'"), value.hasSuffix("'") {
                value = String(value.dropFirst().dropLast())
            }
            if !key.isEmpty { out[key] = value }
        }
        return out
    }

    /// JSON 字符串字面量 → 原文；不是合法字面量时回 nil（调用方退回"只剥引号"，不猜）。
    private static func unescapeJSONString(_ literal: String) -> String? {
        guard let data = "[\(literal)]".data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String],
              let first = parsed.first,
              parsed.count == 1 else { return nil }
        return first
    }
}
