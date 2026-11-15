import SwiftUI
import UIKit

/// One message: user messages sit in a bubble on the right; assistant replies
/// span the full width with their thinking, markdown body and actions.
struct MessageRow: View {
    let message: ChatMessage
    let isStreaming: Bool
    let canRegenerate: Bool
    let onRegenerate: () -> Void

    var body: some View {
        if message.role == .user {
            HStack {
                Spacer(minLength: 48)
                Text(message.content)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if let reasoning = message.reasoning, !reasoning.isEmpty {
                    ReasoningBlock(text: reasoning, seconds: message.reasoningSeconds,
                                   isThinking: isStreaming && message.content.isEmpty)
                }
                if message.isError {
                    Label(message.content, systemImage: "exclamationmark.triangle")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                } else if message.content.isEmpty {
                    if isStreaming && (message.reasoning ?? "").isEmpty {
                        ProgressView()
                    }
                } else {
                    MarkdownText(text: message.content)
                }
                if !isStreaming {
                    HStack(spacing: 20) {
                        if !message.isError && !message.content.isEmpty {
                            CopyButton(text: message.content)
                        }
                        if canRegenerate {
                            Button(action: onRegenerate) {
                                Image(systemName: "arrow.clockwise")
                            }
                            .accessibilityLabel("重新生成")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Collapsible thinking section shown above a reasoning model's answer.
struct ReasoningBlock: View {
    let text: String
    let seconds: Int?
    let isThinking: Bool
    @State private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                    Text(title)
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color(.secondarySystemBackground), in: Capsule())
            }
            .buttonStyle(.plain)

            if expanded {
                HStack(alignment: .top, spacing: 10) {
                    Rectangle()
                        .fill(Color(.systemGray4))
                        .frame(width: 2)
                    Text(text)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var title: String {
        if isThinking { return "思考中…" }
        if let seconds { return "已深度思考（用时 \(seconds) 秒）" }
        return "已深度思考"
    }
}

/// Renders the common markdown in chat replies: fenced code blocks, headings,
/// lists, quotes, and inline styles. An unclosed fence (mid-stream) still renders as code.
struct MarkdownText: View {
    let text: String

    private enum Block {
        case code(language: String, code: String)
        case line(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .code(let language, let code):
                    CodeBlock(language: language, code: code)
                        .padding(.vertical, 4)
                case .line(let line):
                    lineView(line)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var blocks: [Block] {
        var result: [Block] = []
        var codeLines: [String]?
        var language = ""
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                if let lines = codeLines {
                    result.append(.code(language: language, code: lines.joined(separator: "\n")))
                    codeLines = nil
                } else {
                    language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    codeLines = []
                }
            } else if codeLines != nil {
                codeLines!.append(line)
            } else if !trimmed.isEmpty {
                result.append(.line(line))
            }
        }
        if let lines = codeLines {
            result.append(.code(language: language, code: lines.joined(separator: "\n")))
        }
        return result
    }

    @ViewBuilder
    private func lineView(_ line: String) -> some View {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let hashes = trimmed.prefix(while: { $0 == "#" }).count
        if (1...6).contains(hashes), trimmed.dropFirst(hashes).hasPrefix(" ") {
            inline(String(trimmed.dropFirst(hashes + 1)))
                .font(hashes <= 2 ? .title3.bold() : .headline)
                .padding(.top, 4)
        } else if trimmed.hasPrefix("> ") {
            HStack(spacing: 8) {
                Rectangle().fill(Color(.systemGray4)).frame(width: 3)
                inline(String(trimmed.dropFirst(2))).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
            let indent = line.prefix(while: { $0 == " " }).count
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("•")
                inline(String(trimmed.dropFirst(2)))
            }
            .padding(.leading, CGFloat(indent / 2) * 12)
        } else if trimmed == "---" || trimmed == "***" {
            Divider().padding(.vertical, 4)
        } else {
            inline(line)
        }
    }

    private func inline(_ source: String) -> Text {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        let attributed = (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
        return Text(attributed)
    }
}

struct CodeBlock: View {
    let language: String
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                CopyButton(text: code)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(.systemGray5))

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct CopyButton: View {
    let text: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
        }
        .accessibilityLabel(copied ? "已复制" : "复制")
    }
}
