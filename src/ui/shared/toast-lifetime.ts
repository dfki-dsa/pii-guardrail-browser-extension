/**
 * Privacy Guardrail — the life of a toast
 *
 * What every on-page toast does the same way: go onto the page once, count
 * down to its own removal, hold that countdown while the user is engaged with
 * it, and come off the page exactly once — telling whoever is keeping a
 * reference to it.
 *
 * The toasts themselves own their markup, wording and actions. This owns only
 * the part that was identical in each of them and easy to get subtly wrong:
 * the timer and the dispose-once bookkeeping.
 */
export class ToastLifetime {
  private timer: number | null = null;
  private mounted = false;
  private disposed = false;
  private held = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly autoDismissMs: number,
    private readonly onDispose?: () => void,
  ) {}

  /** True between `mount()` and `dispose()`. */
  get isMounted(): boolean {
    return this.mounted;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Put the toast on the page and start the countdown. False, having done
   * nothing, when it is already there or already gone.
   */
  mount(): boolean {
    if (this.mounted || this.disposed) return false;
    document.body.appendChild(this.host);
    this.mounted = true;
    this.resume();
    return true;
  }

  /** Take the toast off the page for good. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    if (this.mounted) {
      this.host.remove();
      this.mounted = false;
    }
    this.onDispose?.();
  }

  /** Stop the countdown until `resume()`. */
  pause(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** (Re)start the countdown from the full duration. */
  resume(): void {
    if (this.disposed || this.held) return;
    this.pause();
    this.timer = window.setTimeout(() => this.dispose(), this.autoDismissMs);
  }

  /**
   * Stop counting down for good. Used once the toast is showing a result,
   * which then decides for itself how long it stays (`disposeAfter`).
   */
  hold(): void {
    this.held = true;
    this.pause();
  }

  /** Remove the toast after `ms`, whatever the countdown is doing. */
  disposeAfter(ms: number): void {
    window.setTimeout(() => this.dispose(), ms);
  }

  /**
   * Hold the countdown while the pointer is over `element` and, with
   * `focus`, while keyboard focus is inside it.
   *
   * The two are tracked together: the countdown resumes only once neither
   * holds. Otherwise moving the pointer away would restart it under someone
   * who has tabbed onto a button and is about to press it.
   */
  pauseWhileEngaged(element: HTMLElement | null, options: { focus?: boolean } = {}): void {
    if (!element) return;
    let hovered = false;
    let focused = false;
    const update = (): void => {
      if (hovered || focused) this.pause();
      else this.resume();
    };
    element.addEventListener('mouseenter', () => {
      hovered = true;
      update();
    });
    element.addEventListener('mouseleave', () => {
      hovered = false;
      update();
    });
    if (!options.focus) return;
    element.addEventListener('focusin', () => {
      focused = true;
      update();
    });
    element.addEventListener('focusout', () => {
      focused = false;
      update();
    });
  }
}
