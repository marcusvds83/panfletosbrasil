package com.panfletosbrasil.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    private WebView webView;
    private static final String APP_URL = "https://encartebrasil.onrender.com";
    private boolean authFlowInProgress = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Status bar color
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#B91C1C"));

        // Main layout
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.MATCH_PARENT));

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
                    // O Google bloqueia OAuth em WebViews (disallowed_useragent).
                    // Abrimos no Chrome; apos auth, o JS redireciona de volta
                    // via custom scheme panfletosbrasil://auth-callback?idToken=XXX
                    if (url.contains("accounts.google.com/o/oauth2") ||
                        url.contains("google.com/accounts/OAuthLogin") ||
                        url.contains("google.com/signin")) {
                        authFlowInProgress = true;
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
                        startActivity(intent);
                        return true; // Nao carrega no WebView
                    }

                    // URLs do proprio app e Firebase: carregar no WebView
                    if (url.startsWith(APP_URL) || url.contains("firebaseapp.com")) {
                        return false;
                    }

                    return false;
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    showErrorPage();
                }
            });

            webView.setWebChromeClient(new WebChromeClient());

            // Enable cookie persistence (CRITICAL for login/session)
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            CookieManager.getInstance().flush();

            // Verifica se a activity foi aberta via custom scheme (callback do Google auth)
            handleIntent(getIntent());

            webView.loadUrl(APP_URL);
        } catch (Exception e) {
            showErrorPage();
        }

        layout.addView(webView);
        setContentView(layout);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    /**
     * Processa intents recebidos, especialmente o callback do Google Auth
     * via custom scheme: panfletosbrasil://auth-callback?idToken=XXX
     */
    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();

        if ("panfletosbrasil".equals(uri.getScheme()) && "auth-callback".equals(uri.getHost())) {
            String idToken = uri.getQueryParameter("idToken");
            if (idToken != null && !idToken.isEmpty()) {
                authFlowInProgress = true;
                // Carrega a pagina auth-complete no WebView, que vai chamar
                // /api/auth/google-login com o token e setar o cookie no WebView
                String authCompleteUrl = APP_URL + "/auth-complete?token=" + Uri.encode(idToken);
                webView.loadUrl(authCompleteUrl);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Nao recarregar durante o fluxo de autenticacao (evita perder o estado)
        if (!authFlowInProgress) {
            try {
                webView.reload();
            } catch (Exception ignored) {}
        }
        authFlowInProgress = false;
    }

    private void showErrorPage() {
        runOnUiThread(() -> {
            LinearLayout errorLayout = new LinearLayout(this);
            errorLayout.setOrientation(LinearLayout.VERTICAL);
            errorLayout.setGravity(android.view.Gravity.CENTER);
            errorLayout.setBackgroundColor(Color.WHITE);
            errorLayout.setPadding(48, 48, 48, 48);

            TextView msg = new TextView(this);
            msg.setText("Sem conexao com o servidor.\nVerifique sua internet e tente novamente.");
            msg.setTextColor(Color.parseColor("#666666"));
            msg.setTextSize(16);
            msg.setGravity(android.view.Gravity.CENTER);

            Button retry = new Button(this);
            retry.setText("Tentar Novamente");
            retry.setTextColor(Color.WHITE);
            retry.setBackgroundColor(Color.parseColor("#DC2626"));
            retry.setPadding(32, 16, 32, 16);
            retry.setOnClickListener(v -> {
                errorLayout.removeAllViews();
                webView.setVisibility(View.VISIBLE);
                webView.reload();
            });

            int dp16 = (int)(16 * getResources().getDisplayMetrics().density);
            LinearLayout.LayoutParams msgParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            msgParams.bottomMargin = dp16;
            msg.setLayoutParams(msgParams);

            LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            btnParams.gravity = android.view.Gravity.CENTER_HORIZONTAL;
            retry.setLayoutParams(btnParams);

            errorLayout.addView(msg);
            errorLayout.addView(retry);

            webView.setVisibility(View.GONE);
            LinearLayout parent = (LinearLayout) webView.getParent();
            if (parent != null) {
                parent.addView(errorLayout);
            }
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}