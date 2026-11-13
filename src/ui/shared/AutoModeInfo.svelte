<script lang="ts">
  import { AUTO_MODE_OFF_HINT, AUTO_MODE_ON_HINT } from '../../shared/auto-mode-copy';

  // The info tag beside every auto-mode switch: an "i" that says what on and
  // off do, shown on hover or keyboard focus.
  //
  // Deliberately without a <style> block. It is used both in the extension
  // popup and inside the review pop-up's closed shadow root, where a
  // component's own styles would not be injected. Its styles live in
  // src/shared/styles/info-tag.css, which both surfaces load.
  let {
    tipId,
    placement = 'below',
    buttonId,
  }: {
    /** Id for the tooltip, so the switch beside it can be described by it. */
    tipId: string;
    /** Which way the tooltip opens. */
    placement?: 'above' | 'below';
    buttonId?: string;
  } = $props();
</script>

<span class={['pg-info', `pg-info--${placement}`]}>
  <button type="button" class="pg-info-btn" id={buttonId} aria-label="About auto-mode" aria-describedby={tipId}>i</button>
  <span class="pg-info-tip" role="tooltip" id={tipId}>
    <span><strong>On:</strong> {AUTO_MODE_ON_HINT}</span>
    <span><strong>Off:</strong> {AUTO_MODE_OFF_HINT}</span>
  </span>
</span>
