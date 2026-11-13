/**
 * Privacy Guardrail — icons used by more than one on-page surface.
 *
 * Inline SVG as strings: the surfaces that use them build their markup inside
 * closed shadow roots, where an icon font or sprite sheet would not reach.
 * They take their colour from the surrounding text (`currentColor`).
 */

function svg(className: string, size: number, strokeWidth: number, body: string): string {
  const cls = className ? ` class="${className}"` : '';
  return `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Curved arrow: put it back the way it was. */
export function undoIcon(className = '', size = 16): string {
  return svg(className, size, 2, '<path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/>');
}

/** Shield with a tick: the paste went in protected. */
export function shieldCheckIcon(className = '', size = 22): string {
  return svg(
    className,
    size,
    1.8,
    '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  );
}

export function closeIcon(className = '', size = 16): string {
  return svg(className, size, 2, '<path d="M6 6l12 12M18 6L6 18"/>');
}
