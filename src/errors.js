'use strict';

class PdfReadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PdfReadError';
    this.cause = cause;
  }
}

class OcrError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'OcrError';
    this.cause = cause;
  }
}

class AiExtractionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AiExtractionError';
    this.cause = cause;
  }
}

class InvalidInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

module.exports = {
  PdfReadError,
  OcrError,
  AiExtractionError,
  InvalidInputError,
};
