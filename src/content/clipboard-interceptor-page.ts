/**
 * Privacy Guardrail — Clipboard Interceptor (page / main world)
 *
 * Runs in the page's main world at document_start. Monkey-patches
 * `navigator.clipboard.writeText` and (defensively) `Clipboard.prototype`
 * methods so the isolated-world coordinator sees writes triggered by the
 * page. The patch never blocks: the original is called first and the
 * postMessage notification is fired right after.
 *
 * This is one of two trigger sources the coordinator listens to. The
 * other is a bubble-phase `copy` DOM event listener in the isolated
 * world, which catches sites that copy via `clipboardData.setData(...)`
 * and `document.execCommand('copy')` without ever calling `writeText`.
 *
 * Captured-original discipline:
 *   - The original `writeText` reference is captured ONCE at boot. Every
 *     extension-driven write (the postMessage Replace round-trip) goes
 *     through that captured reference, never through the patched one.
 */

const SOURCE = 'pg-clipboard-intercept';

interface InterceptedMessage {
  source: typeof SOURCE;
  kind: 'WRITE_INTERCEPTED';
  text: string;
  requestId: string;
}

interface ReplaceMessage {
  source: typeof SOURCE;
  kind: 'REPLACE_CLIPBOARD';
  text: string;
  requestId: string;
}

(function installClipboardPatch(): void {
  const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  if (!clipboard) return;

  // Capture the pristine `writeText` once, bound to the live clipboard
  // instance. All replacement writes go through this reference so the
  // patch never observes its own writes.
  const originalWriteText =
    typeof clipboard.writeText === 'function'
      ? clipboard.writeText.bind(clipboard)
      : null;
  if (!originalWriteText) return;

  let nextId = 1;
  let lastRequestId: string | null = null;

  function notify(text: string): void {
    if (typeof text !== 'string' || text.length === 0) return;
    const requestId = `pg-${Date.now()}-${nextId++}`;
    lastRequestId = requestId;
    try {
      const msg: InterceptedMessage = {
        source: SOURCE,
        kind: 'WRITE_INTERCEPTED',
        text,
        requestId,
      };
      window.postMessage(msg, '*');
    } catch {
      /* ignore postMessage failures — never break the underlying copy */
    }
  }

  const patchedWriteText = function (this: unknown, text: string): Promise<void> {
    const result = originalWriteText(text);
    notify(text);
    return result;
  };

  // Patch BOTH the instance and the prototype. Most sites call
  // `navigator.clipboard.writeText(...)`, which resolves through the
  // prototype lookup; an instance-only patch shadows the prototype for
  // that case. But code paths that bind the prototype method directly
  // (`Clipboard.prototype.writeText.call(...)`) bypass the instance
  // override — covering both is cheap insurance.
  try {
    Object.defineProperty(clipboard, 'writeText', {
      value: patchedWriteText,
      writable: true,
      configurable: true,
    });
  } catch {
    /* property may be locked down on some pages; the prototype patch
     * below still helps. */
  }
  try {
    const proto = Object.getPrototypeOf(clipboard) as Clipboard;
    if (proto && typeof proto.writeText === 'function') {
      Object.defineProperty(proto, 'writeText', {
        value: patchedWriteText,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    /* ignore — instance patch may already cover it */
  }

  // ClipboardItem-based writes: `navigator.clipboard.write([item])`.
  // Some sites use this to copy rich content (text/html + text/plain).
  // Extract the text/plain blob if present and notify.
  if (typeof clipboard.write === 'function') {
    const originalWrite = clipboard.write.bind(clipboard);
    const patchedWrite = function (
      this: unknown,
      items: ClipboardItem[],
    ): Promise<void> {
      const result = originalWrite(items);
      try {
        for (const item of items || []) {
          if (!item || typeof item.getType !== 'function') continue;
          if (!item.types?.includes?.('text/plain')) continue;
          item
            .getType('text/plain')
            .then((blob) => blob.text())
            .then((text) => notify(text))
            .catch(() => {
              /* ignore */
            });
        }
      } catch {
        /* ignore */
      }
      return result;
    };
    try {
      Object.defineProperty(clipboard, 'write', {
        value: patchedWrite,
        writable: true,
        configurable: true,
      });
    } catch {
      /* ignore */
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as ReplaceMessage | undefined;
    if (!data || data.source !== SOURCE) return;
    if (data.kind !== 'REPLACE_CLIPBOARD') return;
    // Stale-id rejection: a newer copy has happened since this toast
    // was shown. Drop the late Replace so the older de-anonymized
    // text doesn't clobber the newer copy.
    if (data.requestId !== lastRequestId) return;
    originalWriteText(data.text).catch(() => {
      /* user has already left the toast; nothing actionable */
    });
  });

  // Boot marker so the user can confirm in DevTools that the main-world
  // script actually loaded. Cheap and one-shot.
  try {
    console.debug('[PG:clipboard-page] writeText patch installed');
  } catch {
    /* ignore */
  }
})();
