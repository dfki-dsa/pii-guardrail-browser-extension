use crate::types::PiiSpan;

/// NER module stub — will be implemented in Phase 2 with tract ONNX inference.
///
/// In Phase 2 this will:
/// 1. Accept model bytes (loaded from IndexedDB via JS)
/// 2. Load a quantized BERT-NER ONNX model via tract
/// 3. Tokenize input with WordPiece tokenizer
/// 4. Run inference and extract entity spans (PER, LOC, ORG, MISC)
/// 5. Merge sub-word tokens into full entity spans

/// Run NER inference on the input text.
/// Currently returns an empty list (no model loaded).
/// Phase 2 will implement this with tract.
pub fn detect_ner(_text: &str) -> Vec<PiiSpan> {
    // Stub: NER not yet implemented
    Vec::new()
}

/// Check if the NER model is currently loaded and ready for inference.
pub fn is_model_loaded() -> bool {
    false
}
