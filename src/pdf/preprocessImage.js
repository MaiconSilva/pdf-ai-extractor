'use strict';

const sharp = require('sharp');

async function preprocessImageBuffer(imageBuffer, profile = 'balanced') {
  const pipeline = sharp(imageBuffer, { failOn: 'none' }).grayscale();

  if (profile === 'highContrast') {
    return pipeline
      .normalise()
      .sharpen({ sigma: 1.2, m1: 0.8, m2: 2.2 })
      .threshold(165, { grayscale: true })
      .toBuffer();
  }

  if (profile === 'clean') {
    return pipeline
      .normalise()
      .median(1)
      .threshold(150, { grayscale: true })
      .toBuffer();
  }

  return pipeline
    .normalise()
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 1.5 })
    .toBuffer();
}

module.exports = {
  preprocessImageBuffer,
};
