import Foundation
import Security

/// Encrypts a password for servers with PASSWORD_LOGIN_ENCRYPTION_ENABLED.
/// Uses the legacy RSA-OAEP/SHA-256 format accepted by `common.DecryptPassword`
/// (the v2 envelope needs an OAEP label, which the Security framework cannot set).
enum PasswordEncryptor {
    static func encrypt(_ password: String, publicKeyPEM: String) throws -> String {
        let base64 = publicKeyPEM
            .components(separatedBy: .newlines)
            .filter { !$0.hasPrefix("-----") }
            .joined()
        guard let spki = Data(base64Encoded: base64) else {
            throw APIError(message: "服务器公钥格式无效")
        }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
        ]
        var error: Unmanaged<CFError>?
        // SecKeyCreateWithData expects PKCS#1; strip the SubjectPublicKeyInfo header if present.
        guard let key = SecKeyCreateWithData(stripSPKIHeader(spki) as CFData, attributes as CFDictionary, &error) else {
            throw APIError(message: "无法加载服务器公钥")
        }
        guard let plaintext = password.data(using: .utf8),
              let ciphertext = SecKeyCreateEncryptedData(key, .rsaEncryptionOAEPSHA256, plaintext as CFData, &error) as Data? else {
            throw APIError(message: "密码过长，无法加密")
        }
        return ciphertext.base64EncodedString()
    }

    /// Returns the PKCS#1 RSAPublicKey inside a DER SubjectPublicKeyInfo, or the input unchanged.
    private static func stripSPKIHeader(_ der: Data) -> Data {
        let bytes = [UInt8](der)
        // SPKI: SEQUENCE { SEQUENCE { OID rsaEncryption, NULL }, BIT STRING { 0x00, RSAPublicKey } }
        let rsaOID: [UInt8] = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01]
        guard let oidStart = bytes.firstRange(of: rsaOID)?.lowerBound else { return der }
        var index = oidStart + rsaOID.count
        if index + 1 < bytes.count, bytes[index] == 0x05, bytes[index + 1] == 0x00 { index += 2 }
        guard index < bytes.count, bytes[index] == 0x03 else { return der }
        index += 1
        guard index < bytes.count else { return der }
        if bytes[index] & 0x80 != 0 {
            index += 1 + Int(bytes[index] & 0x7F)
        } else {
            index += 1
        }
        guard index < bytes.count, bytes[index] == 0x00 else { return der }
        return Data(bytes[(index + 1)...])
    }
}
