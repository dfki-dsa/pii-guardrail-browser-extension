use regex::Regex;
use std::sync::LazyLock;

use crate::types::{DetectionSource, EntityType, PiiSpan};

/// A compiled regex recognizer for a specific PII type.
struct Recognizer {
    pattern: &'static LazyLock<Regex>,
    entity_type: EntityType,
    base_score: f64,
}

// --- Compiled regex patterns (compiled once, reused across calls) ---

static EMAIL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b").unwrap());

static PHONE_RE: LazyLock<Regex> = LazyLock::new(|| {
    // Phones need structural cues so bare digit runs (years, IDs) don't match.
    Regex::new(concat!(
        r"(?:",
        // International with leading +: +49 30 12345678, +1-212-555-1234, +442012345678
        r"\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{1,4}[\s\-.]?\d{1,9}",
        // Parenthesized area code: (212) 555-1234, (030) 1234567
        r"|\(\d{2,5}\)[\s\-.]?\d{2,4}[\s\-.]?\d{2,9}",
        // Three groups separated by space/dash/dot: 212-555-1234
        r"|\b\d{2,4}[\s\-.]\d{2,4}[\s\-.]\d{2,9}\b",
        // Two groups, second one long: 030 12345678
        r"|\b\d{2,5}[\s\-.]\d{6,12}\b",
        r")"
    ))
    .unwrap()
});

static SSN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap());

static CREDIT_CARD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:\d{4}[\s\-]?){3}\d{4}\b").unwrap());

static IP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b")
        .unwrap()
});

static IBAN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?(?:[\dA-Z]{4}[\s]?){1,7}[\dA-Z]{1,4}\b")
        .unwrap()
});

static DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?:",
        // DD/MM/YYYY or MM/DD/YYYY or YYYY-MM-DD
        r"\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b",
        r"|\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b",
        // Month DD, YYYY
        r"|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b",
        r")"
    ))
    .unwrap()
});

const RECOGNIZERS: &[Recognizer] = &[
    Recognizer {
        pattern: &EMAIL_RE,
        entity_type: EntityType::Email,
        base_score: 0.95,
    },
    Recognizer {
        pattern: &PHONE_RE,
        entity_type: EntityType::Phone,
        base_score: 0.70,
    },
    Recognizer {
        pattern: &SSN_RE,
        entity_type: EntityType::Ssn,
        base_score: 0.80,
    },
    Recognizer {
        pattern: &CREDIT_CARD_RE,
        entity_type: EntityType::CreditCard,
        base_score: 0.75,
    },
    Recognizer {
        pattern: &IP_RE,
        entity_type: EntityType::IpAddress,
        base_score: 0.85,
    },
    Recognizer {
        pattern: &IBAN_RE,
        entity_type: EntityType::Iban,
        base_score: 0.80,
    },
    Recognizer {
        pattern: &DATE_RE,
        entity_type: EntityType::Date,
        base_score: 0.60,
    },
];

fn is_full_match(pattern: &Regex, text: &str) -> bool {
    pattern
        .find(text)
        .is_some_and(|mat| mat.start() == 0 && mat.end() == text.len())
}

/// Run all regex recognizers against the input text.
/// Returns candidate PII spans with their type and base confidence score.
pub fn detect_regex(text: &str) -> Vec<PiiSpan> {
    let mut spans = Vec::new();

    for recognizer in RECOGNIZERS {
        for mat in recognizer.pattern.find_iter(text) {
            if recognizer.entity_type == EntityType::Phone && is_full_match(&DATE_RE, mat.as_str())
            {
                continue;
            }

            spans.push(PiiSpan::new(
                mat.start(),
                mat.end(),
                recognizer.entity_type,
                recognizer.base_score,
                mat.as_str().to_string(),
                DetectionSource::Regex,
            ));
        }
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_detection() {
        let spans = detect_regex("Contact me at john.doe@example.com please");
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].entity_type, EntityType::Email);
        assert_eq!(spans[0].text, "john.doe@example.com");
    }

    #[test]
    fn test_multiple_emails() {
        let spans = detect_regex("Send to a@b.com and c@d.org");
        let emails: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Email)
            .collect();
        assert_eq!(emails.len(), 2);
    }

    #[test]
    fn test_phone_us_format() {
        let spans = detect_regex("Call 212-555-1234");
        let phones: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Phone)
            .collect();
        assert!(phones.len() >= 1);
        assert!(phones[0].text.contains("212"));
    }

    #[test]
    fn test_phone_international() {
        let spans = detect_regex("Call +49 30 12345678");
        let phones: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Phone)
            .collect();
        assert!(phones.len() >= 1);
    }

    #[test]
    fn test_german_numeric_date_is_not_phone() {
        let spans = detect_regex("Geburtsdatum 15.01.1990");
        let phones: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Phone)
            .collect();
        let dates: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Date)
            .collect();

        assert!(phones.is_empty());
        assert_eq!(dates.len(), 1);
        assert_eq!(dates[0].text, "15.01.1990");
    }

    #[test]
    fn test_year_numbers_are_not_phones() {
        let texts = [
            "Born in 1990",
            "Released in 2023",
            "between 2020 and 2024",
            "page 12345",
            "order 1234567",
        ];
        for text in texts {
            let phones: Vec<_> = detect_regex(text)
                .into_iter()
                .filter(|s| s.entity_type == EntityType::Phone)
                .collect();
            assert!(phones.is_empty(), "expected no phones in {text:?}, got {phones:?}");
        }
    }

    #[test]
    fn test_ssn() {
        let spans = detect_regex("SSN: 123-45-6789");
        let ssns: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Ssn)
            .collect();
        assert_eq!(ssns.len(), 1);
        assert_eq!(ssns[0].text, "123-45-6789");
    }

    #[test]
    fn test_credit_card() {
        let spans = detect_regex("Card: 4111-1111-1111-1111");
        let ccs: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::CreditCard)
            .collect();
        assert_eq!(ccs.len(), 1);
    }

    #[test]
    fn test_credit_card_spaces() {
        let spans = detect_regex("Card: 4111 1111 1111 1111");
        let ccs: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::CreditCard)
            .collect();
        assert_eq!(ccs.len(), 1);
    }

    #[test]
    fn test_ip_address() {
        let spans = detect_regex("Server at 192.168.1.1 is down");
        let ips: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::IpAddress)
            .collect();
        assert_eq!(ips.len(), 1);
        assert_eq!(ips[0].text, "192.168.1.1");
    }

    #[test]
    fn test_ip_address_invalid_octets() {
        // 999.999.999.999 should not match the IP pattern
        let spans = detect_regex("Address 999.999.999.999");
        let ips: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::IpAddress)
            .collect();
        assert_eq!(ips.len(), 0);
    }

    #[test]
    fn test_iban() {
        let spans = detect_regex("IBAN: DE89370400440532013000");
        let ibans: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Iban)
            .collect();
        assert_eq!(ibans.len(), 1);
    }

    #[test]
    fn test_date_iso() {
        let spans = detect_regex("Born on 1990-01-15");
        let dates: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Date)
            .collect();
        assert!(dates.len() >= 1);
    }

    #[test]
    fn test_date_written() {
        let spans = detect_regex("Born on January 15, 2024");
        let dates: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Date)
            .collect();
        assert!(dates.len() >= 1);
    }

    #[test]
    fn test_no_pii() {
        let spans = detect_regex("What is the weather today?");
        assert!(spans.is_empty());
    }

    #[test]
    fn test_empty_input() {
        let spans = detect_regex("");
        assert!(spans.is_empty());
    }

    #[test]
    fn test_mixed_pii() {
        let text = "Hi, my name is David and my email is david@corp.com. Call me at 212-555-1234.";
        let spans = detect_regex(text);
        let types: Vec<_> = spans.iter().map(|s| s.entity_type).collect();
        assert!(types.contains(&EntityType::Email));
        assert!(types.contains(&EntityType::Phone));
    }

    #[test]
    fn test_partial_email_no_match() {
        let spans = detect_regex("not-an-email@");
        let emails: Vec<_> = spans
            .iter()
            .filter(|s| s.entity_type == EntityType::Email)
            .collect();
        assert_eq!(emails.len(), 0);
    }
}
