package com.yunnan.dietplanner;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private WebView webView;
    private final List<String> nativeEvents = new ArrayList<>();

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new NativeEdgeBridge(this), "NativeEdgeBridge");
        webView.setWebViewClient(new ShellWebViewClient());
        webView.loadUrl(BuildConfig.APP_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    private boolean isOnline() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return capabilities != null
            && (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
    }

    private class ShellWebViewClient extends WebViewClient {
        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                loadOfflineShell(view);
            }
        }
    }

    private void loadOfflineShell(WebView view) {
        String html = "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
            + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<body style='font-family:sans-serif;background:#0b1110;color:#f3f4f6;padding:28px;'>"
            + "<h1>健康饮食规划系统</h1>"
            + "<p>当前无法连接 Web 服务。APP 壳已启动，端侧模型和离线缓存会在 Web 资源可用后继续工作。</p>"
            + "<p>请确认后端服务或线上域名可访问后重试。</p>"
            + "</body></html>";
        view.loadDataWithBaseURL("https://diet-planner.local/", html, "text/html", "utf-8", null);
    }

    public class NativeEdgeBridge {
        private final Context context;

        NativeEdgeBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public String getRuntime() {
            return "{\"channel\":\"android-webview\",\"online\":" + isOnline() + ",\"version\":\"0.1.0\"}";
        }

        @JavascriptInterface
        public void recordEvent(String eventJson) {
            nativeEvents.add(eventJson);
            if (nativeEvents.size() > 100) {
                nativeEvents.remove(0);
            }
        }

        @JavascriptInterface
        public String readEvents() {
            StringBuilder builder = new StringBuilder("[");
            for (int i = 0; i < nativeEvents.size(); i += 1) {
                if (i > 0) builder.append(",");
                builder.append(nativeEvents.get(i));
            }
            builder.append("]");
            return builder.toString();
        }
    }
}
