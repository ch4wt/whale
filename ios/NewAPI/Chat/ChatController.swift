import Foundation

/// Sends messages and streams one reply at a time. The reply keeps streaming
/// into its own conversation when the user switches to another one.
@MainActor
final class ChatController: ObservableObject {
    @Published private(set) var streamingID: UUID?
    private var task: Task<Void, Never>?

    /// Appends the user message (creating a conversation when `conversationID`
    /// is nil) and starts the reply. Returns the conversation it was sent in.
    func send(_ text: String, in conversationID: UUID?, model: String,
              store: ConversationStore, appState: AppState) -> UUID? {
        guard streamingID == nil else { return nil }
        let id = conversationID.flatMap { store.conversation($0)?.id } ?? store.create(model: model).id
        store.mutate(id) { conversation in
            if conversation.messages.isEmpty {
                conversation.title = String(text.prefix(30))
            }
            conversation.model = model
            conversation.messages.append(ChatMessage(role: .user, content: text))
            conversation.updatedAt = Date()
        }
        startReply(in: id, store: store, appState: appState)
        return id
    }

    /// Replaces the last assistant reply with a new one.
    func regenerate(in id: UUID, store: ConversationStore, appState: AppState) {
        guard streamingID == nil, store.conversation(id)?.messages.last?.role == .assistant else { return }
        store.mutate(id) { $0.messages.removeLast() }
        startReply(in: id, store: store, appState: appState)
    }

    func stop() {
        task?.cancel()
    }

    private func startReply(in id: UUID, store: ConversationStore, appState: AppState) {
        guard let conversation = store.conversation(id), let server = appState.server else { return }
        let history = conversation.messages
        let reply = ChatMessage(role: .assistant, content: "")
        store.mutate(id) {
            $0.messages.append(reply)
            $0.updatedAt = Date()
        }
        let updateReply = { (change: (inout ChatMessage) -> Void) in
            store.mutate(id, persist: false) { conversation in
                guard let index = conversation.messages.firstIndex(where: { $0.id == reply.id }) else { return }
                change(&conversation.messages[index])
            }
        }

        streamingID = id
        task = Task {
            var thinkingStarted: Date?
            let finishThinking = {
                guard let start = thinkingStarted else { return }
                thinkingStarted = nil
                let seconds = max(1, Int(Date().timeIntervalSince(start).rounded()))
                updateReply { $0.reasoningSeconds = seconds }
            }
            defer {
                finishThinking()
                streamingID = nil
                task = nil
                store.persist()
            }
            do {
                // A second attempt runs only when the cached API key was rejected,
                // e.g. after it was deleted on the web console.
                for attempt in 0..<2 {
                    let key = try await appState.apiKey()
                    do {
                        for try await delta in ChatStream.stream(server: server, apiKey: key,
                                                                 model: conversation.model, messages: history) {
                            switch delta {
                            case .reasoning(let text):
                                if thinkingStarted == nil { thinkingStarted = Date() }
                                updateReply { $0.reasoning = ($0.reasoning ?? "") + text }
                            case .content(let text):
                                finishThinking()
                                updateReply { $0.content += text }
                            }
                        }
                        break
                    } catch let error as ChatStream.RelayError where error.status == 401 && attempt == 0 {
                        appState.invalidateAPIKey()
                    }
                }
            } catch {
                if Task.isCancelled { return }
                updateReply { message in
                    guard message.content.isEmpty else { return }
                    message.content = error.localizedDescription
                    message.isError = true
                }
            }
        }
    }
}
