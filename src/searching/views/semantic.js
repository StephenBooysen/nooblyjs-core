/**
 * @fileoverview Semantic tab of the searching dashboard (feature 01).
 * Shows the embedding backend, applies pending embeddings and runs semantic,
 * hybrid or keyword queries. Text from the server is written with textContent.
 */
(function () {
  'use strict';

  var API = '/services/searching/api/semantic';
  var form = document.getElementById('semantic-form');
  if (!form) return;
  var statusBox = document.getElementById('semantic-status');
  var results = document.getElementById('semantic-results');
  var message = document.getElementById('semantic-message');
  var queryInput = document.getElementById('semantic-query');
  var modeSelect = document.getElementById('semantic-mode');
  var kInput = document.getElementById('semantic-k');
  var flushButton = document.getElementById('semantic-flush');

  function showError(text) {
    message.textContent = text;
    message.classList.remove('d-none');
  }

  function clearError() {
    message.textContent = '';
    message.classList.add('d-none');
  }

  function setField(name, value) {
    var node = statusBox.querySelector('[data-field="' + name + '"]');
    if (node) node.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  }

  function readError(res) {
    return res.json().then(function (body) { return body.error || ('HTTP ' + res.status); }, function () { return 'HTTP ' + res.status; });
  }

  function loadStatus() {
    return fetch(API + '/status', { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 409) {
        setField('enabled', 'Not enabled (keyword-only provider)');
        return null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (s) {
      if (!s) return;
      setField('enabled', s.enabled ? 'Enabled' : 'Disabled');
      setField('backend', s.backend);
      setField('model', s.model);
      setField('dimensions', s.dimensions);
      setField('pendingEmbeddings', s.pendingEmbeddings);
      setField('lastEmbedError', s.lastEmbedError && (s.lastEmbedError.message || s.lastEmbedError));
    }).catch(function (err) {
      setField('enabled', 'Could not load status (' + err.message + ')');
    });
  }

  function renderResults(hits, query) {
    results.textContent = '';
    if (!hits.length) {
      var empty = document.createElement('li');
      empty.className = 'text-muted';
      empty.textContent = 'No results for “' + query + '”.';
      results.appendChild(empty);
      return;
    }
    hits.forEach(function (hit) {
      var item = document.createElement('li');
      item.className = 'border-bottom py-2';
      var title = document.createElement('div');
      title.className = 'fw-semibold';
      title.textContent = hit.title || hit.id;
      item.appendChild(title);
      var meta = document.createElement('div');
      meta.className = 'small text-muted';
      var parts = ['id ' + hit.id];
      if (typeof hit.score === 'number') parts.push('score ' + hit.score.toFixed(3));
      if (hit.matchedBy) parts.push('matched by ' + hit.matchedBy);
      meta.textContent = parts.join(' · ');
      item.appendChild(meta);
      results.appendChild(item);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearError();
    var query = queryInput.value.trim();
    if (!query) return;
    var k = Math.min(200, Math.max(1, parseInt(kInput.value, 10) || 10));
    fetch(API + '/search', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, mode: modeSelect.value, k: k })
    }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw new Error(err); });
      return res.json();
    }).then(function (body) {
      renderResults(body.results || [], query);
    }).catch(function (err) {
      showError('Search failed: ' + err.message);
    });
  });

  flushButton.addEventListener('click', function () {
    clearError();
    flushButton.disabled = true;
    fetch(API + '/flush', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (res) {
      if (!res.ok) return readError(res).then(function (err) { throw new Error(err); });
      return loadStatus();
    }).catch(function (err) {
      showError('Could not apply embeddings: ' + err.message);
    }).then(function () {
      flushButton.disabled = false;
    });
  });

  var tab = document.getElementById('semantic-tab');
  if (tab) tab.addEventListener('shown.bs.tab', loadStatus);
  loadStatus();
})();
