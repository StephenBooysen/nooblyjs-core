/**
 * @fileoverview Feature flags panel for the settings dashboard (feature 13).
 * Shows every flag with its state, rollout, variants, the last time it was
 * evaluated in this process, and its age. A flag counts as stale when it has
 * not been evaluated for the chosen number of days (or never has). Rows are
 * built with DOM APIs, never innerHTML.
 *
 * Evaluation times are kept in memory, so they start again after a restart.
 *
 * @author NooblyJS Team
 * @since 1.2.0
 */
(function () {
  'use strict';

  const API = '/services/settings/api/flags';
  const DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Creates an element with text content.
   * @param {string} tag
   * @param {Object=} attrs
   * @param {Array<Node|string>=} children
   * @return {HTMLElement}
   */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    for (const child of children) node.append(child);
    return node;
  }

  /**
   * Human-readable age of a timestamp.
   * @param {?string} iso
   * @param {number} now
   * @return {string}
   */
  function ageText(iso, now) {
    if (!iso) return 'never (since restart)';
    const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
    if (days <= 0) return 'today';
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  /**
   * Whether a flag is stale: never evaluated, or last evaluated before the cut-off.
   * @param {?string} lastEvaluatedAt
   * @param {number} staleDays
   * @param {number} now
   * @return {boolean}
   */
  function isStale(lastEvaluatedAt, staleDays, now) {
    if (!lastEvaluatedAt) return true;
    return now - Date.parse(lastEvaluatedAt) > staleDays * DAY_MS;
  }

  function staleDaysValue() {
    const input = document.getElementById('flagsStaleDays');
    const days = Number(input && input.value);
    return Number.isFinite(days) && days > 0 ? days : 30;
  }

  function setAlert(message, kind = 'danger') {
    const box = document.getElementById('flagsAlert');
    if (!box) return;
    box.className = `alert alert-${kind} fade show`;
    box.textContent = message;
  }

  function renderSummary(flags, staleDays, now) {
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = String(value);
    };
    set('flagsTotal', flags.length);
    set('flagsEnabled', flags.filter((f) => f.enabled).length);
    set('flagsStale', flags.filter((f) => isStale(f.lastEvaluatedAt, staleDays, now)).length);
  }

  function renderRows(flags, staleDays, onlyStale, now) {
    const tbody = document.getElementById('flagsRows');
    if (!tbody) return;
    tbody.replaceChildren();
    const rows = flags.filter((f) => !onlyStale || isStale(f.lastEvaluatedAt, staleDays, now));
    if (!rows.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7', class: 'text-muted' }, [onlyStale ? 'No stale flags.' : 'No flags defined yet.'])]));
      return;
    }
    for (const flag of rows) {
      const stale = isStale(flag.lastEvaluatedAt, staleDays, now);
      const rollout = typeof flag.rolloutPercent === 'number' ? `${flag.rolloutPercent}%` : '-';
      const variants = Array.isArray(flag.variants) && flag.variants.length ? flag.variants.map((v) => v.name).join(', ') : '-';
      tbody.append(el('tr', {}, [
        el('td', { class: 'text-break fw-semibold' }, [flag.name]),
        el('td', {}, [el('span', { class: flag.enabled ? 'badge bg-success' : 'badge bg-secondary' }, [flag.enabled ? 'On' : 'Off'])]),
        el('td', {}, [rollout]),
        el('td', { class: 'small text-break' }, [variants]),
        el('td', { class: 'small' }, [ageText(flag.lastEvaluatedAt, now)]),
        el('td', { class: 'small' }, [flag.updatedAt ? ageText(flag.updatedAt, now) : '-']),
        el('td', {}, [stale ? el('span', { class: 'badge bg-warning text-dark' }, ['Stale']) : el('span', { class: 'badge bg-light text-dark border' }, ['Active'])])
      ]));
    }
  }

  const NooblyJSFlags = {
    /** Loads the flags and redraws the panel. */
    async refresh() {
      try {
        const response = await fetch(API, { headers: { Accept: 'application/json' } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        const flags = body.flags || [];
        const staleDays = staleDaysValue();
        const onlyStale = Boolean(document.getElementById('flagsOnlyStale')?.checked);
        const now = Date.now();
        renderSummary(flags, staleDays, now);
        renderRows(flags, staleDays, onlyStale, now);
        setAlert(`Loaded ${flags.length} flag(s).`, 'info');
      } catch (err) {
        setAlert(err.message, 'danger');
      }
    }
  };

  window.NooblyJSFlags = NooblyJSFlags;
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('flagsRows')) NooblyJSFlags.refresh();
  });
})();
