/**
 * Privacy Guardrail — De-anonymization Banner (Shadow DOM)
 *
 * Attaches to AI response elements that contain placeholders.
 * Provides a toggle to reveal/hide original PII values as a
 * non-destructive overlay on the response text.
 */

import { EntityMap } from '../../shared/entity-map';
import { deAnonymize } from '../../shared/de-anonymizer';
import { resolveText } from '../../shared/placeholder-resolver';
import { SHADOW_DESIGN_SYSTEM_STYLES } from '../shared/shadow-design-system';

type FormControl = HTMLInputElement | HTMLTextAreaElement;

/** Collect descendant `<input>` and `<textarea>` controls in document
 *  order. Used to surface artifact-card content that lives on the
 *  `.value` property and is invisible to `Node.textContent`. */
function collectFormControls(root: HTMLElement): FormControl[] {
  return Array.from(root.querySelectorAll<FormControl>('input, textarea'));
}

/** Concatenate the response's textContent with the current `.value` of
 *  every descendant form control. Newline-separated so placeholders
 *  embedded in different fields cannot fuse into spurious tokens. */
function buildCombinedText(
  root: HTMLElement,
  controls: FormControl[],
): string {
  const parts: string[] = [root.textContent || ''];
  for (const control of controls) {
    if (control.value) parts.push(control.value);
  }
  return parts.join('\n');
}

interface HiddenElementState {
  element: HTMLElement;
  styleAttribute: string | null;
}

interface HiddenTextState {
  placeholder: Comment;
  textNode: Text;
}

/**
 * Create and attach a de-anonymization banner above a response element.
 *
 * @param theme — visual theme to render in. Defaults to `dark`.
 */
export function attachDeAnonBanner(
  responseElement: HTMLElement,
  entityMap: EntityMap,
  theme: 'dark' | 'light' = 'dark',
): void {
  // Don't attach twice
  if (responseElement.dataset.pgBanner === 'attached') return;
  responseElement.dataset.pgBanner = 'attached';

  // Build a combined detection text spanning visible markdown and any
  // descendant form-control values (artifact cards render their content
  // into <input>/<textarea>, whose current `.value` is not part of
  // textContent for controlled React components).
  const formControls = collectFormControls(responseElement);
  const text = buildCombinedText(responseElement, formControls);

  // Single source of truth for placeholder + synthetic resolution. Used
  // by both the banner and the clipboard interceptor so the two surfaces
  // never disagree on what is revealable.
  const { matches } = resolveText(text, entityMap);
  const totalRevealable = matches.length;
  if (totalRevealable === 0) return;

  // Create banner host with Shadow DOM
  const host = document.createElement('div');
  host.className = 'pg-deanon-host';
  const shadow = host.attachShadow({ mode: 'closed' });

  let revealed = false;
  let overlayEl: HTMLElement | null = null;
  let hiddenElements: HiddenElementState[] = [];
  let hiddenTextNodes: HiddenTextState[] = [];

  shadow.innerHTML = `
    <style>${BANNER_STYLES}</style>
    <div class="pg-banner pg-design-surface" data-theme="${theme}" role="status" aria-live="polite">
      <span class="pg-banner-icon" aria-hidden="true"></span>
      <span class="pg-banner-text pg-design-muted">${totalRevealable} anonymized item${totalRevealable !== 1 ? 's' : ''}</span>
      <button class="pg-banner-btn pg-design-button" id="pg-reveal-btn">Reveal originals</button>
      <button class="pg-banner-btn pg-banner-copy pg-design-button pg-design-button-subtle" id="pg-copy-btn" title="Copy de-anonymized text">Copy</button>
    </div>
  `;

  const revealBtn = shadow.getElementById('pg-reveal-btn')!;
  const copyBtn = shadow.getElementById('pg-copy-btn')!;

  revealBtn.addEventListener('click', () => {
    if (!revealed) {
      overlayEl = buildRevealLayer(responseElement, entityMap);
      ({ hiddenElements, hiddenTextNodes } = hideOriginalContent(responseElement));
      responseElement.appendChild(overlayEl);

      revealBtn.textContent = 'Hide originals';
      revealed = true;
    } else {
      // Remove overlay, restore original
      if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
      }
      restoreOriginalContent(hiddenElements, hiddenTextNodes);
      hiddenElements = [];
      hiddenTextNodes = [];
      revealBtn.textContent = 'Reveal originals';
      revealed = false;
    }
  });

  copyBtn.addEventListener('click', () => {
    // Re-collect at click time so any user edits to artifact text fields
    // are reflected in what gets copied.
    const liveControls = collectFormControls(responseElement);
    const liveText = buildCombinedText(responseElement, liveControls);
    const deAnon = deAnonymize(liveText, entityMap);
    navigator.clipboard.writeText(deAnon).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });

  // Insert banner before the response element
  responseElement.parentElement?.insertBefore(host, responseElement);
}

function buildRevealLayer(responseElement: HTMLElement, entityMap: EntityMap): HTMLElement {
  const overlayEl = document.createElement('div');
  overlayEl.className = 'pg-deanon-overlay-container';
  overlayEl.style.display = 'contents';

  // Snapshot live form-control values BEFORE cloning. Form controls hold
  // their current value on the `.value` property; cloneNode(true) only
  // copies the markup-level default, so artifact-card text would be lost
  // in the clone for any React-controlled control.
  const originalControls = collectFormControls(responseElement);
  const liveValues = originalControls.map((c) => c.value);

  for (const child of Array.from(responseElement.childNodes)) {
    overlayEl.appendChild(child.cloneNode(true));
  }

  replacePlaceholdersInSubtree(overlayEl, entityMap);
  replaceFormControlsInSubtree(overlayEl, liveValues, entityMap);

  return overlayEl;
}

/**
 * Replace cloned `<input>` / `<textarea>` elements in the reveal overlay
 * with static, de-anonymised renditions. Form controls don't pick up
 * text-node mutations the way prose does, so the regular text-walk pass
 * can't surface placeholders that live inside their `.value`.
 */
function replaceFormControlsInSubtree(
  overlayEl: HTMLElement,
  liveValues: string[],
  entityMap: EntityMap,
): void {
  const overlayControls = collectFormControls(overlayEl);
  // Order matches because `collectFormControls` returns document order
  // and the overlay was cloned from the same subtree.
  const limit = Math.min(overlayControls.length, liveValues.length);
  for (let i = 0; i < limit; i++) {
    const control = overlayControls[i];
    const value = liveValues[i];
    const isMultiline = control.tagName === 'TEXTAREA';
    const replacement = document.createElement(isMultiline ? 'pre' : 'span');
    replacement.className = 'pg-revealed-formfield';
    if (isMultiline) {
      replacement.style.whiteSpace = 'pre-wrap';
      replacement.style.fontFamily = 'inherit';
      replacement.style.margin = '0';
    }
    const fragment = buildReplacementFragment(value, entityMap);
    if (fragment) {
      replacement.appendChild(fragment);
    } else {
      replacement.textContent = value;
    }
    control.replaceWith(replacement);
  }
}

function replacePlaceholdersInSubtree(root: ParentNode, entityMap: EntityMap): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const fragment = buildReplacementFragment(textNode.textContent || '', entityMap);
    if (fragment) {
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }
}

function buildReplacementFragment(
  text: string,
  entityMap: EntityMap,
): DocumentFragment | null {
  const { matches } = resolveText(text, entityMap);
  if (matches.length === 0) return null;

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
    }

    const span = document.createElement('span');
    span.className = `pg-revealed pg-revealed-${match.styleKey}`;
    span.title = `Was: ${match.matchText}`;
    span.textContent = match.originalText;
    applyRevealHighlight(span, match.styleKey);
    fragment.appendChild(span);

    cursor = match.end;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

function applyRevealHighlight(element: HTMLElement, typeClass: string): void {
  const palette: Record<string, { background: string; color: string }> = {
    person: { background: 'rgba(153, 27, 27, 0.85)', color: '#fef2f2' },
    email: { background: 'rgba(30, 64, 175, 0.85)', color: '#eff6ff' },
    phone: { background: 'rgba(133, 77, 14, 0.9)', color: '#fffbeb' },
    credit_card: { background: 'rgba(107, 33, 168, 0.85)', color: '#f5f3ff' },
    ssn: { background: 'rgba(157, 23, 77, 0.85)', color: '#fdf2f8' },
    iban: { background: 'rgba(107, 33, 168, 0.85)', color: '#f5f3ff' },
    ip_address: { background: 'rgba(17, 94, 89, 0.85)', color: '#f0fdfa' },
    location: { background: 'rgba(22, 101, 52, 0.85)', color: '#f0fdf4' },
    organization: { background: 'rgba(154, 52, 18, 0.88)', color: '#fff7ed' },
    date: { background: 'rgba(55, 48, 163, 0.85)', color: '#eef2ff' },
    misc: { background: 'rgba(71, 85, 105, 0.88)', color: '#f8fafc' },
  };

  const colors = palette[typeClass] || palette.misc;
  element.style.borderRadius = '3px';
  element.style.padding = '1px 3px';
  element.style.fontWeight = '500';
  element.style.background = colors.background;
  element.style.color = colors.color;
}

function hideOriginalContent(
  responseElement: HTMLElement,
): { hiddenElements: HiddenElementState[]; hiddenTextNodes: HiddenTextState[] } {
  const hiddenElements: HiddenElementState[] = [];
  const hiddenTextNodes: HiddenTextState[] = [];

  for (const child of Array.from(responseElement.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement;
      hiddenElements.push({
        element,
        styleAttribute: element.getAttribute('style'),
      });
      element.style.display = 'none';
      continue;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const textNode = child as Text;
      const placeholder = document.createComment('pg-hidden-text');
      responseElement.replaceChild(placeholder, textNode);
      hiddenTextNodes.push({ placeholder, textNode });
    }
  }

  return { hiddenElements, hiddenTextNodes };
}

function restoreOriginalContent(
  hiddenElements: HiddenElementState[],
  hiddenTextNodes: HiddenTextState[],
): void {
  for (const { element, styleAttribute } of hiddenElements) {
    if (styleAttribute === null) {
      element.removeAttribute('style');
    } else {
      element.setAttribute('style', styleAttribute);
    }
  }

  for (const { placeholder, textNode } of hiddenTextNodes) {
    placeholder.parentNode?.replaceChild(textNode, placeholder);
  }
}

const BANNER_STYLES = `
  ${SHADOW_DESIGN_SYSTEM_STYLES}

  .pg-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    margin-bottom: 6px;
    border-radius: var(--pg-radius-md);
    font-size: 12px;
    line-height: 1.4;
  }

  .pg-banner-icon {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--pg-color-success);
    box-shadow: 0 0 0 3px rgb(34 197 94 / 16%);
    flex: 0 0 auto;
  }

  .pg-banner-text { flex: 1; }

  .pg-banner-btn {
    padding: 5px 9px;
    font-size: 11px;
  }

  .pg-revealed {
    border-radius: 3px;
    padding: 1px 3px;
    font-weight: 500;
  }

  .pg-revealed-formfield {
    display: block;
    padding: 6px 8px;
    margin: 4px 0;
    border: 1px dashed rgba(148, 163, 184, 0.5);
    border-radius: 4px;
  }
  .pg-revealed-person { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
  .pg-revealed-email { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
  .pg-revealed-phone { background: rgba(234, 179, 8, 0.2); color: #fde047; }
  .pg-revealed-credit_card { background: rgba(168, 85, 247, 0.2); color: #c4b5fd; }
  .pg-revealed-ssn { background: rgba(236, 72, 153, 0.2); color: #f9a8d4; }
  .pg-revealed-iban { background: rgba(168, 85, 247, 0.2); color: #c4b5fd; }
  .pg-revealed-ip_address { background: rgba(20, 184, 166, 0.2); color: #5eead4; }
  .pg-revealed-location { background: rgba(34, 197, 94, 0.2); color: #86efac; }
  .pg-revealed-organization { background: rgba(249, 115, 22, 0.2); color: #fdba74; }
  .pg-revealed-date { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }
  .pg-revealed-misc { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; }
`;
