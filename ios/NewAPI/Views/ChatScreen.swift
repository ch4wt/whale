import SwiftUI

struct ChatScreen: View {
    @Binding var conversationID: UUID?
    @ObservedObject var chat: ChatController
    let onOpenSidebar: () -> Void

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var store: ConversationStore
    @AppStorage("default_model") private var defaultModel = ""
    @State private var draft = ""
    @State private var errorMessage: String?
    @FocusState private var inputFocused: Bool

    private var conversation: Conversation? {
        conversationID.flatMap { store.conversation($0) }
    }

    private var model: String {
        if let model = conversation?.model { return model }
        return appState.models.contains(defaultModel) ? defaultModel : (appState.models.first ?? "")
    }

    private var assistantName: String {
        appState.status?.systemName.flatMap { $0.isEmpty ? nil : $0 } ?? "New API"
    }

    private var isStreamingHere: Bool {
        chat.streamingID != nil && chat.streamingID == conversationID
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            if let conversation, !conversation.messages.isEmpty {
                messageList(conversation)
            } else {
                welcome
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 4)
            }
            inputBox
        }
        .background(Color(.systemBackground))
        .task { await loadModels() }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 4) {
            Button(action: onOpenSidebar) {
                Image(systemName: "line.3.horizontal")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("历史对话")
            Spacer()
            Text(conversation?.title ?? "新对话")
                .font(.headline)
                .lineLimit(1)
            Spacer()
            Button {
                conversationID = nil
                inputFocused = true
            } label: {
                Image(systemName: "plus.bubble")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("开启新对话")
            .disabled(conversation == nil)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 6)
    }

    // MARK: Content

    private var welcome: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("我是 \(assistantName)，很高兴见到你！")
                .font(.title3.bold())
                .multilineTextAlignment(.center)
            Text("我可以帮你写代码、答疑解惑、写作各种创意内容，请把你的任务交给我吧～")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { inputFocused = false }
    }

    private func messageList(_ conversation: Conversation) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(conversation.messages) { message in
                        let isLast = message.id == conversation.messages.last?.id
                        MessageRow(message: message,
                                   isStreaming: isLast && isStreamingHere,
                                   canRegenerate: isLast && chat.streamingID == nil,
                                   onRegenerate: {
                                       chat.regenerate(in: conversation.id, store: store, appState: appState)
                                   })
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .id(conversation.id)
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: conversation.messages.last?.content) { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: conversation.messages.last?.reasoning) { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: conversation.messages.count) {
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    // MARK: Input

    private var inputBox: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("给 \(assistantName) 发送消息", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .focused($inputFocused)
                .padding(.horizontal, 4)
            HStack {
                modelMenu
                Spacer()
                sendButton
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var modelMenu: some View {
        Menu {
            if appState.models.isEmpty {
                Button("重新加载模型") { Task { await loadModels() } }
            } else {
                Picker("模型", selection: Binding(get: { model }, set: selectModel)) {
                    ForEach(appState.models, id: \.self) { Text($0).tag($0) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "cube")
                Text(model.isEmpty ? "选择模型" : model)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .font(.footnote)
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .overlay(Capsule().stroke(Color(.separator)))
            .frame(maxWidth: 220, alignment: .leading)
        }
    }

    private var sendButton: some View {
        let canSend = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && chat.streamingID == nil && !model.isEmpty
        return Button {
            if isStreamingHere { chat.stop() } else { send() }
        } label: {
            Image(systemName: isStreamingHere ? "stop.fill" : "arrow.up")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(isStreamingHere || canSend ? Color.accentColor : Color(.systemGray3), in: Circle())
        }
        .disabled(!isStreamingHere && !canSend)
        .accessibilityLabel(isStreamingHere ? "停止生成" : "发送")
    }

    private func selectModel(_ newModel: String) {
        defaultModel = newModel
        if let id = conversationID {
            store.mutate(id) { $0.model = newModel }
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !model.isEmpty else { return }
        if let id = chat.send(text, in: conversationID, model: model, store: store, appState: appState) {
            conversationID = id
            draft = ""
        }
    }

    private func loadModels() async {
        guard appState.models.isEmpty else { return }
        do {
            try await appState.refreshModels()
            errorMessage = appState.models.isEmpty ? "当前账号没有可用模型" : nil
        } catch {
            errorMessage = "加载模型失败：\(error.localizedDescription)"
        }
    }
}
