/// WordPiece tokenizer stub — will be implemented in Phase 2 for NER.
///
/// In Phase 2 this will:
/// 1. Load a vocabulary file (vocab.txt from BERT)
/// 2. Implement WordPiece tokenization matching HuggingFace's output
/// 3. Convert tokens to input IDs for the ONNX model
/// 4. Track character-to-token offset mapping for span reconstruction

/// Placeholder for future WordPiece tokenizer.
/// Phase 2 will implement this with the HuggingFace `tokenizers` crate
/// or a custom WordPiece implementation.
#[allow(dead_code)]
pub struct WordPieceTokenizer;

#[allow(dead_code)]
impl WordPieceTokenizer {
    pub fn new() -> Self {
        Self
    }
}
