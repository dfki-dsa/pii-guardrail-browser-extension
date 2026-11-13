/** @jest-environment jsdom */

import { ToastLifetime } from '../../src/ui/shared/toast-lifetime';

describe('ToastLifetime', () => {
  let host: HTMLElement;
  let onDispose: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    host = document.createElement('div');
    host.id = 'toast';
    onDispose = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const onPage = (): boolean => document.getElementById('toast') !== null;

  it('goes onto the page once', () => {
    const life = new ToastLifetime(host, 1000, onDispose);

    expect(life.mount()).toBe(true);
    expect(life.mount()).toBe(false);

    expect(onPage()).toBe(true);
    expect(life.isMounted).toBe(true);
    expect(document.querySelectorAll('#toast')).toHaveLength(1);
  });

  it('removes itself when the countdown runs out, and says so once', () => {
    const life = new ToastLifetime(host, 1000, onDispose);
    life.mount();

    jest.advanceTimersByTime(999);
    expect(onPage()).toBe(true);
    jest.advanceTimersByTime(1);

    expect(onPage()).toBe(false);
    expect(life.isDisposed).toBe(true);
    expect(life.isMounted).toBe(false);
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes once however often it is asked', () => {
    const life = new ToastLifetime(host, 1000, onDispose);
    life.mount();

    life.dispose();
    life.dispose();
    jest.advanceTimersByTime(5000);

    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('cannot be mounted after it was disposed', () => {
    const life = new ToastLifetime(host, 1000, onDispose);
    life.dispose();

    expect(life.mount()).toBe(false);
    expect(onPage()).toBe(false);
  });

  it('holds the countdown while paused and restarts it in full on resume', () => {
    const life = new ToastLifetime(host, 1000, onDispose);
    life.mount();

    jest.advanceTimersByTime(900);
    life.pause();
    jest.advanceTimersByTime(60_000);
    expect(onPage()).toBe(true);

    life.resume();
    jest.advanceTimersByTime(999);
    expect(onPage()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(onPage()).toBe(false);
  });

  it('pauses while the pointer is over the element, and while focus is inside it when asked', () => {
    const surface = document.createElement('div');
    const life = new ToastLifetime(host, 1000, onDispose);
    life.pauseWhileEngaged(surface, { focus: true });
    life.mount();

    surface.dispatchEvent(new Event('mouseenter'));
    jest.advanceTimersByTime(10_000);
    expect(onPage()).toBe(true);
    surface.dispatchEvent(new Event('mouseleave'));

    surface.dispatchEvent(new Event('focusin'));
    jest.advanceTimersByTime(10_000);
    expect(onPage()).toBe(true);
    surface.dispatchEvent(new Event('focusout'));

    jest.advanceTimersByTime(1000);
    expect(onPage()).toBe(false);
  });

  it('keeps holding while either the pointer or focus is still there', () => {
    const surface = document.createElement('div');
    const life = new ToastLifetime(host, 1000, onDispose);
    life.pauseWhileEngaged(surface, { focus: true });
    life.mount();

    // Tabbed onto a button, then the pointer passes over and away.
    surface.dispatchEvent(new Event('focusin'));
    surface.dispatchEvent(new Event('mouseenter'));
    surface.dispatchEvent(new Event('mouseleave'));
    jest.advanceTimersByTime(10_000);
    expect(onPage()).toBe(true);

    // The other way round: focus leaves while the pointer rests on it.
    surface.dispatchEvent(new Event('mouseenter'));
    surface.dispatchEvent(new Event('focusout'));
    jest.advanceTimersByTime(10_000);
    expect(onPage()).toBe(true);

    // Neither holds any more: the countdown starts afresh.
    surface.dispatchEvent(new Event('mouseleave'));
    jest.advanceTimersByTime(999);
    expect(onPage()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(onPage()).toBe(false);
  });

  it('ignores focus unless asked to follow it', () => {
    const surface = document.createElement('div');
    const life = new ToastLifetime(host, 1000, onDispose);
    life.pauseWhileEngaged(surface);
    life.mount();

    surface.dispatchEvent(new Event('focusin'));
    jest.advanceTimersByTime(1000);

    expect(onPage()).toBe(false);
  });

  it('stops counting down for good once held, leaving the result to decide', () => {
    const surface = document.createElement('div');
    const life = new ToastLifetime(host, 1000, onDispose);
    life.pauseWhileEngaged(surface);
    life.mount();

    life.hold();
    // Moving the pointer away must not restart the countdown under a result.
    surface.dispatchEvent(new Event('mouseleave'));
    life.resume();
    jest.advanceTimersByTime(60_000);
    expect(onPage()).toBe(true);

    life.disposeAfter(500);
    jest.advanceTimersByTime(500);
    expect(onPage()).toBe(false);
  });

  it('tolerates having no element to watch', () => {
    const life = new ToastLifetime(host, 1000);
    expect(() => life.pauseWhileEngaged(null)).not.toThrow();
  });
});
