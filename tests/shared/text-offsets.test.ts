import {
  byteLength,
  byteOffsetToStringIndex,
  sliceTextByByteOffsets,
  stringIndexToByteOffset,
} from '../../src/shared/text-offsets';

describe('text byte offset helpers', () => {
  test('round-trips UTF-8 byte offsets for non-ASCII entity spans', () => {
    const text = 'Anna Müller lives in München.';
    const startIndex = text.indexOf('Müller');
    const endIndex = startIndex + 'Müller'.length;
    const start = stringIndexToByteOffset(text, startIndex);
    const end = stringIndexToByteOffset(text, endIndex);

    expect(byteLength('Müller')).toBe(7);
    expect(start).toBe(new TextEncoder().encode(text.slice(0, startIndex)).length);
    expect(byteOffsetToStringIndex(text, start)).toBe(startIndex);
    expect(byteOffsetToStringIndex(text, end)).toBe(endIndex);
    expect(sliceTextByByteOffsets(text, start, end)).toBe('Müller');
  });

  test('clamps offsets that land outside or inside a multibyte character', () => {
    const text = 'A😀B';
    const emojiStart = stringIndexToByteOffset(text, 1);

    expect(byteOffsetToStringIndex(text, -1)).toBe(0);
    expect(byteOffsetToStringIndex(text, 999)).toBe(text.length);
    expect(byteOffsetToStringIndex(text, emojiStart + 1)).toBe(3);
  });
});
