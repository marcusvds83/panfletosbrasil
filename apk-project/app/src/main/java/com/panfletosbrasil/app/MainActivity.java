package com.panfletosbrasil.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    private WebView webView;
    private LinearLayout splashLayout;
    private LinearLayout errorLayout;
    private FrameLayout container;
    private static final String APP_URL = "https://encartebrasil.onrender.com";
    private boolean authFlowInProgress = false;
    private Handler retryHandler = new Handler(Looper.getMainLooper());
    private int retryCount = 0;
    private static final int MAX_RETRIES = 5;
    private static final int RETRY_DELAY_MS = 3000; // 3 segundos entre tentativas

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Status bar color
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#B91C1C"));

        // Container principal
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.WHITE);

        // ── Splash Screen ──────────────────────────────────────────────────
        splashLayout = createSplashScreen();
        container.addView(splashLayout);

        // ── Error Screen ───────────────────────────────────────────────────
        errorLayout = createErrorScreen();
        errorLayout.setVisibility(View.GONE);
        container.addView(errorLayout);

        // ── WebView ────────────────────────────────────────────────────────
        webView = new WebView(this);
        webView.setVisibility(View.GONE);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        try {
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setUserAgentString(settings.getUserAgentString() + " PanfletosBrasilApp/1.0");
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);

            webView.setWebViewClient(new WebViewClient() {

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();

                    // ── Google OAuth: abrir no navegador externo (Chrome) ──
                    if (url.contains("accounts.google.com/o/oauth2") ||
                        url.contains("google.com/accounts/OAuthLogin") ||
                        url.contains("google.com/signin")) {
                        authFlowInProgress = true;
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
                        startActivity(intent);
                        return true;
                    }

                    // URLs do proprio app e Firebase: carregar no WebView
                    if (url.startsWith(APP_URL) || url.contains("firebaseapp.com")) {
                        // Exceção: PDFs devem abrir no navegador externo (WebView não renderiza PDF)
                        if (url.contains("/api/encarte/") && url.endsWith("/pdf")) {
                            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
                            startActivity(intent);
                            return true;
                        }
                        return false;
                    }

                    return false;
                }

                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                    showSplash();
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    // Verifica se a pagina carregou corretamente
                    // Se o titulo for "404" ou conter "not found", é um erro
                    String title = view.getTitle();
                    if (title != null && (title.contains("404") || title.toLowerCase().contains("not found"))) {
                        handleLoadError("Pagina nao encontrada");
                        return;
                    }
                    hideSplash();
                    retryCount = 0; // Reset retry count on success
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    handleLoadError("Erro de conexao: " + description);
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                    // Intercepta erros HTTP no pedido principal (nao sub-recursos como imagens/JS)
                    String url = request.getUrl().toString();
                    if (url.equals(APP_URL) || url.equals(APP_URL + "/")) {
                        int statusCode = errorResponse.getStatusCode();
                        if (statusCode >= 400) {
                            handleLoadError("Servidor retornou erro " + statusCode + " — tentando novamente...");
                        }
                    }
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    handleLoadError("O navegador interno travou. Tentando novamente...");
                    return true;
                }
            });

            webView.setWebChromeClient(new WebChromeClient());

            // Enable cookie persistence
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            CookieManager.getInstance().flush();

            // Verifica se a activity foi aberta via custom scheme (callback do Google auth)
            handleIntent(getIntent());

            container.addView(webView);
            setContentView(container);

            // Carrega a URL principal
            webView.loadUrl(APP_URL);

        } catch (Exception e) {
            handleLoadError("Erro ao inicializar: " + e.getMessage());
            container.addView(webView);
            setContentView(container);
        }
    }

    // ── Splash Screen ──────────────────────────────────────────────────────

    private LinearLayout createSplashScreen() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.WHITE);

        // Icon placeholder (red rounded square)
        ImageView icon = new ImageView(this);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(
            (int)(72 * getResources().getDisplayMetrics().density),
            (int)(72 * getResources().getDisplayMetrics().density));
        iconParams.bottomMargin = (int)(12 * getResources().getDisplayMetrics().density);
        icon.setLayoutParams(iconParams);

        // Create a simple red rounded rectangle as icon placeholder
        GradientDrawable iconBg = new GradientDrawable();
        iconBg.setCornerRadius(16 * getResources().getDisplayMetrics().density);
        iconBg.setColor(Color.parseColor("#DC2626"));
        icon.setImageDrawable(iconBg);
        icon.setScaleType(ImageView.ScaleType.CENTER);
        icon.setPadding(16, 16, 16, 16);

        TextView title = new TextView(this);
        title.setText("Panfletos Brasil");
        title.setTextColor(Color.parseColor("#1F2937"));
        title.setTextSize(20);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        titleParams.bottomMargin = (int)(8 * getResources().getDisplayMetrics().density);
        title.setLayoutParams(titleParams);

        TextView subtitle = new TextView(this);
        subtitle.setText("Carregando...");
        subtitle.setTextColor(Color.parseColor("#9CA3AF"));
        subtitle.setTextSize(14);
        subtitle.setGravity(Gravity.CENTER);

        // Loading dots
        TextView dots = new TextView(this);
        dots.setText(". . .");
        dots.setTextColor(Color.parseColor("#DC2626"));
        dots.setTextSize(18);
        dots.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dotsParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        dotsParams.topMargin = (int)(24 * getResources().getDisplayMetrics().density);
        dots.setLayoutParams(dotsParams);

        layout.addView(icon);
        layout.addView(title);
        layout.addView(subtitle);
        layout.addView(dots);

        return layout;
    }

    // ── Error Screen ───────────────────────────────────────────────────────

    private LinearLayout createErrorScreen() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.WHITE);
        int pad = (int)(32 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        // Red icon
        ImageView icon = new ImageView(this);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(
            (int)(56 * getResources().getDisplayMetrics().density),
            (int)(56 * getResources().getDisplayMetrics().density));
        iconParams.bottomMargin = (int)(16 * getResources().getDisplayMetrics().density);
        icon.setLayoutParams(iconParams);
        GradientDrawable iconBg = new GradientDrawable();
        iconBg.setCornerRadius(12 * getResources().getDisplayMetrics().density);
        iconBg.setColor(Color.parseColor("#FEE2E2"));
        icon.setImageDrawable(iconBg);
        icon.setScaleType(ImageView.ScaleType.CENTER);
        icon.setPadding(12, 12, 12, 12);

        TextView title = new TextView(this);
        title.setText("Nao foi possivel carregar");
        title.setTextColor(Color.parseColor("#1F2937"));
        title.setTextSize(18);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        titleParams.bottomMargin = (int)(8 * getResources().getDisplayMetrics().density);
        title.setLayoutParams(titleParams);

        TextView errorMsg = new TextView(this);
        errorMsg.setText("Verifique sua conexao com a internet.\nO servidor pode estar acordando (aguarde alguns segundos).");
        errorMsg.setTextColor(Color.parseColor("#6B7280"));
        errorMsg.setTextSize(13);
        errorMsg.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams msgParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        msgParams.bottomMargin = (int)(24 * getResources().getDisplayMetrics().density);
        errorMsg.setLayoutParams(msgParams);

        TextView retryInfo = new TextView(this);
        retryInfo.setText("");
        retryInfo.setTextColor(Color.parseColor("#9CA3AF"));
        retryInfo.setTextSize(12);
        retryInfo.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams retryInfoParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        retryInfoParams.bottomMargin = (int)(16 * getResources().getDisplayMetrics().density);
        retryInfo.setLayoutParams(retryInfoParams);

        // Retry button
        android.widget.Button retryBtn = new android.widget.Button(this);
        retryBtn.setText("Tentar Novamente");
        retryBtn.setTextColor(Color.WHITE);
        retryBtn.setAllCaps(false);
        retryBtn.setTextSize(15);
        int btnPadH = (int)(32 * getResources().getDisplayMetrics().density);
        int btnPadV = (int)(12 * getResources().getDisplayMetrics().density);
        retryBtn.setPadding(btnPadH, btnPadV, btnPadH, btnPadV);
        GradientDrawable btnBg = new GradientDrawable();
        btnBg.setCornerRadius(8 * getResources().getDisplayMetrics().density);
        btnBg.setColor(Color.parseColor("#DC2626"));
        retryBtn.setBackground(btnBg);
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        btnParams.gravity = Gravity.CENTER_HORIZONTAL;
        retryBtn.setLayoutParams(btnParams);

        retryBtn.setOnClickListener(v -> {
            retryCount = 0;
            doRetry();
        });

        layout.addView(icon);
        layout.addView(title);
        layout.addView(errorMsg);
        layout.addView(retryInfo);
        layout.addView(retryBtn);

        // Store reference to retryInfo for updates
        layout.setTag(retryInfo);

        return layout;
    }

    // ── Screen Management ──────────────────────────────────────────────────

    private void showSplash() {
        runOnUiThread(() -> {
            if (splashLayout != null) splashLayout.setVisibility(View.VISIBLE);
            if (errorLayout != null) errorLayout.setVisibility(View.GONE);
            if (webView != null) webView.setVisibility(View.GONE);
        });
    }

    private void hideSplash() {
        runOnUiThread(() -> {
            if (splashLayout != null) splashLayout.setVisibility(View.GONE);
            if (errorLayout != null) errorLayout.setVisibility(View.GONE);
            if (webView != null) webView.setVisibility(View.VISIBLE);
        });
    }

    private void showError(String message) {
        runOnUiThread(() -> {
            if (splashLayout != null) splashLayout.setVisibility(View.GONE);
            if (webView != null) webView.setVisibility(View.GONE);
            if (errorLayout != null) {
                errorLayout.setVisibility(View.VISIBLE);
                TextView retryInfo = (TextView) errorLayout.getTag();
                if (retryInfo != null) {
                    retryInfo.setText(message);
                }
            }
        });
    }

    // ── Error Handling + Auto-Retry ────────────────────────────────────────

    private void handleLoadError(String message) {
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            int attempt = retryCount;
            int delay = RETRY_DELAY_MS * attempt; // Delay crescente: 3s, 6s, 9s, 12s, 15s

            // Mostra splash com mensagem de retry
            runOnUiThread(() -> {
                if (splashLayout != null) splashLayout.setVisibility(View.VISIBLE);
                if (errorLayout != null) errorLayout.setVisibility(View.GONE);
            });

            // Aguarda e tenta novamente
            retryHandler.postDelayed(() -> {
                if (retryCount == attempt) { // So tenta se nao houve nova tentativa manual
                    try {
                        webView.loadUrl(APP_URL);
                    } catch (Exception ignored) {}
                }
            }, delay);
        } else {
            // Excedeu o maximo de tentativas — mostra tela de erro com botao de retry manual
            showError("Tentativa " + retryCount + "/" + MAX_RETRIES + " — " + message);
        }
    }

    private void doRetry() {
        showSplash();
        try {
            webView.clearCache(true);
            webView.loadUrl(APP_URL);
        } catch (Exception ignored) {}
    }

    // ── Intent Handling (Google Auth Callback) ─────────────────────────────

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();

        if ("panfletosbrasil".equals(uri.getScheme()) && "auth-callback".equals(uri.getHost())) {
            String idToken = uri.getQueryParameter("idToken");
            if (idToken != null && !idToken.isEmpty()) {
                authFlowInProgress = true;
                String authCompleteUrl = APP_URL + "/auth-complete?token=" + Uri.encode(idToken);
                webView.loadUrl(authCompleteUrl);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!authFlowInProgress) {
            // Se o WebView ja mostrou conteudo, nao recarregar
            if (webView != null && webView.getVisibility() == View.VISIBLE) {
                // Conteudo ja carregou — nao precisa recarregar
            } else {
                // Ainda no splash ou erro — recarregar (pode ter voltado do Chrome)
                try {
                    webView.loadUrl(APP_URL);
                } catch (Exception ignored) {}
            }
        }
        authFlowInProgress = false;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        retryHandler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}