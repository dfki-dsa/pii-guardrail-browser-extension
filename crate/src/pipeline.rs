use crate::checksum;
use crate::context;
use crate::merger;
use crate::ner;
use crate::regex_recognizers;
use crate::types::{DetectionSource, PiiSpan, PipelineConfig};

/// Run the full PII detection pipeline on the input text.
///
/// Stages:
/// 1. Regex recognizers — structured pattern matching
/// 2. NER (ML) — transformer-based entity recognition (when enabled)
/// 3. Checksum validation — verify structured matches (Luhn, IBAN, SSN)
/// 4. Context word scoring — boost confidence from nearby keywords
/// 5. Span merging — deduplicate overlapping detections
///
/// Returns the final list of PII spans, filtered by the minimum confidence threshold.
pub fn detect(text: &str, config: &PipelineConfig) -> Vec<PiiSpan> {
    detect_with_external_spans(text, config, Vec::new())
}

pub fn detect_with_external_spans(
    text: &str,
    config: &PipelineConfig,
    external_ner_spans: Vec<PiiSpan>,
) -> Vec<PiiSpan> {
    if text.is_empty() {
        return Vec::new();
    }

    // Stage 1: Regex recognizers
    let mut regex_spans = regex_recognizers::detect_regex(text);

    // Stage 2: NER (if enabled and model is loaded)
    let mut ner_spans = if config.ner_enabled && ner::is_model_loaded() {
        ner::detect_ner(text)
    } else {
        Vec::new()
    };
    ner_spans.extend(valid_external_ner_spans(text, external_ner_spans));

    // Stage 3: Checksum validation (filter out invalid regex matches)
    regex_spans.retain(|span| checksum::validate(span));

    // Combine regex and NER spans
    let mut all_spans = regex_spans;
    all_spans.extend(ner_spans);

    // Stage 4: Context word scoring
    context::apply_context_boost(
        &mut all_spans,
        text,
        config.context_window,
        config.context_boost,
    );

    // Stage 5: Span merging (resolve overlaps)
    let merged = merger::merge_spans(all_spans);

    // Filter by source/type-aware confidence threshold
    merged
        .into_iter()
        .filter(|span| span.score >= confidence_threshold_for(span, config))
        .collect()
}

fn valid_external_ner_spans(text: &str, spans: Vec<PiiSpan>) -> Vec<PiiSpan> {
    spans
        .into_iter()
        .filter_map(|mut span| {
            if span.source != DetectionSource::Ner
                || span.start >= span.end
                || span.end > text.len()
                || !text.is_char_boundary(span.start)
                || !text.is_char_boundary(span.end)
                || !span.score.is_finite()
                || !(0.0..=1.0).contains(&span.score)
            {
                return None;
            }

            span.text = text[span.start..span.end].to_string();
            Some(span)
        })
        .collect()
}

fn confidence_threshold_for(span: &PiiSpan, config: &PipelineConfig) -> f64 {
    match span.source {
        DetectionSource::Ner => config.min_confidence.max(ner_min_confidence(span.entity_type)),
        DetectionSource::Regex | DetectionSource::Manual => config.min_confidence,
    }
}

// Per-type NER confidence thresholds. MUST stay in sync with the TS-side
// `NER_THRESHOLD_BY_ENTITY_TYPE` in `src/offscreen/ner-provider.ts`. The TS
// gate filters spans before they cross the WASM boundary; this gate is the
// authoritative final filter the PRD assigns to the Rust pipeline. Lower the
// values together when tuning, or detections passing the TS gate will silently
// drop here (real bug seen with LOCATION "Boston" @ 0.65 dropped by Rust 0.82).
fn ner_min_confidence(entity_type: crate::types::EntityType) -> f64 {
    match entity_type {
        crate::types::EntityType::Person
        | crate::types::EntityType::Location
        | crate::types::EntityType::Address => 0.55,
        // Organization stays at the regex baseline (0.5). PRD user story 17
        // requires NER >= regex baseline; lower would be silently capped by
        // `max(config.min_confidence, ...)` below anyway.
        crate::types::EntityType::Organization => 0.50,
        crate::types::EntityType::Url
        | crate::types::EntityType::Username
        | crate::types::EntityType::Password => 0.60,
        // Account-number model scores are softer in the prototype corpus, but
        // still useful when above the regex baseline.
        crate::types::EntityType::BankAccount => 0.50,
        crate::types::EntityType::Email
        | crate::types::EntityType::Phone
        | crate::types::EntityType::CreditCard
        | crate::types::EntityType::Ssn
        | crate::types::EntityType::Iban
        | crate::types::EntityType::IpAddress
        | crate::types::EntityType::Date => 0.80,
        // Keep Rust's authoritative cap permissive enough for model-specific
        // TS threshold profiles. AI4Privacy still filters MISC at 0.90 before
        // this boundary; BardsAI maps explicit sensitive labels to MISC at 0.70.
        crate::types::EntityType::Misc => 0.70,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DetectionSource, EntityType};

    struct DetectionCase {
        language: &'static str,
        entity_type: EntityType,
        text: &'static str,
        matched_text: &'static str,
    }

    fn default_config() -> PipelineConfig {
        PipelineConfig::default()
    }

    fn assert_detects(language: &str, text: &str, entity_type: EntityType, matched_text: &str) {
        let result = detect(text, &default_config());
        assert!(
            result
                .iter()
                .any(|span| span.entity_type == entity_type && span.text == matched_text),
            "expected {} {:?} {:?} in {:?}, got {:?}",
            language,
            entity_type,
            matched_text,
            text,
            result
        );
    }

    fn assert_detects_cases(cases: &[DetectionCase]) {
        for case in cases {
            assert_detects(
                case.language,
                case.text,
                case.entity_type,
                case.matched_text,
            );
        }
    }

    fn external_span(
        text: &str,
        matched_text: &str,
        entity_type: EntityType,
        score: f64,
    ) -> PiiSpan {
        let start = text.find(matched_text).unwrap();
        let end = start + matched_text.len();
        PiiSpan::new(
            start,
            end,
            entity_type,
            score,
            matched_text.to_string(),
            DetectionSource::Ner,
        )
    }

    fn assert_structured_regex_wins_over_same_range_ner(
        text: &str,
        matched_text: &str,
        regex_entity_type: EntityType,
    ) {
        let spans = vec![external_span(text, matched_text, EntityType::Misc, 0.99)];

        let result = detect_with_external_spans(text, &default_config(), spans);

        assert!(
            result.iter().any(|span| {
                span.entity_type == regex_entity_type
                    && span.text == matched_text
                    && span.source == DetectionSource::Regex
            }),
            "expected regex {:?} {:?} to win in {:?}, got {:?}",
            regex_entity_type,
            matched_text,
            text,
            result
        );
        assert!(
            !result.iter().any(|span| {
                span.source == DetectionSource::Ner
                    && span.start == text.find(matched_text).unwrap()
                    && span.end == text.find(matched_text).unwrap() + matched_text.len()
            }),
            "expected same-range NER span to be removed, got {:?}",
            result
        );
    }

    const ENGLISH_STRUCTURED_PII_CASES: &[DetectionCase] = &[
        DetectionCase {
            language: "English",
            entity_type: EntityType::Email,
            text: "Please email david.smith@example.com about the ticket.",
            matched_text: "david.smith@example.com",
        },
        DetectionCase {
            language: "English",
            entity_type: EntityType::Phone,
            text: "Call me at +1 212-555-1234 tomorrow.",
            matched_text: "+1 212-555-1234",
        },
        DetectionCase {
            language: "English",
            entity_type: EntityType::CreditCard,
            text: "The payment card is 4111-1111-1111-1111.",
            matched_text: "4111-1111-1111-1111",
        },
        DetectionCase {
            language: "English",
            entity_type: EntityType::Ssn,
            text: "The employee SSN is 123-45-6789.",
            matched_text: "123-45-6789",
        },
        DetectionCase {
            language: "English",
            entity_type: EntityType::Iban,
            text: "Transfer funds to IBAN GB29NWBK60161331926819.",
            matched_text: "GB29NWBK60161331926819",
        },
        DetectionCase {
            language: "English",
            entity_type: EntityType::IpAddress,
            text: "The server IP address is 192.168.1.1.",
            matched_text: "192.168.1.1",
        },
        DetectionCase {
            language: "English",
            entity_type: EntityType::Date,
            text: "The customer was born on January 15, 2024.",
            matched_text: "January 15, 2024",
        },
    ];

    const GERMAN_STRUCTURED_PII_CASES: &[DetectionCase] = &[
        DetectionCase {
            language: "German",
            entity_type: EntityType::Email,
            text: "Bitte senden Sie die Rechnung an anna.mueller@example.de.",
            matched_text: "anna.mueller@example.de",
        },
        DetectionCase {
            language: "German",
            entity_type: EntityType::Phone,
            text: "Telefonnummer des Kunden: +49 30 12345678.",
            matched_text: "+49 30 12345678",
        },
        DetectionCase {
            language: "German",
            entity_type: EntityType::CreditCard,
            text: "Die Kreditkarte lautet 5500 0000 0000 0004.",
            matched_text: "5500 0000 0000 0004",
        },
        DetectionCase {
            language: "German",
            entity_type: EntityType::Iban,
            text: "Die IBAN ist DE89 3704 0044 0532 0130 00.",
            matched_text: "DE89 3704 0044 0532 0130 00",
        },
        DetectionCase {
            language: "German",
            entity_type: EntityType::IpAddress,
            text: "Der interne Server hat die IP 10.0.0.5.",
            matched_text: "10.0.0.5",
        },
        DetectionCase {
            language: "German",
            entity_type: EntityType::Date,
            text: "Das Geburtsdatum ist 15.01.1990.",
            matched_text: "15.01.1990",
        },
    ];

    #[test]
    fn test_empty_text() {
        let result = detect("", &default_config());
        assert!(result.is_empty());
    }

    #[test]
    fn test_no_pii() {
        let result = detect("What is the weather today?", &default_config());
        assert!(result.is_empty());
    }

    #[test]
    fn test_email_detection() {
        let result = detect("Contact john@example.com for details", &default_config());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_type, EntityType::Email);
        assert_eq!(result[0].text, "john@example.com");
    }

    #[test]
    fn test_phone_with_context() {
        let result = detect("call me at 212-555-1234 tomorrow", &default_config());
        let phones: Vec<_> = result
            .iter()
            .filter(|s| s.entity_type == EntityType::Phone)
            .collect();
        assert!(phones.len() >= 1);
        // "call" is a context keyword, so score should be boosted
        assert!(phones[0].score > 0.70);
    }

    #[test]
    fn test_invalid_cc_filtered_by_checksum() {
        let result = detect("Card number 1234-5678-9012-3456", &default_config());
        let ccs: Vec<_> = result
            .iter()
            .filter(|s| s.entity_type == EntityType::CreditCard)
            .collect();
        // Luhn check should filter this out
        assert!(ccs.is_empty());
    }

    #[test]
    fn test_valid_cc_passes_checksum() {
        let result = detect("Card number 4111-1111-1111-1111", &default_config());
        let ccs: Vec<_> = result
            .iter()
            .filter(|s| s.entity_type == EntityType::CreditCard)
            .collect();
        assert_eq!(ccs.len(), 1);
    }

    #[test]
    fn test_mixed_pii_types() {
        let text = "Email david@corp.com, call 212-555-1234, SSN 123-45-6789";
        let result = detect(text, &default_config());
        let types: Vec<_> = result.iter().map(|s| s.entity_type).collect();
        assert!(types.contains(&EntityType::Email));
        assert!(types.contains(&EntityType::Ssn));
    }

    #[test]
    fn test_high_confidence_threshold() {
        let config = PipelineConfig {
            min_confidence: 0.95,
            ..default_config()
        };
        let result = detect("call 212-555-1234", &config);
        // Phone base score is 0.70 + context boost ~0.85, below 0.95 threshold
        let phones: Vec<_> = result
            .iter()
            .filter(|s| s.entity_type == EntityType::Phone)
            .collect();
        assert!(phones.is_empty());
    }

    #[test]
    fn test_iban_with_valid_checksum() {
        let result = detect("Transfer to IBAN DE89370400440532013000", &default_config());
        let ibans: Vec<_> = result
            .iter()
            .filter(|s| s.entity_type == EntityType::Iban)
            .collect();
        assert_eq!(ibans.len(), 1);
    }

    #[test]
    fn test_context_boost_applied() {
        let text = "my email address is test@example.com";
        let result = detect(text, &default_config());
        let emails: Vec<_> = result
            .iter()
            .filter(|s| s.entity_type == EntityType::Email)
            .collect();
        assert_eq!(emails.len(), 1);
        // Base email score is 0.95, context boost should push it towards 1.0
        assert!(emails[0].score > 0.95);
    }

    #[test]
    fn test_presidio_example() {
        let text = "Hi, my name is David and my number is 212 555 1234";
        let result = detect(text, &default_config());
        // Should detect at least the phone number
        assert!(!result.is_empty());
    }

    #[test]
    fn test_detects_english_structured_pii_examples() {
        assert_detects_cases(ENGLISH_STRUCTURED_PII_CASES);
    }

    #[test]
    fn test_detects_german_structured_pii_examples() {
        assert_detects_cases(GERMAN_STRUCTURED_PII_CASES);
    }

    #[test]
    fn test_detects_multiple_structured_pii_items_in_english_message() {
        let text = "Email david.smith@example.com, call 212-555-1234, use card 4111-1111-1111-1111, SSN 123-45-6789, IBAN GB29NWBK60161331926819, IP 192.168.1.1, date 1990-01-15.";

        assert_detects(
            "English",
            text,
            EntityType::Email,
            "david.smith@example.com",
        );
        assert_detects("English", text, EntityType::Phone, "212-555-1234");
        assert_detects(
            "English",
            text,
            EntityType::CreditCard,
            "4111-1111-1111-1111",
        );
        assert_detects("English", text, EntityType::Ssn, "123-45-6789");
        assert_detects("English", text, EntityType::Iban, "GB29NWBK60161331926819");
        assert_detects("English", text, EntityType::IpAddress, "192.168.1.1");
        assert_detects("English", text, EntityType::Date, "1990-01-15");
    }

    #[test]
    fn external_ner_span_becomes_final_detection() {
        let text = "My name is Ada Lovelace and I work at Acme Corp.";
        let spans = vec![
            external_span(text, "Ada Lovelace", EntityType::Person, 0.90),
            external_span(text, "Acme Corp", EntityType::Organization, 0.88),
        ];

        let result = detect_with_external_spans(text, &default_config(), spans);

        assert!(result.iter().any(|span| {
            span.entity_type == EntityType::Person
                && span.text == "Ada Lovelace"
                && span.source == DetectionSource::Ner
        }));
        assert!(result.iter().any(|span| {
            span.entity_type == EntityType::Organization
                && span.text == "Acme Corp"
                && span.source == DetectionSource::Ner
        }));
    }

    #[test]
    fn invalid_external_ner_spans_are_ignored() {
        let text = "My name is Ada Lovelace.";
        let spans = vec![
            PiiSpan::new(
                20,
                10,
                EntityType::Person,
                0.99,
                String::new(),
                DetectionSource::Ner,
            ),
            PiiSpan::new(
                11,
                23,
                EntityType::Person,
                0.99,
                "Ada Lovelace".to_string(),
                DetectionSource::Regex,
            ),
        ];

        let result = detect_with_external_spans(text, &default_config(), spans);

        assert!(result.is_empty());
    }

    #[test]
    fn external_ner_spans_use_stricter_type_thresholds_than_regex_spans() {
        let text = "Ada Lovelace";

        // PERSON threshold = 0.55 (see ner_min_confidence and the matching TS
        // table). 0.54 < threshold; 0.55 == threshold.
        let below_threshold = detect_with_external_spans(
            text,
            &default_config(),
            vec![external_span(text, "Ada Lovelace", EntityType::Person, 0.54)],
        );
        let at_threshold = detect_with_external_spans(
            text,
            &default_config(),
            vec![external_span(text, "Ada Lovelace", EntityType::Person, 0.55)],
        );

        assert!(below_threshold.is_empty());
        assert!(at_threshold.iter().any(|span| {
            span.entity_type == EntityType::Person
                && span.text == "Ada Lovelace"
                && span.source == DetectionSource::Ner
        }));
    }

    #[test]
    fn organization_ner_spans_match_regex_baseline_threshold() {
        let text = "Acme Corp";

        // ORGANIZATION threshold = 0.50 — pinned to the regex baseline so
        // PRD user story 17 (NER no laxer than regex) holds. Default config
        // min_confidence is also 0.50, so a span at 0.49 fails and 0.50
        // passes.
        let below_threshold = detect_with_external_spans(
            text,
            &default_config(),
            vec![external_span(text, "Acme Corp", EntityType::Organization, 0.49)],
        );
        let at_threshold = detect_with_external_spans(
            text,
            &default_config(),
            vec![external_span(text, "Acme Corp", EntityType::Organization, 0.50)],
        );

        assert!(below_threshold.is_empty());
        assert!(at_threshold.iter().any(|span| {
            span.entity_type == EntityType::Organization
                && span.text == "Acme Corp"
                && span.source == DetectionSource::Ner
        }));
    }

    #[test]
    fn bank_account_ner_spans_match_regex_baseline_threshold() {
        let text = "Identifier ACCTXYZ";
        let config = PipelineConfig {
            context_boost: 0.0,
            ..default_config()
        };

        // BANK_ACCOUNT stays at the regex baseline for the prototype model:
        // account-number labels are useful but score lower than person,
        // address, and password labels in the curated local corpus.
        let below_threshold = detect_with_external_spans(
            text,
            &config,
            vec![external_span(text, "ACCTXYZ", EntityType::BankAccount, 0.49)],
        );
        let at_threshold = detect_with_external_spans(
            text,
            &config,
            vec![external_span(text, "ACCTXYZ", EntityType::BankAccount, 0.50)],
        );

        assert!(!below_threshold.iter().any(|span| {
            span.entity_type == EntityType::BankAccount && span.source == DetectionSource::Ner
        }));
        assert!(at_threshold.iter().any(|span| {
            span.entity_type == EntityType::BankAccount
                && span.text == "ACCTXYZ"
                && span.source == DetectionSource::Ner
        }));
    }

    #[test]
    fn misc_ner_spans_require_conservative_confidence() {
        let text = "Reference X123";

        // Rust stays permissive enough for model-specific TS threshold profiles;
        // the AI4Privacy provider keeps its own MISC gate at 0.90.
        let below_threshold = detect_with_external_spans(
            text,
            &default_config(),
            vec![external_span(text, "X123", EntityType::Misc, 0.69)],
        );
        let at_threshold = detect_with_external_spans(
            text,
            &default_config(),
            vec![external_span(text, "X123", EntityType::Misc, 0.70)],
        );

        assert!(below_threshold.is_empty());
        assert!(at_threshold.iter().any(|span| {
            span.entity_type == EntityType::Misc
                && span.text == "X123"
                && span.source == DetectionSource::Ner
        }));
    }

    #[test]
    fn global_confidence_threshold_still_applies_to_ner_spans() {
        let text = "Ada Lovelace";
        let config = PipelineConfig {
            min_confidence: 0.95,
            ..default_config()
        };

        let result = detect_with_external_spans(
            text,
            &config,
            vec![external_span(text, "Ada Lovelace", EntityType::Person, 0.90)],
        );

        assert!(result.is_empty());
    }

    #[test]
    fn invalid_external_ner_scores_are_ignored() {
        let text = "Ada Lovelace";
        let spans = vec![PiiSpan::new(
            0,
            text.len(),
            EntityType::Person,
            1.01,
            "Ada Lovelace".to_string(),
            DetectionSource::Ner,
        )];

        let result = detect_with_external_spans(text, &default_config(), spans);

        assert!(result.is_empty());
    }

    #[test]
    fn structured_regex_detections_remain_authoritative_over_same_range_ner() {
        let cases = [
            (
                "Email david.smith@example.com about the ticket.",
                "david.smith@example.com",
                EntityType::Email,
            ),
            (
                "Call me at +1 212-555-1234 tomorrow.",
                "+1 212-555-1234",
                EntityType::Phone,
            ),
            (
                "The payment card is 4111-1111-1111-1111.",
                "4111-1111-1111-1111",
                EntityType::CreditCard,
            ),
            (
                "The employee SSN is 123-45-6789.",
                "123-45-6789",
                EntityType::Ssn,
            ),
            (
                "Transfer funds to IBAN GB29NWBK60161331926819.",
                "GB29NWBK60161331926819",
                EntityType::Iban,
            ),
            (
                "The server IP address is 192.168.1.1.",
                "192.168.1.1",
                EntityType::IpAddress,
            ),
            (
                "The customer was born on January 15, 2024.",
                "January 15, 2024",
                EntityType::Date,
            ),
        ];

        for (text, matched_text, entity_type) in cases {
            assert_structured_regex_wins_over_same_range_ner(text, matched_text, entity_type);
        }
    }

    #[test]
    fn non_overlapping_ner_spans_are_preserved_with_regex_detections() {
        let text = "Email ada@example.com after meeting Ada Lovelace.";
        let spans = vec![external_span(
            text,
            "Ada Lovelace",
            EntityType::Person,
            0.90,
        )];

        let result = detect_with_external_spans(text, &default_config(), spans);

        assert!(result.iter().any(|span| {
            span.entity_type == EntityType::Email
                && span.text == "ada@example.com"
                && span.source == DetectionSource::Regex
        }));
        assert!(result.iter().any(|span| {
            span.entity_type == EntityType::Person
                && span.text == "Ada Lovelace"
                && span.source == DetectionSource::Ner
        }));
    }

    #[test]
    fn test_detects_multiple_structured_pii_items_in_german_message() {
        let text = "E-Mail anna.mueller@example.de, Telefon +49 30 12345678, Kreditkarte 5500 0000 0000 0004, IBAN DE89 3704 0044 0532 0130 00, IP 10.0.0.5, Datum 15.01.1990.";

        assert_detects("German", text, EntityType::Email, "anna.mueller@example.de");
        assert_detects("German", text, EntityType::Phone, "+49 30 12345678");
        assert_detects(
            "German",
            text,
            EntityType::CreditCard,
            "5500 0000 0000 0004",
        );
        assert_detects(
            "German",
            text,
            EntityType::Iban,
            "DE89 3704 0044 0532 0130 00",
        );
        assert_detects("German", text, EntityType::IpAddress, "10.0.0.5");
        assert_detects("German", text, EntityType::Date, "15.01.1990");
    }
}
