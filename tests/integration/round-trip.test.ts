import { anonymize } from '../../src/shared/anonymizer';
import { deAnonymize } from '../../src/shared/de-anonymizer';
import { EntityMap } from '../../src/shared/entity-map';
import type { PiiSpan } from '../../src/shared/message-types';

function makeSpan(
  start: number,
  end: number,
  entityType: string,
  text: string,
  source: PiiSpan['source'] = 'regex'
): PiiSpan {
  return {
    start,
    end,
    entity_type: entityType as any,
    score: 0.9,
    text,
    source,
  };
}

describe('round-trip: anonymize → de-anonymize', () => {
  test('restores original text from AI response with placeholders', () => {
    const original =
      'Hi, my name is David Smith and my email is david@corp.com. I live in Berlin.';
    const spans = [
      makeSpan(15, 26, 'PERSON', 'David Smith'),
      makeSpan(43, 57, 'EMAIL', 'david@corp.com'),
      makeSpan(69, 75, 'LOCATION', 'Berlin'),
    ];

    const anonymized = anonymize(original, spans);
    expect(anonymized.text).toBe(
      'Hi, my name is [PERSON_1] and my email is [EMAIL_1]. I live in [LOCATION_1].'
    );

    // Simulate AI response that uses the placeholders
    const aiResponse =
      'Hello [PERSON_1], I can help you with your [EMAIL_1] account in [LOCATION_1].';
    const restored = deAnonymize(aiResponse, anonymized.entityMap);
    expect(restored).toBe(
      'Hello David Smith, I can help you with your david@corp.com account in Berlin.'
    );
  });

  test('handles multiple entities of same type', () => {
    const original = 'Alice and Bob went to Paris and London.';
    const spans = [
      makeSpan(0, 5, 'PERSON', 'Alice'),
      makeSpan(10, 13, 'PERSON', 'Bob'),
      makeSpan(22, 27, 'LOCATION', 'Paris'),
      makeSpan(32, 38, 'LOCATION', 'London'),
    ];

    const anonymized = anonymize(original, spans);
    expect(anonymized.text).toBe(
      '[PERSON_1] and [PERSON_2] went to [LOCATION_1] and [LOCATION_2].'
    );

    const aiResponse = '[PERSON_1] should visit [LOCATION_2] with [PERSON_2].';
    const restored = deAnonymize(aiResponse, anonymized.entityMap);
    expect(restored).toBe('Alice should visit London with Bob.');
  });

  test('serialization roundtrip preserves mapping', () => {
    const original = 'Contact David at david@test.com';
    const spans = [
      makeSpan(8, 13, 'PERSON', 'David'),
      makeSpan(17, 31, 'EMAIL', 'david@test.com'),
    ];

    const anonymized = anonymize(original, spans);
    const stored = anonymized.entityMap.toStored();

    // Simulate loading in a new context
    const restoredMap = new EntityMap(stored);
    const aiResponse = 'Dear [PERSON_1], your email [EMAIL_1] is confirmed.';
    const restored = deAnonymize(aiResponse, restoredMap);
    expect(restored).toBe('Dear David, your email david@test.com is confirmed.');
  });

  test('new NER entity types anonymize, persist, and de-anonymize', () => {
    const original =
      'Ship to 42 Cedar St. Use https://portal.example/private with alice_admin and password correct-horse. Bank account 1234567890.';
    const spans = [
      makeSpan(8, 19, 'ADDRESS', '42 Cedar St'),
      makeSpan(25, 55, 'URL', 'https://portal.example/private'),
      makeSpan(61, 72, 'USERNAME', 'alice_admin'),
      makeSpan(86, 99, 'PASSWORD', 'correct-horse'),
      makeSpan(114, 124, 'BANK_ACCOUNT', '1234567890'),
    ];

    const anonymized = anonymize(original, spans);
    expect(anonymized.text).toBe(
      'Ship to [ADDRESS_1]. Use [URL_1] with [USERNAME_1] and password [PASSWORD_1]. Bank account [BANK_ACCOUNT_1].'
    );

    const restoredMap = new EntityMap(anonymized.entityMap.toStored());
    const aiResponse =
      'Confirmed: [ADDRESS_1], [URL_1], [USERNAME_1], [PASSWORD_1], [BANK_ACCOUNT_1].';
    const restored = deAnonymize(aiResponse, restoredMap);

    expect(restored).toBe(
      'Confirmed: 42 Cedar St, https://portal.example/private, alice_admin, correct-horse, 1234567890.'
    );
  });

  test('fixture NER detections use the existing anonymization and de-anonymization flow', () => {
    const original = 'Ada Lovelace works at Acme Corp in Berlin.';
    const spans = [
      makeSpan(0, 12, 'PERSON', 'Ada Lovelace', 'ner'),
      makeSpan(22, 31, 'ORGANIZATION', 'Acme Corp', 'ner'),
      makeSpan(35, 41, 'LOCATION', 'Berlin', 'ner'),
    ];

    const anonymized = anonymize(original, spans);
    expect(anonymized.text).toBe(
      '[PERSON_1] works at [ORGANIZATION_1] in [LOCATION_1].'
    );

    const restored = deAnonymize(
      'Draft reply for [PERSON_1] at [ORGANIZATION_1] in [LOCATION_1].',
      new EntityMap(anonymized.entityMap.toStored())
    );

    expect(restored).toBe('Draft reply for Ada Lovelace at Acme Corp in Berlin.');
  });

  test('no PII text passes through unchanged', () => {
    const text = 'What is the weather today?';
    const anonymized = anonymize(text, []);
    expect(anonymized.text).toBe(text);

    const restored = deAnonymize(anonymized.text, anonymized.entityMap);
    expect(restored).toBe(text);
  });
});
