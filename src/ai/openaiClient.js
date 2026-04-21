'use strict';

const OpenAI = require('openai');
const { AiExtractionError } = require('../errors');

const RETRY_DELAYS = [1000, 2000, 4000];
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt(userPrompt, schema) {
  return `${userPrompt}

Expected JSON schema:
${JSON.stringify(schema, null, 2)}

Return ONLY valid JSON, no markdown, no explanations.`;
}

async function extractStructuredData(text, prompt, schema, options, logger) {
  const { apiKey, model = 'gpt-4o-mini' } = options;

  const client = new OpenAI({ apiKey });
  const systemPrompt = buildSystemPrompt(prompt, schema);

  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      logger.debug(`OpenAI request attempt ${attempt + 1}`);

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      logger.debug('OpenAI response received, parsing JSON');

      try {
        const data = JSON.parse(content);
        return data;
      } catch (parseError) {
        throw new AiExtractionError(
          `Failed to parse OpenAI response as JSON: ${parseError.message}`,
          parseError
        );
      }
    } catch (error) {
      lastError = error;

      // Don't retry if it's already an AiExtractionError (parse error)
      if (error instanceof AiExtractionError) {
        throw error;
      }

      const status = error.status || error.response?.status;
      const shouldRetry = RETRYABLE_STATUS_CODES.includes(status);

      if (!shouldRetry || attempt >= RETRY_DELAYS.length) {
        throw new AiExtractionError(
          `OpenAI extraction failed: ${error.message}`,
          error
        );
      }

      const delay = RETRY_DELAYS[attempt];
      logger.debug(`Retrying in ${delay}ms due to status ${status}`);
      await sleep(delay);
    }
  }

  throw new AiExtractionError(
    `OpenAI extraction failed after ${RETRY_DELAYS.length + 1} attempts: ${lastError?.message}`,
    lastError
  );
}

module.exports = { extractStructuredData };
