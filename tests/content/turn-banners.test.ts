/** @jest-environment jsdom */

import { TurnBannerKeeper } from '../../src/content/turn-banners';

describe('TurnBannerKeeper', () => {
  /** Replies that currently carry a banner. */
  let withBanner: Set<HTMLElement>;
  /** Replies whose text was read, in order: the cost this keeper exists to bound. */
  let looked: HTMLElement[];
  let attach: jest.Mock;
  let keeper: TurnBannerKeeper;

  const reply = (text: string): HTMLElement => {
    const element = document.createElement('div');
    element.textContent = text;
    document.body.append(element);
    return element;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    withBanner = new Set();
    looked = [];
    attach = jest.fn((element: HTMLElement) => {
      withBanner.add(element);
      return true;
    });
    keeper = new TurnBannerKeeper({
      hasLiveBanner: (element) => withBanner.has(element),
      mightResolve: (text) => text.includes('['),
      attach,
    });
    // Count reads of a reply's text through the one property the keeper uses.
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
    jest.spyOn(Node.prototype, 'textContent', 'get').mockImplementation(function (this: Node) {
      if (this instanceof HTMLElement && this.parentElement === document.body) looked.push(this);
      return descriptor.get!.call(this);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attaches a banner to a reply that holds something resolvable and has none', () => {
    const plain = reply('No tokens here.');
    const tokens = reply('Written to [EMAIL_1].');

    keeper.reconcile([plain, tokens]);

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(tokens);
  });

  it('does not re-read replies it has already ruled out', () => {
    const older = [reply('One.'), reply('Two.'), reply('Three.')];
    const last = reply('Four.');
    keeper.reconcile([...older, last]);
    looked.length = 0;

    keeper.reconcile([...older, last]);
    keeper.reconcile([...older, last]);

    // Only the last reply, which may still be streaming, is looked at again.
    expect(looked).toEqual([last, last]);
  });

  it('keeps looking at the last reply while it streams, and attaches once tokens arrive', () => {
    const streaming = reply('Sure, ');
    keeper.reconcile([streaming]);
    expect(attach).not.toHaveBeenCalled();

    streaming.textContent = 'Sure, I wrote to [EMAIL_1].';
    keeper.reconcile([streaming]);

    expect(attach).toHaveBeenCalledWith(streaming);
  });

  it('looks at a reply it has not seen before, wherever it is', () => {
    const first = reply('Old, no tokens.');
    const last = reply('Newest, no tokens.');
    keeper.reconcile([first, last]);

    const inserted = reply('Loaded later: [PERSON_1].');
    keeper.reconcile([first, inserted, last]);

    expect(attach).toHaveBeenCalledWith(inserted);
  });

  it('puts a banner back on a reply that lost it, even when it is no longer the last', () => {
    const answered = reply('Written to [EMAIL_1].');
    keeper.reconcile([answered]);
    expect(attach).toHaveBeenCalledTimes(1);

    // The site redraws and drops the banner; a newer reply has arrived since.
    withBanner.delete(answered);
    const newer = reply('Anything else?');
    keeper.reconcile([answered, newer]);

    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach).toHaveBeenLastCalledWith(answered);
  });

  it('also watches over banners that some other path attached', () => {
    const answered = reply('Written to [EMAIL_1].');
    const newer = reply('Anything else?');
    keeper.reconcile([answered.cloneNode(true) as HTMLElement, newer]);
    // The response observer attached it, not the keeper.
    withBanner.add(answered);
    keeper.noteAttached(answered);

    withBanner.delete(answered);
    keeper.reconcile([answered, newer]);

    expect(attach).toHaveBeenCalledWith(answered);
  });

  it('leaves replies with a live banner alone', () => {
    const answered = reply('Written to [EMAIL_1].');
    withBanner.add(answered);
    looked.length = 0;

    keeper.reconcile([answered]);

    expect(attach).not.toHaveBeenCalled();
    expect(looked).toEqual([]);
  });

  it('looks at everything again after what may resolve has changed', () => {
    // A synthetic name only becomes resolvable once the scope knows it.
    let known = false;
    keeper = new TurnBannerKeeper({
      hasLiveBanner: (element) => withBanner.has(element),
      mightResolve: (text) => known && text.includes('Jordan Park'),
      attach,
    });
    const older = reply('I wrote to Jordan Park.');
    const last = reply('Anything else?');
    keeper.reconcile([older, last]);
    expect(attach).not.toHaveBeenCalled();

    known = true;
    keeper.reconcile([older, last]);
    expect(attach).not.toHaveBeenCalled();

    keeper.reset();
    keeper.reconcile([older, last]);
    expect(attach).toHaveBeenCalledWith(older);
  });

  it('does nothing with no replies', () => {
    expect(() => keeper.reconcile([])).not.toThrow();
    expect(attach).not.toHaveBeenCalled();
  });
});
