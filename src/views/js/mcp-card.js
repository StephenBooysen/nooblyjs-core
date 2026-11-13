/**
 * @fileoverview MCP card on the services dashboard (feature 03). Shows whether
 * the MCP endpoint is on, how many tools it offers, and whether write tools are
 * enabled. Reads only the counts from /services/api/mcp/status.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */
(function () {
  'use strict';

  const container = document.getElementById('mcp-card');
  if (!container) return;

  /**
   * Escapes text for safe insertion into the card.
   * @param {*} value
   * @return {string}
   */
  function text(value) {
    const span = document.createElement('span');
    span.textContent = String(value);
    return span.innerHTML;
  }

  /**
   * Renders the card from the status payload.
   * @param {{enabled: boolean, endpoint: ?string, readTools: number, writeTools: number, writeEnabled: boolean}} data
   */
  function render(data) {
    const state = data.enabled
      ? '<span class="badge bg-success">On</span>'
      : '<span class="badge bg-secondary">Off</span>';
    const writes = data.writeEnabled
      ? `${text(data.writeTools)} write tools enabled`
      : 'Write tools disabled';
    const endpoint = data.enabled
      ? `<code>${text(data.endpoint)}</code>`
      : 'Set <code>mcp.enabled</code> in the app to turn it on';
    container.innerHTML = `
      <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span><i class="bi bi-plug"></i> MCP server for coding agents</span>
          ${state}
        </div>
        <div class="card-body">
          <p class="mb-1">${endpoint}</p>
          <p class="mb-0 text-muted small">${text(data.readTools)} read tools, ${writes}.</p>
        </div>
      </div>`;
  }

  fetch('/services/api/mcp/status', { credentials: 'same-origin' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((body) => render(body.data))
    .catch(() => {
      container.innerHTML = '<div class="alert alert-warning mb-0">The MCP status could not be loaded.</div>';
    });
})();
