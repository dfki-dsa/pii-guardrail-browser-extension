<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import { onboardingStepCount, type OnboardingStep } from '../onboarding-content';
  import { firstUsableAnchor, positionCoachmark, type OnboardingPosition, type Rect } from '../onboarding-position';

  let { step, stepIndex, canGoBack, canGoNext, onBack, onNext, onEnd, shell, body }: {
    step: Readable<OnboardingStep | null>;
    stepIndex: Readable<number>;
    canGoBack: Readable<boolean>;
    canGoNext: Readable<boolean>;
    onBack: () => void;
    onNext: () => void;
    onEnd: () => void;
    shell: HTMLElement | undefined;
    body: HTMLElement | undefined;
  } = $props();

  let card = $state<HTMLElement>();
  let position = $state<OnboardingPosition>({ left: 12, top: 12, placement: 'floating', arrowLeft: null, targetCenterX: null, targetCenterY: null, targetLeft: null, targetTop: null, targetWidth: null, targetHeight: null });
  let restoreScroll = 0;
  let restoreScrollCaptured = false;
  let observer: ResizeObserver | undefined;
  let focusedStepIndex = -1;
  let frame = 0;

  const asRect = (rect: DOMRect): Rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  const usable = (element: HTMLElement | null): element is HTMLElement => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  function anchorFor(current: OnboardingStep): HTMLElement | null {
    return firstUsableAnchor([
      shell?.querySelector<HTMLElement>(`[data-onboarding-anchor="${current.anchor}"]`),
      shell?.querySelector<HTMLElement>(`[data-onboarding-anchor="${current.fallbackAnchor}"]`),
      shell?.querySelector<HTMLElement>('[data-onboarding-anchor="onboarding-help"]'),
    ], (candidate) => candidate.getBoundingClientRect());
  }

  const queuePosition = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => void updatePosition());
  };

  async function updatePosition(): Promise<void> {
    const current = $step;
    if (!shell || !card || !current) return;
    let anchor = anchorFor(current);
    if (anchor && body) {
      const bodyRect = body.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const outsideBody = anchorRect.top < bodyRect.top || anchorRect.bottom > bodyRect.bottom;
      const belongsToBody = body.contains(anchor);
      if (belongsToBody && outsideBody) {
        anchor.scrollIntoView({ block: 'nearest' });
        await tick();
        anchor = anchorFor(current);
      }
    }
    await tick();
    if (!shell || !card) return;
    const target = usable(anchor) ? asRect(anchor.getBoundingClientRect()) : null;
    position = positionCoachmark(asRect(shell.getBoundingClientRect()), target, asRect(card.getBoundingClientRect()), current.placement);
    if (focusedStepIndex !== $stepIndex) {
      focusedStepIndex = $stepIndex;
      card.querySelector<HTMLElement>('[data-coachmark-heading]')?.focus();
    }
  }

  function focusables(): HTMLElement[] {
    if (!card) return [];
    return [card, ...card.querySelectorAll<HTMLElement>('[data-coachmark-heading], button:not(:disabled)')];
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!$step) return;
    if (event.key === 'Escape') { event.preventDefault(); onEnd(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables();
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    if (index === -1 || (event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1)) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]?.focus();
    }
  }

  onDestroy(() => {
    if (body && restoreScrollCaptured) body.scrollTop = restoreScroll;
  });

  $effect(() => {
    if (!$step) return;
    if (!restoreScrollCaptured) {
      restoreScroll = body?.scrollTop ?? 0;
      restoreScrollCaptured = true;
    }
    void updatePosition();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(queuePosition);
      if (shell) observer.observe(shell);
      if (card) observer.observe(card);
      const anchor = anchorFor($step);
      if (anchor) observer.observe(anchor);
    }
    body?.addEventListener('scroll', queuePosition, { passive: true });
    window.addEventListener('resize', queuePosition);
    window.visualViewport?.addEventListener('resize', queuePosition);
    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = undefined;
      body?.removeEventListener('scroll', queuePosition);
      window.removeEventListener('resize', queuePosition);
      window.visualViewport?.removeEventListener('resize', queuePosition);
      document.removeEventListener('keydown', handleKeydown, true);
    };
  });

  $effect(() => {
    if (!$step && body && restoreScrollCaptured) {
      body.scrollTop = restoreScroll;
      restoreScrollCaptured = false;
      focusedStepIndex = -1;
    }
  });
</script>

{#if $step}
  <div class="tour-layer" aria-hidden="true"></div>
  {#if position.targetLeft !== null && position.targetTop !== null && position.targetWidth !== null && position.targetHeight !== null}
    <div class="target-halo" style={`left:${position.targetLeft}px; top:${position.targetTop}px; width:${position.targetWidth}px; height:${position.targetHeight}px`} aria-hidden="true"></div>
  {/if}
  <div
    bind:this={card}
    class="coachmark"
    class:above={position.placement === 'above'}
    class:floating={position.placement === 'floating'}
    style={`left:${position.left}px; top:${position.top}px; ${position.arrowLeft !== null ? `--arrow-left:${position.arrowLeft}px` : ''}`}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="coachmark-title"
    aria-describedby="coachmark-description"
  >
    <div class="coachmark-body">
      <p class="progress" aria-live="polite">Step {$stepIndex + 1} of {onboardingStepCount}</p>
      <h2 id="coachmark-title" data-coachmark-heading tabindex="-1">{$step.title}</h2>
      <p id="coachmark-description">{$step.body}</p>
    </div>
    <footer>
      <button type="button" onclick={onBack} disabled={!$canGoBack}>Back</button>
      <button type="button" class="end" onclick={onEnd}>End tour</button>
      <button type="button" class="next" onclick={onNext} disabled={!$canGoNext}>Next</button>
    </footer>
  </div>
{/if}

<style>
  .tour-layer { position: absolute; z-index: 10; inset: 0; background: rgb(15 23 42 / 24%); pointer-events: auto; }
  .target-halo { position: absolute; z-index: 11; box-sizing: border-box; border: 2px solid #8b5cf6; border-radius: 6px; box-shadow: 0 0 0 4px rgb(139 92 246 / 24%); pointer-events: none; }
  .coachmark { position: absolute; z-index: 12; width: min(316px, calc(100% - 24px)); max-height: calc(100% - 24px); box-sizing: border-box; display: flex; flex-direction: column; min-height: 0; padding: 13px; border: 1px solid #dbeafe; border-radius: 10px; background: #fff; box-shadow: 0 12px 28px rgb(15 23 42 / 30%); color: #172033; }
  .coachmark:not(.floating)::before { content: ''; position: absolute; left: calc(var(--arrow-left) - 7px); width: 14px; height: 14px; border: solid #dbeafe; border-width: 1px 1px 0 0; background: #fff; transform: rotate(-45deg); }
  .coachmark.above::before { bottom: -8px; transform: rotate(135deg); }
  .coachmark:not(.above)::before { top: -8px; }
  .coachmark-body { min-height: 0; overflow-y: auto; }
  .coachmark h2 { margin: 0; font-size: 15px; line-height: 1.25; outline: none; }
  .coachmark p { margin: 7px 0 0; color: #475569; font-size: 12px; line-height: 1.4; }
  .coachmark .progress { margin: 0; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  .coachmark footer { display: flex; flex-shrink: 0; align-items: center; gap: 6px; margin-top: 12px; }
  .coachmark button { min-height: 32px; padding: 5px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .coachmark button:focus-visible, .coachmark:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
  .coachmark button:disabled { cursor: default; opacity: .45; }
  .coachmark .end { margin-left: auto; }
  .coachmark .next { border-color: #2563eb; background: #2563eb; color: #fff; }
</style>
