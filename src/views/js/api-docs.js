/**
 * @fileoverview Renders the merged OpenAPI document (feature 10) with Swagger UI.
 * Loaded from a file, so the page works under the strict script policy.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */
(function () {
  'use strict';

  const status = document.getElementById('docs-status');

  /**
   * Shows an error message instead of the spinner text.
   * @param {string} text
   */
  function showError(text) {
    status.textContent = text;
  }

  if (typeof SwaggerUIBundle !== 'function') {
    showError('Swagger UI could not be loaded. Check the network connection and try again.');
    return;
  }

  fetch('/services/api/openapi.json', { credentials: 'same-origin' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((spec) => {
      status.hidden = true;
      SwaggerUIBundle({
        spec,
        domNode: document.getElementById('swagger-ui'),
        deepLinking: true,
        tryItOutEnabled: false
      });
    })
    .catch((err) => {
      showError(`The API description could not be loaded (${err.message}).`);
    });
})();
