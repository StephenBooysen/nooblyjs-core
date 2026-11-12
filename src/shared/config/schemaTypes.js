/**
 * @fileoverview Shorthand JSON Schema fragments for `options.schema.js` files
 * (feature 08). Numbers and booleans also accept their string forms, because
 * options are often read from environment variables.
 *
 * @module shared/config/schemaTypes
 */

'use strict';

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: ['number', 'string'], pattern: '^-?\\d+(\\.\\d+)?$', description });
const bool = (description) => ({ type: ['boolean', 'string'], pattern: '^(true|false)$', description });
const obj = (description) => ({ type: 'object', description });
const arr = (description) => ({ type: 'array', description });
const strOrArr = (description) => ({ type: ['string', 'array'], description });
const any = (description) => ({ description });

/** Options shared by every `*Api` provider (proxies to a remote instance). */
const apiProvider = {
  properties: {
    api: str('Base URL of the remote NooblyJS instance'),
    apiRoot: str('Same as api (older name)'),
    apiUrl: str('Same as api (filing)'),
    apiKey: str('API key for the remote instance'),
    timeout: num('Request timeout in ms'),
    retryLimit: num('Retries on failure')
  }
};

module.exports = { str, num, bool, obj, arr, strOrArr, any, apiProvider };
