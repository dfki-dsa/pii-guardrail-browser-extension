use crate::types::{DetectionSource, EntityType, PiiSpan};

/// Merge overlapping PII spans, keeping authoritative structured detections
/// ahead of weaker overlapping guesses.
///
/// Algorithm:
/// 1. Sort spans by start position, then by score descending.
/// 2. Iterate through sorted spans, greedily keeping spans that don't overlap
///    with already-accepted spans.
/// 3. Resolve overlaps by source/type precedence first, then score.
pub fn merge_spans(mut spans: Vec<PiiSpan>) -> Vec<PiiSpan> {
    if spans.len() <= 1 {
        return spans;
    }

    // Sort by start position; on ties, prefer higher score
    spans.sort_by(|a, b| {
        a.start.cmp(&b.start).then(
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });

    let mut merged: Vec<PiiSpan> = Vec::with_capacity(spans.len());

    for span in spans {
        // Check if this span overlaps with the last accepted span
        if let Some(last) = merged.last() {
            if span.overlaps(last) {
                if should_replace(last, &span) {
                    let last_idx = merged.len() - 1;
                    merged[last_idx] = span;
                }
                continue;
            }
        }
        merged.push(span);
    }

    merged
}

fn should_replace(existing: &PiiSpan, candidate: &PiiSpan) -> bool {
    let existing_precedence = precedence(existing);
    let candidate_precedence = precedence(candidate);

    if candidate_precedence != existing_precedence {
        return candidate_precedence > existing_precedence;
    }

    candidate.score > existing.score
}

fn precedence(span: &PiiSpan) -> u8 {
    match span.source {
        DetectionSource::Manual => 3,
        DetectionSource::Regex if is_authoritative_structured_type(span.entity_type) => 2,
        DetectionSource::Regex | DetectionSource::Ner => 1,
    }
}

fn is_authoritative_structured_type(entity_type: EntityType) -> bool {
    matches!(
        entity_type,
        EntityType::CreditCard
            | EntityType::Iban
            | EntityType::Ssn
            | EntityType::Email
            | EntityType::Phone
            | EntityType::IpAddress
            | EntityType::Date
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(start: usize, end: usize, score: f64, entity_type: EntityType) -> PiiSpan {
        PiiSpan::new(
            start,
            end,
            entity_type,
            score,
            format!("[{}-{}]", start, end),
            DetectionSource::Regex,
        )
    }

    fn sourced_span(
        start: usize,
        end: usize,
        score: f64,
        entity_type: EntityType,
        source: DetectionSource,
    ) -> PiiSpan {
        PiiSpan::new(
            start,
            end,
            entity_type,
            score,
            format!("[{}-{}]", start, end),
            source,
        )
    }

    #[test]
    fn test_no_overlap() {
        let spans = vec![
            span(0, 5, 0.9, EntityType::Person),
            span(10, 15, 0.8, EntityType::Email),
        ];
        let result = merge_spans(spans);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_full_overlap_keep_higher_score() {
        let spans = vec![
            span(0, 10, 0.9, EntityType::Person),
            span(0, 10, 0.7, EntityType::Organization),
        ];
        let result = merge_spans(spans);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_type, EntityType::Person);
        assert!((result[0].score - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_partial_overlap_keep_higher_score() {
        let spans = vec![
            span(0, 10, 0.7, EntityType::Person),
            span(5, 15, 0.9, EntityType::Organization),
        ];
        let result = merge_spans(spans);
        assert_eq!(result.len(), 1);
        // The higher-scoring span should win
        assert!((result[0].score - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_adjacent_no_overlap() {
        let spans = vec![
            span(0, 5, 0.9, EntityType::Person),
            span(5, 10, 0.8, EntityType::Email),
        ];
        let result = merge_spans(spans);
        assert_eq!(result.len(), 2); // adjacent, not overlapping
    }

    #[test]
    fn test_empty() {
        let result = merge_spans(vec![]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_single_span() {
        let spans = vec![span(0, 10, 0.9, EntityType::Person)];
        let result = merge_spans(spans);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_three_way_overlap() {
        let spans = vec![
            span(0, 10, 0.5, EntityType::Person),
            span(3, 12, 0.9, EntityType::Organization),
            span(8, 15, 0.7, EntityType::Location),
        ];
        let result = merge_spans(spans);
        // First span at 0-10 (0.5) overlaps with 3-12 (0.9) → keep 0.9 at 3-12
        // Then 3-12 overlaps with 8-15 → keep 0.9 at 3-12
        assert_eq!(result.len(), 1);
        assert!((result[0].score - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_mixed_overlapping_and_not() {
        let spans = vec![
            span(0, 5, 0.9, EntityType::Person),
            span(3, 8, 0.7, EntityType::Organization),
            span(20, 30, 0.8, EntityType::Email),
            span(25, 35, 0.6, EntityType::Phone),
        ];
        let result = merge_spans(spans);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].entity_type, EntityType::Person);
        assert_eq!(result[1].entity_type, EntityType::Email);
    }

    #[test]
    fn structured_regex_beats_higher_scoring_overlapping_ner() {
        let spans = vec![
            sourced_span(0, 19, 0.99, EntityType::BankAccount, DetectionSource::Ner),
            sourced_span(3, 19, 0.75, EntityType::CreditCard, DetectionSource::Regex),
        ];

        let result = merge_spans(spans);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_type, EntityType::CreditCard);
        assert_eq!(result[0].source, DetectionSource::Regex);
    }

    #[test]
    fn non_authoritative_conflicts_still_fall_back_to_score() {
        let spans = vec![
            sourced_span(0, 10, 0.70, EntityType::Person, DetectionSource::Regex),
            sourced_span(0, 10, 0.95, EntityType::Organization, DetectionSource::Ner),
        ];

        let result = merge_spans(spans);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_type, EntityType::Organization);
        assert_eq!(result[0].source, DetectionSource::Ner);
    }
}
