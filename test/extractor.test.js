'use strict';

const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Mock modules before requiring the extractor
const openaiMock = {
  chat: {
    completions: {
      create: mock.fn(async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                numero: '12345',
                valor: 100.5,
                emissor: {
                  cnpj: '12.345.678/0001-90',
                  razao_social: 'Test Company',
                },
              }),
            },
          },
        ],
      })),
    },
  },
};

// Store original require
const originalRequire = module.constructor.prototype.require;

// Override require for openai
module.constructor.prototype.require = function (id) {
  if (id === 'openai') {
    return function OpenAI() {
      return openaiMock;
    };
  }
  return originalRequire.apply(this, arguments);
};

// Clear module cache for affected modules
delete require.cache[require.resolve('../src/ai/openaiClient')];
delete require.cache[require.resolve('../src/extractor')];
delete require.cache[require.resolve('../src/index')];

const {
  PdfAiExtractor,
  InvalidInputError,
  PdfReadError,
  OcrError,
  AiExtractionError,
} = require('../src/index');
const { chunkText, estimateTokens } = require('../src/utils/chunker');
const { mergeResults, mergeResultsSimple } = require('../src/utils/merger');

// Restore original require after loading
module.constructor.prototype.require = originalRequire;

// Test fixtures path
const fixturesPath = path.join(__dirname, 'fixtures');

describe('PdfAiExtractor', () => {
  describe('constructor', () => {
    it('should throw InvalidInputError when apiKey is missing', () => {
      assert.throws(
        () => new PdfAiExtractor({}),
        InvalidInputError
      );
    });

    it('should create instance with valid apiKey', () => {
      const extractor = new PdfAiExtractor({ apiKey: 'test-key' });
      assert.ok(extractor);
    });

    it('should use default values', () => {
      const extractor = new PdfAiExtractor({ apiKey: 'test-key' });
      assert.strictEqual(extractor.model, 'gpt-4o-mini');
      assert.strictEqual(extractor.ocrLanguage, 'por+eng');
      assert.strictEqual(extractor.ocrThreshold, 50);
      assert.strictEqual(extractor.maxTokensPerChunk, 8000);
      assert.strictEqual(extractor.debug, false);
    });

    it('should accept custom options', () => {
      const extractor = new PdfAiExtractor({
        apiKey: 'test-key',
        model: 'gpt-4o',
        ocrLanguage: 'eng',
        ocrThreshold: 100,
        maxTokensPerChunk: 4000,
        debug: true,
      });
      assert.strictEqual(extractor.model, 'gpt-4o');
      assert.strictEqual(extractor.ocrLanguage, 'eng');
      assert.strictEqual(extractor.ocrThreshold, 100);
      assert.strictEqual(extractor.maxTokensPerChunk, 4000);
      assert.strictEqual(extractor.debug, true);
    });
  });

  describe('extract - validation', () => {
    let extractor;

    beforeEach(() => {
      extractor = new PdfAiExtractor({ apiKey: 'test-key' });
    });

    it('should throw InvalidInputError when source is missing', async () => {
      await assert.rejects(
        () => extractor.extract({ prompt: 'test', schema: {} }),
        InvalidInputError
      );
    });

    it('should throw InvalidInputError when prompt is missing', async () => {
      await assert.rejects(
        () => extractor.extract({ source: Buffer.from('test'), schema: {} }),
        InvalidInputError
      );
    });

    it('should throw InvalidInputError when schema is missing', async () => {
      await assert.rejects(
        () => extractor.extract({ source: Buffer.from('test'), prompt: 'test' }),
        InvalidInputError
      );
    });

    it('should throw InvalidInputError when file does not exist', async () => {
      await assert.rejects(
        () =>
          extractor.extract({
            source: '/nonexistent/file.pdf',
            prompt: 'test',
            schema: {},
          }),
        InvalidInputError
      );
    });
  });
});

describe('chunker', () => {
  it('should return single chunk for short text', () => {
    const text = 'This is a short text.';
    const chunks = chunkText(text, 8000);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], text);
  });

  it('should split long text into multiple chunks', () => {
    const paragraph = 'This is a paragraph. '.repeat(100);
    const text = (paragraph + '\n\n').repeat(10);
    const chunks = chunkText(text, 100); // Very small chunk size
    assert.ok(chunks.length > 1);
  });

  it('should preserve paragraph boundaries when possible', () => {
    const text = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.';
    const chunks = chunkText(text, 8000);
    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].includes('Paragraph 1'));
    assert.ok(chunks[0].includes('Paragraph 2'));
    assert.ok(chunks[0].includes('Paragraph 3'));
  });

  it('should estimate tokens correctly', () => {
    const text = 'This is a test'; // 14 characters
    const tokens = estimateTokens(text);
    assert.strictEqual(tokens, 4); // 14 / 4 = 3.5 -> 4
  });
});

describe('merger', () => {
  it('should return empty object for empty results', () => {
    const merged = mergeResults([], {});
    assert.deepStrictEqual(merged, {});
  });

  it('should return single result unchanged', () => {
    const result = { name: 'Test', value: 42 };
    const merged = mergeResults([result], { name: 'string', value: 'number' });
    assert.deepStrictEqual(merged, result);
  });

  it('should concatenate arrays', () => {
    const results = [{ items: [1, 2] }, { items: [3, 4] }];
    const schema = { items: [] };
    const merged = mergeResults(results, schema);
    assert.deepStrictEqual(merged.items, [1, 2, 3, 4]);
  });

  it('should use first non-null scalar value', () => {
    const results = [{ name: null }, { name: 'Second' }, { name: 'Third' }];
    const schema = { name: 'string' };
    const merged = mergeResults(results, schema);
    assert.strictEqual(merged.name, 'Second');
  });

  it('should merge nested objects recursively', () => {
    const results = [
      { person: { name: 'John', age: null } },
      { person: { name: null, age: 30 } },
    ];
    const schema = { person: { name: 'string', age: 'number' } };
    const merged = mergeResults(results, schema);
    assert.deepStrictEqual(merged.person, { name: 'John', age: 30 });
  });
});

describe('Error classes', () => {
  it('should create PdfReadError with cause', () => {
    const cause = new Error('Original error');
    const error = new PdfReadError('Failed to read PDF', cause);
    assert.strictEqual(error.name, 'PdfReadError');
    assert.strictEqual(error.message, 'Failed to read PDF');
    assert.strictEqual(error.cause, cause);
  });

  it('should create OcrError with cause', () => {
    const cause = new Error('OCR failed');
    const error = new OcrError('OCR extraction failed', cause);
    assert.strictEqual(error.name, 'OcrError');
    assert.strictEqual(error.message, 'OCR extraction failed');
    assert.strictEqual(error.cause, cause);
  });

  it('should create AiExtractionError with cause', () => {
    const cause = new Error('API error');
    const error = new AiExtractionError('AI extraction failed', cause);
    assert.strictEqual(error.name, 'AiExtractionError');
    assert.strictEqual(error.message, 'AI extraction failed');
    assert.strictEqual(error.cause, cause);
  });

  it('should create InvalidInputError', () => {
    const error = new InvalidInputError('Invalid input');
    assert.strictEqual(error.name, 'InvalidInputError');
    assert.strictEqual(error.message, 'Invalid input');
  });
});
