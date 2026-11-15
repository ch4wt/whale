import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var store: ConversationStore
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let profile = appState.profile {
                    Section {
                        LabeledContent("用户名", value: profile.username)
                        if let name = profile.displayName, !name.isEmpty {
                            LabeledContent("显示名称", value: name)
                        }
                        if let group = profile.group, !group.isEmpty {
                            LabeledContent("分组", value: group)
                        }
                    } header: {
                        Text("账户")
                    }
                    Section {
                        LabeledContent("剩余额度", value: format(profile.quota))
                        LabeledContent("已用额度", value: format(profile.usedQuota))
                        LabeledContent("请求次数", value: profile.requestCount.formatted())
                    } header: {
                        Text("用量")
                    }
                } else if errorMessage == nil {
                    Section { ProgressView().frame(maxWidth: .infinity) }
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }

                Section {
                    if let server = appState.server {
                        LabeledContent("服务器", value: server.host ?? server.absoluteString)
                    }
                    Button("退出登录", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("退出登录只会清除本机保存的凭据。如需立即作废访问令牌，请在网页控制台的“访问令牌”页面撤销。")
                }
            }
            .navigationTitle(appState.status?.systemName ?? "账户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .confirmationDialog("退出登录并删除本机聊天记录？", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) {
                    store.removeAll()
                    appState.signOut()
                }
            }
        }
    }

    private func format(_ quota: Int) -> String {
        appState.status?.format(quota: quota) ?? quota.formatted()
    }

    private func load() async {
        do {
            try await appState.refreshAccount()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
