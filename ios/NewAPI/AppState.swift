import Foundation

/// Signed-in state shared by every screen: the server, the PAT, and the relay
/// API key used for chat.
@MainActor
final class AppState: ObservableObject {
    static let apiKeyName = "iOS App"
    private static let serverDefaultsKey = "server_url"

    @Published private(set) var server: URL?
    @Published private(set) var accessToken: String?
    @Published var profile: UserProfile?
    @Published var status: ServerStatus?
    @Published var models: [String] = []

    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.serverDefaultsKey) {
            server = URL(string: saved)
        }
        accessToken = Keychain.get(KeychainKey.accessToken)
        if server == nil { accessToken = nil }
    }

    var isSignedIn: Bool { server != nil && accessToken != nil }
    var lastServer: String { UserDefaults.standard.string(forKey: Self.serverDefaultsKey) ?? "" }

    private var client: APIClient? { server.map(APIClient.init) }

    func signedIn(_ result: LoginFlow.Result) {
        UserDefaults.standard.set(result.server.absoluteString, forKey: Self.serverDefaultsKey)
        Keychain.set(result.accessToken, for: KeychainKey.accessToken)
        Keychain.set(nil, for: KeychainKey.apiKey)
        server = result.server
        accessToken = result.accessToken
    }

    /// Forgets local credentials. The PAT stays valid on the server until it
    /// expires or is revoked from the web console (revocation needs a browser session).
    func signOut() {
        Keychain.set(nil, for: KeychainKey.accessToken)
        Keychain.set(nil, for: KeychainKey.apiKey)
        accessToken = nil
        profile = nil
        models = []
    }

    /// Runs a management call with the PAT and signs out when it was revoked or expired.
    private func authorized<T: Decodable>(_ type: T.Type, _ method: String, _ path: String,
                                          query: [String: String] = [:], body: Any? = nil) async throws -> T {
        guard let client, let accessToken else { throw APIError(message: "未登录") }
        do {
            return try await client.send(type, method, path, query: query, bearer: accessToken, body: body)
        } catch let error as APIError where error.isUnauthorized {
            signOut()
            throw APIError(message: "登录已失效，请重新登录")
        }
    }

    func refreshAccount() async throws {
        guard let client else { return }
        async let status = client.send(ServerStatus.self, "GET", "api/status")
        async let profile = authorized(UserProfile.self, "GET", "api/user/self")
        self.profile = try await profile
        self.status = try? await status
    }

    func refreshModels() async throws {
        models = try await authorized([String].self, "GET", "api/user/models").sorted()
    }

    /// Returns the relay key for chat, creating a dedicated "iOS App" API key the
    /// first time. Only the unmasked key is cached, in the Keychain.
    func apiKey() async throws -> String {
        if let cached = Keychain.get(KeychainKey.apiKey) { return cached }
        var token = try await findAppToken()
        if token == nil {
            let body: [String: Any] = ["name": Self.apiKeyName, "remain_quota": 0,
                                       "unlimited_quota": true, "expired_time": -1]
            _ = try await authorized(Empty.self, "POST", "api/token/", body: body)
            token = try await findAppToken()
        }
        guard let token else { throw APIError(message: "无法创建 API 令牌") }
        let revealed = try await authorized(TokenKey.self, "POST", "api/token/\(token.id)/key")
        let key = revealed.key.hasPrefix("sk-") ? revealed.key : "sk-" + revealed.key
        Keychain.set(key, for: KeychainKey.apiKey)
        return key
    }

    /// Drops a cached key the relay rejected so the next call fetches it again.
    func invalidateAPIKey() {
        Keychain.set(nil, for: KeychainKey.apiKey)
    }

    private func findAppToken() async throws -> TokenItem? {
        let page = try await authorized(TokenPage.self, "GET", "api/token/", query: ["p": "1", "page_size": "100"])
        return page.items?.first { $0.name == Self.apiKeyName && $0.status == 1 }
    }
}
