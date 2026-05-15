import { matchPattern } from '../../src/shared/pattern-matcher';

// Each case: [description, text, pattern, expectedMatchTexts]
const CASES: [string, string, string, string[]][] = [
  // Exact match
  ['exact match', 'Smith', 'Smith', ['Smith']],
  ['exact match in sentence', 'Hired Smith today', 'Smith', ['Smith']],
  ['no match', 'nothing here', 'Smith', []],

  // Case-insensitive
  ['lowercase text', 'hired smith today', 'Smith', ['smith']],
  ['uppercase text', 'hired SMITH today', 'Smith', ['SMITH']],
  ['mixed case', 'Smith SMITH smith', 'Smith', ['Smith', 'SMITH', 'smith']],

  // Word-boundary respect — "Smith" must not match inside "smithsonian"
  ['no match inside word (smithsonian)', 'smithsonian', 'Smith', []],
  ['no match prefix of compound', 'smithsonian hired Smith', 'Smith', ['Smith']],
  ['no match as suffix', 'goldsmith', 'Smith', []],
  ['no match mid-word', 'aSmithB', 'Smith', []],

  // * wildcard — word chars only, no cross-word
  ['wildcard matches word chars', 'acme-prod', 'acme-*', ['acme-prod']],
  ['wildcard no match across space', 'acme prod', 'acme-*', []],
  ['wildcard matches different suffixes', 'acme-prod acme-dev', 'acme-*', ['acme-prod', 'acme-dev']],
  ['wildcard no match bare prefix', 'acme-', 'acme-*', []],
  ['wildcard no match non-word suffix', 'acme-!prod', 'acme-*', []],
  ['leading wildcard', 'foobar barfoo', '*bar', ['foobar']],
  ['wildcard both sides', 'foobar barfoo xbarx', '*bar*', ['xbarx']],

  // Multiple matches
  ['multiple exact matches', 'John met John later', 'John', ['John', 'John']],

  // Empty pattern edge — single char
  ['single char pattern', 'a b a', 'a', ['a', 'a']],

  // Pattern with dot (should be literal)
  ['dot is literal', 'user.name other', 'user.name', ['user.name']],
  ['dot does not match other char', 'userXname', 'user.name', []],

  // Exact matches that begin or end with punctuation/non-word characters
  ['leading plus exact phone', '+49 30 123456 is allowed', '+49 30 123456', ['+49 30 123456']],
  ['parenthesized phone exact', 'Call (555) 123-4567 today', '(555) 123-4567', ['(555) 123-4567']],
  ['trailing slash exact url', 'Use https://example.com/ here', 'https://example.com/', ['https://example.com/']],
  ['no match embedded after word char', 'x+49 30 123456', '+49 30 123456', []],
  ['no match embedded before word char', '+49 30 123456x', '+49 30 123456', []],

  // Unicode — basic: word boundary at start/end of string still works
  ['unicode span exact', 'Müller', 'Müller', ['Müller']],
  ['unicode span in sentence', 'Hello Müller there', 'Müller', ['Müller']],
];

describe('matchPattern', () => {
  test.each(CASES)('%s', (_desc, text, pattern, expectedTexts) => {
    const matches = matchPattern(text, pattern);
    expect(matches.map((m) => m.text)).toEqual(expectedTexts);
  });
});

// Verify start/end positions are accurate
describe('matchPattern — positions', () => {
  test('correct start and end', () => {
    const matches = matchPattern('say Smith here', 'Smith');
    expect(matches).toEqual([{ start: 4, end: 9, text: 'Smith' }]);
  });

  test('wildcard start and end', () => {
    const matches = matchPattern('test acme-prod end', 'acme-*');
    expect(matches).toEqual([{ start: 5, end: 14, text: 'acme-prod' }]);
  });
});
