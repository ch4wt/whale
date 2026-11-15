import SwiftUI

struct SidebarView: View {
    @Binding var currentID: UUID?
    let onSelect: (UUID?) -> Void
    let onOpenAccount: () -> Void

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var store: ConversationStore
    @State private var search = ""
    @State private var renamingID: UUID?
    @State private var renameText = ""

    var body: some View {
        VStack(spacing: 0) {
            searchField
                .padding(.horizontal, 16)
                .padding(.top, 8)

            Button {
                onSelect(nil)
            } label: {
                Label("开启新对话", systemImage: "plus.bubble")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.accentColor.opacity(0.12), in: Capsule())
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            conversationList

            Divider()
            accountRow
        }
        .background(Color(.secondarySystemBackground).ignoresSafeArea())
        .alert("重命名对话", isPresented: Binding(get: { renamingID != nil }, set: { if !$0 { renamingID = nil } })) {
            TextField("对话名称", text: $renameText)
            Button("确定") {
                if let id = renamingID { store.rename(id, to: renameText) }
            }
            Button("取消", role: .cancel) {}
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("搜索历史对话", text: $search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !search.isEmpty {
                Button {
                    search = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }

    private var conversationList: some View {
        let sections = groupedConversations
        return List {
            ForEach(sections, id: \.title) { section in
                Section {
                    ForEach(section.items) { conversation in
                        row(conversation)
                    }
                } header: {
                    Text(section.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if sections.isEmpty {
                Text(search.isEmpty ? "暂无历史对话" : "没有匹配的对话")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func row(_ conversation: Conversation) -> some View {
        let selected = conversation.id == currentID
        return Button {
            onSelect(conversation.id)
        } label: {
            Text(conversation.title)
                .font(.subheadline)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(selected ? Color(.systemGray4).opacity(0.6) : .clear,
                            in: RoundedRectangle(cornerRadius: 10))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 1, leading: 8, bottom: 1, trailing: 8))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .contextMenu {
            Button {
                renameText = conversation.title
                renamingID = conversation.id
            } label: {
                Label("重命名", systemImage: "pencil")
            }
            Button(role: .destructive) {
                if currentID == conversation.id { currentID = nil }
                store.delete(conversation.id)
            } label: {
                Label("删除", systemImage: "trash")
            }
        }
    }

    private var accountRow: some View {
        Button(action: onOpenAccount) {
            HStack(spacing: 10) {
                let name = appState.profile.map { ($0.displayName?.isEmpty == false ? $0.displayName! : $0.username) } ?? "账户"
                Text(String(name.prefix(1)).uppercased())
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Color.accentColor, in: Circle())
                Text(name)
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "ellipsis")
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("账户与设置")
    }

    private struct DateSection {
        let title: String
        var items: [Conversation]
    }

    /// Groups by recency the way chat apps label history: today, yesterday,
    /// last 7 and 30 days, then by month.
    private var groupedConversations: [DateSection] {
        let query = search.trimmingCharacters(in: .whitespaces)
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let monthFormatter = DateFormatter()
        monthFormatter.dateFormat = "yyyy 年 M 月"

        var sections: [DateSection] = []
        for conversation in store.conversations {
            if !query.isEmpty,
               !conversation.title.localizedCaseInsensitiveContains(query),
               !conversation.messages.contains(where: { $0.content.localizedCaseInsensitiveContains(query) }) {
                continue
            }
            let date = conversation.updatedAt
            let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: startOfToday).day ?? 0
            let title: String
            switch days {
            case ...0: title = "今天"
            case 1: title = "昨天"
            case 2..<7: title = "7 天内"
            case 7..<30: title = "30 天内"
            default: title = monthFormatter.string(from: date)
            }
            if sections.last?.title == title {
                sections[sections.count - 1].items.append(conversation)
            } else {
                sections.append(DateSection(title: title, items: [conversation]))
            }
        }
        return sections
    }
}
