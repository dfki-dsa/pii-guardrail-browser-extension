/** @jest-environment jsdom */

import { CancelDecisionDialog } from '../../src/ui/cancel-decision-dialog/cancel-decision-dialog';

describe('CancelDecisionDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function host(): HTMLElement {
    const el = document.getElementById('pg-cancel-decision-dialog-host');
    if (!el) throw new Error('dialog host not found');
    return el;
  }

  it('renders the required accessible dialog copy and light theme attribute', () => {
    void new CancelDecisionDialog('light').show();
    const root = host().shadowRoot!;

    const dialog = root.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-theme')).toBe('light');
    expect(root.textContent).toContain('Scan canceled');
    expect(root.textContent).toContain('Do you want to paste this text without checking for personal data?');
    expect(root.textContent).toContain('Remember this choice');
    expect(root.textContent).toContain('Paste without checking');
    expect(root.textContent).toContain('Don’t paste');
  });

  it('resolves paste-original with remember only after the primary action is clicked', async () => {
    const promise = new CancelDecisionDialog('dark').show();
    const root = host().shadowRoot!;
    (root.querySelector('.remember') as HTMLInputElement).checked = true;
    (root.querySelector('.primary') as HTMLButtonElement).click();

    await expect(promise).resolves.toEqual({
      decision: 'paste-original',
      remember: true,
      dismissed: false,
    });
    expect(document.getElementById('pg-cancel-decision-dialog-host')).toBeNull();
  });

  it('resolves drop from the secondary button and can remember it', async () => {
    const promise = new CancelDecisionDialog('dark').show();
    const root = host().shadowRoot!;
    (root.querySelector('.remember') as HTMLInputElement).checked = true;
    (root.querySelector('.secondary') as HTMLButtonElement).click();

    await expect(promise).resolves.toEqual({
      decision: 'drop',
      remember: true,
      dismissed: false,
    });
  });

  it('treats Escape and backdrop dismissal as safe drop without remembering', async () => {
    const escapePromise = new CancelDecisionDialog('dark').show();
    (host().shadowRoot!.querySelector('.remember') as HTMLInputElement).checked = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(escapePromise).resolves.toEqual({ decision: 'drop', remember: false, dismissed: true });

    const backdropPromise = new CancelDecisionDialog('dark').show();
    (host().shadowRoot!.querySelector('.remember') as HTMLInputElement).checked = true;
    (host().shadowRoot!.querySelector('.backdrop') as HTMLElement).click();
    await expect(backdropPromise).resolves.toEqual({ decision: 'drop', remember: false, dismissed: true });
  });
});
