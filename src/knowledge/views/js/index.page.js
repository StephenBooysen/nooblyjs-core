/**
 * @fileoverview Knowledge dashboard (feature 05): ask with streamed, cited
 * answers and rate them; sync and list sources; run evaluations and read ratings.
 * Authenticates with the session cookie. Model output and document text are
 * written with textContent, never as HTML.
 */

(function knowledgeDashboard() {
  'use strict';

  const API = '/services/knowledge/api';
  const $ = (id) => document.getElementById(id);

  /**
   * Creates an element with optional class names and text.
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @return {HTMLElement}
   */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /**
   * Shows an error in the page alert.
   * @param {string} message
   * @return {void}
   */
  function showError(message) {
    const alert = $('kbError');
    alert.textContent = message;
    alert.classList.add('show');
    clearTimeout(showError.timer);
    showError.timer = setTimeout(() => alert.classList.remove('show'), 6000);
  }

  /**
   * Calls the API with the session cookie and returns `data`.
   * @param {string} path
   * @param {Object} [init]
   * @return {Promise<*>}
   */
  async function api(path, init = {}) {
    const res = await fetch(`${API}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
    });
    let body = null;
    try { body = await res.json(); } catch (_err) { /* not JSON */ }
    if (!res.ok || (body && body.success === false)) {
      throw new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    }
    return body ? body.data : null;
  }

  const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'Never');

  // ---- Status and sources -------------------------------------------------

  async function loadStatus() {
    try {
      const s = await api('/status');
      $('kbStatFiles').textContent = s.files;
      $('kbStatChunks').textContent = s.chunks;
      $('kbStatSync').textContent = s.syncing ? 'Running…' : (s.lastSync ? when(s.lastSync.at) : 'Never');
      $('kbStatFeedback').textContent = `${s.feedback ? s.feedback.good : 0} / ${s.feedback ? s.feedback.bad : 0}`;
      const skipped = s.skipped || [];
      $('kbSkippedCard').classList.toggle('d-none', skipped.length === 0);
      const list = $('kbSkipped');
      list.replaceChildren(...skipped.map((f) => {
        const li = el('li', 'list-group-item d-flex justify-content-between gap-2');
        li.append(el('code', '', f.path), el('span', 'text-muted small', f.error));
        return li;
      }));
    } catch (err) {
      showError(err.message);
    }
  }

  async function loadSources() {
    const body = $('kbSourcesBody');
    try {
      const sources = await api('/sources');
      if (!sources.length) {
        const tr = el('tr');
        const td = el('td', 'text-muted', 'Nothing indexed yet. Sync a folder to start.');
        td.colSpan = 5;
        tr.append(td);
        body.replaceChildren(tr);
        return;
      }
      body.replaceChildren(...sources.map((s) => {
        const tr = el('tr');
        const pathCell = el('td');
        pathCell.append(el('code', 'text-break', s.path));
        tr.append(
          pathCell,
          el('td', 'text-break', s.title),
          el('td', 'text-end', s.chunks),
          el('td', 'd-none d-md-table-cell', (s.roles || []).join(', ')),
          el('td', 'd-none d-md-table-cell small text-muted', when(s.indexedAt))
        );
        return tr;
      }));
    } catch (err) {
      showError(err.message);
    }
  }

  async function sync(event) {
    event.preventDefault();
    const btn = $('kbSyncBtn');
    btn.disabled = true;
    $('kbSyncResult').textContent = 'Syncing…';
    try {
      const stats = await api('/sync', { method: 'POST', body: JSON.stringify({ directory: $('kbSyncDir').value || '/' }) });
      $('kbSyncResult').textContent = `${stats.files} files: ${stats.added} added, ${stats.changed} changed, ${stats.unchanged} unchanged, ${stats.removed} removed, ${stats.skipped || 0} skipped (${stats.chunks} chunks indexed).`;
      await Promise.all([loadStatus(), loadSources()]);
    } catch (err) {
      $('kbSyncResult').textContent = 'Sync failed.';
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Ask ----------------------------------------------------------------

  /**
   * Reads a server-sent event stream from a fetch response.
   * @param {Response} res
   * @param {function(string, Object): void} onEvent
   * @return {Promise<void>}
   */
  async function readEvents(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let name = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) {
          try { onEvent(name, JSON.parse(data)); } catch (_err) { /* ignore a malformed event */ }
        }
      }
    }
  }

  /**
   * Adds the citations list and the rating buttons under an answer.
   * @param {HTMLElement} bubble Answer element
   * @param {string} question
   * @param {Object} done The `done` event
   * @return {void}
   */
  function finishAnswer(bubble, question, done) {
    const meta = el('div', 'core-kb-meta');
    const badgeClass = done.confidence === 'cited' ? 'text-bg-success' : (done.confidence === 'low' ? 'text-bg-warning' : 'text-bg-secondary');
    const label = done.confidence === 'cited' ? 'Cited' : (done.confidence === 'low' ? 'No citation: check this answer' : 'No matching sources');
    meta.append(el('span', `badge ${badgeClass}`, label));
    bubble.append(meta);

    if (done.citations && done.citations.length) {
      const list = el('ol', 'core-kb-citations');
      for (const c of done.citations) {
        const li = el('li');
        li.value = c.n;
        const details = el('details');
        const summary = el('summary');
        summary.append(el('strong', '', c.title || c.path), el('span', 'text-muted', c.heading ? ` › ${c.heading}` : ''), el('code', 'ms-2 small', c.path));
        details.append(summary, el('p', 'small text-muted mb-1', c.snippet));
        li.append(details);
        list.append(li);
      }
      bubble.append(list);
    }

    const actions = el('div', 'core-kb-rate');
    const rate = async (rating, btn) => {
      actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await api('/feedback', {
          method: 'POST',
          body: JSON.stringify({ question, rating, answer: done.text, citations: (done.citations || []).map((c) => c.path) })
        });
        btn.classList.add('active');
        actions.append(el('span', 'small text-muted', 'Thanks, recorded.'));
        loadStatus();
      } catch (err) {
        actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        showError(err.message);
      }
    };
    const good = el('button', 'btn btn-sm btn-outline-success');
    good.type = 'button';
    good.title = 'Good answer';
    good.setAttribute('aria-label', 'Good answer');
    good.append(el('i', 'bi bi-hand-thumbs-up'));
    good.addEventListener('click', () => rate('good', good));
    const bad = el('button', 'btn btn-sm btn-outline-danger');
    bad.type = 'button';
    bad.title = 'Bad answer';
    bad.setAttribute('aria-label', 'Bad answer');
    bad.append(el('i', 'bi bi-hand-thumbs-down'));
    bad.addEventListener('click', () => rate('bad', bad));
    actions.append(good, bad);
    bubble.append(actions);
  }

  async function ask(event) {
    event.preventDefault();
    const input = $('kbQuestion');
    const question = input.value.trim();
    if (!question) return;
    const thread = $('kbThread');
    const empty = $('kbEmpty');
    if (empty) empty.remove();
    thread.append(el('div', 'core-kb-msg user', question));
    const bubble = el('div', 'core-kb-msg answer');
    const text = el('div', 'core-kb-text', '');
    const sourcesLine = el('div', 'core-kb-meta small text-muted', 'Searching…');
    bubble.append(sourcesLine, text);
    thread.append(bubble);
    bubble.scrollIntoView({ block: 'nearest' });
    input.value = '';
    $('kbAskBtn').disabled = true;

    try {
      const res = await fetch(`${API}/ask/stream`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ question })
      });
      if (!res.ok || !res.body) {
        let message = `Request failed (${res.status})`;
        try { const b = await res.json(); message = b.message || b.error || message; } catch (_err) { /* not JSON */ }
        throw new Error(message);
      }
      let finished = false;
      await readEvents(res, (name, data) => {
        if (name === 'sources') {
          const n = (data.sources || []).length;
          sourcesLine.textContent = n ? `${n} source${n === 1 ? '' : 's'} found` : 'No matching sources';
        } else if (name === 'text') {
          text.textContent += data.text || '';
        } else if (name === 'done') {
          finished = true;
          text.textContent = data.text || text.textContent;
          finishAnswer(bubble, question, data);
        } else if (name === 'error') {
          finished = true;
          bubble.append(el('div', 'text-danger small', data.message || 'The answer could not be generated.'));
        }
      });
      if (!finished) bubble.append(el('div', 'text-danger small', 'The answer stopped before it finished.'));
    } catch (err) {
      bubble.append(el('div', 'text-danger small', 'The answer could not be generated.'));
      showError(err.message);
    } finally {
      $('kbAskBtn').disabled = false;
      input.focus();
    }
  }

  // ---- Quality ------------------------------------------------------------

  async function loadFeedback() {
    const list = $('kbFeedbackList');
    try {
      const rating = $('kbFeedbackFilter').value;
      const data = await api(`/feedback?limit=100${rating ? `&rating=${rating}` : ''}`);
      if (!data.items.length) {
        list.replaceChildren(el('li', 'list-group-item text-muted', 'No ratings yet.'));
        return;
      }
      list.replaceChildren(...data.items.map((f) => {
        const li = el('li', 'list-group-item');
        const head = el('div', 'd-flex justify-content-between gap-2');
        head.append(
          el('strong', 'text-break', f.question),
          el('span', `badge ${f.rating === 'good' ? 'text-bg-success' : 'text-bg-danger'}`, f.rating)
        );
        li.append(head);
        if (f.citations.length) li.append(el('div', 'small text-muted text-break', `Cited: ${f.citations.join(', ')}`));
        li.append(el('div', 'small text-muted', `${when(f.at)}${f.user ? ` · ${f.user}` : ''}`));
        return li;
      }));
    } catch (err) {
      // Reading ratings needs knowledge:write; a reader just sees none.
      list.replaceChildren(el('li', 'list-group-item text-muted', 'Ratings are not available to you.'));
    }
  }

  async function evaluate(body) {
    const btn = $('kbEvalBtn');
    btn.disabled = true;
    try {
      const answers = $('kbEvalAnswers').checked;
      const report = await api('/evaluate', { method: 'POST', body: JSON.stringify({ ...body, answers }) });
      $('kbEvalReport').classList.remove('d-none');
      const chips = [
        `${report.cases} questions`,
        `Recall@k ${(report.recallAtK * 100).toFixed(0)}%`,
        `MRR ${report.meanReciprocalRank.toFixed(2)}`
      ];
      if (typeof report.citationAccuracy === 'number') chips.push(`Cites expected ${(report.citationAccuracy * 100).toFixed(0)}%`);
      $('kbEvalSummary').replaceChildren(...chips.map((c) => el('span', 'core-chip', c)));
      const cited = new Map((report.answerResults || []).map((r) => [r.question, r.cited]));
      $('kbEvalCitedHead').classList.toggle('d-none', !answers);
      $('kbEvalBody').replaceChildren(...report.results.map((r) => {
        const tr = el('tr');
        const exp = el('td');
        exp.append(el('code', 'text-break', r.expectedPath));
        const citedCell = el('td', `text-end${answers ? '' : ' d-none'}`, cited.has(r.question) ? (cited.get(r.question) ? 'Yes' : 'No') : '');
        tr.append(el('td', 'text-break', r.question), exp, el('td', `text-end ${r.hit ? '' : 'text-danger'}`, r.rank || 'Missed'), citedCell);
        return tr;
      }));
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Wiring -------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {
    if (window.NooblyJSNavigation) window.NooblyJSNavigation.renderNavigation('navigation-sidebar', 'knowledge');
    $('kbAskForm').addEventListener('submit', ask);
    $('kbSyncForm').addEventListener('submit', sync);
    $('kbRefreshSources').addEventListener('click', () => { loadStatus(); loadSources(); });
    $('kbFeedbackFilter').addEventListener('change', loadFeedback);
    $('kbEvalBtn').addEventListener('click', () => evaluate({ yaml: $('kbEvalYaml').value }));
    $('kbEvalFeedbackBtn').addEventListener('click', () => evaluate({ fromFeedback: true }));
    $('sources-tab').addEventListener('shown.bs.tab', loadSources);
    $('quality-tab').addEventListener('shown.bs.tab', loadFeedback);
    loadStatus();
  });
})();
