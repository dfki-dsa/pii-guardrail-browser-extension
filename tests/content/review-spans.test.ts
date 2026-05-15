import { prepareReviewSpans } from '../../src/content/review-spans';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import type { AllowlistEntry, BlocklistEntry, PiiSpan, Settings } from '../../src/shared/message-types';

function span(
  text: string,
  start: number,
  entity_type: PiiSpan['entity_type'] = 'PERSON',
  score = 0.9,
): PiiSpan {
  return {
    start,
    end: start + text.length,
    entity_type,
    score,
    text,
    source: 'ner',
  };
}

function allowEntry(pattern: string): AllowlistEntry {
  return { pattern, scope: 'any', addedAt: 0, source: 'manual' };
}

function blockEntry(pattern: string, scope: BlocklistEntry['scope'] = 'any'): BlocklistEntry {
  return { pattern, scope, addedAt: 0, source: 'manual' };
}

function settingsWith(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('prepareReviewSpans', () => {
  test('removes allowlisted detections from the overlay span list', () => {
    const text = 'Alice met Bob';
    const spans = [span('Alice', 0), span('Bob', 10)];
    const settings = settingsWith({ allowlist: [allowEntry('Alice')] });

    const result = prepareReviewSpans(text, spans, settings, {});

    expect(result.map((s) => s.text)).toEqual(['Bob']);
  });

  test('returns no spans when every detection is allowlisted', () => {
    const text = 'Alice';
    const settings = settingsWith({ allowlist: [allowEntry('Alice')] });

    const result = prepareReviewSpans(text, [span('Alice', 0)], settings, {});

    expect(result).toEqual([]);
  });

  test('removes exact allowlisted detections that start with punctuation', () => {
    const text = 'Call +49 30 123456 today';
    const settings = settingsWith({ allowlist: [allowEntry('+49 30 123456')] });

    const result = prepareReviewSpans(text, [span('+49 30 123456', 5, 'PHONE')], settings, {});

    expect(result).toEqual([]);
  });

  test('removes split detections covered by an allowlisted phrase', () => {
    const text = 'Alice Example joined';
    const settings = settingsWith({ allowlist: [allowEntry('Alice Example')] });
    const spans = [span('Alice', 0), span('Example', 6)];

    const result = prepareReviewSpans(text, spans, settings, {});

    expect(result).toEqual([]);
  });

  test('re-injects blocklisted text after allowlist suppression', () => {
    const text = 'Project Bluebird';
    const settings = settingsWith({
      allowlist: [allowEntry('Project Bluebird')],
      blocklist: [blockEntry('Project Bluebird', 'ORGANIZATION')],
    });

    const result = prepareReviewSpans(text, [span('Project Bluebird', 0)], settings, {});

    expect(result).toEqual([
      expect.objectContaining({
        text: 'Project Bluebird',
        entity_type: 'ORGANIZATION',
        source: 'manual',
      }),
    ]);
  });

  test('tags filtered spans in code blocks when code-block skipping is enabled', () => {
    const text = '```js\nAlice\n```';
    const settings = settingsWith({ skipCodeBlocks: true });

    const result = prepareReviewSpans(text, [span('Alice', 6)], settings, {});

    expect(result[0]).toEqual(expect.objectContaining({ text: 'Alice', inCodeBlock: true }));
  });
});
