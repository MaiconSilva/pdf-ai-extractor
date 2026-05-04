'use strict';

const { createWorker } = require('tesseract.js');
const { OcrError } = require('../errors');
const { preprocessImageBuffer } = require('./preprocessImage');

function getDefaultLogger() {
  return {
    debug: () => {},
    warn: () => {},
  };
}

function normalizeOptions(loggerOrOptions) {
  if (loggerOrOptions && typeof loggerOrOptions.debug === 'function') {
    return {
      logger: loggerOrOptions,
      tesseractParams: {},
      minConfidence: 0,
      retryEnabled: false,
      preprocess: { enabled: false, profile: 'balanced', retryProfile: 'highContrast' },
      returnMeta: false,
    };
  }

  const options = loggerOrOptions || {};

  return {
    logger: options.logger || getDefaultLogger(),
    tesseractParams: options.tesseractParams || {},
    minConfidence: Number.isFinite(options.minConfidence) ? options.minConfidence : 0,
    retryEnabled: options.retryEnabled === true,
    preprocess: {
      enabled: false,
      profile: 'balanced',
      retryProfile: 'highContrast',
      ...(options.preprocess || {}),
    },
    returnMeta: options.returnMeta === true,
  };
}

async function runOcr(worker, imageBuffer, preprocessConfig, logger) {
  const buffer = preprocessConfig.enabled
    ? await preprocessImageBuffer(imageBuffer, preprocessConfig.profile)
    : imageBuffer;

  const result = await worker.recognize(buffer);
  const confidence =
    result && result.data && Number.isFinite(result.data.confidence) ? result.data.confidence : 0;

  logger.debug(`OCR confidence: ${confidence.toFixed(2)}`);

  return {
    result,
    confidence,
  };
}

async function extractTextFromImages(imageBuffers, language = 'por+eng', loggerOrOptions) {
  let worker = null;
  const options = normalizeOptions(loggerOrOptions);
  const { logger, tesseractParams, minConfidence, retryEnabled, preprocess, returnMeta } = options;

  try {
    logger.debug(`Starting OCR with language: ${language}`);

    worker = await createWorker(language);
    if (tesseractParams && Object.keys(tesseractParams).length > 0) {
      await worker.setParameters(tesseractParams);
      logger.debug(`Applied ${Object.keys(tesseractParams).length} OCR parameters`);
    }

    const texts = [];
    const confidences = [];
    const perPage = [];

    for (let i = 0; i < imageBuffers.length; i++) {
      logger.debug(`Processing image ${i + 1}/${imageBuffers.length}`);

      let { result, confidence } = await runOcr(worker, imageBuffers[i], preprocess, logger);
      let retried = false;
      let finalProfile = preprocess.enabled ? preprocess.profile : 'none';

      if (retryEnabled && minConfidence > 0 && confidence < minConfidence) {
        retried = true;
        logger.debug(
          `Confidence ${confidence.toFixed(2)} below minimum ${minConfidence}. Retrying image ${
            i + 1
          }`
        );

        const retryPreprocess = {
          ...preprocess,
          profile: preprocess.retryProfile || preprocess.profile,
        };
        const retryAttempt = await runOcr(worker, imageBuffers[i], retryPreprocess, logger);

        if (retryAttempt.confidence >= confidence) {
          result = retryAttempt.result;
          confidence = retryAttempt.confidence;
          finalProfile = preprocess.enabled ? retryPreprocess.profile : 'none';
        }
      }

      texts.push(result.data.text);
      confidences.push(confidence);
      perPage.push({
        page: i + 1,
        confidence,
        retried,
        preprocessProfile: finalProfile,
      });
    }

    const combinedText = texts.join('\n\n');
    logger.debug(`OCR complete. Extracted ${combinedText.length} characters`);

    const averageConfidence =
      confidences.length > 0
        ? confidences.reduce((acc, current) => acc + current, 0) / confidences.length
        : 0;

    const meta = {
      pages: imageBuffers.length,
      averageConfidence,
      minConfidenceObserved: confidences.length > 0 ? Math.min(...confidences) : 0,
      maxConfidenceObserved: confidences.length > 0 ? Math.max(...confidences) : 0,
      retries: perPage.filter((entry) => entry.retried).length,
      perPage,
    };

    if (returnMeta) {
      return {
        text: combinedText,
        meta,
      };
    }

    return combinedText;
  } catch (error) {
    throw new OcrError(`OCR extraction failed: ${error.message}`, error);
  } finally {
    if (worker) {
      try {
        await worker.terminate();
        logger.debug('Tesseract worker terminated');
      } catch (err) {
        logger.warn('Failed to terminate Tesseract worker:', err.message);
      }
    }
  }
}

async function extractTextFromImage(imageBuffer, language = 'por+eng', loggerOrOptions) {
  return extractTextFromImages([imageBuffer], language, loggerOrOptions);
}

module.exports = { extractTextFromImages, extractTextFromImage };
