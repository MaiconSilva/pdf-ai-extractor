'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const originalRequire = module.constructor.prototype.require;

describe('OCR config pipeline', () => {
  it('should pass OCR options through extractor pipeline', async () => {
    const renderCalls = [];
    const ocrCalls = [];

    const mocks = {
      './pdf/textExtractor': {
        extractText: async () => ({ text: 'low', pageCount: 2 }),
      },
      './pdf/pageRenderer': {
        renderPagesWithCount: async (buffer, pageCount, options) => {
          renderCalls.push({ pageCount, options });
          return [Buffer.from('img1'), Buffer.from('img2')];
        },
      },
      './pdf/ocrExtractor': {
        extractTextFromImages: async (images, language, options) => {
          ocrCalls.push({ images, language, options });
          return {
            text: 'OCR FINAL TEXT',
            meta: { averageConfidence: 91.2, retries: 1, perPage: [] },
          };
        },
        extractTextFromImage: async () => ({ text: '', meta: {} }),
      },
      './ai/openaiClient': {
        extractStructuredData: async () => ({ ok: true }),
      },
    };

    module.constructor.prototype.require = function (id) {
      if (mocks[id]) {
        return mocks[id];
      }
      return originalRequire.apply(this, arguments);
    };

    delete require.cache[require.resolve('../src/extractor')];
    const { PdfAiExtractor } = require('../src/extractor');
    module.constructor.prototype.require = originalRequire;

    const extractor = new PdfAiExtractor({
      apiKey: 'test-key',
      ocrThreshold: 50,
      ocrRenderOptions: { density: 300, width: 2200, height: 3100 },
      ocrTesseractParams: { tessedit_pageseg_mode: 6, preserve_interword_spaces: '1' },
      ocrMinConfidence: 75,
      ocrRetryEnabled: true,
      ocrPreprocess: { enabled: true, profile: 'balanced', retryProfile: 'highContrast' },
    });

    const result = await extractor.extract({
      source: Buffer.from('%PDF-1.7 sample'),
      prompt: 'extract',
      schema: { ok: 'boolean' },
    });

    assert.strictEqual(result.meta.usedOcr, true);
    assert.strictEqual(renderCalls.length, 1);
    assert.deepStrictEqual(renderCalls[0].options, { density: 300, width: 2200, height: 3100 });
    assert.strictEqual(ocrCalls.length, 1);
    assert.strictEqual(ocrCalls[0].language, 'por+eng');
    assert.strictEqual(ocrCalls[0].options.returnMeta, true);
    assert.strictEqual(ocrCalls[0].options.retryEnabled, true);
    assert.strictEqual(ocrCalls[0].options.minConfidence, 75);
    assert.deepStrictEqual(ocrCalls[0].options.tesseractParams, {
      tessedit_pageseg_mode: 6,
      preserve_interword_spaces: '1',
    });
  });

  it('should trigger OCR for low-quality native text even above threshold', async () => {
    let usedOcrPath = false;

    const mocks = {
      './pdf/textExtractor': {
        extractText: async () => ({ text: '@@@ ### $$$ @@@ ### $$$', pageCount: 1 }),
      },
      './pdf/pageRenderer': {
        renderPagesWithCount: async () => [Buffer.from('img1')],
      },
      './pdf/ocrExtractor': {
        extractTextFromImages: async () => {
          usedOcrPath = true;
          return { text: 'Recovered OCR text', meta: { averageConfidence: 80, perPage: [] } };
        },
        extractTextFromImage: async () => ({ text: '', meta: {} }),
      },
      './ai/openaiClient': {
        extractStructuredData: async () => ({ ok: true }),
      },
    };

    module.constructor.prototype.require = function (id) {
      if (mocks[id]) {
        return mocks[id];
      }
      return originalRequire.apply(this, arguments);
    };

    delete require.cache[require.resolve('../src/extractor')];
    const { PdfAiExtractor } = require('../src/extractor');
    module.constructor.prototype.require = originalRequire;

    const extractor = new PdfAiExtractor({
      apiKey: 'test-key',
      ocrThreshold: 5,
      ocrQualityCheck: { enabled: true, minAlphanumericRatio: 0.5, maxSymbolRatio: 0.2 },
    });

    await extractor.extract({
      source: Buffer.from('%PDF-1.7 sample'),
      prompt: 'extract',
      schema: { ok: 'boolean' },
    });

    assert.strictEqual(usedOcrPath, true);
  });
});
