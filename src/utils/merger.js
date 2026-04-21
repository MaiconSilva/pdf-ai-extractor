'use strict';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeResults(results, schema) {
  if (!results || results.length === 0) {
    return {};
  }

  if (results.length === 1) {
    return results[0];
  }

  return mergeBySchema(results, schema);
}

function mergeBySchema(results, schema) {
  const merged = {};

  for (const key of Object.keys(schema)) {
    const schemaValue = schema[key];
    const values = results.map((r) => r[key]).filter((v) => v !== undefined && v !== null);

    if (values.length === 0) {
      merged[key] = null;
      continue;
    }

    // Determine how to merge based on schema type or actual values
    if (Array.isArray(schemaValue) || schemaValue === 'array') {
      // Concatenate arrays
      merged[key] = values.reduce((acc, val) => {
        if (Array.isArray(val)) {
          return acc.concat(val);
        }
        return acc;
      }, []);
    } else if (isObject(schemaValue)) {
      // Recursive merge for nested objects
      const objectValues = values.filter(isObject);
      if (objectValues.length > 0) {
        merged[key] = mergeBySchema(objectValues, schemaValue);
      } else {
        merged[key] = values[0];
      }
    } else {
      // Scalar: first non-null value wins
      merged[key] = values[0];
    }
  }

  return merged;
}

function mergeResultsSimple(results) {
  if (!results || results.length === 0) {
    return {};
  }

  if (results.length === 1) {
    return results[0];
  }

  const merged = {};
  const allKeys = new Set();

  // Collect all keys from all results
  for (const result of results) {
    for (const key of Object.keys(result)) {
      allKeys.add(key);
    }
  }

  for (const key of allKeys) {
    const values = results.map((r) => r[key]).filter((v) => v !== undefined && v !== null);

    if (values.length === 0) {
      merged[key] = null;
      continue;
    }

    // Check if values are arrays
    const hasArrays = values.some(Array.isArray);
    if (hasArrays) {
      merged[key] = values.reduce((acc, val) => {
        if (Array.isArray(val)) {
          return acc.concat(val);
        }
        return acc;
      }, []);
    } else if (values.every(isObject)) {
      // All values are objects, merge recursively
      merged[key] = mergeResultsSimple(values);
    } else {
      // Scalar: first non-null value wins
      merged[key] = values[0];
    }
  }

  return merged;
}

module.exports = { mergeResults, mergeResultsSimple };
