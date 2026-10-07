package com.local.acumap;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;

public class MainActivity extends Activity {
 private WebView viewer;

 @Override public void onCreate(Bundle savedInstanceState) {
  super.onCreate(savedInstanceState);
  viewer = new WebView(this);
  viewer.setBackgroundColor(0xff0f1a21);
  setContentView(viewer);
  viewer.setOnApplyWindowInsetsListener((view, insets) -> {
   if (android.os.Build.VERSION.SDK_INT >= 30) {
    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
   }
   return insets;
  });

  WebSettings settings = viewer.getSettings();
  settings.setJavaScriptEnabled(true);
  settings.setDomStorageEnabled(true);
  settings.setAllowFileAccess(false);
  settings.setAllowContentAccess(false);
  settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

  final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
   .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
   .build();
  viewer.setWebViewClient(new WebViewClient() {
   @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
    return response != null ? response : new WebResourceResponse(
     "text/plain", "UTF-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0]));
   }

   @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
    return true;
   }
  });
  viewer.loadUrl("https://appassets.androidplatform.net/assets/index.html");
 }

 @Override protected void onPause() {
  super.onPause();
  viewer.onPause();
 }

 @Override protected void onResume() {
  super.onResume();
  if (viewer != null) viewer.onResume();
 }

 @Override protected void onDestroy() {
  viewer.destroy();
  super.onDestroy();
 }
}
