import Foundation

struct UserProfile: Decodable {
    let id: Int
    let username: String
    let displayName: String?
    let group: String?
    let quota: Int
    let usedQuota: Int
    let requestCount: Int
    let role: Int?

    enum CodingKeys: String, CodingKey {
        case id, username, group, quota, role
        case displayName = "display_name"
        case usedQuota = "used_quota"
        case requestCount = "request_count"
    }
}

struct ServerStatus: Decodable {
    let systemName: String?
    let quotaPerUnit: Double?
    let quotaDisplayType: String?
    let usdExchangeRate: Double?
    let customCurrencySymbol: String?
    let customCurrencyExchangeRate: Double?

    enum CodingKeys: String, CodingKey {
        case systemName = "system_name"
        case quotaPerUnit = "quota_per_unit"
        case quotaDisplayType = "quota_display_type"
        case usdExchangeRate = "usd_exchange_rate"
        case customCurrencySymbol = "custom_currency_symbol"
        case customCurrencyExchangeRate = "custom_currency_exchange_rate"
    }

    /// Formats a quota value the way the web console's display setting asks for.
    func format(quota: Int) -> String {
        let perUnit = (quotaPerUnit ?? 0) > 0 ? quotaPerUnit! : 500_000
        let usd = Double(quota) / perUnit
        switch quotaDisplayType?.uppercased() {
        case "TOKENS":
            return quota.formatted()
        case "CNY":
            return "¥" + (usd * (usdExchangeRate ?? 7.3)).formatted(.number.precision(.fractionLength(2)))
        case "CUSTOM":
            let symbol = customCurrencySymbol ?? "¤"
            return symbol + (usd * (customCurrencyExchangeRate ?? 1)).formatted(.number.precision(.fractionLength(2)))
        default:
            return "$" + usd.formatted(.number.precision(.fractionLength(2)))
        }
    }
}

struct VerificationMethod: Decodable {
    let method: String
    let available: Bool
    let reason: String?
}

/// `POST /api/user/login` returns either a session or a verification challenge.
struct LoginResponse: Decodable {
    let accessToken: String?
    let requireVerification: Bool?
    let flowToken: String?
    let methods: [VerificationMethod]?

    enum CodingKeys: String, CodingKey {
        case methods
        case accessToken = "access_token"
        case requireVerification = "require_verification"
        case flowToken = "flow_token"
    }
}

struct VerificationRequirements: Decodable {
    let methods: [VerificationMethod]
    let passwordEncryptionEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case methods
        case passwordEncryptionEnabled = "password_encryption_enabled"
    }
}

struct EncryptionKey: Decodable {
    let enabled: Bool
    let kid: String?
    let publicKey: String?

    enum CodingKeys: String, CodingKey {
        case enabled, kid
        case publicKey = "public_key"
    }
}

struct SecurityProof: Decodable {
    let proofToken: String

    enum CodingKeys: String, CodingKey {
        case proofToken = "proof_token"
    }
}

struct CreatedAccessToken: Decodable {
    let token: String
}

struct TokenPage: Decodable {
    let items: [TokenItem]?
}

struct TokenItem: Decodable {
    let id: Int
    let name: String
    let status: Int
}

struct TokenKey: Decodable {
    let key: String
}

// MARK: - Chat

struct ChatMessage: Codable, Identifiable, Equatable {
    enum Role: String, Codable { case system, user, assistant }

    var id = UUID()
    var role: Role
    var content: String
    var isError = false
    /// Thinking text streamed in `reasoning_content` by reasoning models.
    var reasoning: String?
    var reasoningSeconds: Int?
}

struct Conversation: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var model: String
    var messages: [ChatMessage]
    var updatedAt: Date
}
