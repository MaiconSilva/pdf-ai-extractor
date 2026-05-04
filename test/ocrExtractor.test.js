'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const originalRequire = module.constructor.prototype.require;

describe('ocrExtractor', () => {
  it('should apply tesseract params and retry low-confidence pages', async () => {
    const recognizeInputs = [];
    let setParametersPayload = null;
    let terminateCalled = false;
    const preprocessProfiles = [];
    let recognizeCallCount = 0;

    const worker = {
      setParameters: async (params) => {
        setParametersPayload = params;
      },
      recognize: async (buffer) => {
        recognizeInputs.push(buffer.toString());
        recognizeCallCount += 1;

        if (recognizeCallCount === 1) {
          return {
            data: {
              text: 'low-confidence',
              confidence: 45,
            },
          };
        }

        return {
          data: {
            text: 'high-confidence',
            confidence: 92,
          },
        };
      },
      terminate: async () => {
        terminateCalled = true;
      },
    };

    module.constructor.prototype.require = function (id) {
      if (id === 'tesseract.js') {
        return {
          createWorker: async () => worker,
        };
      }

      if (id === './preprocessImage') {
        return {
          preprocessImageBuffer: async (buffer, profile) => {
            preprocessProfiles.push(profile);
            return Buffer.from(`${buffer.toString()}::${profile}`);
          },
        };
      }

      return originalRequire.apply(this, arguments);
    };

    delete require.cache[require.resolve('../src/pdf/ocrExtractor')];
    const { extractTextFromImage } = require('../src/pdf/ocrExtractor');
    module.constructor.prototype.require = originalRequire;

    const logger = {
      debug: () => {},
      warn: () => {},
    };

    const result = await extractTextFromImage(Buffer.from('img-buffer'), 'por', {
      logger,
      tesseractParams: { tessedit_pageseg_mode: 6, preserve_interword_spaces: '1' },
      minConfidence: 80,
      retryEnabled: true,
      preprocess: { enabled: true, profile: 'balanced', retryProfile: 'highContrast' },
      returnMeta: true,
    });

    assert.strictEqual(result.text, 'high-confidence');
    assert.strictEqual(result.meta.retries, 1);
    assert.strictEqual(result.meta.perPage[0].retried, true);
    assert.strictEqual(result.meta.perPage[0].preprocessProfile, 'highContrast');
    assert.deepStrictEqual(preprocessProfiles, ['balanced', 'highContrast']);
    assert.deepStrictEqual(setParametersPayload, {
      tessedit_pageseg_mode: 6,
      preserve_interword_spaces: '1',
    });
    assert.strictEqual(terminateCalled, true);
    assert.strictEqual(recognizeInputs.length, 2);
    assert.ok(recognizeInputs[0].includes('balanced'));
    assert.ok(recognizeInputs[1].includes('highContrast'));
  });
});
