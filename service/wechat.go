package service

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// weChatCodeClaimTTL keeps a used code on record well past the WeChat server's
// own code lifetime, so a replay is rejected for as long as the server would
// still resolve it.
const weChatCodeClaimTTL = time.Hour

type weChatUserResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

// ClaimWeChatCode resolves a WeChat official-account verification code to the
// WeChat user ID and records the code as used. One code authorizes at most one
// login, binding or security verification, whatever the WeChat server allows.
func ClaimWeChatCode(code string) (string, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return "", common.NewMessage("Invalid parameters")
	}
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/wechat/user?code=%s", common.WeChatServerAddress, url.QueryEscape(code)), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", common.WeChatServerToken)
	client := http.Client{Timeout: 5 * time.Second}
	httpResponse, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer httpResponse.Body.Close()
	var res weChatUserResponse
	if err := common.DecodeJson(httpResponse.Body, &res); err != nil {
		return "", err
	}
	if !res.Success {
		return "", errors.New(res.Message)
	}
	if res.Data == "" {
		return "", common.NewMessage("Verification code is incorrect or has expired")
	}
	// Claim only codes the WeChat server accepted, so invalid guesses do not
	// fill the table; the unique index makes concurrent reuse lose atomically.
	if err := model.ClaimExternalAuthAssertion(model.AuthFlowPurposeWeChatCode, code, time.Now().Add(weChatCodeClaimTTL)); err != nil {
		if errors.Is(err, model.ErrAuthFlowConsumed) {
			return "", common.NewMessage("Verification code is incorrect or has expired")
		}
		return "", err
	}
	return res.Data, nil
}
