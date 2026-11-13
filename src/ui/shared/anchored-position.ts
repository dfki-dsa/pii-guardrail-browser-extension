/**
 * Privacy Guardrail — lining floating notices up with the message box.
 *
 * The notices are `position: fixed` and centred with `left: 50%`, which is the
 * middle of the window. On a chat page that is rarely the middle of the chat:
 * a sidebar pushes the conversation and its message box to one side, and a
 * notice about a paste then appears off to the side of the thing it is about.
 *
 * `centerOverAnchor` moves a notice's centre to the horizontal centre of an
 * anchor element — the message box — and keeps it fully on screen. With no
 * usable anchor it changes nothing, so the stylesheet's `left: 50%` remains
 * the fallback. Only `left` is set; the notices keep their own
 * `translateX(-50%)`, vertical position and entrance animation.
 */

/** Gap kept between a notice and the edge of the window. */
const VIEWPORT_MARGIN_PX = 16;

function viewportWidth(): number {
  return document.documentElement.clientWidth || window.innerWidth || 0;
}

/**
 * The horizontal centre of `anchor` in viewport pixels, or null when the
 * element is gone, has no width, or sits entirely outside the window.
 */
export function anchorCenterX(anchor: Element | null | undefined): number | null {
  if (!anchor || !anchor.isConnected) return null;
  const rect = anchor.getBoundingClientRect();
  if (!(rect.width > 0)) return null;
  const center = rect.left + rect.width / 2;
  const width = viewportWidth();
  if (!(center > 0) || (width > 0 && center >= width)) return null;
  return center;
}

/**
 * `center` moved as little as needed for a surface `surfaceWidth` wide to keep
 * `margin` to both edges of the window. Null when no position can do that:
 * the surface is wider than the window allows, or the window has no width.
 */
function clampCenterX(center: number, surfaceWidth: number, margin: number): number | null {
  const width = viewportWidth();
  const min = surfaceWidth / 2 + margin;
  const max = width - surfaceWidth / 2 - margin;
  return width > 0 && min <= max ? Math.min(Math.max(center, min), max) : null;
}

/**
 * How far sideways, in pixels, a surface that its container centres in the
 * window has to move to sit over `anchor` — positive is to the right.
 *
 * For the review pop-up, which is wide: a full move would often push it off
 * the far edge, so it goes as far toward the anchor as it can while keeping
 * `margin` to the window's edge. Zero when there is no usable anchor or the
 * surface already fills the window.
 */
export function anchorShiftX(
  surfaceWidth: number,
  anchor: Element | null | undefined,
  margin: number = VIEWPORT_MARGIN_PX,
): number {
  const center = anchorCenterX(anchor);
  if (center === null) return 0;
  const target = clampCenterX(center, surfaceWidth, margin);
  return target === null ? 0 : Math.round(target - viewportWidth() / 2);
}

/**
 * Centre a mounted, fixed-position notice over `anchor`.
 *
 * Call it after the notice is in the document (its width is measured) and
 * again when its text changes enough to change that width.
 */
export function centerOverAnchor(
  surface: HTMLElement | null | undefined,
  anchor: Element | null | undefined,
): void {
  if (!surface) return;
  const center = anchorCenterX(anchor);
  if (center === null) {
    // Back to the stylesheet's own centring.
    surface.style.removeProperty('left');
    return;
  }

  // A notice wider than the window cannot be kept inside it by moving it,
  // so it is simply left over the anchor.
  const clamped = clampCenterX(center, surface.offsetWidth, VIEWPORT_MARGIN_PX) ?? center;
  surface.style.left = `${Math.round(clamped)}px`;
}
