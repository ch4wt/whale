import Foundation

/// Keeps conversations on device as one JSON file in Application Support.
@MainActor
final class ConversationStore: ObservableObject {
    @Published var conversations: [Conversation] = []

    private let fileURL: URL = {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("conversations.json")
    }()

    init() {
        guard let data = try? Data(contentsOf: fileURL),
              let saved = try? JSONDecoder().decode([Conversation].self, from: data) else { return }
        conversations = saved.sorted { $0.updatedAt > $1.updatedAt }
    }

    func conversation(_ id: UUID) -> Conversation? {
        conversations.first { $0.id == id }
    }

    func create(model: String) -> Conversation {
        let conversation = Conversation(title: "新对话", model: model, messages: [], updatedAt: Date())
        conversations.insert(conversation, at: 0)
        persist()
        return conversation
    }

    /// Applies a change to one conversation. `persist: false` skips the disk
    /// write, for per-token updates while a reply is streaming.
    func mutate(_ id: UUID, persist: Bool = true, _ change: (inout Conversation) -> Void) {
        guard let index = conversations.firstIndex(where: { $0.id == id }) else { return }
        change(&conversations[index])
        conversations.sort { $0.updatedAt > $1.updatedAt }
        if persist { self.persist() }
    }

    func rename(_ id: UUID, to title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        mutate(id) { $0.title = title }
    }

    func delete(_ id: UUID) {
        conversations.removeAll { $0.id == id }
        persist()
    }

    func removeAll() {
        conversations = []
        persist()
    }

    func persist() {
        guard let data = try? JSONEncoder().encode(conversations) else { return }
        try? data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }
}
