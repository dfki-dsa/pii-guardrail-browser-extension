mod checksum;
mod context;
mod merger;
mod ner;
mod pipeline;
mod regex_recognizers;
mod tokenizer;
pub mod types;

use types::PipelineConfig;
use wasm_bindgen::prelude::*;

/// Initialize the WASM module. Called once on load.
#[wasm_bindgen]
pub fn init() {
    // Future: set up panic hook for better error messages in browser console
    // when console_error_panic_hook feature is added.
}

/// Run the full PII detection pipeline on the input text.
///
/// Returns a JSON-serialized array of PiiSpan objects.
///
/// # Arguments
/// * `text` - The input text to scan for PII
/// * `config_json` - Optional JSON string with PipelineConfig overrides.
///   If empty or invalid, defaults are used.
#[wasm_bindgen]
pub fn detect_pii(text: &str, config_json: &str) -> String {
    let config = PipelineConfig::from_json_or_default(config_json);

    let spans = pipeline::detect(text, &config);
    serde_json::to_string(&spans).unwrap_or_else(|_| "[]".to_string())
}

/// Run the PII detection pipeline with externally produced NER candidate spans.
///
/// The external spans are JSON-serialized PiiSpan objects. Rust validates byte
/// offsets and source metadata, then owns context scoring, merging, and final
/// filtering with regex detections.
#[wasm_bindgen]
pub fn detect_pii_with_external_spans(
    text: &str,
    config_json: &str,
    external_spans_json: &str,
) -> String {
    let config = PipelineConfig::from_json_or_default(config_json);
    let external_spans = if external_spans_json.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(external_spans_json).unwrap_or_default()
    };

    let spans = pipeline::detect_with_external_spans(text, &config, external_spans);
    serde_json::to_string(&spans).unwrap_or_else(|_| "[]".to_string())
}

/// Check if the NER model is loaded and ready.
#[wasm_bindgen]
pub fn is_ner_ready() -> bool {
    ner::is_model_loaded()
}

/// Get the default pipeline configuration as JSON.
#[wasm_bindgen]
pub fn default_config() -> String {
    serde_json::to_string(&PipelineConfig::default()).unwrap_or_else(|_| "{}".to_string())
}
