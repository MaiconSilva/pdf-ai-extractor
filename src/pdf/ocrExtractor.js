'use strict';

const { createWorker } = require('tesseract.js');
const { OcrError } = require('../errors');

async function extractTextFromImages(imageBuffers, language = 'por+eng', logger) {
  let worker = null;

  try {
    logger.debug(`Starting OCR with language: ${language}`);

    worker = await createWorker(language);

    const texts = [];

    for (let i = 0; i < imageBuffers.length; i++) {
      logger.debug(`Processing image ${i + 1}/${imageBuffers.length}`);

      const result = await worker.recognize(imageBuffers[i]);
      texts.push(result.data.text);
    }

    const combinedText = texts.join('\n\n');
    logger.debug(`OCR complete. Extracted ${combinedText.length} characters`);

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

async function extractTextFromImage(imageBuffer, language = 'por+eng', logger) {
  return extractTextFromImages([imageBuffer], language, logger);
}

module.exports = { extractTextFromImages, extractTextFromImage };
