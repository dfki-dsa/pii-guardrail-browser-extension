/**
 * Firefox MV2 — runs in isolated world at document_start.
 * Injects clipboard-interceptor-page.js into the page's main world via a
 * <script> tag so it executes synchronously before page scripts.
 */
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/clipboard-interceptor-page.js');
document.documentElement.insertBefore(script, document.documentElement.firstChild);
