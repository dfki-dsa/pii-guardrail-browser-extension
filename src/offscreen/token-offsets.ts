/**
 * Character-offset recovery for token-classification output.
 *
 * Transformers.js does not emit 'start' / 'end' for the token-classification
 * pipeline. Every item comes back with 'start: undefined, end: undefined', 
 * so the only way to place a prediction back into the source text is to 
 * align the tokenizer's own pieces against it.
 *
 * Here we align the complete piece sequence instead. With no gaps in the sequence the cursor 
 * cannot skip ahead, so each piece lands on its true source characters.
 *
 * Supported tokenizer styles:
 *  - SentencePiece / Metaspace (XLM-R, the BardsAI model): word-initial pieces
 *    carry a `▁` prefix, continuations carry nothing.
 *  - WordPiece (DistilBERT, the AI4Privacy and HikmaAI models): continuation
 *    pieces carry a `##` prefix, word-initial pieces carry nothing. These are
 *    `-uncased` checkpoints that also strip accents, so matching folds case and
 *    combining marks.
 */

const METASPACE = '▁';
const WORDPIECE_CONTINUATION = '##';

/** CHAR gap after the cursor when a piece does not match the verbatim. */
const RESYNC_WINDOW_CHARS = 48;

export interface TokenCharRange {
  /** Inclusive character index into the original (un-normalized) text. */
  start: number;
  /** Exclusive character index into the original text. */
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

/**
 * Case and accent-folded view of a string, with an index back to the original.
 *
 * 'folded[i]' corresponds to 'sourceIndex[i]' in the original text. Folding is
 * applied per source character, so one source character may contribute zero or several 
 * folded characters. The index array keeps the mapping exact either way.
 */
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

  // a match that runs to the very end can resolve its exclusive end.
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
  /** Literal segments to match, in order, separated by word boundaries. */
  segments: string[];
  /** Whether a whitespace run may be consumed before the first segment. */
  boundaryBefore: boolean;
}

/**
 * Split a raw token into the literal text it stands for.
 *
 * Metaspace pieces may contain '▁' internally: this tokenizer's normalizer
 * rewrites runs of two or more spaces to a literal '▁' before pre-tokenization,
 * so '▁a▁b' means "word boundary, 'a', whitespace run, 'b'".
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

/**
 * Try to match 'segments' starting at source index 'from'.
 *
 * Returns the exclusive end index, or 'null' when the segments do not line up.
 * Matching happens in folded space so that '-uncased', accent-stripping
 * tokenizers still align against the original cased text.
 */
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
 * Map every token in 'tokens' to its character range in 'text'.
 *
 * 'tokens' must be the tokenizer's complete output for 'text' (the same call
 * the model saw, special tokens included) so that indices line up with the
 * 'index' field on token-classification items.
 *
 * Returns one entry per token: a range, or 'null' for special tokens, empty
 * pieces, and any piece that could not be placed.
 */
export function alignTokensToText(
  text: string,
  tokens: readonly string[]
): (TokenCharRange | null)[] {
  const specialTokens = new Set(DEFAULT_SPECIAL_TOKENS);
  const style = detectStyle(tokens);
  const foldedText = foldText(text);

  // Reverse of foldedText.sourceIndex: first folded position for a source index.
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
      // Metaspace-only piece: it stands for whitespace, not content. Consume the
      // whitespace so the next piece starts in the right place, but emit no range.
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

    // Resync: an <unk> or a normalization we do not model consumed source
    // characters we did not account for. Scan forward a bounded window rather
    // than giving up on the rest of the sequence.
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

/**
 * Fraction of content-bearing tokens that were placed successfully.
 *
 * The provider uses this as a health check: if alignment degrades on some text
 * we have not anticipated, it is better to fall back than to emit spans at
 * confidently wrong positions.
 */
export function alignmentCoverage(
  ranges: readonly (TokenCharRange | null)[],
  tokens: readonly string[]
): number {
  const specialTokens = new Set(DEFAULT_SPECIAL_TOKENS);

  let content = 0;
  let placed = 0;
  ranges.forEach((range, index) => {
    // A special token is aligned to null by design, so counting it as a failure
    // would push short text under the gate and back onto the legacy search.
    if (specialTokens.has(tokens[index])) return;
    content += 1;
    if (range) placed += 1;
  });

  if (content === 0) return 1;
  return placed / content;
}
