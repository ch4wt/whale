import Foundation

/// Streams an OpenAI-compatible chat completion from `/v1/chat/completions`.
enum ChatStream {
    enum Delta {
        case content(String)
        case reasoning(String)
    }

    struct RelayError: LocalizedError {
        let message: String
        let status: Int
        var errorDescription: String? { message }
    }

    private struct Chunk: Decodable {
        struct Choice: Decodable {
            struct Delta: Decodable {
                let content: String?
                let reasoningContent: String?
                let reasoning: String?

                enum CodingKeys: String, CodingKey {
                    case content, reasoning
                    case reasoningContent = "reasoning_content"
                }
            }
            let delta: Delta?
        }
        let choices: [Choice]?
    }

    private struct ErrorBody: Decodable {
        struct Detail: Decodable { let message: String? }
        let error: Detail?
        let message: String?
    }

    static func stream(server: URL, apiKey: String, model: String,
                       messages: [ChatMessage]) -> AsyncThrowingStream<Delta, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let client = APIClient(baseURL: server)
                    let payload: [String: Any] = [
                        "model": model,
                        "stream": true,
                        "messages": messages.filter { !$0.isError }.map { ["role": $0.role.rawValue, "content": $0.content] },
                    ]
                    var request = try client.makeRequest("POST", "v1/chat/completions", bearer: apiKey, body: payload)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.timeoutInterval = 300

                    let (bytes, response) = try await client.urlSession.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard (200..<300).contains(status) else {
                        var data = Data()
                        for try await byte in bytes { data.append(byte) }
                        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
                        let message = body?.error?.message ?? body?.message ?? "请求失败（HTTP \(status)）"
                        throw RelayError(message: message, status: status)
                    }
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        if payload == "[DONE]" { break }
                        guard let data = payload.data(using: .utf8),
                              let delta = (try? JSONDecoder().decode(Chunk.self, from: data))?.choices?.first?.delta else { continue }
                        if let thinking = delta.reasoningContent ?? delta.reasoning, !thinking.isEmpty {
                            continuation.yield(.reasoning(thinking))
                        }
                        if let text = delta.content, !text.isEmpty {
                            continuation.yield(.content(text))
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
