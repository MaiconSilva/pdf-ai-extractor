'use strict';

const fs = require('fs');
const path = require('path');
const { InvalidInputError } = require('./errors');
const { createLogger } = require('./utils/logger');
const { extractText } = require('./pdf/textExtractor');
const { renderPagesWithCount } = require('./pdf/pageRenderer');
const { extractTextFromImages, extractTextFromImage } = require('./pdf/ocrExtractor');
const { extractStructuredData } = require('./ai/openaiClient');
const { chunkText } = require('./utils/chunker');
const { mergeResults } = require('./utils/merger');

const PDF_MAGIC_BYTES = '%PDF';

class PdfAiExtractor {
  constructor(options = {}) {
    const { apiKey, model, ocrLanguage, ocrThreshold, maxTokensPerChunk, debug } = options;

    if (!apiKey) {
      throw new InvalidInputError('apiKey is required');
    }

    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
    this.ocrLanguage = ocrLanguage || 'por+eng';
    this.ocrThreshold = ocrThreshold !== undefined ? ocrThreshold : 50;
    this.maxTokensPerChunk = maxTokensPerChunk || 8000;
    this.debug = debug || false;
    this.logger = createLogger(this.debug);
  }

  async extract({ source, prompt, schema }) {
    // Validate input
    if (!source) {
      throw new InvalidInputError('source is required');
    }
    if (!prompt) {
      throw new InvalidInputError('prompt is required');
    }
    if (!schema) {
      throw new InvalidInputError('schema is required');
    }

    this.logger.debug('Starting extraction');

    // Get buffer from source
    const buffer = await this._getBuffer(source);

    // Detect file type
    const isPdf = this._isPdf(buffer);
    const fileType = isPdf ? 'pdf' : 'image';

    this.logger.debug(`Detected file type: ${fileType}`);

    let text = '';
    let usedOcr = false;
    let pageCount = 1;

    if (isPdf) {
      // Try native text extraction first
      const extracted = await extractText(buffer, this.logger);
      text = extracted.text;
      pageCount = extracted.pageCount;

      this.logger.debug(`Native PDF extraction: ${text.length} chars from ${pageCount} pages`);

      // If text is empty or below threshold, use OCR
      if (text.trim().length < this.ocrThreshold) {
        this.logger.debug(`Text below threshold (${this.ocrThreshold}), using OCR`);

        const images = await renderPagesWithCount(buffer, pageCount, {}, this.logger);
        text = await extractTextFromImages(images, this.ocrLanguage, this.logger);
        usedOcr = true;
      }
    } else {
      // Image: run OCR directly
      this.logger.debug('Processing image with OCR');
      text = await extractTextFromImage(buffer, this.ocrLanguage, this.logger);
      usedOcr = true;
    }

    // Chunk text if necessary
    const chunks = chunkText(text, this.maxTokensPerChunk);
    this.logger.debug(`Split text into ${chunks.length} chunks`);

    // Process each chunk with OpenAI
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      this.logger.debug(`Processing chunk ${i + 1}/${chunks.length}`);

      const result = await extractStructuredData(
        chunks[i],
        prompt,
        schema,
        { apiKey: this.apiKey, model: this.model },
        this.logger
      );

      results.push(result);
    }

    // Merge results
    const data = mergeResults(results, schema);

    return {
      data,
      meta: {
        pages: pageCount,
        usedOcr,
        chunks: chunks.length,
        fileType,
      },
    };
  }

  async _getBuffer(source) {
    if (Buffer.isBuffer(source)) {
      return source;
    }

    if (typeof source === 'string') {
      // Assume it's a file path
      const resolvedPath = path.resolve(source);

      if (!fs.existsSync(resolvedPath)) {
        throw new InvalidInputError(`File not found: ${source}`);
      }

      return fs.readFileSync(resolvedPath);
    }

    throw new InvalidInputError('source must be a Buffer or a file path string');
  }

  _isPdf(buffer) {
    if (buffer.length < 4) {
      return false;
    }

    const header = buffer.slice(0, 4).toString('ascii');
    return header === PDF_MAGIC_BYTES;
  }
}

module.exports = { PdfAiExtractor };
