/**
 * The review overlay previews a replacement before the user confirms.
 * What they approve is what gets pasted, so the preview resolver and
 * `anonymizeWithVault` must agree.
 */

import { makePreviewResolverFactory } from '../../src/content/preview-resolver';
import { anonymizeWithVault } from '../../src/shared/anonymizer';
import { emptyVaultData } from '../../src/shared/identity-vault';
import type { EntityType, PiiSpan } from '../../src/shared/message-types';

function makeSpan(text: string, type: EntityType): PiiSpan {
  return { start: 0, end: text.length, entity_type: type, score: 0.9, text, source: 'regex' };
}

describe('preview resolver matches anonymizeWithVault', () => {
  test.each([
    ['Sarah', 'PERSON'],
    ['Sarah Connor', 'PERSON'],
    ['sarah.connor@example.com', 'EMAIL'],
  ] as const)('%s (%s)', (text, type) => {
    const span = makeSpan(text, type);

    const preview = makePreviewResolverFactory(emptyVaultData(), 'synthetic')()(span);
    const pasted = anonymizeWithVault(text, [span], emptyVaultData(), 'synthetic').text;

    expect(preview).toBe(pasted);
    expect(preview).not.toBe(text);
  });

  test('an email keeps a dotted local part, like a two-word name', () => {
    const span = makeSpan('sarah@example.com', 'EMAIL');

    const preview = makePreviewResolverFactory(emptyVaultData(), 'synthetic')()(span);

    expect(preview.split('@')[0]).toContain('.');
  });
});
