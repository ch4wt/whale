package com.tun.whale;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.graphics.Color;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** 应用主界面：一个铺满屏幕的 WebView，页面由本机 LocalServer 提供。 */
public class MainActivity extends Activity {

    private static final String TAG = "DeepSeekApp";
    private static final int REQ_FILE = 0x51;
    private static final int REQ_MIC = 0x52;

    private WebView web;
    private LocalServer server;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFFFFFF);

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        configureWebView();

        int port;
        try {
            server = new LocalServer(getAssets(), BuildConfig.UPSTREAM, BuildConfig.STRIP_ANTHROPIC,
                    BuildConfig.DEFAULT_API_KEY, BuildConfig.PORT_BASE,
                    BuildConfig.BRAND_NAME, BuildConfig.BRAND_AVATAR, BuildConfig.ACCOUNT_NAME);
            port = server.start();
        } catch (IOException e) {
            Log.e(TAG, "本机服务启动失败", e);
            showFatal("本机服务启动失败：" + e.getMessage());
            return;
        }
        web.loadUrl("http://127.0.0.1:" + port + "/");
    }

    private void showFatal(String message) {
        TextView tv = new TextView(this);
        tv.setText(message);
        tv.setPadding(48, 96, 48, 48);
        tv.setTextSize(16);
        ((ViewGroup) web.getParent()).addView(tv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);

        web.setBackgroundColor(0xFFFFFFFF);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        // 页面主题色（<meta name="theme-color">）回传给原生，用来同步状态栏
        web.addJavascriptInterface(new ThemeBridge(), "AndroidTheme");
        // 允许 adb 连接调试页面（仅本机调试用途，需设备授权）
        WebView.setWebContentsDebuggingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                injectThemeWatcher();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (scheme.equals("http") && uri.getHost() != null && uri.getHost().equals("127.0.0.1")) {
                    return false; // 本机页面内部跳转，交给 WebView
                }
                if (scheme.equals("http") || scheme.equals("https")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception e) {
                        Log.w(TAG, "无法打开外部链接", e);
                    }
                    return true;
                }
                return true; // 其他 scheme 一律不接管
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handlePermissionRequest(request));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                return openFileChooser(callback, params);
            }
        });
    }

    /** 注入主题观察器，并在页面切换主题时立刻同步状态栏颜色 */
    private void injectThemeWatcher() {
        String js = "(function(){"
                + "var m=document.querySelector('meta[name=\"theme-color\"]');"
                + "if(!m||!window.AndroidTheme)return;"
                + "function push(){try{AndroidTheme.setThemeColor(m.content||'#ffffff')}catch(e){}}"
                + "push();"
                + "new MutationObserver(push).observe(m,{attributes:true,attributeFilter:['content']});"
                + "})();";
        web.evaluateJavascript(js, null);
    }

    private void applyThemeColor(String value) {
        int color = parseColor(value);
        if (color == 0) {
            return;
        }
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        double luma = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0;
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        if (luma > 0.6) {
            flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        } else {
            flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    /** 支持 #RRGGBB、#RGB、rgb(r, g, b) 三种写法；无法解析返回 0 */
    private static int parseColor(String value) {
        if (value == null) {
            return 0;
        }
        String v = value.trim();
        try {
            if (v.startsWith("#")) {
                return Color.parseColor(v);
            }
            int open = v.indexOf('(');
            int close = v.indexOf(')');
            if (open > 0 && close > open) {
                String[] parts = v.substring(open + 1, close).split(",");
                if (parts.length >= 3) {
                    int r = clamp(Integer.parseInt(parts[0].trim()));
                    int g = clamp(Integer.parseInt(parts[1].trim()));
                    int b = clamp(Integer.parseInt(parts[2].trim()));
                    return Color.rgb(r, g, b);
                }
            }
        } catch (Exception ignored) {
            return 0;
        }
        return 0;
    }

    private static int clamp(int v) {
        return Math.max(0, Math.min(255, v));
    }

    private final class ThemeBridge {
        @JavascriptInterface
        public void setThemeColor(final String value) {
            runOnUiThread(() -> applyThemeColor(value));
        }
    }

    private void handlePermissionRequest(PermissionRequest request) {
        boolean wantsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                wantsAudio = true;
            }
        }
        if (!wantsAudio) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingPermission = request;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_MIC) {
            return;
        }
        PermissionRequest pending = pendingPermission;
        pendingPermission = null;
        if (pending == null) {
            return;
        }
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pending.deny();
        }
    }

    private boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
        }
        fileCallback = callback;
        try {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            if (params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            String[] accept = params == null ? null : params.getAcceptTypes();
            if (accept != null && accept.length > 0 && accept[0] != null && !accept[0].isEmpty()) {
                String type = accept[0];
                if (type.contains("/")) {
                    intent.setType(type);
                }
            }
            startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "打开文件选择器失败", e);
            fileCallback = null;
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback == null) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null);
            return;
        }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            for (int i = 0; i < count; i++) {
                Uri uri = data.getClipData().getItemAt(i).getUri();
                if (uri != null) {
                    uris.add(uri);
                }
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        callback.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (server != null) {
            server.stop();
        }
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }
}
