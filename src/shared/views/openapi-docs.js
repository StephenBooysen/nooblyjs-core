/**
 * @fileoverview Browser script for the API reference page (feature 10).
 * Loads /services/api/openapi.json and lists operations grouped by tag.
 * Text from the document is written with textContent, never as HTML.
 */
(function () {
  'use strict';

  var list = document.getElementById('api-list');
  var status = document.getElementById('api-status');
  var filter = document.getElementById('api-filter');
  var operations = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function render(query) {
    list.textContent = '';
    var q = (query || '').toLowerCase();
    var groups = {};
    operations.forEach(function (op) {
      var haystack = (op.method + ' ' + op.path + ' ' + (op.summary || '') + ' ' + op.tag).toLowerCase();
      if (q && haystack.indexOf(q) === -1) return;
      (groups[op.tag] = groups[op.tag] || []).push(op);
    });
    var tags = Object.keys(groups).sort();
    if (tags.length === 0) {
      list.appendChild(el('p', 'text-muted', 'No operations match.'));
      return;
    }
    tags.forEach(function (tag) {
      var section = el('section', 'mb-4');
      section.appendChild(el('h2', 'h5', tag));
      groups[tag].forEach(function (op) {
        var details = el('details', 'api-op border rounded p-2 mb-2');
        var summary = el('summary', 'd-flex gap-2 align-items-center');
        summary.appendChild(el('span', 'badge text-bg-secondary text-uppercase', op.method));
        summary.appendChild(el('code', '', op.path));
        if (op.summary) summary.appendChild(el('span', 'text-muted small', op.summary));
        details.appendChild(summary);
        if (op.description) details.appendChild(el('p', 'small mt-2', op.description));
        if (op.parameters && op.parameters.length) {
          var ul = el('ul', 'small');
          op.parameters.forEach(function (p) {
            ul.appendChild(el('li', '', p.in + ' · ' + p.name + (p.required ? ' (required)' : '')));
          });
          details.appendChild(ul);
        }
        details.appendChild(el('div', 'small text-muted', 'operationId: ' + (op.operationId || '—') + (op.generated ? ' · no description yet' : '')));
        section.appendChild(details);
      });
      list.appendChild(section);
    });
  }

  fetch('/services/api/openapi.json', { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (doc) {
      var paths = doc.paths || {};
      Object.keys(paths).forEach(function (path) {
        Object.keys(paths[path]).forEach(function (method) {
          var op = paths[path][method];
          operations.push({
            method: method,
            path: path,
            tag: (op.tags && op.tags[0]) || 'other',
            summary: op.summary,
            description: op.description,
            parameters: op.parameters,
            operationId: op.operationId,
            generated: op['x-generated'] === true
          });
        });
      });
      status.textContent = operations.length + ' operations · OpenAPI ' + doc.openapi;
      render(filter.value);
    })
    .catch(function (err) {
      status.textContent = 'Could not load the API document (' + err.message + ').';
    });

  filter.addEventListener('input', function () { render(filter.value); });
})();
