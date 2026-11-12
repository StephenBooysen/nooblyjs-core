/**
 * @fileoverview Dashboard script for the knowledge service (feature 05).
 * Lists sources, runs incremental sync, asks questions and shows the cited
 * passages. Everything from the server is written with textContent.
 */
(function () {
  'use strict';

  var API = '/services/knowledge/api';
  var message = document.getElementById('knowledge-message');
  var answerBox = document.getElementById('knowledge-answer');
  var citationsBox = document.getElementById('knowledge-citations');
  var sourcesBody = document.getElementById('knowledge-sources');
  var form = document.getElementById('knowledge-form');
  var question = document.getElementById('knowledge-question');
  var askButton = document.getElementById('knowledge-ask');
  var syncButton = document.getElementById('knowledge-sync');

  function showError(text) {
    message.textContent = text;
    message.classList.remove('d-none');
  }

  function clearError() {
    message.textContent = '';
    message.classList.add('d-none');
  }

  function readJson(res) {
    return res.json().then(function (body) {
      if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
      return body;
    }, function () {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return null;
    });
  }

  function setField(name, value) {
    var node = document.querySelector('[data-field="' + name + '"]');
    if (node) node.textContent = value === null || value === undefined ? '—' : String(value);
  }

  function loadStatus() {
    return fetch(API + '/status', { credentials: 'same-origin' }).then(readJson).then(function (s) {
      setField('documents', s.documents);
      setField('chunks', s.chunks);
      setField('lastSync', s.lastSync ? new Date(s.lastSync).toLocaleString() : 'Never');
      setField('answers', s.answers ? 'Configured' : 'Not configured');
    });
  }

  function loadSources() {
    return fetch(API + '/sources', { credentials: 'same-origin' }).then(readJson).then(function (body) {
      sourcesBody.textContent = '';
      body.sources.forEach(function (source) {
        var row = document.createElement('tr');
        var path = document.createElement('td');
        path.className = 'text-break';
        path.textContent = source.path;
        var title = document.createElement('td');
        title.textContent = source.title;
        var chunks = document.createElement('td');
        chunks.className = 'text-end';
        chunks.textContent = String(source.chunks);
        row.appendChild(path);
        row.appendChild(title);
        row.appendChild(chunks);
        sourcesBody.appendChild(row);
      });
      if (!body.sources.length) {
        var empty = document.createElement('tr');
        var cell = document.createElement('td');
        cell.colSpan = 3;
        cell.className = 'text-muted';
        cell.textContent = 'No sources yet. Run a sync.';
        empty.appendChild(cell);
        sourcesBody.appendChild(empty);
      }
    });
  }

  function refresh() {
    return Promise.all([loadStatus(), loadSources()]).catch(function (err) {
      showError('Could not load the knowledge base: ' + err.message);
    });
  }

  function renderCitations(citations) {
    citationsBox.textContent = '';
    if (!citations.length) return;
    var heading = document.createElement('h2');
    heading.className = 'h6';
    heading.textContent = 'Sources';
    citationsBox.appendChild(heading);
    citations.forEach(function (c) {
      var details = document.createElement('details');
      details.className = 'border rounded p-2 mb-2';
      var summary = document.createElement('summary');
      summary.textContent = '[' + c.n + '] ' + c.title + (c.heading ? ' — ' + c.heading : '') + ' (' + c.path + ')';
      details.appendChild(summary);
      var passage = document.createElement('p');
      passage.className = 'small mt-2 mb-0';
      passage.textContent = c.snippet;
      details.appendChild(passage);
      citationsBox.appendChild(details);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearError();
    var text = question.value.trim();
    if (!text) return;
    askButton.disabled = true;
    answerBox.textContent = 'Thinking…';
    citationsBox.textContent = '';
    fetch(API + '/ask', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: text })
    }).then(readJson).then(function (body) {
      answerBox.textContent = body.text;
      if (body.confidence === 'low') {
        var note = document.createElement('div');
        note.className = 'small text-warning mt-1';
        note.textContent = 'Low confidence: the answer cites no source. Check it against the documents.';
        answerBox.appendChild(note);
      }
      renderCitations(body.citations || []);
    }).catch(function (err) {
      answerBox.textContent = '';
      showError('Could not answer: ' + err.message);
    }).then(function () {
      askButton.disabled = false;
    });
  });

  syncButton.addEventListener('click', function () {
    clearError();
    syncButton.disabled = true;
    fetch(API + '/sync', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(readJson).then(refresh).catch(function (err) {
      showError('Sync failed: ' + err.message);
    }).then(function () {
      syncButton.disabled = false;
    });
  });

  refresh();
})();
