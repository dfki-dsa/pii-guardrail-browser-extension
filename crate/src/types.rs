use serde::{Deserialize, Serialize};

/// Entity types that the detection pipeline can identify.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityType {
    Person,
    Email,
    Phone,
    CreditCard,
    Ssn,
    Iban,
    IpAddress,
    Location,
    Organization,
    Address,
    Url,
    Username,
    Password,
    BankAccount,
    Date,
    Misc,
}

impl EntityType {
    pub fn label(&self) -> &'static str {
        match self {
            EntityType::Person => "PERSON",
            EntityType::Email => "EMAIL",
            EntityType::Phone => "PHONE",
            EntityType::CreditCard => "CREDIT_CARD",
            EntityType::Ssn => "SSN",
            EntityType::Iban => "IBAN",
            EntityType::IpAddress => "IP_ADDRESS",
            EntityType::Location => "LOCATION",
            EntityType::Organization => "ORGANIZATION",
            EntityType::Address => "ADDRESS",
            EntityType::Url => "URL",
            EntityType::Username => "USERNAME",
            EntityType::Password => "PASSWORD",
            EntityType::BankAccount => "BANK_ACCOUNT",
            EntityType::Date => "DATE",
            EntityType::Misc => "MISC",
        }
    }
}

/// The source stage that produced this detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectionSource {
    Regex,
    Ner,
    Manual,
}

/// A detected PII span within the input text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiiSpan {
    /// Byte offset of the start of the span in the original text.
    pub start: usize,
    /// Byte offset of the end of the span (exclusive) in the original text.
    pub end: usize,
    /// The entity type detected.
    pub entity_type: EntityType,
    /// Confidence score in [0.0, 1.0].
    pub score: f64,
    /// The matched text fragment.
    pub text: String,
    /// Which detection stage produced this span.
    pub source: DetectionSource,
}

impl PiiSpan {
    pub fn new(
        start: usize,
        end: usize,
        entity_type: EntityType,
        score: f64,
        text: String,
        source: DetectionSource,
    ) -> Self {
        Self {
            start,
            end,
            entity_type,
            score,
            text,
            source,
        }
    }

    /// Check if this span overlaps with another.
    pub fn overlaps(&self, other: &PiiSpan) -> bool {
        self.start < other.end && other.start < self.end
    }
}

/// Configuration for the detection pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    /// Minimum confidence score to include a span in results.
    pub min_confidence: f64,
    /// Boost applied to spans with nearby context words.
    pub context_boost: f64,
    /// Number of tokens to scan on each side for context words.
    pub context_window: usize,
    /// Whether NER is enabled (requires model to be loaded).
    pub ner_enabled: bool,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            min_confidence: 0.5,
            context_boost: 0.15,
            context_window: 5,
            ner_enabled: false,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct PipelineConfigOverrides {
    pub min_confidence: Option<f64>,
    pub context_boost: Option<f64>,
    pub context_window: Option<usize>,
    pub ner_enabled: Option<bool>,
}

impl PipelineConfig {
    pub fn from_json_or_default(config_json: &str) -> Self {
        if config_json.is_empty() {
            return Self::default();
        }

        let overrides: PipelineConfigOverrides = match serde_json::from_str(config_json) {
            Ok(overrides) => overrides,
            Err(_) => return Self::default(),
        };

        let mut config = Self::default();
        if let Some(min_confidence) = overrides.min_confidence {
            config.min_confidence = min_confidence;
        }
        if let Some(context_boost) = overrides.context_boost {
            config.context_boost = context_boost;
        }
        if let Some(context_window) = overrides.context_window {
            config.context_window = context_window;
        }
        if let Some(ner_enabled) = overrides.ner_enabled {
            config.ner_enabled = ner_enabled;
        }
        config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_ENTITY_TYPES: &[EntityType] = &[
        EntityType::Person,
        EntityType::Email,
        EntityType::Phone,
        EntityType::CreditCard,
        EntityType::Ssn,
        EntityType::Iban,
        EntityType::IpAddress,
        EntityType::Location,
        EntityType::Organization,
        EntityType::Address,
        EntityType::Url,
        EntityType::Username,
        EntityType::Password,
        EntityType::BankAccount,
        EntityType::Date,
        EntityType::Misc,
    ];

    #[test]
    fn entity_type_labels_serialize_in_contract_format() {
        for entity_type in ALL_ENTITY_TYPES {
            let serialized = serde_json::to_string(entity_type).unwrap();
            assert_eq!(serialized, format!("\"{}\"", entity_type.label()));
        }
    }

    #[test]
    fn new_entity_types_deserialize_from_typescript_contract_values() {
        let cases = [
            ("\"ADDRESS\"", EntityType::Address),
            ("\"URL\"", EntityType::Url),
            ("\"USERNAME\"", EntityType::Username),
            ("\"PASSWORD\"", EntityType::Password),
            ("\"BANK_ACCOUNT\"", EntityType::BankAccount),
        ];

        for (json, expected) in cases {
            let actual: EntityType = serde_json::from_str(json).unwrap();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn pipeline_config_accepts_partial_json_overrides() {
        let config = PipelineConfig::from_json_or_default(r#"{"ner_enabled":true}"#);

        assert!(config.ner_enabled);
        assert_eq!(
            config.min_confidence,
            PipelineConfig::default().min_confidence
        );
        assert_eq!(
            config.context_boost,
            PipelineConfig::default().context_boost
        );
        assert_eq!(
            config.context_window,
            PipelineConfig::default().context_window
        );
    }
}
