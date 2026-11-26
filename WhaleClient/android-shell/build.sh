#!/bin/bash
# DeepSeek Chat 安卓壳手工构建（无 Gradle、无 AndroidX）
# aapt2 + javac + d8 + zipalign + apksigner，可重复执行。
#
# 用法：
#   ./build.sh                     默认：官方接口、应用名 DeepSeek Chat、不预填 Key
#   ./build.sh --web               先构建网页再打包
#   ./build.sh --clean             清空中间产物
#
# 变体参数（环境变量）：
#   DS_APP_NAME        应用显示名，默认 "DeepSeek Chat"
#   DS_PKG             包名，默认 com.tun.whale（不同包名可同时安装）
#   DS_UPSTREAM        上游 API，默认 https://api.deepseek.com
#   DS_STRIP_ANTHROPIC true 时把 /anthropic 前缀去掉（ModelHub 需要）
#   DS_DEFAULT_KEY     首次启动预填的 API Key（空 = 不预填）
#   DS_APK_SUFFIX      APK 文件名后缀，如 -ds
#
# 依赖：JDK 17+（brew openjdk@21）、Android SDK（~/android-sdk，build-tools 35.0.0 / platforms android-35）

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_DIR="$(cd "$APP_DIR/.." && pwd)"
# WhaleClient：网页在 ../web
WEB_DIR="$PROJ_DIR/web"
BUILD="$APP_DIR/build"
DIST="$PROJ_DIR/dist"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/android-sdk}}"
BT="35.0.0"
PLATFORM="android-35"
PKG="${DS_PKG:-com.tun.whale}"
APP_NAME="${DS_APP_NAME:-小虎鲸}"
UPSTREAM="${DS_UPSTREAM:-http://nlb-m49t3666wybeevyd16.cn-beijing.nlb.aliyuncsslb.com}"
STRIP_ANTHROPIC="${DS_STRIP_ANTHROPIC:-false}"
DEFAULT_KEY="${DS_DEFAULT_KEY:-}"
PORT_BASE="${DS_PORT_BASE:-18731}"
RES_EXTRA="${DS_RES_EXTRA:-}"
BRAND_NAME="${DS_BRAND:-whale}"
ACCOUNT_NAME="${DS_ACCOUNT:-}"
AVATAR_SRC="${DS_AVATAR_FILE:-}"
AVATAR_PATH=""
if [ -n "$AVATAR_SRC" ]; then
  [ -f "$AVATAR_SRC" ] || die "头像文件不存在：$AVATAR_SRC"
  AVATAR_PATH="/brand-avatar.png"
fi
VERSION_CODE="2"
VERSION_NAME="1.0.1"
APK_NAME="deepseek-chat-${VERSION_NAME}${DS_APK_SUFFIX:-}.apk"
KEYSTORE="$APP_DIR/deepseek-app.keystore"
KS_PASS="deepseekapp"
KS_ALIAS="deepseekapp"
PKG_PATH="$(printf '%s' "$PKG" | tr '.' '/')"

log() { printf '\033[1m[build]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[build][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

CLEAN=0
BUILD_WEB=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --web) BUILD_WEB=1 ;;
    *) die "未知参数：${arg}（用法：./build.sh [--clean] [--web]）" ;;
  esac
done

# ---------------------------------------------------------------- 1. JDK
resolve_jdk() {
  local c
  for c in \
    "${JAVA_HOME:-}" \
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" \
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" ; do
    if [ -n "$c" ] && [ -x "$c/bin/javac" ]; then
      export JAVA_HOME="$c"
      return 0
    fi
  done
  return 1
}
resolve_jdk || die "找不到 JDK（装 openjdk@21 或设 JAVA_HOME）"
export PATH="$JAVA_HOME/bin:$PATH"
log "JAVA_HOME=$JAVA_HOME"

# ---------------------------------------------------------------- 2. Android SDK
export ANDROID_SDK_ROOT="$SDK"
export ANDROID_HOME="$SDK"
AAPT2="$SDK/build-tools/$BT/aapt2"
ZIPALIGN="$SDK/build-tools/$BT/zipalign"
APKSIGNER="$SDK/build-tools/$BT/apksigner"
D8="$SDK/build-tools/$BT/d8"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
for f in "$AAPT2" "$ZIPALIGN" "$APKSIGNER" "$D8" "$ANDROID_JAR"; do
  [ -e "$f" ] || die "缺工具：$f"
done
log "SDK=$SDK build-tools=$BT platform=$PLATFORM"

# ---------------------------------------------------------------- 3. 网页产物
if [ "$BUILD_WEB" = "1" ]; then
  log "构建网页"
  ( cd "$WEB_DIR" && DS_API_ORIGIN=/api npx rspack build -c rspack.config.ts )
fi
[ -f "$WEB_DIR/dist/index.html" ] || die "缺 $WEB_DIR/dist/index.html（先跑 ./build.sh --web）"

# ---------------------------------------------------------------- 4. 工作目录
if [ "$CLEAN" = "1" ]; then
  rm -rf "$BUILD"
fi
mkdir -p "$BUILD/res" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$DIST" \
         "$APP_DIR/assets" "$BUILD/gen-src/$PKG_PATH" "$BUILD/src"
rm -rf "$APP_DIR/assets/www" "$BUILD/gen-src" "$BUILD/src"
mkdir -p "$BUILD/gen-src/$PKG_PATH" "$BUILD/src"

cp -R "$WEB_DIR/dist/." "$APP_DIR/assets/www/"
rm -rf "$BUILD/res"
mkdir -p "$BUILD/res"
cp -R "$APP_DIR/res/." "$BUILD/res/"
# 变体专属资源（图标等）覆盖默认资源
if [ -n "$RES_EXTRA" ]; then
  [ -d "$APP_DIR/$RES_EXTRA" ] || die "缺变体资源目录：$APP_DIR/$RES_EXTRA"
  cp -R "$APP_DIR/$RES_EXTRA/." "$BUILD/res/"
fi
cp -R "$APP_DIR/src/." "$BUILD/src/"

# 应用名（每个变体不同）
python3 - "$BUILD/res/values/strings.xml" "$APP_NAME" <<'PY'
import sys
path, name = sys.argv[1], sys.argv[2]
xml = ('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
       '    <string name="app_name">%s</string>\n</resources>\n' % name.replace('&', '&amp;').replace('<', '&lt;'))
open(path, 'w', encoding='utf-8').write(xml)
PY

# 包名（变体之间可共存）
if [ "$PKG" != "com.tun.whale" ]; then
  find "$BUILD/src" -name '*.java' -exec sed -i '' "s/^package com\.tun\.dsapp;/package $PKG;/" {} +
fi

if [ -n "$AVATAR_SRC" ]; then
  cp "$AVATAR_SRC" "$APP_DIR/assets/www/brand-avatar.png"
fi

log "应用名=$APP_NAME 包名=$PKG 图标资源=${RES_EXTRA:-默认} 网页资源=$(du -sh "$APP_DIR/assets/www" | cut -f1)"

# ---------------------------------------------------------------- 5. BuildConfig
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
UPSTREAM_ESC="$(esc "$UPSTREAM")"
KEY_ESC="$(esc "$DEFAULT_KEY")"
sed -e "s|@UPSTREAM@|$UPSTREAM_ESC|g" \
    -e "s|@STRIP_ANTHROPIC@|$STRIP_ANTHROPIC|g" \
    -e "s|@DEFAULT_API_KEY@|$KEY_ESC|g" \
    -e "s|@PORT_BASE@|$PORT_BASE|g" \
    -e "s|@BRAND_NAME@|$(esc "$BRAND_NAME")|g" \
    -e "s|@BRAND_AVATAR@|$AVATAR_PATH|g" \
    -e "s|@ACCOUNT_NAME@|$(esc "$ACCOUNT_NAME")|g" \
    -e "s|@VERSION_NAME@|$VERSION_NAME|g" \
    -e "s|@VERSION_CODE@|$VERSION_CODE|g" \
    "$APP_DIR/template/BuildConfig.java.in" > "$BUILD/gen-src/$PKG_PATH/BuildConfig.java"
if [ "$PKG" != "com.tun.whale" ]; then
  sed -i '' "s/^package com\.tun\.dsapp;/package $PKG;/" "$BUILD/gen-src/$PKG_PATH/BuildConfig.java"
fi
grep -q "UPSTREAM = \"$UPSTREAM\"" "$BUILD/gen-src/$PKG_PATH/BuildConfig.java" \
  || die "BuildConfig UPSTREAM 注入失败"
if [ -n "$DEFAULT_KEY" ]; then
  grep -q "DEFAULT_API_KEY = \"$DEFAULT_KEY\"" "$BUILD/gen-src/$PKG_PATH/BuildConfig.java" \
    || die "BuildConfig DEFAULT_API_KEY 注入失败"
fi
if [ -n "$DEFAULT_KEY" ]; then
  log "上游=$UPSTREAM 端口段=$PORT_BASE 预填Key=有（${#DEFAULT_KEY} 字符）"
else
  log "上游=$UPSTREAM 端口段=$PORT_BASE 预填Key=无"
fi

# ---------------------------------------------------------------- 6. keystore
if [ ! -f "$KEYSTORE" ]; then
  log "生成签名密钥：$KEYSTORE"
  "$JAVA_HOME/bin/keytool" -genkeypair \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=DeepSeek Chat Local, OU=Local Build, O=Local, L=Local, ST=Local, C=CN" >/dev/null
fi

# ---------------------------------------------------------------- 7. 资源编译
log "aapt2 compile"
"$AAPT2" compile --dir "$BUILD/res" -o "$BUILD/res.zip"

sed -e "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$VERSION_CODE\"/" \
    -e "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION_NAME\"/" \
    -e "s/package=\"com\.tun\.dsapp\"/package=\"$PKG\"/" \
    "$APP_DIR/AndroidManifest.xml" > "$BUILD/AndroidManifest.xml"

log "aapt2 link"
"$AAPT2" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$BUILD/AndroidManifest.xml" \
  --custom-package "$PKG" \
  -A "$APP_DIR/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 26 \
  --target-sdk-version 35 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  "$BUILD/res.zip"

# ---------------------------------------------------------------- 8. javac
log "javac"
find "$BUILD/src" "$BUILD/gen" "$BUILD/gen-src" -name '*.java' | sort > "$BUILD/sources.txt"
"$JAVA_HOME/bin/javac" \
  -source 11 -target 11 -Xlint:-options -encoding UTF-8 \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

# ---------------------------------------------------------------- 9. dex + 打包
log "d8"
find "$BUILD/classes" -name '*.class' | sort > "$BUILD/classes.txt"
"$D8" --release --min-api 26 --lib "$ANDROID_JAR" --output "$BUILD/dex" @"$BUILD/classes.txt"
[ -f "$BUILD/dex/classes.dex" ] || die "d8 未产出 classes.dex"

cp -f "$BUILD/base.apk" "$BUILD/unsigned.apk"
( cd "$BUILD/dex" && zip -q -X "$BUILD/unsigned.apk" classes.dex )
log "zipalign"
"$ZIPALIGN" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

# ---------------------------------------------------------------- 10. 签名
OUT="$DIST/$APK_NAME"
rm -f "$OUT" "$OUT.idsig"
log "apksigner sign -> $OUT"
"$APKSIGNER" sign \
  --ks "$KEYSTORE" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT" "$BUILD/aligned.apk"

# ---------------------------------------------------------------- 11. 构建信息
SIZE=$(wc -c < "$OUT" | tr -d ' ')
SHA=$(shasum -a 256 "$OUT" | cut -d' ' -f1)
INFO="$DIST/build-info${DS_APK_SUFFIX:-}.txt"
{
  echo "DeepSeek Chat 安卓端构建信息"
  echo "=========================================="
  printf '应用名      : %s\n' "$APP_NAME"
  printf '包名        : %s\n' "$PKG"
  printf '版本        : %s (versionCode %s)\n' "$VERSION_NAME" "$VERSION_CODE"
  printf '构建时间    : %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
  printf '上游 API    : %s\n' "$UPSTREAM"
  printf '路径改写    : %s\n' "$STRIP_ANTHROPIC"
  printf '预填 Key    : %s\n' "$([ -n "$DEFAULT_KEY" ] && echo "是（${#DEFAULT_KEY} 字符）" || echo "否")"
  printf 'APK         : %s\n' "$OUT"
  printf '大小        : %s bytes\n' "$SIZE"
  printf 'sha256      : %s\n' "$SHA"
} > "$INFO"
( cd "$DIST" && shasum -a 256 "$APK_NAME" > "SHA256SUMS${DS_APK_SUFFIX:-}")

log "完成：${OUT}（${SIZE} bytes）"
cat "$INFO"
