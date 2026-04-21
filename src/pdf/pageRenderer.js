'use strict';

const { fromBuffer } = require('pdf2pic');
const { PdfReadError } = require('../errors');

async function renderPages(buffer, options = {}, logger) {
  const {
    density = 150,
    format = 'png',
    width = 1200,
    height = 1600,
  } = options;

  try {
    logger.debug('Converting PDF pages to images');

    const converter = fromBuffer(buffer, {
      density,
      format,
      width,
      height,
      saveFilename: 'page',
      savePath: '/tmp',
    });

    // Get page count first by converting page 1
    const firstPage = await converter(1, { responseType: 'buffer' });

    if (!firstPage || !firstPage.buffer) {
      throw new Error('Failed to render first page');
    }

    const images = [firstPage.buffer];

    // Try to get more pages
    let pageNum = 2;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        const page = await converter(pageNum, { responseType: 'buffer' });
        if (page && page.buffer) {
          images.push(page.buffer);
          pageNum++;
        } else {
          hasMorePages = false;
        }
      } catch (err) {
        // No more pages or error
        hasMorePages = false;
      }
    }

    logger.debug(`Rendered ${images.length} pages to images`);
    return images;
  } catch (error) {
    throw new PdfReadError(`Failed to render PDF pages to images: ${error.message}`, error);
  }
}

async function renderPagesWithCount(buffer, pageCount, options = {}, logger) {
  const {
    density = 150,
    format = 'png',
    width = 1200,
    height = 1600,
  } = options;

  try {
    logger.debug(`Converting ${pageCount} PDF pages to images`);

    const converter = fromBuffer(buffer, {
      density,
      format,
      width,
      height,
      saveFilename: 'page',
      savePath: '/tmp',
    });

    const images = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await converter(i, { responseType: 'buffer' });
      if (page && page.buffer) {
        images.push(page.buffer);
      }
    }

    logger.debug(`Rendered ${images.length} pages to images`);
    return images;
  } catch (error) {
    throw new PdfReadError(`Failed to render PDF pages to images: ${error.message}`, error);
  }
}

module.exports = { renderPages, renderPagesWithCount };
