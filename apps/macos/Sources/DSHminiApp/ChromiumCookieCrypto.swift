// Chromium 系浏览器 cookie/密码的解密：它自己的配方十年没变。
//
//   · 密钥：那个浏览器在 macOS keychain 里的一项（"<名字> Safe Storage"）里放着一串口令；
//     口令做 PBKDF2-SHA1（salt "saltysalt"、1003 轮、16 字节）得到 AES-128 密钥。
//   · 密文：`v10` 前缀 + AES-128-CBC（IV 是 16 个空格）。解出来的明文就是值；新版会在前面
//     加 32 字节的站点哈希，剥掉即得。
//
// 读 keychain 那一项时 macOS 会先问用户（要输登录密码才放行）——这是导入唯一必须人点头的地方，
// 也是为什么读取必须放后台线程：`SecItemCopyMatching` 会一直等到用户回答。
import CommonCrypto
import Foundation
import Security

enum ChromiumCookieCrypto {
    /// 那个浏览器的 Safe Storage 口令。用户不批准、或没有这一项 → nil（导入按"拿不到密钥"处理）。
    static func safeStorage(service: String, account: String) -> String? {
        var out: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ] as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data,
              let passphrase = String(data: data, encoding: .utf8), !passphrase.isEmpty else { return nil }
        return passphrase
    }

    /// 口令 → AES-128 密钥（PBKDF2-SHA1 / salt "saltysalt" / 1003 轮）。
    static func stretch(_ passphrase: String) -> [UInt8] {
        var key = [UInt8](repeating: 0, count: 16)
        let salt = Array("saltysalt".utf8)
        let pass = Array(passphrase.utf8)
        // 口令为空的极端情况：CCKeyDerivationPBKDF 不收 nil 指针，退化成"全零密钥"没有意义，
        // 直接回零（调用点会当成解不开）
        guard !pass.isEmpty else { return key }
        pass.withUnsafeBufferPointer { p in
            salt.withUnsafeBufferPointer { s in
                _ = CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    UnsafeRawPointer(p.baseAddress!).assumingMemoryBound(to: Int8.self), pass.count,
                    s.baseAddress!, salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), 1003,
                    &key, key.count
                )
            }
        }
        return key
    }

    /// `v10…` 的密文 → 明文。没有 `v10` 前缀的老档案本来就是明文，原样交回。
    static func unwrap(_ blob: Data, key: [UInt8]) -> String? {
        guard blob.count > 3, blob.prefix(3) == Data("v10".utf8) else {
            return String(data: blob, encoding: .utf8)
        }
        let body = [UInt8](blob.dropFirst(3))
        let iv = [UInt8](repeating: 0x20, count: 16)
        var out = [UInt8](repeating: 0, count: body.count + kCCBlockSizeAES128)
        var moved = 0
        let status = CCCrypt(
            CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES128), CCOptions(kCCOptionPKCS7Padding),
            key, key.count, iv,
            body, body.count,
            &out, out.count, &moved
        )
        guard status == kCCSuccess else { return nil }
        let plain = Data(out.prefix(moved))
        if let text = String(data: plain, encoding: .utf8) { return text }
        // 新版把站点哈希（32 字节）写在值前面，剥掉就是值
        guard plain.count > 32 else { return nil }
        return String(data: plain.dropFirst(32), encoding: .utf8)
    }
}
