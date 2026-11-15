import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var flow = LoginFlow()

    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var code = ""

    var body: some View {
        NavigationStack {
            Form {
                switch flow.step {
                case .credentials:
                    credentialsSection
                case .loginCode:
                    codeSection(title: "两步验证", footer: "请输入身份验证器中的 6 位验证码，或一个备用码。")
                case .stepUpCode:
                    codeSection(title: "授权此设备",
                                footer: "为了给 App 创建访问令牌，需要再验证一次。请等待验证器刷新后输入新的验证码（同一个验证码不能重复使用）。")
                }

                if let message = flow.errorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("登录")
            .disabled(flow.isWorking)
            .overlay {
                if flow.isWorking { ProgressView().controlSize(.large) }
            }
            .onAppear {
                if server.isEmpty { server = appState.lastServer }
            }
        }
    }

    private var credentialsSection: some View {
        Group {
            Section {
                TextField("https://api.example.com", text: $server)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("服务器地址")
            }
            Section {
                TextField("用户名或邮箱", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("密码", text: $password)
                    .textContentType(.password)
            } header: {
                Text("账号")
            } footer: {
                Text("登录后 App 会创建一个仅含 API 令牌和个人资料权限、有效期 90 天的访问令牌，保存在本机钥匙串中。你可以随时在网页控制台撤销它。")
            }
            Section {
                Button("登录") {
                    Task {
                        if let result = await flow.signIn(server: server, username: username, password: password) {
                            password = ""
                            appState.signedIn(result)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(server.isEmpty || username.isEmpty || password.isEmpty)
            }
        }
    }

    private func codeSection(title: String, footer: String) -> some View {
        Group {
            Section {
                TextField("验证码", text: $code)
                    .keyboardType(.asciiCapable)
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text(title)
            } footer: {
                Text(footer)
            }
            Section {
                Button("验证") {
                    Task {
                        let result = await flow.submitCode(code)
                        code = ""
                        if let result {
                            password = ""
                            appState.signedIn(result)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(code.isEmpty)
                Button("返回", role: .cancel) {
                    code = ""
                    flow.reset()
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}
