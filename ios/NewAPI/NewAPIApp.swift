import SwiftUI

@main
struct NewAPIApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var store = ConversationStore()

    var body: some Scene {
        WindowGroup {
            Group {
                if appState.isSignedIn {
                    ChatHomeView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(appState)
            .environmentObject(store)
        }
    }
}
