import Foundation

/// Minimal dynamic JSON tree for the settings RPC surface (SPEC-SETTINGS-WINDOW
/// §3): `settings.describe` returns schema-driven namespaces whose value shape
/// is engine-defined, so Codable structs would fossilize the API surface.
enum JSONValue: Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    // MARK: literals

    init(_ any: Any) {
        switch any {
        case is NSNull: self = .null
        case let n as NSNumber:
            // Booleans arrive as NSNumber; distinguish before numeric.
            if CFGetTypeID(n) == CFBooleanGetTypeID() {
                self = .bool(n.boolValue)
            } else if CFNumberIsFloatType(n) {
                self = .double(n.doubleValue)
            } else {
                self = .int(n.intValue)
            }
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(a.map(JSONValue.init))
        case let o as [String: Any]:
            self = .object(o.mapValues(JSONValue.init))
        default: self = .null
        }
    }

    init(data: Data) throws {
        self = try JSONValue(JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
    }

    var anyValue: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .int(let i): return i
        case .double(let d): return d
        case .string(let s): return s
        case .array(let a): return a.map { $0.anyValue }
        case .object(let o): return o.mapValues { $0.anyValue }
        }
    }

    var data: Data {
        (try? JSONSerialization.data(withJSONObject: anyValue, options: [.fragmentsAllowed, .prettyPrinted])) ?? Data("null".utf8)
    }

    var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    // MARK: paths ("a.b.c" — numeric segments index arrays)

    private static func segments(_ path: String) -> [String] {
        path.split(separator: ".").map(String.init)
    }

    func at(_ path: String) -> JSONValue? {
        var cur: JSONValue? = self
        for seg in JSONValue.segments(path) {
            guard let c = cur else { return nil }
            switch c {
            case .object(let o): cur = o[seg]
            case .array(let a):
                guard let i = Int(seg), a.indices.contains(i) else { return nil }
                cur = a[i]
            default: return nil
            }
        }
        return cur
    }

    func setting(_ path: String, to newValue: JSONValue) -> JSONValue {
        let segs = JSONValue.segments(path)
        guard let first = segs.first else { return newValue }
        let rest = segs.dropFirst()
        if rest.isEmpty {
            switch self {
            case .object(var o):
                o[first] = newValue
                return .object(o)
            case .array(var a):
                if let i = Int(first), a.indices.contains(i) {
                    a[i] = newValue
                    return .array(a)
                }
                return self
            default:
                return .object([first: newValue])
            }
        }
        switch self {
        case .object(let o):
            var o = o
            o[first] = (o[first] ?? .object([:])).setting(String(rest.joined(separator: ".")), to: newValue)
            return .object(o)
        case .array(let a):
            var a = a
            if let i = Int(first), a.indices.contains(i) {
                a[i] = a[i].setting(String(rest.joined(separator: ".")), to: newValue)
            }
            return .array(a)
        default:
            return .object([first: JSONValue.object([:]).setting(String(rest.joined(separator: ".")), to: newValue)])
        }
    }

    func unsetting(_ path: String) -> JSONValue {
        let segs = JSONValue.segments(path)
        guard let first = segs.first else { return self }
        if segs.count == 1 {
            switch self {
            case .object(var o):
                o.removeValue(forKey: first)
                return .object(o)
            default: return self
            }
        }
        switch self {
        case .object(let o):
            var o = o
            if let child = o[first] {
                o[first] = child.unsetting(String(segs.dropFirst().joined(separator: ".")))
            }
            return .object(o)
        default: return self
        }
    }

    // MARK: diff → path ops (SPEC-SETTINGS-WINDOW §3.2)

    /// Ops touching only the paths the user actually changed. Objects recurse
    /// per key; anything else (arrays included) is replaced whole at the
    /// differing path. Secrets never appear on either side (describe strips
    /// them structurally), so they can never be written back.
    static func diffOps(from old: JSONValue, to new: JSONValue) -> [[String: Any]] {
        var ops: [[String: Any]] = []
        diff(from: old, to: new, path: [], into: &ops)
        return ops
    }

    private static func diff(from old: JSONValue, to new: JSONValue, path: [String], into ops: inout [[String: Any]]) {
        let pathString = path.joined(separator: ".")
        switch (old, new) {
        case let (.object(a), .object(b)):
            for (k, v) in b where a[k] != v {
                diff(from: a[k] ?? .null, to: v, path: path + [k], into: &ops)
            }
            for (k, v) in a where b[k] == nil {
                if !v.isNull {
                    ops.append(["op": "unset", "path": (path + [k]).joined(separator: ".")])
                }
            }
        default:
            if old != new {
                if new.isNull {
                    if !pathString.isEmpty { ops.append(["op": "unset", "path": pathString]) }
                } else {
                    ops.append(["op": "set", "path": pathString, "value": new.anyValue])
                }
            }
        }
    }
}
