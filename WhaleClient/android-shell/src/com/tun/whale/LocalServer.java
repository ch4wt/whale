package com.tun.whale;

import android.content.res.AssetManager;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 本机 HTTP 服务。
 *
 * 作用有两个：
 * 1. 把 APK 内的静态页面（assets/www）以 http://127.0.0.1:PORT/ 提供出来。
 * 2. 把 /api/* 原样转发到上游 API，让网页与接口同源，避开浏览器 CORS 限制。
 *
 * 端口固定（不随机），因为页面的 localStorage / IndexedDB 按 origin 隔离，
 * 端口一变等于换站点，聊天记录和 API Key 都会丢。
 */
final class LocalServer {

    private static final String TAG = "DeepSeekApp";

    private static final int PORT_SPAN = 10;
    private static final int MAX_BODY = 200 * 1024 * 1024;

    private final AssetManager assets;
    private final String upstream; // 例如 https://api.deepseek.com，末尾不带斜杠
    private final boolean stripAnthropic;
    private final String defaultKey;
    private final int portBase;
    private final String brandName;
    private final String brandAvatar;
    private final String accountName;

    private ServerSocket serverSocket;
    private volatile boolean running = true;
    private Thread acceptor;

    LocalServer(AssetManager assets, String upstream, boolean stripAnthropic, String defaultKey, int portBase,
                String brandName, String brandAvatar, String accountName) {
        this.assets = assets;
        this.stripAnthropic = stripAnthropic;
        this.defaultKey = defaultKey == null ? "" : defaultKey.trim();
        this.portBase = portBase <= 0 ? 18731 : portBase;
        this.brandName = brandName == null ? "" : brandName;
        this.brandAvatar = brandAvatar == null ? "" : brandAvatar;
        this.accountName = accountName == null ? "" : accountName;
        String u = upstream == null ? "" : upstream.trim();
        while (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        this.upstream = u;
    }

    /** 绑定 127.0.0.1，返回实际端口。端口被占用时按顺序试下一个。 */
    int start() throws IOException {
        IOException last = null;
        for (int port = portBase; port < portBase + PORT_SPAN; port++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 64);
                serverSocket = s;
                acceptor = new Thread(this::acceptLoop, "ds-local-http");
                acceptor.setDaemon(true);
                acceptor.start();
                return port;
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new IOException("无法绑定本机端口");
    }

    void stop() {
        running = false;
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException ignored) {
            // 关闭失败不影响进程退出
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket socket = serverSocket.accept();
                Thread t = new Thread(() -> handle(socket), "ds-local-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (!running) {
                    return;
                }
                try {
                    Thread.sleep(50);
                } catch (InterruptedException ie) {
                    return;
                }
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(120_000);
            socket.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(socket.getInputStream(), 16384);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 16384);

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) {
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                return;
            }
            String method = parts[0];
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    headers.put(line.substring(0, idx).trim().toLowerCase(Locale.ROOT),
                            line.substring(idx + 1).trim());
                }
            }

            if (target.startsWith("/api/")
                    || target.startsWith("/v1/")
                    || target.startsWith("/avatars/")) {
                proxy(method, target, headers, in, out);
            } else {
                serveStatic(method, target, out);
            }
            out.flush();
        } catch (Exception ignored) {
            // 客户端断开属于常态（用户停止生成、页面刷新），不记录
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {
                // 已关闭
            }
        }
    }

    // ---------------------------------------------------------------- 静态文件

    private void serveStatic(String method, String target, OutputStream out) throws IOException {
        String path = target;
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        if (path.isEmpty() || path.equals("/")) {
            path = "/index.html";
        }
        if (path.contains("..")) {
            sendText(out, 404, "Not Found");
            return;
        }
        String assetPath = "www" + path;
        InputStream is;
        try {
            is = assets.open(assetPath);
        } catch (IOException e) {
            // 单页应用：未知路径回落到首页
            try {
                is = assets.open("www/index.html");
            } catch (IOException e2) {
                sendText(out, 404, "Not Found");
                return;
            }
        }
        byte[] data = readAll(is);
        is.close();
        if (path.endsWith(".html") && (!defaultKey.isEmpty() || !brandName.isEmpty())) {
            data = injectDefaults(data);
        }

        String head = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: " + mime(path) + "\r\n"
                + "Content-Length: " + data.length + "\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        if (!"HEAD".equals(method)) {
            out.write(data);
        }
        out.flush();
    }

    /** 在 <head> 后插入一段脚本：首次启动时把内置 API Key 写进 localStorage */
    private byte[] injectDefaults(byte[] html) {
        String safe = defaultKey.replace("\\", "\\\\").replace("'", "\\'");
        String brandScript = "<script>window.__BRAND__={name:'" + esc(brandName)
                + "',avatar:'" + esc(brandAvatar) + "',account:'" + esc(accountName) + "'};</script>";
        String script = brandScript + "<script>(function(){try{"
                + "if(!localStorage.getItem('chat-demo:api-key')){"
                + "localStorage.setItem('chat-demo:api-key','" + safe + "');"
                + "}}catch(e){}})();</script>";
        String text = new String(html, StandardCharsets.UTF_8);
        int idx = text.indexOf("<head>");
        if (idx < 0) {
            return html;
        }
        text = text.substring(0, idx + 6) + script + text.substring(idx + 6);
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static String esc(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("'", "\\'");
    }

    private void sendText(OutputStream out, int code, String text) throws IOException {
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + " " + text + "\r\n"
                + "Content-Type: text/plain; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain; charset=utf-8";
        if (p.endsWith(".map")) return "application/json; charset=utf-8";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- 反向代理

    private void proxy(String method, String target, Map<String, String> headers,
                       InputStream in, OutputStream out) throws IOException {
        byte[] body = readBody(headers, in);
        String path = target.substring(4); // 去掉 "/api"
        if (path.isEmpty()) {
            path = "/";
        }
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        if (stripAnthropic && path.startsWith("/anthropic/")) {
            path = path.substring("/anthropic".length());
        }

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(upstream + path).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(20_000);
            conn.setReadTimeout(600_000);
            conn.setInstanceFollowRedirects(false);
            conn.setUseCaches(false);

            for (Map.Entry<String, String> e : headers.entrySet()) {
                String k = e.getKey();
                if (skipRequestHeader(k)) {
                    continue;
                }
                conn.setRequestProperty(canonical(k), e.getValue());
            }

            boolean hasBody = body.length > 0
                    || "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
            if (hasBody) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(body.length);
                OutputStream os = conn.getOutputStream();
                os.write(body);
                os.flush();
                os.close();
            }

            int code = conn.getResponseCode();
            Log.i(TAG, method + " " + path + " -> " + code);
            writeChunkedHead(out, code, conn.getHeaderFields());

            if (code == 204 || code == 304) {
                return;
            }
            InputStream es = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (es == null) {
                writeLastChunk(out);
                out.flush();
                return;
            }
            byte[] buf = new byte[8192];
            int n;
            long total = 0;
            while ((n = es.read(buf)) > 0) {
                writeChunk(out, buf, n);
                out.flush(); // SSE 必须逐块刷出
                total += n;
            }
            Log.i(TAG, method + " " + path + " 流结束, " + total + " bytes");
            es.close();
            writeLastChunk(out);
            out.flush();
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static boolean skipRequestHeader(String k) {
        switch (k) {
            case "host":
            case "connection":
            case "content-length":
            case "transfer-encoding":
            case "accept-encoding":
            case "origin":
            case "referer":
            case "cookie":
            case "upgrade-insecure-requests":
                return true;
            default:
                return k.startsWith("sec-") || k.startsWith("proxy-");
        }
    }

    private static String canonical(String k) {
        StringBuilder sb = new StringBuilder(k.length());
        boolean upper = true;
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            if (upper) {
                sb.append(Character.toUpperCase(c));
                upper = false;
            } else {
                sb.append(c);
            }
            if (c == '-') {
                upper = true;
            }
        }
        return sb.toString();
    }

    private void writeChunkedHead(OutputStream out, int code, Map<String, List<String>> headers)
            throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        boolean sawType = false;
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            String name = e.getKey();
            if (name == null) {
                continue;
            }
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.equals("content-length") || lower.equals("transfer-encoding")
                    || lower.equals("connection") || lower.equals("content-encoding")
                    || lower.equals("keep-alive")) {
                continue;
            }
            for (String v : e.getValue()) {
                head.append(name).append(": ").append(v).append("\r\n");
                if (lower.equals("content-type")) {
                    sawType = true;
                }
            }
        }
        if (!sawType) {
            head.append("Content-Type: application/json; charset=utf-8\r\n");
        }
        head.append("Transfer-Encoding: chunked\r\n");
        head.append("Cache-Control: no-store\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 204: return "No Content";
            case 301: return "Moved Permanently";
            case 302: return "Found";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 409: return "Conflict";
            case 413: return "Payload Too Large";
            case 422: return "Unprocessable Entity";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default: return "Status";
        }
    }

    private static void writeChunk(OutputStream out, byte[] data, int len) throws IOException {
        out.write(Integer.toHexString(len).getBytes(StandardCharsets.ISO_8859_1));
        out.write('\r');
        out.write('\n');
        out.write(data, 0, len);
        out.write('\r');
        out.write('\n');
    }

    private static void writeLastChunk(OutputStream out) throws IOException {
        out.write('0');
        out.write('\r');
        out.write('\n');
        out.write('\r');
        out.write('\n');
    }

    // ---------------------------------------------------------------- 请求体

    private byte[] readBody(Map<String, String> headers, InputStream in) throws IOException {
        String te = headers.get("transfer-encoding");
        if (te != null && te.toLowerCase(Locale.ROOT).contains("chunked")) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            while (true) {
                String sizeLine = readLine(in);
                if (sizeLine == null) {
                    break;
                }
                int semi = sizeLine.indexOf(';');
                if (semi >= 0) {
                    sizeLine = sizeLine.substring(0, semi);
                }
                int size;
                try {
                    size = Integer.parseInt(sizeLine.trim(), 16);
                } catch (NumberFormatException e) {
                    break;
                }
                if (size == 0) {
                    readLine(in);
                    break;
                }
                if (bos.size() + size > MAX_BODY) {
                    throw new IOException("请求体过大");
                }
                copyExact(in, bos, size);
                readLine(in);
            }
            return bos.toByteArray();
        }
        String cl = headers.get("content-length");
        if (cl == null) {
            return new byte[0];
        }
        int n;
        try {
            n = Integer.parseInt(cl.trim());
        } catch (NumberFormatException e) {
            return new byte[0];
        }
        if (n <= 0) {
            return new byte[0];
        }
        if (n > MAX_BODY) {
            throw new IOException("请求体过大");
        }
        ByteArrayOutputStream bos = new ByteArrayOutputStream(Math.min(n, 1 << 20));
        copyExact(in, bos, n);
        return bos.toByteArray();
    }

    private static void copyExact(InputStream in, OutputStream out, int len) throws IOException {
        byte[] buf = new byte[8192];
        int left = len;
        while (left > 0) {
            int n = in.read(buf, 0, Math.min(buf.length, left));
            if (n < 0) {
                throw new IOException("请求体提前结束");
            }
            out.write(buf, 0, n);
            left -= n;
        }
    }

    /** 读一行（\r\n 结尾），按字节读，避免把二进制读乱。 */
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(128);
        int prev = -1;
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n' && prev == '\r') {
                byte[] raw = bos.toByteArray();
                return new String(raw, 0, Math.max(0, raw.length - 1), StandardCharsets.ISO_8859_1);
            }
            bos.write(c);
            prev = c;
            if (bos.size() > 16384) {
                break;
            }
        }
        if (bos.size() == 0) {
            return null;
        }
        return new String(bos.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static byte[] readAll(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(16384);
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        return bos.toByteArray();
    }
}
