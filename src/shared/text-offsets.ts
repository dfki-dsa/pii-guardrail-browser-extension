const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function stringIndexToByteOffset(text: string, stringIndex: number): number {
  return byteLength(text.slice(0, Math.max(0, stringIndex)));
}

export function byteOffsetToStringIndex(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;

  let bytesSeen = 0;
  let stringIndex = 0;

  for (const char of text) {
    if (bytesSeen === byteOffset) return stringIndex;

    const codePoint = char.codePointAt(0)!;
    const charByteLength =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;

    bytesSeen += charByteLength;
    stringIndex += char.length;

    if (bytesSeen >= byteOffset) return stringIndex;
  }

  return text.length;
}

export function sliceTextByByteOffsets(text: string, start: number, end: number): string {
  return text.slice(byteOffsetToStringIndex(text, start), byteOffsetToStringIndex(text, end));
}
