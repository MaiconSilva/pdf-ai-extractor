'use strict';

const pdfParse = require('pdf-parse');
const { PdfReadError } = require('../errors');

async function extractText(buffer, logger) {
  try {
    logger.debug('Extracting text from PDF using pdf-parse');

    const data = await pdfParse(buffer);

    const text = data.text || '';
    const pageCount = data.numpages || 0;

    logger.debug(`Extracted ${text.length} characters from ${pageCount} pages`);

    return {
      text,
      pageCount,
    };
  } catch (error) {
    throw new PdfReadError(`Failed to extract text from PDF: ${error.message}`, error);
  }
}

module.exports = { extractText };
