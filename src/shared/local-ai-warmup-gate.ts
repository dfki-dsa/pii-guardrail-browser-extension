import type { NerStatus, Settings, SystemCompatibilityStatus } from './message-types';

/**
 * Resource-safe auto-warmup gate for the popup.
 *
 * PRD: "On popup open, auto-warm Local AI only when Local AI is enabled
 * and the system tier is OK. Do not auto-warm on warning, critical
 * override, unknown memory, or known CPU/WASM fallback systems."
 *
 * Callers must NOT auto-warm when this returns false. User-initiated
 * actions (explicit Local AI toggle, retry after load failure) live on
 * different code paths and are intentionally not gated here.
 */
export function shouldAutoWarmLocalAi(
  settings: Settings | null,
  status: SystemCompatibilityStatus | null,
  nerStatus?: NerStatus | null,
): boolean {
  if (!settings) return false;
  if (settings.nerProvider === 'off') return false;

  if (!status) return false;
  if (status.localAiState !== 'enabled') return false;
  if (status.tier !== 'ok') return false;
  if (status.webGpu === 'unavailable') return false;

  // Known runtime CPU/WASM fallback after the model has already loaded.
  if (nerStatus?.state === 'ready' && nerStatus.device === 'wasm') return false;

  return true;
}
