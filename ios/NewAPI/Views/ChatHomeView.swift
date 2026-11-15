import SwiftUI

/// Root screen once signed in: a full-screen chat with a history sidebar that
/// slides in from the left and pushes the chat aside.
struct ChatHomeView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var chat = ChatController()
    @State private var currentID: UUID?
    @State private var sidebarOpen = false
    @State private var dragOffset: CGFloat = 0
    @State private var showAccount = false

    var body: some View {
        GeometryReader { geometry in
            let width = min(geometry.size.width * 0.82, 320)
            let reveal = min(max((sidebarOpen ? width : 0) + dragOffset, 0), width)

            ZStack(alignment: .leading) {
                ChatScreen(conversationID: $currentID, chat: chat,
                           onOpenSidebar: { setSidebar(open: true) })
                    .overlay {
                        Color.black
                            .opacity(0.3 * reveal / width)
                            .ignoresSafeArea()
                            .allowsHitTesting(sidebarOpen)
                            .onTapGesture { setSidebar(open: false) }
                    }
                    .offset(x: reveal)

                SidebarView(currentID: $currentID,
                            onSelect: { id in
                                currentID = id
                                setSidebar(open: false)
                            },
                            onOpenAccount: { showAccount = true })
                    .frame(width: width)
                    .offset(x: reveal - width)
            }
            .simultaneousGesture(sidebarDrag(width: width))
        }
        .sheet(isPresented: $showAccount) { AccountView() }
        .task {
            try? await appState.refreshAccount()
        }
    }

    private func setSidebar(open: Bool) {
        if open { hideKeyboard() }
        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
            sidebarOpen = open
            dragOffset = 0
        }
    }

    /// Opens with a swipe from the left edge, closes with a swipe to the left.
    private func sidebarDrag(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 15)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                if sidebarOpen {
                    dragOffset = min(0, value.translation.width)
                } else if value.startLocation.x < 30 {
                    dragOffset = max(0, value.translation.width)
                }
            }
            .onEnded { value in
                guard dragOffset != 0 else { return }
                let shouldOpen = sidebarOpen ? dragOffset > -width / 3 : dragOffset > width / 3
                setSidebar(open: shouldOpen || (!sidebarOpen && value.predictedEndTranslation.width > width / 2))
            }
    }
}

func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
