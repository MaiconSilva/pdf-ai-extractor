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
const DEFAULT_OCR_PREPROCESS = {
  enabled: false,
  profile: 'balanced',
  retryProfile: 'highContrast',
};
const DEFAULT_OCR_QUALITY_CHECK = {
  enabled: true,
  minAlphanumericRatio: 0.55,
  maxSymbolRatio: 0.3,
  minAverageWordLength: 2,
};

class PdfAiExtractor {
  constructor(options = {}) {
    const {
      apiKey,
      model,
      ocrLanguage,
      ocrThreshold,
      maxTokensPerChunk,
      debug,
      ocrRenderOptions,
      ocrTesseractParams,
      ocrMinConfidence,
      ocrRetryEnabled,
      ocrPreprocess,
      ocrQualityCheck,
    } = options;

    if (!apiKey) {
      throw new InvalidInputError('apiKey is required');
    }

    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
    this.ocrLanguage = ocrLanguage || 'por+eng';
    this.ocrThreshold = ocrThreshold !== undefined ? ocrThreshold : 50;
    this.ocrRenderOptions = ocrRenderOptions || {};
    this.ocrTesseractParams = ocrTesseractParams || {};
    this.ocrMinConfidence = Number.isFinite(ocrMinConfidence) ? ocrMinConfidence : 0;
    this.ocrRetryEnabled = ocrRetryEnabled !== undefined ? ocrRetryEnabled : false;
    this.ocrPreprocess = {
      ...DEFAULT_OCR_PREPROCESS,
      ...(ocrPreprocess || {}),
    };
    this.ocrQualityCheck = {
      ...DEFAULT_OCR_QUALITY_CHECK,
      ...(ocrQualityCheck || {}),
    };
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
    let ocrMeta = null;
    let pageCount = 1;

    if (isPdf) {
      // Try native text extraction first
      const extracted = await extractText(buffer, this.logger);
      text = extracted.text;
      pageCount = extracted.pageCount;

      this.logger.debug(`Native PDF extraction: ${text.length} chars from ${pageCount} pages`);

      const quality = this._assessTextQuality(text);
      const textBelowThreshold = text.trim().length < this.ocrThreshold;
      const shouldUseOcr = textBelowThreshold || quality.isLowQuality;

      if (shouldUseOcr) {
        this.logger.debug(
          `Using OCR (threshold=${textBelowThreshold}, lowQuality=${quality.isLowQuality}, ` +
            `alnumRatio=${quality.metrics.alphanumericRatio.toFixed(3)}, ` +
            `symbolRatio=${quality.metrics.symbolRatio.toFixed(3)})`
        );

        const images = await renderPagesWithCount(buffer, pageCount, this.ocrRenderOptions, this.logger);
        const ocrResult = await extractTextFromImages(images, this.ocrLanguage, {
          logger: this.logger,
          tesseractParams: this.ocrTesseractParams,
          minConfidence: this.ocrMinConfidence,
          retryEnabled: this.ocrRetryEnabled,
          preprocess: this.ocrPreprocess,
          returnMeta: true,
        });

        text = ocrResult.text;
        ocrMeta = ocrResult.meta;
        usedOcr = true;
      }
    } else {
      // Image: run OCR directly
      this.logger.debug('Processing image with OCR');
      const ocrResult = await extractTextFromImage(buffer, this.ocrLanguage, {
        logger: this.logger,
        tesseractParams: this.ocrTesseractParams,
        minConfidence: this.ocrMinConfidence,
        retryEnabled: this.ocrRetryEnabled,
        preprocess: this.ocrPreprocess,
        returnMeta: true,
      });
      text = ocrResult.text;
      ocrMeta = ocrResult.meta;
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
        ...(ocrMeta ? { ocr: ocrMeta } : {}),
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

  _assessTextQuality(text) {
    const trimmed = (text || '').trim();
    const metrics = {
      alphanumericRatio: 0,
      symbolRatio: 0,
      averageWordLength: 0,
    };

    if (!trimmed || !this.ocrQualityCheck.enabled) {
      return {
        isLowQuality: false,
        metrics,
      };
    }

    const compact = trimmed.replace(/\s+/g, '');
    const chars = Array.from(compact);
    const alnumChars = chars.filter((char) => /[A-Za-z0-9À-ÖØ-öø-ÿ]/.test(char)).length;
    const symbolChars = chars.length - alnumChars;
    const words = trimmed.split(/\s+/).filter(Boolean);
    const totalWordLength = words.reduce((acc, word) => acc + word.length, 0);

    metrics.alphanumericRatio = compact.length > 0 ? alnumChars / compact.length : 0;
    metrics.symbolRatio = compact.length > 0 ? symbolChars / compact.length : 0;
    metrics.averageWordLength = words.length > 0 ? totalWordLength / words.length : 0;

    const isLowQuality =
      metrics.alphanumericRatio < this.ocrQualityCheck.minAlphanumericRatio ||
      metrics.symbolRatio > this.ocrQualityCheck.maxSymbolRatio ||
      (words.length >= 6 && metrics.averageWordLength < this.ocrQualityCheck.minAverageWordLength);

    return {
      isLowQuality,
      metrics,
    };
  }
}

module.exports = { PdfAiExtractor };
