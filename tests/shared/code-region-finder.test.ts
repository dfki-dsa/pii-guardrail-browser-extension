import { findCodeRegions } from '../../src/shared/code-region-finder';

// Each case: [description, text, expected regions as {start, end}[]]
const CASES: [string, string, Array<{ start: number; end: number }>][] = [
  // --- Inline backticks must NOT produce code regions ---
  ['inline single backticks not a region', 'hello `world` there', []],
  ['inline backtick email not a region', 'send to `user@example.com` today', []],
  ['multiple inline backticks not regions', 'a `foo` and `bar` text', []],

  // --- Plain prose ---
  ['plain prose no regions', 'just some plain text here with no code', []],

  // --- Single fenced block ---
  ['single fenced block', '```\nhello\n```', [{ start: 0, end: 13 }]],
  ['fenced block with language tag', '```js\nhello\n```', [{ start: 0, end: 15 }]],
  ['fenced block in the middle', 'prose\n```\ncode\n```\nmore', [{ start: 6, end: 18 }]],

  // --- Multiple fenced blocks ---
  [
    'multiple fenced blocks',
    '```\nfoo\n```\nprose\n```\nbar\n```',
    [{ start: 0, end: 11 }, { start: 18, end: 29 }],
  ],

  // --- Unclosed fence ---
  ['unclosed fence runs to end', '```\nhello\nworld', [{ start: 0, end: 15 }]],
  ['unclosed fence with lang tag', '```python\ncode here', [{ start: 0, end: 19 }]],

  // --- Empty block ---
  ['empty fenced block', '```\n```', [{ start: 0, end: 7 }]],

  // --- Nested backticks inside fenced block — block still one region ---
  [
    'inline backtick inside fenced block does not close it',
    '```\nhello `world` end\n```',
    [{ start: 0, end: 25 }],
  ],

  // --- HTML <code> blocks ---
  ['html code block', '<code>hello</code>', [{ start: 0, end: 18 }]],
  ['html code block with attributes', '<code class="js">foo</code>', [{ start: 0, end: 27 }]],
  ['html code block in prose', 'before <code>x</code> after', [{ start: 7, end: 21 }]],

  // --- HTML <pre> blocks ---
  ['html pre block', '<pre>world</pre>', [{ start: 0, end: 16 }]],
  ['html pre with attributes', '<pre class="sh">cmd</pre>', [{ start: 0, end: 25 }]],

  // --- Mixed prose + fenced code ---
  [
    'prose before and after fenced block',
    'hello\n```\ncode\n```\nworld',
    [{ start: 6, end: 18 }],
  ],

  // --- Fenced block longer than 3 backticks ---
  ['4-backtick fence', '````\nhello\n````', [{ start: 0, end: 15 }]],
];

describe('findCodeRegions', () => {
  test.each(CASES)('%s', (_desc, text, expected) => {
    expect(findCodeRegions(text)).toEqual(expected);
  });
});

// Verify span containment logic — spot-check that a char inside the region is covered
describe('findCodeRegions — containment', () => {
  test('email inside fenced block is in region', () => {
    const text = 'prose\n```\ntest@inside.com\n```\nmore';
    const regions = findCodeRegions(text);
    // The fenced block starts at offset 6 (after 'prose\n')
    const emailStart = text.indexOf('test@inside.com');
    expect(regions.length).toBe(1);
    expect(emailStart).toBeGreaterThanOrEqual(regions[0].start);
    expect(emailStart).toBeLessThan(regions[0].end);
  });

  test('email in prose is not in any region', () => {
    const text = '```\ncode\n```\nuser@example.com in prose';
    const regions = findCodeRegions(text);
    const emailStart = text.indexOf('user@example.com');
    const inRegion = regions.some((r) => emailStart >= r.start && emailStart < r.end);
    expect(inRegion).toBe(false);
  });

  test('email in inline backtick is not in any region', () => {
    const text = 'send `user@example.com` today';
    const regions = findCodeRegions(text);
    expect(regions).toEqual([]);
  });
});
