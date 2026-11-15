import Foundation

struct APIError: LocalizedError {
    let message: String
    var code: String?
    var status: Int?

    var errorDescription: String? { message }

    var isUnauthorized: Bool {
        status == 401 || (code?.hasPrefix("AUTH_") ?? false) || code == "ACCESS_TOKEN_SCOPE_DENIED"
    }
}

/// Every management API response uses the `{success, message, data}` envelope.
private struct Envelope<T: Decodable>: Decodable {
    let success: Bool
    let message: String?
    let code: String?
    let data: T?
}

struct Empty: Decodable {}

/// Thin HTTP client for one new-api server. An ephemeral session keeps the
/// browser refresh cookie the login endpoint sets out of persistent storage.
final class APIClient {
    let baseURL: URL
    private let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 60
        session = URLSession(configuration: config)
    }

    /// Normalizes user input such as `api.example.com/` into `https://api.example.com`.
    static func normalizeServer(_ input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text), let scheme = url.scheme, ["http", "https"].contains(scheme),
              url.host != nil else { return nil }
        return url
    }

    func makeRequest(_ method: String, _ path: String, query: [String: String] = [:],
                     bearer: String? = nil, headers: [String: String] = [:], body: Any? = nil) throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    func send<T: Decodable>(_ type: T.Type, _ method: String, _ path: String, query: [String: String] = [:],
                            bearer: String? = nil, headers: [String: String] = [:], body: Any? = nil) async throws -> T {
        let request = try makeRequest(method, path, query: query, bearer: bearer, headers: headers, body: body)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let envelope: Envelope<T>
        do {
            envelope = try JSONDecoder().decode(Envelope<T>.self, from: data)
        } catch {
            throw APIError(message: "服务器返回了无法解析的响应（HTTP \(status)）", status: status)
        }
        guard envelope.success else {
            let message = envelope.message.flatMap { $0.isEmpty ? nil : $0 } ?? "请求失败（HTTP \(status)）"
            throw APIError(message: message, code: envelope.code, status: status)
        }
        if let value = envelope.data { return value }
        if let empty = Empty() as? T { return empty }
        throw APIError(message: "服务器响应缺少数据", status: status)
    }

    var urlSession: URLSession { session }
}
