# New API iOS

SwiftUI client for a new-api server: chat with the models your account can use, and see your balance and usage.

## Requirements

- Xcode 16 or later, iOS 17 or later
- A new-api server reachable over HTTPS (plain HTTP is blocked by iOS App Transport Security)

> **Testing only:** `Config/Info.plist` allows plain HTTP for `nlb-mzyxzqfly9br3tjbzz.cn-beijing.nlb.aliyuncsslb.com`. Over HTTP, the password, the access token and the API key can all be intercepted. Remove the exception once the server serves HTTPS, and before submitting to the App Store.

## Run

1. Open `ios/NewAPI.xcodeproj` in Xcode.
2. Under Signing & Capabilities, pick your team. Change `PRODUCT_BUNDLE_IDENTIFIER` (`com.newapi.ios`) if needed.
3. Choose a simulator or device and run.

## How sign-in works

The web console's session refresh token is a `SameSite=Strict` cookie behind an Origin check, so a native app cannot keep that session alive. The app signs in once and then uses a personal access token (PAT):

1. `POST /api/user/login`, encrypting the password when the server sets `PASSWORD_LOGIN_ENCRYPTION_ENABLED`. If the account has 2FA, it then calls `POST /api/user/login/verify`.
2. `POST /api/verify` with password or 2FA for scope `access_token.generate`, which returns a single-use security proof.
3. `POST /api/user/access_tokens` creates a PAT valid for 90 days, with scopes `api_key:read`, `api_key:reveal`, `api_key:write` and `profile:read`.
4. `POST /api/user/auth/logout` revokes the temporary session. Only the PAT is kept, in the Keychain (`WhenUnlockedThisDeviceOnly`).

For chat, the app creates or reuses an API key named `iOS App` and calls `/v1/chat/completions` with streaming.

Limitations:

- Accounts that can only verify with a Passkey, or that sign in only through OAuth, cannot sign in yet.
- Signing out clears the credentials on the device only. To invalidate the PAT right away, revoke it under Access Tokens in the web console. That page needs a browser session, so a PAT cannot revoke itself.
- When the PAT expires after 90 days, the app returns to the sign-in screen.
- Conversations are stored only on the device, in Application Support with complete file protection.
