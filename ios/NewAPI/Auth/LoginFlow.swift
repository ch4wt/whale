import Foundation

/// Signs in with a dashboard password, then trades the short-lived browser
/// session for a scoped personal access token (PAT) the app keeps in the Keychain.
///
/// The web session cannot be refreshed from a native app (its refresh token is a
/// SameSite=Strict cookie behind an Origin check), so the app holds only the PAT.
/// Creating a PAT requires a security proof, which the server issues after a
/// password or 2FA check bound to the exact scopes and expiry requested.
@MainActor
final class LoginFlow: ObservableObject {
    enum Step: Equatable {
        case credentials
        /// The account has 2FA: the login itself needs a TOTP or backup code.
        case loginCode(flowToken: String)
        /// Creating the PAT needs a fresh 2FA code (the login code cannot be replayed).
        case stepUpCode
    }

    static let patScopes = ["api_key:read", "api_key:reveal", "api_key:write", "profile:read"]
    static let patLifetime: TimeInterval = 90 * 24 * 3600

    @Published var step: Step = .credentials
    @Published var isWorking = false
    @Published var errorMessage: String?

    private var client: APIClient?
    private var password = ""
    private var sessionToken: String?

    struct Result {
        let server: URL
        let accessToken: String
    }

    func signIn(server: String, username: String, password: String) async -> Result? {
        guard let url = APIClient.normalizeServer(server) else {
            errorMessage = "服务器地址无效"
            return nil
        }
        let client = APIClient(baseURL: url)
        self.client = client
        self.password = password
        return await run {
            var body: [String: Any] = ["username": username]
            try await self.attachPassword(to: &body, client: client)
            let login = try await client.send(LoginResponse.self, "POST", "api/user/login", body: body)
            return try await self.continueLogin(login)
        }
    }

    func submitCode(_ code: String) async -> Result? {
        let code = code.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty, let client else { return nil }
        return await run {
            switch self.step {
            case .loginCode(let flowToken):
                let login = try await client.send(LoginResponse.self, "POST", "api/user/login/verify",
                                                  body: ["flow_token": flowToken, "method": "2fa", "code": code])
                return try await self.continueLogin(login)
            case .stepUpCode:
                return try await self.createAccessToken(method: "2fa", code: code)
            case .credentials:
                return nil
            }
        }
    }

    func reset() {
        step = .credentials
        errorMessage = nil
        password = ""
        sessionToken = nil
    }

    private func run(_ work: @escaping () async throws -> Result?) async -> Result? {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await work()
            if result != nil { password = "" }
            return result
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func continueLogin(_ login: LoginResponse) async throws -> Result? {
        if let token = login.accessToken {
            sessionToken = token
            return try await beginStepUp()
        }
        guard login.requireVerification == true, let flowToken = login.flowToken else {
            throw APIError(message: "登录响应无效")
        }
        let methods = login.methods ?? []
        guard methods.contains(where: { $0.method == "2fa" && $0.available }) else {
            throw APIError(message: "该账号需要 Passkey 验证登录，App 暂不支持，请先在网页端为账号启用两步验证")
        }
        step = .loginCode(flowToken: flowToken)
        return nil
    }

    private func beginStepUp() async throws -> Result? {
        guard let client, let sessionToken else { return nil }
        let requirements = try await client.send(VerificationRequirements.self, "GET", "api/verify/methods",
                                                 query: ["scope": "access_token.generate"], bearer: sessionToken)
        let available = Set(requirements.methods.filter(\.available).map(\.method))
        if available.contains("password") {
            return try await createAccessToken(method: "password", code: nil)
        }
        if available.contains("2fa") {
            step = .stepUpCode
            return nil
        }
        throw APIError(message: "当前账号只能通过 Passkey 或第三方登录完成安全验证，App 暂不支持")
    }

    private func createAccessToken(method: String, code: String?) async throws -> Result? {
        guard let client, let sessionToken else { return nil }
        // The proof is bound to these exact values, so both requests reuse them.
        let scopes = Self.patScopes.sorted()
        let expiresAt = Int64(Date().addingTimeInterval(Self.patLifetime).timeIntervalSince1970)
        let context: [String: Any] = ["scopes": scopes, "expires_at": expiresAt]

        var verify: [String: Any] = ["method": method, "scope": "access_token.generate", "context": context]
        if method == "password" {
            try await attachPassword(to: &verify, client: client)
        } else if let code {
            verify["code"] = code
        }
        let proof = try await client.send(SecurityProof.self, "POST", "api/verify", bearer: sessionToken, body: verify)

        let created = try await client.send(
            CreatedAccessToken.self, "POST", "api/user/access_tokens",
            bearer: sessionToken, headers: ["X-Security-Proof": proof.proofToken],
            body: ["name": "iOS App · \(DeviceInfo.name)", "scopes": scopes, "expires_at": expiresAt])

        // The browser-style session is no longer needed once the PAT exists.
        let origin = client.baseURL.absoluteString
        _ = try? await client.send(Empty.self, "POST", "api/user/auth/logout",
                                   bearer: sessionToken, headers: ["Origin": origin])
        self.sessionToken = nil
        return Result(server: client.baseURL, accessToken: created.token)
    }

    /// Adds the password in the form the server expects: encrypted when the
    /// server enables password transport encryption, plain over TLS otherwise.
    private func attachPassword(to body: inout [String: Any], client: APIClient) async throws {
        let key = try await client.send(EncryptionKey.self, "GET", "api/user/login/encryption-key")
        if key.enabled, let kid = key.kid, let publicKey = key.publicKey {
            body["password_encrypted"] = try PasswordEncryptor.encrypt(password, publicKeyPEM: publicKey)
            body["encryption_key_id"] = kid
        } else {
            body["password"] = password
        }
    }
}

enum DeviceInfo {
    static var name: String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafeBytes(of: &info.machine) { buffer in
            String(decoding: buffer.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return machine.isEmpty ? "iPhone" : machine
    }
}
