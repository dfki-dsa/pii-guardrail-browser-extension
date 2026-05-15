use crate::types::{EntityType, PiiSpan};

/// Context keywords that, when found near a candidate span, boost its confidence.
/// Grouped by the entity type they support.
const PERSON_KEYWORDS: &[&str] = &[
    "name",
    "named",
    "called",
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "author",
    "patient",
    "client",
    "employee",
    "contact",
    "person",
    "user",
    "owner",
    "recipient",
    "sender",
];

const EMAIL_KEYWORDS: &[&str] = &[
    "email", "e-mail", "mail", "contact", "send", "write", "reach", "address",
];

const PHONE_KEYWORDS: &[&str] = &[
    "phone",
    "call",
    "tel",
    "telephone",
    "mobile",
    "cell",
    "fax",
    "number",
    "dial",
    "reach",
];

const LOCATION_KEYWORDS: &[&str] = &[
    "address", "street", "city", "state", "country", "zip", "postal", "live", "lives", "located",
    "from", "born", "based",
];

const ADDRESS_KEYWORDS: &[&str] = &[
    "address", "street", "st", "road", "rd", "avenue", "ave", "lane", "ln", "zip", "postal",
];

const URL_KEYWORDS: &[&str] = &[
    "url", "link", "website", "web", "site", "homepage", "profile",
];

const USERNAME_KEYWORDS: &[&str] = &["username", "user", "handle", "login", "account", "profile"];

const PASSWORD_KEYWORDS: &[&str] = &["password", "passcode", "secret", "credential", "token"];

const SSN_KEYWORDS: &[&str] = &["ssn", "social", "security", "tax", "identification", "id"];

const CREDIT_CARD_KEYWORDS: &[&str] = &[
    "card",
    "credit",
    "debit",
    "visa",
    "mastercard",
    "amex",
    "payment",
    "cc",
];

const IBAN_KEYWORDS: &[&str] = &["iban", "bank", "account", "transfer", "wire", "routing"];

const BANK_ACCOUNT_KEYWORDS: &[&str] = &[
    "bank", "account", "routing", "transfer", "wire", "swift", "bic",
];

const DATE_KEYWORDS: &[&str] = &[
    "born", "birthday", "dob", "date", "birth", "issued", "expires", "expiry",
];

/// Get the relevant context keywords for an entity type.
fn keywords_for(entity_type: EntityType) -> &'static [&'static str] {
    match entity_type {
        EntityType::Person => PERSON_KEYWORDS,
        EntityType::Email => EMAIL_KEYWORDS,
        EntityType::Phone => PHONE_KEYWORDS,
        EntityType::Location => LOCATION_KEYWORDS,
        EntityType::Address => ADDRESS_KEYWORDS,
        EntityType::Url => URL_KEYWORDS,
        EntityType::Username => USERNAME_KEYWORDS,
        EntityType::Password => PASSWORD_KEYWORDS,
        EntityType::Ssn => SSN_KEYWORDS,
        EntityType::CreditCard => CREDIT_CARD_KEYWORDS,
        EntityType::Iban => IBAN_KEYWORDS,
        EntityType::BankAccount => BANK_ACCOUNT_KEYWORDS,
        EntityType::Date => DATE_KEYWORDS,
        EntityType::IpAddress => &[],
        EntityType::Organization => &[],
        EntityType::Misc => &[],
    }
}

/// Tokenize text into lowercase words with their byte offsets.
fn tokenize(text: &str) -> Vec<(usize, usize, String)> {
    let mut tokens = Vec::new();
    let mut start = None;

    for (i, c) in text.char_indices() {
        if c.is_alphanumeric() || c == '-' || c == '\'' {
            if start.is_none() {
                start = Some(i);
            }
        } else if let Some(s) = start {
            let word = text[s..i].to_lowercase();
            tokens.push((s, i, word));
            start = None;
        }
    }

    // Handle trailing word
    if let Some(s) = start {
        let word = text[s..].to_lowercase();
        tokens.push((s, text.len(), word));
    }

    tokens
}

/// Apply context word scoring to a list of PII spans.
/// Scans a window of `window_size` tokens on each side of each span.
/// If a relevant keyword is found, boosts the span's confidence by `boost`.
pub fn apply_context_boost(spans: &mut [PiiSpan], text: &str, window_size: usize, boost: f64) {
    let tokens = tokenize(text);

    for span in spans.iter_mut() {
        let keywords = keywords_for(span.entity_type);
        if keywords.is_empty() {
            continue;
        }

        // Find tokens within the context window around this span
        let has_context = tokens.iter().any(|(tok_start, tok_end, word)| {
            // Token must be outside the span itself
            if *tok_start >= span.start && *tok_end <= span.end {
                return false;
            }

            // Token must be within window_size tokens of the span
            let distance_before = if *tok_end <= span.start {
                tokens
                    .iter()
                    .filter(|(_ts, te, _)| *te <= span.start && *te > *tok_end)
                    .count()
            } else {
                usize::MAX
            };

            let distance_after = if *tok_start >= span.end {
                tokens
                    .iter()
                    .filter(|(ts, _te, _)| *ts >= span.end && *ts < *tok_start)
                    .count()
            } else {
                usize::MAX
            };

            let distance = distance_before.min(distance_after);
            if distance > window_size {
                return false;
            }

            keywords.contains(&word.as_str())
        });

        if has_context {
            span.score = (span.score + boost).min(1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::DetectionSource;

    fn make_span(start: usize, end: usize, entity_type: EntityType, score: f64) -> PiiSpan {
        PiiSpan::new(
            start,
            end,
            entity_type,
            score,
            String::new(),
            DetectionSource::Regex,
        )
    }

    #[test]
    fn test_context_boost_name() {
        let text = "my name is David Smith and I work here";
        // "David Smith" starts at 11, ends at 22
        let mut spans = vec![make_span(11, 22, EntityType::Person, 0.70)];
        apply_context_boost(&mut spans, text, 5, 0.15);
        assert!(
            spans[0].score > 0.70,
            "Score should be boosted: {}",
            spans[0].score
        );
        assert!((spans[0].score - 0.85).abs() < 0.01);
    }

    #[test]
    fn test_context_boost_email() {
        let text = "send email to john@example.com";
        // "john@example.com" starts at 14
        let mut spans = vec![make_span(14, 30, EntityType::Email, 0.80)];
        apply_context_boost(&mut spans, text, 5, 0.15);
        assert!(spans[0].score > 0.80);
    }

    #[test]
    fn test_no_context_no_boost() {
        let text = "the quick brown fox jumps over john@example.com";
        let start = text.find("john@example.com").unwrap();
        let end = start + "john@example.com".len();
        let mut spans = vec![make_span(start, end, EntityType::Email, 0.80)];
        apply_context_boost(&mut spans, text, 2, 0.15); // narrow window
                                                        // "quick brown fox jumps over" has no email keywords in 2-token window
                                                        // Actually "over" is close but not a keyword. Score should stay 0.80.
        assert!((spans[0].score - 0.80).abs() < 0.01);
    }

    #[test]
    fn test_context_boost_phone() {
        let text = "call me at 212-555-1234";
        let mut spans = vec![make_span(11, 23, EntityType::Phone, 0.70)];
        apply_context_boost(&mut spans, text, 5, 0.15);
        assert!(spans[0].score > 0.70);
    }

    #[test]
    fn test_context_boost_caps_at_1() {
        let text = "my name is David";
        let mut spans = vec![make_span(11, 16, EntityType::Person, 0.95)];
        apply_context_boost(&mut spans, text, 5, 0.15);
        assert!((spans[0].score - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_ip_no_context_keywords() {
        let text = "server at 192.168.1.1";
        let mut spans = vec![make_span(10, 21, EntityType::IpAddress, 0.85)];
        apply_context_boost(&mut spans, text, 5, 0.15);
        // IP has no keywords, score unchanged
        assert!((spans[0].score - 0.85).abs() < 0.01);
    }

    #[test]
    fn test_tokenize_basic() {
        let tokens = tokenize("hello world");
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].2, "hello");
        assert_eq!(tokens[1].2, "world");
    }

    #[test]
    fn test_tokenize_case_insensitive() {
        let tokens = tokenize("My NAME");
        assert_eq!(tokens[0].2, "my");
        assert_eq!(tokens[1].2, "name");
    }
}
