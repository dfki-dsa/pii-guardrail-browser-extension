import { anonymize } from '../../src/shared/anonymizer';
import { EntityMap } from '../../src/shared/entity-map';
import type { EntityType, PiiSpan } from '../../src/shared/message-types';

interface AnonymizationFixture {
  name: string;
  text: string;
  entities: Array<[EntityType, string]>;
  expectedText: string;
}

function makeSpan(
  start: number,
  end: number,
  entityType: string,
  text: string,
  score = 0.9
): PiiSpan {
  return {
    start,
    end,
    entity_type: entityType as any,
    score,
    text,
    source: 'regex',
  };
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function spanForText(originalText: string, entityType: string, piiText: string): PiiSpan {
  const charStart = originalText.indexOf(piiText);
  if (charStart === -1) {
    throw new Error(`PII text not found in fixture: ${piiText}`);
  }
  const start = utf8ByteLength(originalText.slice(0, charStart));
  const end = start + utf8ByteLength(piiText);
  return makeSpan(start, end, entityType, piiText);
}

function spansForFixture(fixture: AnonymizationFixture): PiiSpan[] {
  return fixture.entities.map(([entityType, piiText]) =>
    spanForText(fixture.text, entityType, piiText)
  );
}

function expectNoOriginals(anonymizedText: string, originals: string[]): void {
  for (const original of originals) {
    expect(anonymizedText).not.toContain(original);
  }
}

const multilingualPiiFixtures: AnonymizationFixture[] = [
  {
    name: 'English support request',
    text:
      'David Smith from Acme Corp lives in Berlin. Email david.smith@example.com or call +1 212-555-1234. His card 4111-1111-1111-1111, SSN 123-45-6789, IBAN GB29NWBK60161331926819, IP 192.168.1.1, and birthday 1990-01-15 are in the ticket.',
    entities: [
      ['PERSON', 'David Smith'],
      ['ORGANIZATION', 'Acme Corp'],
      ['LOCATION', 'Berlin'],
      ['EMAIL', 'david.smith@example.com'],
      ['PHONE', '+1 212-555-1234'],
      ['CREDIT_CARD', '4111-1111-1111-1111'],
      ['SSN', '123-45-6789'],
      ['IBAN', 'GB29NWBK60161331926819'],
      ['IP_ADDRESS', '192.168.1.1'],
      ['DATE', '1990-01-15'],
    ],
    expectedText:
      '[PERSON_1] from [ORGANIZATION_1] lives in [LOCATION_1]. Email [EMAIL_1] or call [PHONE_1]. His card [CREDIT_CARD_1], SSN [SSN_1], IBAN [IBAN_1], IP [IP_ADDRESS_1], and birthday [DATE_1] are in the ticket.',
  },
  {
    name: 'German support request with Unicode text',
    text:
      'Kundin Anna Müller von Beispiel GmbH wohnt in München. E-Mail anna.mueller@example.de, Telefon +49 30 12345678, Kreditkarte 5500 0000 0000 0004, IBAN DE89 3704 0044 0532 0130 00, Server 10.0.0.5, Geburtsdatum 15.01.1990.',
    entities: [
      ['PERSON', 'Anna Müller'],
      ['ORGANIZATION', 'Beispiel GmbH'],
      ['LOCATION', 'München'],
      ['EMAIL', 'anna.mueller@example.de'],
      ['PHONE', '+49 30 12345678'],
      ['CREDIT_CARD', '5500 0000 0000 0004'],
      ['IBAN', 'DE89 3704 0044 0532 0130 00'],
      ['IP_ADDRESS', '10.0.0.5'],
      ['DATE', '15.01.1990'],
    ],
    expectedText:
      'Kundin [PERSON_1] von [ORGANIZATION_1] wohnt in [LOCATION_1]. E-Mail [EMAIL_1], Telefon [PHONE_1], Kreditkarte [CREDIT_CARD_1], IBAN [IBAN_1], Server [IP_ADDRESS_1], Geburtsdatum [DATE_1].',
  },
  {
    name: 'NER taxonomy support request',
    text:
      'Ship to 42 Cedar St, Boston. Open https://portal.example/private, user alice_admin, password correct-horse, bank account 1234567890.',
    entities: [
      ['ADDRESS', '42 Cedar St'],
      ['LOCATION', 'Boston'],
      ['URL', 'https://portal.example/private'],
      ['USERNAME', 'alice_admin'],
      ['PASSWORD', 'correct-horse'],
      ['BANK_ACCOUNT', '1234567890'],
    ],
    expectedText:
      'Ship to [ADDRESS_1], [LOCATION_1]. Open [URL_1], user [USERNAME_1], password [PASSWORD_1], bank account [BANK_ACCOUNT_1].',
  },
];

describe('anonymize basic behavior', () => {
  test('returns original text when no spans', () => {
    const result = anonymize('Hello world', []);
    expect(result.text).toBe('Hello world');
    expect(result.entityMap.size).toBe(0);
  });

  test('replaces single entity with placeholder', () => {
    const text = 'My name is David Smith';
    const spans = [makeSpan(11, 22, 'PERSON', 'David Smith')];
    const result = anonymize(text, spans);
    expect(result.text).toBe('My name is [PERSON_1]');
    expect(result.entityMap.getOriginal('[PERSON_1]')).toBe('David Smith');
  });

  test('replaces multiple entities of different types', () => {
    const text = 'Email david@corp.com, call 212-555-1234';
    const spans = [
      makeSpan(6, 20, 'EMAIL', 'david@corp.com'),
      makeSpan(27, 39, 'PHONE', '212-555-1234'),
    ];
    const result = anonymize(text, spans);
    expect(result.text).toBe('Email [EMAIL_1], call [PHONE_1]');
  });

  test('numbers entities of same type incrementally', () => {
    const text = 'Alice and Bob';
    const spans = [
      makeSpan(0, 5, 'PERSON', 'Alice'),
      makeSpan(10, 13, 'PERSON', 'Bob'),
    ];
    const result = anonymize(text, spans);
    expect(result.text).toBe('[PERSON_1] and [PERSON_2]');
  });

  test('reuses placeholder for duplicate text', () => {
    const text = 'Alice met Alice';
    const spans = [
      makeSpan(0, 5, 'PERSON', 'Alice'),
      makeSpan(10, 15, 'PERSON', 'Alice'),
    ];
    const result = anonymize(text, spans);
    expect(result.text).toBe('[PERSON_1] met [PERSON_1]');
  });

  test('extends existing entity map', () => {
    const existingMap = new EntityMap();
    existingMap.add(makeSpan(0, 5, 'PERSON', 'Alice'));

    const text = 'Bob is here';
    const spans = [makeSpan(0, 3, 'PERSON', 'Bob')];
    const result = anonymize(text, spans, existingMap);
    expect(result.text).toBe('[PERSON_2] is here');
    expect(result.entityMap.getOriginal('[PERSON_1]')).toBe('Alice');
    expect(result.entityMap.getOriginal('[PERSON_2]')).toBe('Bob');
  });

  test('preserves text outside spans', () => {
    const text = 'before david@test.com after';
    const spans = [makeSpan(7, 21, 'EMAIL', 'david@test.com')];
    const result = anonymize(text, spans);
    expect(result.text).toBe('before [EMAIL_1] after');
  });

  test('handles empty text', () => {
    const result = anonymize('', []);
    expect(result.text).toBe('');
  });
});

describe('anonymize detector offsets', () => {
  test('uses UTF-8 byte offsets from the WASM detector', () => {
    const text = 'Customer Müller uses mueller@example.com';
    const email = 'mueller@example.com';
    const start = utf8ByteLength(text.slice(0, text.indexOf(email)));
    const end = start + utf8ByteLength(email);
    const spans = [makeSpan(start, end, 'EMAIL', email)];

    const result = anonymize(text, spans);

    expect(result.text).toBe('Customer Müller uses [EMAIL_1]');
    expect(result.entityMap.getOriginal('[EMAIL_1]')).toBe(email);
  });
});

describe('anonymize multilingual PII fixtures', () => {
  test.each(multilingualPiiFixtures)('$name', (fixture) => {
    const spans = spansForFixture(fixture);
    const originals = fixture.entities.map(([, original]) => original);

    const result = anonymize(fixture.text, spans);

    expect(result.text).toBe(fixture.expectedText);
    expectNoOriginals(result.text, originals);
    for (const original of originals) {
      expect(result.entityMap.getPlaceholder(original)).toBeDefined();
    }
  });
});
