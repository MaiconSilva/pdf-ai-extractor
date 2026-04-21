# @opemcode/pdf-ai-extractor

Extract structured JSON from PDFs and images using OpenAI, with OCR fallback via Tesseract.js.

## Installation

```bash
npm install @opemcode/pdf-ai-extractor
```

### System Requirements

**IMPORTANT:** This package requires GraphicsMagick and Ghostscript to be installed on your system for PDF to image conversion (used when OCR is needed).

#### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install graphicsmagick ghostscript
```

#### macOS

```bash
brew install graphicsmagick ghostscript
```

#### Docker

```dockerfile
FROM node:18

RUN apt-get update && apt-get install -y \
    graphicsmagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
```

#### Windows

Download and install:
- [GraphicsMagick](http://www.graphicsmagick.org/download.html)
- [Ghostscript](https://www.ghostscript.com/download/gsdnld.html)

## Usage

```javascript
const { PdfAiExtractor } = require('@opemcode/pdf-ai-extractor');

const extractor = new PdfAiExtractor({
  apiKey: process.env.OPENAI_API_KEY,
});

const { data, meta } = await extractor.extract({
  source: './invoice.pdf',
  prompt: 'Extract invoice data from this document',
  schema: {
    numero: 'string',
    valor: 'number',
    data_emissao: 'string',
    emissor: {
      cnpj: 'string',
      razao_social: 'string',
    },
    itens: [
      {
        descricao: 'string',
        quantidade: 'number',
        valor_unitario: 'number',
      },
    ],
  },
});

console.log(data);
// {
//   numero: '12345',
//   valor: 1500.00,
//   data_emissao: '2024-01-15',
//   emissor: {
//     cnpj: '12.345.678/0001-90',
//     razao_social: 'Company Name Ltda'
//   },
//   itens: [
//     { descricao: 'Product A', quantidade: 2, valor_unitario: 500.00 },
//     { descricao: 'Product B', quantidade: 1, valor_unitario: 500.00 }
//   ]
// }

console.log(meta);
// { pages: 1, usedOcr: false, chunks: 1, fileType: 'pdf' }
```

### Using a Buffer

```javascript
const fs = require('fs');

const buffer = fs.readFileSync('./document.pdf');

const { data } = await extractor.extract({
  source: buffer,
  prompt: 'Extract the main content',
  schema: { title: 'string', content: 'string' },
});
```

### Processing Images

```javascript
const { data } = await extractor.extract({
  source: './receipt.png', // Supports: .png, .jpg, .jpeg, .webp
  prompt: 'Extract receipt information',
  schema: {
    store: 'string',
    total: 'number',
    date: 'string',
  },
});
```

## Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | OpenAI API key |
| `model` | `string` | `'gpt-4o-mini'` | OpenAI model to use |
| `ocrLanguage` | `string` | `'por+eng'` | Tesseract language codes (e.g., `'eng'`, `'por+eng'`, `'deu'`) |
| `ocrThreshold` | `number` | `50` | Minimum characters from native PDF extraction before triggering OCR |
| `maxTokensPerChunk` | `number` | `8000` | Maximum tokens per chunk when splitting large documents |
| `debug` | `boolean` | `false` | Enable debug logging |

## Extract Method Options

| Option | Type | Description |
|--------|------|-------------|
| `source` | `string \| Buffer` | File path or Buffer containing PDF/image data |
| `prompt` | `string` | Instructions for the AI on what to extract |
| `schema` | `object` | JSON schema describing the expected output structure |

## Return Value

```javascript
{
  data: { ... },  // Extracted data matching your schema
  meta: {
    pages: number,      // Number of pages (1 for images)
    usedOcr: boolean,   // Whether OCR was used
    chunks: number,     // Number of chunks processed
    fileType: string,   // 'pdf' or 'image'
  }
}
```

## Error Handling

The package exports custom error classes for specific failure scenarios:

```javascript
const {
  PdfAiExtractor,
  InvalidInputError,
  PdfReadError,
  OcrError,
  AiExtractionError,
} = require('@opemcode/pdf-ai-extractor');

try {
  const { data } = await extractor.extract({ ... });
} catch (error) {
  if (error instanceof InvalidInputError) {
    // Missing or invalid input parameters
    console.error('Invalid input:', error.message);
  } else if (error instanceof PdfReadError) {
    // Failed to read or parse PDF file
    console.error('PDF read error:', error.message);
  } else if (error instanceof OcrError) {
    // OCR processing failed
    console.error('OCR error:', error.message);
  } else if (error instanceof AiExtractionError) {
    // OpenAI API error or invalid response
    console.error('AI extraction error:', error.message);
  }
}
```

| Error | When |
|-------|------|
| `InvalidInputError` | Missing `apiKey`, `source`, `prompt`, or `schema`; file not found; invalid source type |
| `PdfReadError` | Failed to parse PDF or convert PDF pages to images |
| `OcrError` | Tesseract OCR processing failed |
| `AiExtractionError` | OpenAI API error, rate limit exceeded (after retries), or invalid JSON response |

## How It Works

1. **File Type Detection**: Checks magic bytes (`%PDF`) to determine if input is PDF or image
2. **Text Extraction**: For PDFs, attempts native text extraction using `pdf-parse`
3. **OCR Fallback**: If native text is below `ocrThreshold`, converts PDF pages to images and runs OCR
4. **Image Processing**: For images, runs OCR directly using Tesseract.js
5. **Chunking**: If text exceeds `maxTokensPerChunk`, splits by paragraphs
6. **AI Processing**: Sends each chunk to OpenAI with your prompt and schema
7. **Result Merging**: Combines chunk results (arrays concatenated, scalars use first value)

## Cost Considerations

- **OpenAI API**: Charges per token. Large documents with many chunks will incur higher costs.
- **OCR Performance**: Tesseract.js is CPU-intensive. Processing large PDFs with many pages can be slow.
- **Recommendation**: For production use with high volume, consider:
  - Setting appropriate `ocrThreshold` to minimize unnecessary OCR
  - Using smaller models like `gpt-4o-mini` when possible
  - Pre-processing PDFs to ensure they have searchable text

## License

MIT
