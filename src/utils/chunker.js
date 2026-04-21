'use strict';

// Rough estimate: 1 token ≈ 4 characters for English/Portuguese
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function chunkText(text, maxTokensPerChunk = 8000) {
  const maxChars = maxTokensPerChunk * CHARS_PER_TOKEN;

  if (text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If a single paragraph exceeds maxChars, split it by sentences
    if (paragraph.length > maxChars) {
      // First, add any accumulated chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split large paragraph by sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let sentenceChunk = '';

      for (const sentence of sentences) {
        if ((sentenceChunk + ' ' + sentence).length > maxChars) {
          if (sentenceChunk.trim()) {
            chunks.push(sentenceChunk.trim());
          }
          // If a single sentence is too long, just add it as is
          if (sentence.length > maxChars) {
            chunks.push(sentence);
            sentenceChunk = '';
          } else {
            sentenceChunk = sentence;
          }
        } else {
          sentenceChunk = sentenceChunk ? sentenceChunk + ' ' + sentence : sentence;
        }
      }

      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
    } else if ((currentChunk + '\n\n' + paragraph).length > maxChars) {
      // Adding this paragraph would exceed limit
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph;
    } else {
      // Add paragraph to current chunk
      currentChunk = currentChunk ? currentChunk + '\n\n' + paragraph : paragraph;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

module.exports = { chunkText, estimateTokens };
