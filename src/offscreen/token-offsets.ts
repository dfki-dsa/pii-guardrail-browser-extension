/**
 * Character-offset recovery for token-classification output.
 *
 * Transformers.js leaves 'start' / 'end' undefined, so predictions are placed by
 * aligning the tokenizer's own pieces against the source. Handles Metaspace ('▁'
 * on word-initial pieces) and WordPiece ('##' on continuations); the WordPiece
 * checkpoints are '-uncased', so matching folds case and accents.
 */

const METASPACE = '▁';
const WORDPIECE_CONTINUATION = '##';

/** How far to scan forward when a piece does not match at the cursor. */
const RESYNC_WINDOW_CHARS = 48;

export interface TokenCharRange {
  start: number;
  end: number;
}

const DEFAULT_SPECIAL_TOKENS: readonly string[] = [
  '<s>',
  '</s>',
  '<pad>',
  '<unk>',
  '<mask>',
  '[CLS]',
  '[SEP]',
  '[PAD]',
  '[UNK]',
  '[MASK]',
];

/** One source character may fold to zero or several, so 'sourceIndex' maps back. */
interface FoldedText {
  folded: string;
  sourceIndex: number[];
}

function foldChar(char: string): string {
  return char
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
}

function foldText(text: string): FoldedText {
  let folded = '';
  const sourceIndex: number[] = [];

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!;
    const char = String.fromCodePoint(codePoint);
    const replacement = foldChar(char);

    for (let k = 0; k < replacement.length; k += 1) {
      sourceIndex.push(index);
    }
    folded += replacement;
    index += char.length;
  }

  sourceIndex.push(text.length);
  return { folded, sourceIndex };
}

function foldPiece(piece: string): string {
  let out = '';
  for (const char of piece) {
    out += foldChar(char);
  }
  return out;
}

type TokenizerStyle = 'metaspace' | 'wordpiece';

function detectStyle(tokens: readonly string[]): TokenizerStyle {
  for (const token of tokens) {
    if (token.startsWith(METASPACE)) return 'metaspace';
    if (token.startsWith(WORDPIECE_CONTINUATION)) return 'wordpiece';
  }
  return 'metaspace';
}

interface PieceShape {
  segments: string[];
  boundaryBefore: boolean;
}

/**
 * Metaspace pieces can contain '▁' internally: the normalizer rewrites runs of two
 * or more spaces to a literal '▁', so '▁a▁b' is "boundary, a, spaces, b".
 */
function pieceShape(token: string, style: TokenizerStyle): PieceShape {
  if (style === 'wordpiece') {
    return token.startsWith(WORDPIECE_CONTINUATION)
      ? { segments: [token.slice(WORDPIECE_CONTINUATION.length)], boundaryBefore: false }
      : { segments: [token], boundaryBefore: true };
  }

  const boundaryBefore = token.startsWith(METASPACE);
  const segments = token.split(METASPACE).filter((segment) => segment.length > 0);
  return { segments, boundaryBefore };
}

function skipWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text.charAt(index))) index += 1;
  return index;
}

/** Matches in folded space so '-uncased' tokenizers align against cased text. */
function matchSegments(
  text: string,
  foldedText: FoldedText,
  foldedStartBySource: number[],
  segments: readonly string[],
  from: number,
  allowLeadingWhitespace: boolean
): { start: number; end: number } | null {
  let sourceCursor = allowLeadingWhitespace ? skipWhitespace(text, from) : from;
  const start = sourceCursor;

  for (let i = 0; i < segments.length; i += 1) {
    if (i > 0) sourceCursor = skipWhitespace(text, sourceCursor);

    const needle = foldPiece(segments[i]);
    if (needle.length === 0) continue;

    const foldedCursor = foldedStartBySource[sourceCursor];
    if (foldedCursor === undefined) return null;
    if (!foldedText.folded.startsWith(needle, foldedCursor)) return null;

    const foldedEnd = foldedCursor + needle.length;
    const nextSource = foldedText.sourceIndex[foldedEnd];
    if (nextSource === undefined) return null;
    sourceCursor = nextSource;
  }

  if (sourceCursor <= start && segments.some((segment) => segment.length > 0)) return null;
  return { start, end: sourceCursor };
}

/**
 * 'tokens' must be the tokenizer's complete output for 'text' -- the same call the
 * model saw, specials included -- so indices line up with an item's 'index'.
 * Entries are 'null' for specials, empty pieces, and anything unplaceable.
 */
export function alignTokensToText(
  text: string,
  tokens: readonly string[]
): (TokenCharRange | null)[] {
  const specialTokens = new Set(DEFAULT_SPECIAL_TOKENS);
  const style = detectStyle(tokens);
  const foldedText = foldText(text);

  const foldedStartBySource: number[] = new Array(text.length + 1).fill(-1);
  for (let foldedIndex = foldedText.sourceIndex.length - 1; foldedIndex >= 0; foldedIndex -= 1) {
    foldedStartBySource[foldedText.sourceIndex[foldedIndex]] = foldedIndex;
  }
  // Source characters that fold away entirely inherit the next real position.
  let carry = foldedText.folded.length;
  for (let sourceIndex = text.length; sourceIndex >= 0; sourceIndex -= 1) {
    if (foldedStartBySource[sourceIndex] === -1) foldedStartBySource[sourceIndex] = carry;
    else carry = foldedStartBySource[sourceIndex];
  }

  const ranges: (TokenCharRange | null)[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (specialTokens.has(token)) {
      ranges.push(null);
      continue;
    }

    const { segments, boundaryBefore } = pieceShape(token, style);
    if (segments.length === 0) {
      // Whitespace, not content: consume it but emit no range.
      if (boundaryBefore) cursor = skipWhitespace(text, cursor);
      ranges.push(null);
      continue;
    }

    let matched = matchSegments(
      text,
      foldedText,
      foldedStartBySource,
      segments,
      cursor,
      boundaryBefore
    );

    // An <unk> or unmodelled normalization ate characters; scan a bounded window
    // rather than abandoning the rest of the sequence.
    if (!matched) {
      const limit = Math.min(text.length, cursor + RESYNC_WINDOW_CHARS);
      for (let probe = cursor + 1; probe <= limit; probe += 1) {
        matched = matchSegments(
          text,
          foldedText,
          foldedStartBySource,
          segments,
          probe,
          boundaryBefore
        );
        if (matched) break;
      }
    }

    if (!matched) {
      ranges.push(null);
      continue;
    }

    ranges.push({ start: matched.start, end: matched.end });
    cursor = matched.end;
  }

  return ranges;
}

/** Fraction of content-bearing tokens placed; the provider's gate for falling back. */
export function alignmentCoverage(
  ranges: readonly (TokenCharRange | null)[],
  tokens: readonly string[]
): number {
  const specialTokens = new Set(DEFAULT_SPECIAL_TOKENS);

  let content = 0;
  let placed = 0;
  ranges.forEach((range, index) => {
    // Null by design; counting it as a failure would push short text under the gate.
    if (specialTokens.has(tokens[index])) return;
    content += 1;
    if (range) placed += 1;
  });

  if (content === 0) return 1;
  return placed / content;
}
