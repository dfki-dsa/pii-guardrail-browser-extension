/** @jest-environment jsdom */

import { findTextColumn } from '../../src/ui/banner/text-column';

/** jsdom lays nothing out, so each element is told where it is. */
function place(element: HTMLElement, left: number, width: number, height = 20): void {
  element.getBoundingClientRect = () =>
    ({ left, right: left + width, width, top: 0, bottom: height, height, x: left, y: 0 }) as DOMRect;
}

function el(tag: string, display: string, left: number, width: number, height = 20): HTMLElement {
  const element = document.createElement(tag);
  element.style.display = display;
  place(element, left, width, height);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('findTextColumn', () => {
  it('finds the centred block inside a reply that spans the whole chat area', () => {
    // Gemini: full-width wrappers, an inline custom element among them, and
    // each block narrowed and centred on its own.
    const reply = el('div', 'block', 300, 1224);
    const container = el('div', 'block', 300, 1224);
    const messageContent = el('message-content', 'inline', 300, 1224);
    const markdown = el('div', 'block', 300, 1224);
    const list = el('ul', 'block', 558, 708);
    const item = el('li', 'list-item', 561, 705);
    const bold = el('b', 'inline', 601, 138);
    bold.textContent = 'Deadline:';
    item.append(bold, ' reply by Friday.');
    list.append(item);
    markdown.append(list);
    messageContent.append(markdown);
    container.append(messageContent);
    reply.append(container);
    document.body.append(reply);

    expect(findTextColumn(reply)).toEqual({ left: 558, width: 708 });
  });

  it('has nothing to report when the text fills the reply', () => {
    const reply = el('div', 'block', 400, 700);
    const paragraph = el('p', 'block', 400, 700);
    paragraph.textContent = 'Plain reply.';
    reply.append(paragraph);
    document.body.append(reply);

    expect(findTextColumn(reply)).toBeNull();
  });

  it('does not take an indent for a column', () => {
    // A list item sits in from the left only.
    const reply = el('div', 'block', 400, 700);
    const list = el('ul', 'block', 400, 700);
    const item = el('li', 'list-item', 426, 674);
    item.textContent = 'First point.';
    list.append(item);
    reply.append(list);
    document.body.append(reply);

    expect(findTextColumn(reply)).toBeNull();
  });

  it('does not take a short inline run or a narrow chip for a column', () => {
    const reply = el('div', 'block', 400, 700);
    const paragraph = el('p', 'block', 400, 700);
    const bold = el('b', 'inline', 500, 90);
    bold.textContent = 'All bold';
    paragraph.append(bold);
    reply.append(paragraph);
    document.body.append(reply);
    expect(findTextColumn(reply)).toBeNull();

    // A block set in from both sides, but far too narrow to hold a banner.
    const labelled = el('div', 'block', 400, 700);
    const chip = el('div', 'block', 600, 80);
    chip.textContent = 'Draft';
    labelled.append(chip);
    document.body.append(labelled);
    expect(findTextColumn(labelled)).toBeNull();
  });

  it('measures from text that is drawn, not from content hidden under a reveal', () => {
    const reply = el('div', 'block', 300, 1224);
    // The original, hidden: no box.
    const hidden = el('div', 'none', 0, 0, 0);
    hidden.textContent = 'Written to [EMAIL_1].';
    // The reveal layer takes no box of its own; its children do.
    const layer = el('div', 'contents', 0, 0, 0);
    const shown = el('p', 'block', 558, 708);
    shown.textContent = 'Written to jane@example.com.';
    layer.append(shown);
    reply.append(hidden, layer);
    document.body.append(reply);

    expect(findTextColumn(reply)).toEqual({ left: 558, width: 708 });
  });

  it('has nothing to report for a reply with no text or no box', () => {
    const empty = el('div', 'block', 300, 1224);
    document.body.append(empty);
    expect(findTextColumn(empty)).toBeNull();

    const unplaced = document.createElement('div');
    unplaced.textContent = 'Not laid out.';
    document.body.append(unplaced);
    expect(findTextColumn(unplaced)).toBeNull();
  });
});
