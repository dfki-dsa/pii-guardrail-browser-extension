<script lang="ts">
  import { truncate, type DismissMenuState } from '../overlay-model';

  let {
    menu,
    shadowRoot,
    onChoose,
    onClose,
  }: {
    menu: DismissMenuState;
    shadowRoot: ShadowRoot;
    onChoose: (persist: 'none' | 'value' | 'pattern') => void;
    onClose: () => void;
  } = $props();

  const WIDTH = 230;
  const GAP = 6;

  // Position the popover just below the anchor button (using viewport
  // coordinates — `position: fixed`). If it would clip off the right edge
  // of the viewport, nudge it left so it stays fully visible.
  const top = $derived(menu.anchorRect.bottom + GAP);
  const left = $derived(
    Math.max(8, Math.min(menu.anchorRect.right - WIDTH, window.innerWidth - WIDTH - 8)),
  );

  let menuEl: HTMLElement | undefined = $state();

  $effect(() => {
    // Document-level: a closed shadow root retargets the event so its
    // `target` becomes the shadow host. So if `e.target === host` the
    // mousedown happened *inside* the shadow — let the shadow-root
    // listener decide. Otherwise it's truly outside → close.
    function onDocDown(e: MouseEvent) {
      if (e.target === shadowRoot.host) return;
      onClose();
    }
    // Shadow-root level: inside the shadow we can see the real target.
    // Only close when the click is outside the menu element itself.
    function onShadowDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (menuEl && target && menuEl.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDocDown, true);
    shadowRoot.addEventListener('mousedown', onShadowDown as EventListener, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      shadowRoot.removeEventListener('mousedown', onShadowDown as EventListener, true);
      document.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div
  bind:this={menuEl}
  class="pg-dismiss-menu"
  role="menu"
  style="top: {top}px; left: {left}px; width: {WIDTH}px;"
>
  <div class="pg-dismiss-menu-head">
    <span>Dismiss </span>
    <span class="pg-dismiss-menu-value">"{truncate(menu.spanText, 28)}"</span>
  </div>

  <button type="button" class="pg-dismiss-menu-item" role="menuitem" onclick={() => onChoose('none')}>
    <span class="pg-dismiss-menu-item-l">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M2.5 2.5l6 6M8.5 2.5l-6 6" />
      </svg>
      Just this time
    </span>
  </button>

  <button type="button" class="pg-dismiss-menu-item" role="menuitem" onclick={() => onChoose('value')}>
    <span class="pg-dismiss-menu-item-l">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 6l2.5 2.5L10 3" />
      </svg>
      Always allow this value
    </span>
  </button>

  <button type="button" class="pg-dismiss-menu-item" role="menuitem" onclick={() => onChoose('pattern')}>
    <span class="pg-dismiss-menu-item-l">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1" />
        <path d="M4.5 6h3" />
      </svg>
      Allow pattern…
    </span>
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true" class="pg-dismiss-menu-item-arrow">
      <path d="M3 2l2.5 2.5L3 7" />
    </svg>
  </button>
</div>
