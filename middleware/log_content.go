package middleware

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/gin-gonic/gin"
)

const logChatContentKey = "log_chat_content"

// CaptureChatContent 把请求里的对话内容暂存到上下文，供计费日志记录
// 只在开关打开时才读取并保存
func CaptureChatContent() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !enabledLogChatContent() {
			c.Next()
			return
		}
		raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 256*1024))
		if err != nil {
			c.Next()
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))

		var payload struct {
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if json.Unmarshal(raw, &payload) == nil && len(payload.Messages) > 0 {
			// 只记录用户这一轮的新输入，不存助手回复和历史上下文
			var lastUser string
			for _, msg := range payload.Messages {
				if msg.Role != "user" {
					continue
				}
				text := string(msg.Content)
				var plain string
				if json.Unmarshal(msg.Content, &plain) == nil {
					text = plain
				}
				lastUser = text
			}
			if lastUser != "" {
				parts := []map[string]string{{"role": "user", "content": lastUser}}
				if encoded, err := json.Marshal(parts); err == nil {
					c.Set(logChatContentKey, string(encoded))
				}
			}
		}
		c.Next()
	}
}

// ChatContentFromContext 取出暂存的对话内容
func ChatContentFromContext(c *gin.Context) string {
	value, ok := c.Get(logChatContentKey)
	if !ok {
		return ""
	}
	text, _ := value.(string)
	return text
}
