/**
 * @fileoverview NooblyJS Core Workflow Manager UI Client Library.
 * Renders the workflow manager - grouped workflow list with schedule status
 * and last-run data, schedule management with live cron validation, and
 * execution history (across workflows or scoped to one) with run details -
 * into any container element in a consuming application.
 *
 * The panel is self-contained: it injects its own namespaced styles, has no
 * framework dependency, and renders sub-views (editor, run detail, schedule
 * form) inline rather than in overlay modals, so it cannot interfere with the
 * host page's stacking context. Colours resolve against the host's NooblyJS
 * design tokens (`--ink`, `--accent`, ...) where they exist, so it follows the
 * host theme.
 *
 * @author NooblyJS Core Team
 * @version 1.1.0
 * @since 1.0.15
 *
 * @example
 * // <script src="/services/workflow/scripts/js/index.js"></script>
 * const manager = new WorkflowManagerUI({ containerId: 'workflowManager' });
 * manager.initialize();
 *
 * @example
 * // Read-only history view with an auth header
 * const manager = new WorkflowManagerUI({
 *   containerId: 'runs',
 *   screens: ['executions'],
 *   readOnly: true,
 *   fetchOptions: { headers: { 'x-api-key': token } }
 * });
 * manager.initialize();
 */

(function (global) {
  'use strict';

  /** @const {string} Identifier of the injected style element. */
  const STYLE_ID = 'nooblyjs-workflow-ui-styles';

  /** @const {number} Largest result payload rendered in a run's detail view. */
  const MAX_JSON_CHARS = 200000;

  /** @const {!Array<{days: number, label: string}>} Look-back windows for one workflow's history. */
  const DAY_RANGES = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 0, label: 'All' }
  ];

  /** @const {!Array<!Array<string>>} Cron presets (numeric day-of-week: the parser has no names). */
  const CRON_PRESETS = [
    ['*/15 * * * *', 'Every 15 min'],
    ['0 * * * *', 'Hourly'],
    ['0 2 * * *', 'Daily 02:00'],
    ['0 8 * * 1-5', 'Weekdays 08:00'],
    ['0 0 1 * *', 'Monthly']
  ];

  /** @const {!Object<string, number>} Interval units in milliseconds. */
  const INTERVAL_UNITS = { seconds: 1000, minutes: 60000, hours: 3600000 };

  /** @const {!Array<string>} */
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /** @const {!Array<string>} */
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** @const {!Object<string, string>} Screen titles. */
  const SCREENS = {
    workflows: 'Workflows',
    schedules: 'Schedules',
    executions: 'Execution history'
  };

  /**
   * Namespaced styles for the panel.
   * @const {string}
   */

  /**
   * Inline SVG icon paths (24x24, stroke-based).
   * @const {!Object<string, string>}
   */
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    starFilled: '<path fill="currentColor" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    workflow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a3 3 0 0 0 3 3h6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>'
  };

  /**
   * Returns an inline SVG icon.
   * @param {string} name - Icon name from {@link ICONS}
   * @param {number} [size=14] - Pixel size
   * @return {string} SVG markup
   */
  function icon(name, size) {
    const s = size || 14;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  /**
   * Escapes text for safe insertion into HTML.
   * @param {*} value - Value to escape
   * @return {string} Escaped text
   */
  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Formats a timestamp in the viewer's locale.
   * @param {?string} value - ISO timestamp
   * @return {string} Formatted date/time, or an em dash
   */
  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Describes a timestamp relative to now ("5 min ago", "in 2 h").
   * @param {?string} value - ISO timestamp
   * @return {string} Relative description
   */
  function timeAgo(value) {
    if (!value) return '';
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) return '';
    const diff = Date.now() - ms;
    const future = diff < 0;
    const abs = Math.abs(diff);
    let text;
    if (abs < 45000) return future ? 'in a moment' : 'just now';
    if (abs < 3600000) text = `${Math.round(abs / 60000)} min`;
    else if (abs < 86400000) text = `${Math.round(abs / 3600000)} h`;
    else if (abs < 30 * 86400000) text = `${Math.round(abs / 86400000)} d`;
    else return fmtDateTime(value);
    return future ? `in ${text}` : `${text} ago`;
  }

  /**
   * Formats a duration in milliseconds.
   * @param {?number} ms - Duration
   * @return {string} "850 ms", "12.4 s", "3m 05s", "1h 02m"
   */
  function fmtDuration(ms) {
    if (ms === undefined || ms === null || ms === '' || Number.isNaN(Number(ms))) return '—';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)} ms`;
    if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
    const totalSeconds = Math.round(n / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  }

  /**
   * Describes an interval in milliseconds ("Every 5 min").
   * @param {number} ms - Interval
   * @return {string} Description
   */
  function describeInterval(ms) {
    const n = Number(ms);
    if (!n) return '—';
    if (n % 3600000 === 0) return `Every ${n / 3600000} h`;
    if (n % 60000 === 0) return `Every ${n / 60000} min`;
    return `Every ${Math.round(n / 1000)} s`;
  }

  /**
   * Phrases common cron expressions in plain English. Returns null for
   * anything it cannot phrase confidently; callers show the raw expression.
   * @param {string} expression - 5-field cron expression
   * @return {?string} Description
   */
  function describeCron(expression) {
    const parts = String(expression || '').trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [min, hour, dom, mon, dow] = parts;
    const num = v => /^\d+$/.test(v);
    const nums = v => /^\d+(,\d+)*$/.test(v);
    const pad = v => String(v).padStart(2, '0');
    const times = () => hour.split(',').map(h => `${pad(h)}:${pad(min)}`).join(', ');

    if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
    let m = /^\*\/(\d+)$/.exec(min);
    if (m && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${m[1]} minutes`;
    if (num(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Hourly at :${pad(min)}`;
    m = /^\*\/(\d+)$/.exec(hour);
    if (num(min) && m && dom === '*' && mon === '*' && dow === '*') return `Every ${m[1]} hours at :${pad(min)}`;
    if (!num(min) || !nums(hour)) return null;

    if (dom === '*' && mon === '*') {
      if (dow === '*') return `Daily at ${times()}`;
      if (dow === '1-5') return `Weekdays at ${times()}`;
      if (dow === '0,6' || dow === '6,0') return `Weekends at ${times()}`;
      if (nums(dow) && dow.split(',').every(d => Number(d) <= 6)) {
        const days = dow.split(',').map(d => DAY_NAMES[Number(d)]);
        return `${days.length === 1 ? `Every ${days[0]}` : days.map(d => d.slice(0, 3)).join(', ')} at ${times()}`;
      }
      return null;
    }
    if (num(dom) && mon === '*' && dow === '*') return `Monthly on day ${dom} at ${times()}`;
    if (num(dom) && num(mon) && dow === '*' && Number(mon) >= 1 && Number(mon) <= 12) {
      return `Yearly on ${MONTH_NAMES[Number(mon) - 1]} ${dom} at ${times()}`;
    }
    return null;
  }

  /**
   * Quick client-side sanity check of a cron expression, used before the
   * server's authoritative preview answers.
   * @param {string} expression - Cron expression
   * @return {?string} Why it is rejected, or null
   */
  function cronRejection(expression) {
    const parts = String(expression || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Enter a cron expression';
    if (parts.length !== 5) return `A cron expression has 5 fields; this has ${parts.length}`;
    if (parts.some(p => !/^[\d*,\-/]+$/.test(p))) return 'Use numbers only (no MON/JAN names; Sunday is 0)';
    return null;
  }

  /**
   * Normalises an execution or last-run record to an outcome bucket.
   * @param {?Object} record - Execution-like record
   * @return {string} success | failed | running | cancelled | other
   */
  function outcomeOf(record) {
    if (!record) return 'other';
    const status = String(record.status || '').toLowerCase();
    const outcome = String(record.outcome || '').toLowerCase();
    if (status === 'running') return 'running';
    if (status === 'cancelled' || outcome === 'cancelled') return 'cancelled';
    if (['error', 'failed'].includes(status) || ['failed', 'error'].includes(outcome)) return 'failed';
    if (['completed', 'success'].includes(status) || outcome === 'success') return 'success';
    return 'other';
  }

  /**
   * Status pill markup for an outcome bucket.
   * @param {string} bucket - Outcome bucket
   * @param {string} [label] - Override label
   * @return {string} Markup
   */
  function pill(bucket, label) {
    const map = {
      success: ['success', 'Succeeded'],
      failed: ['failed', 'Failed'],
      running: ['running', 'Running'],
      cancelled: ['warn', 'Cancelled'],
      other: ['', 'Unknown']
    };
    const [cls, text] = map[bucket] || map.other;
    return `<span class="njwf-pill ${cls}"><span class="njwf-dot"></span>${esc(label || text)}</span>`;
  }

  /**
   * Describes what started a run.
   * @param {?string} trigger - Trigger value
   * @return {string} Label
   */
  function triggerLabel(trigger) {
    return {
      manual: 'Manual',
      api: 'API',
      schedule: 'Schedule',
      'catch-up': 'Catch-up',
      'run-now': 'Run now'
    }[trigger] || (trigger ? String(trigger) : '—');
  }

  /**
   * Pretty-prints a value as JSON, capped so a huge payload cannot freeze the page.
   * @param {*} value - Value
   * @return {string} JSON text
   */
  function prettyJson(value) {
    let text;
    try {
      text = JSON.stringify(value, null, 2);
    } catch (_err) {
      return '(too large to display)';
    }
    if (text === undefined) return '';
    if (text.length > MAX_JSON_CHARS) {
      return `${text.slice(0, MAX_JSON_CHARS)}\n\n… truncated (${text.length.toLocaleString()} characters in total)`;
    }
    return text;
  }

  /**
   * Parses a JSON object field; empty input means `{}`.
   * @param {string} raw - Raw text
   * @return {{value: ?Object, error: ?string}}
   */
  function parseJsonObject(raw) {
    const text = String(raw || '').trim();
    if (!text) return { value: {}, error: null };
    try {
      const value = JSON.parse(text);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { value: null, error: 'Must be a JSON object, e.g. { "key": "value" }' };
      }
      return { value, error: null };
    } catch (err) {
      return { value: null, error: `Invalid JSON: ${err.message}` };
    }
  }

  /**
   * Workflow manager UI.
   * @class
   */
  class WorkflowManagerUI {
    /**
     * @param {Object} options - Options
     * @param {string} options.containerId - Id of the element to render into
     * @param {string} [options.apiBaseUrl='/services/workflow/api'] - Workflow API root
     * @param {Object} [options.fetchOptions] - Extra fetch options (e.g. `headers`, `credentials`)
     * @param {Array<string>} [options.screens] - Screens to offer: workflows, schedules, executions
     * @param {string} [options.initialScreen] - Screen shown first
     * @param {boolean} [options.readOnly=false] - Hide every action that changes state
     * @param {number} [options.pollInterval=5000] - Refresh cadence (ms) while runs are in flight; 0 disables
     * @param {string} [options.storageKey='njwf'] - Prefix for remembered UI state in localStorage
     * @param {function(string, Object)} [options.onNavigate] - Called with (screen, params) on navigation
     * @param {function(Error)} [options.onError] - Called when an API call fails
     */
    constructor(options = {}) {
      this.options = {
        apiBaseUrl: '/services/workflow/api',
        fetchOptions: {},
        screens: ['workflows', 'schedules', 'executions'],
        readOnly: false,
        pollInterval: 5000,
        storageKey: 'njwf',
        ...options
      };
      this.options.screens = this.options.screens.filter(s => SCREENS[s]);
      if (this.options.screens.length === 0) this.options.screens = ['workflows'];

      this.root = null;
      this.screen = this.options.screens.includes(this.options.initialScreen)
        ? this.options.initialScreen : this.options.screens[0];
      this.view = 'list';
      this.params = {};
      this.data = {
        workflows: [], lastRuns: {}, groups: [], schedules: [], scheduleStats: null,
        executions: null, execStats: null, scoped: null, detail: null
      };
      this.ui = {
        search: '', statusFilter: '', lastRunFilter: '', starredOnly: false,
        execStatus: '', execWorkflow: '', execLimit: 200, days: 30,
        expanded: {}
      };
      this.form = null;
      this.loading = false;
      this.error = null;
      this.pollTimer_ = null;
      this.searchTimer_ = null;
      this.previewTimer_ = null;
      this.previewSeq_ = 0;
      this.onClick_ = this.onClick_.bind(this);
      this.onInput_ = this.onInput_.bind(this);
      this.onKeyDown_ = this.onKeyDown_.bind(this);
    }

    /**
     * Renders the panel and loads the first screen.
     * @return {Promise<void>}
     */
    async initialize() {
      this.root = document.getElementById(this.options.containerId);
      if (!this.root) throw new Error(`WorkflowManagerUI: no element with id "${this.options.containerId}"`);
      this.injectStyles_();
      for (const screen of Object.keys(SCREENS)) {
        this.ui.expanded[screen] = this.load_(`${screen}.expanded`, {});
      }
      this.root.classList.add('njwf-root');
      this.root.innerHTML = `
        <nav class="njwf-tabs" role="tablist" aria-label="Workflow manager" data-region="tabs"></nav>
        <div data-region="body"></div>
        <div class="njwf-toasts" data-region="toasts" role="status" aria-live="polite"></div>`;
      this.root.addEventListener('click', this.onClick_);
      this.root.addEventListener('input', this.onInput_);
      this.root.addEventListener('change', this.onInput_);
      this.root.addEventListener('keydown', this.onKeyDown_);
      await this.navigate(this.screen, {});
    }

    /**
     * Removes the panel and its listeners.
     */
    destroy() {
      this.stopPolling_();
      if (!this.root) return;
      this.root.removeEventListener('click', this.onClick_);
      this.root.removeEventListener('input', this.onInput_);
      this.root.removeEventListener('change', this.onInput_);
      this.root.removeEventListener('keydown', this.onKeyDown_);
      this.root.innerHTML = '';
      this.root.classList.remove('njwf-root');
      this.root = null;
    }

    /**
     * Shows a screen.
     * @param {string} screen - workflows | schedules | executions
     * @param {Object} [params] - Screen parameters (e.g. `{ workflowName }` scopes history)
     * @return {Promise<void>}
     */
    async navigate(screen, params = {}) {
      if (!this.options.screens.includes(screen)) return;
      const prevScope = this.params.workflowName || null;
      this.screen = screen;
      this.params = params || {};
      this.view = 'list';
      this.form = null;
      if (screen === 'executions' && (this.params.workflowName || null) !== prevScope) {
        this.ui.execStatus = '';
        this.ui.days = 30;
        this.data.scoped = null;
      }
      this.renderTabs_();
      this.options.onNavigate?.(screen, this.params);
      await this.reload();
    }

    /**
     * Reloads the current screen's data and repaints.
     * @param {Object} [opts] - `{ quiet: true }` keeps the current content while loading
     * @return {Promise<void>}
     */
    async reload(opts = {}) {
      if (!opts.quiet) {
        this.loading = true;
        this.paint_();
      }
      try {
        await this.fetchScreen_();
        this.error = null;
      } catch (err) {
        this.error = err;
        this.options.onError?.(err);
      } finally {
        this.loading = false;
      }
      this.renderTabs_();
      this.paint_();
      this.schedulePoll_();
    }

    // -------------------------------------------------------------------------
    // Data
    // -------------------------------------------------------------------------

    /**
     * Calls the workflow API.
     * @param {string} method - HTTP method
     * @param {string} path - Path below apiBaseUrl
     * @param {*} [body] - JSON body
     * @return {Promise<*>} Parsed response
     * @private
     */
    async api_(method, path, body) {
      const base = this.options.fetchOptions || {};
      const init = {
        ...base,
        method,
        credentials: base.credentials || 'same-origin',
        headers: { Accept: 'application/json', ...(base.headers || {}) }
      };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(this.options.apiBaseUrl + path, init);
      const type = response.headers.get('content-type') || '';
      const payload = type.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) {
        const message = payload && payload.error ? payload.error : (typeof payload === 'string' && payload ? payload : `HTTP ${response.status}`);
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    /**
     * Loads what the current screen needs.
     * @return {Promise<void>}
     * @private
     */
    async fetchScreen_() {
      const needs = {
        workflows: ['workflows', 'lastRuns', 'schedules'],
        schedules: ['workflows', 'schedules'],
        executions: ['workflows']
      }[this.screen];
      const jobs = [];
      if (needs.includes('workflows')) jobs.push(this.api_('GET', '/workflows').then((w) => { this.data.workflows = w || []; }));
      if (needs.includes('lastRuns')) {
        // Last-run data decorates a list that must render without it.
        jobs.push(this.api_('GET', '/workflows/last-runs')
          .then((r) => { this.data.lastRuns = r || {}; })
          .catch(() => { this.data.lastRuns = {}; }));
      }
      if (needs.includes('schedules')) {
        jobs.push(this.api_('GET', '/schedules').then((s) => { this.data.schedules = s || []; }));
        jobs.push(this.api_('GET', '/schedules/stats').then((s) => { this.data.scheduleStats = s; }).catch(() => {}));
      }
      if (this.screen === 'executions') jobs.push(this.fetchExecutions_());
      await Promise.all(jobs);
    }

    /**
     * Loads execution history for the executions screen.
     * @return {Promise<void>}
     * @private
     */
    async fetchExecutions_() {
      const scope = this.params.workflowName;
      if (scope) {
        const qs = new URLSearchParams({
          days: this.ui.days > 0 ? String(this.ui.days) : 'all',
          limit: '300'
        });
        if (this.ui.execStatus) qs.set('status', this.ui.execStatus);
        this.data.scoped = await this.api_('GET', `/workflows/${encodeURIComponent(scope)}/executions?${qs}`);
        return;
      }
      const qs = new URLSearchParams({ limit: String(this.ui.execLimit) });
      if (this.ui.execStatus) qs.set('status', this.ui.execStatus);
      if (this.ui.execWorkflow) qs.set('workflowName', this.ui.execWorkflow);
      const statsQs = this.ui.execWorkflow ? `?workflowName=${encodeURIComponent(this.ui.execWorkflow)}` : '';
      const [page, stats] = await Promise.all([
        this.api_('GET', `/runs?${qs}`),
        this.api_('GET', `/runs/stats${statsQs}`).catch(() => null)
      ]);
      this.data.executions = page;
      this.data.execStats = stats;
    }

    // -------------------------------------------------------------------------
    // Rendering: shell
    // -------------------------------------------------------------------------

    /**
     * Injects the panel stylesheet once per document.
     * @private
     */
    injectStyles_() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/services/css/workflow-ui.css';
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    /**
     * Paints the screen tabs.
     * @private
     */
    renderTabs_() {
      const tabs = this.root && this.root.querySelector('[data-region="tabs"]');
      if (!tabs) return;
      if (this.options.screens.length < 2) {
        tabs.hidden = true;
        return;
      }
      const counts = {
        workflows: this.data.workflows.length || null,
        schedules: this.data.schedules.length || null,
        executions: null
      };
      tabs.innerHTML = this.options.screens.map((s) => {
        const iconName = { workflows: 'workflow', schedules: 'clock', executions: 'history' }[s];
        const count = counts[s] ? `<span class="njwf-count">${counts[s]}</span>` : '';
        return `<button class="njwf-tab" role="tab" type="button" aria-selected="${s === this.screen}" data-action="nav" data-screen="${s}">${icon(iconName, 14)} ${esc(SCREENS[s])}${count}</button>`;
      }).join('');
    }

    /**
     * Paints the body for the current screen and view.
     * @private
     */
    paint_() {
      const body = this.root && this.root.querySelector('[data-region="body"]');
      if (!body) return;
      const active = document.activeElement;
      const field = active && this.root.contains(active) && active.dataset ? active.dataset.field : null;
      const caret = field && typeof active.selectionStart === 'number' ? active.selectionStart : null;

      let html;
      if (this.loading && !this.hasData_()) {
        html = `<div class="njwf-loading">Loading…</div>`;
      } else if (this.error && !this.hasData_()) {
        html = this.errorBlock_(this.error);
      } else {
        html = this.renderScreen_();
      }
      body.innerHTML = html;

      // Keep focus in the search box across repaints while typing.
      if (field === 'search') {
        const input = body.querySelector('[data-field="search"]');
        if (input) {
          input.focus();
          if (caret !== null) input.setSelectionRange(caret, caret);
        }
      }
      if (this.form && this.form.kind === 'schedule') this.refreshCronStatus_();
    }

    /**
     * Whether the current screen has data to show while reloading.
     * @return {boolean}
     * @private
     */
    hasData_() {
      if (this.screen === 'executions') return !!(this.params.workflowName ? this.data.scoped : this.data.executions);
      return this.data.workflows.length > 0 || this.data.schedules.length > 0;
    }

    /**
     * Error block with a retry button.
     * @param {Error} err - The error
     * @return {string} Markup
     * @private
     */
    errorBlock_(err) {
      return `<div class="njwf-error" role="alert">${icon('alert', 16)}<span>Could not load: ${esc(err.message)}</span>
        <span class="njwf-spacer"></span><button class="njwf-btn" type="button" data-action="retry">${icon('refresh', 13)} Retry</button></div>`;
    }

    /**
     * Renders the active screen/view.
     * @return {string} Markup
     * @private
     */
    renderScreen_() {
      if (this.view === 'workflow-form') return this.renderWorkflowForm_();
      if (this.view === 'schedule-form') return this.renderScheduleForm_();
      if (this.view === 'import') return this.renderImport_();
      if (this.view === 'run-detail') return this.renderRunDetail_();
      if (this.screen === 'workflows') return this.renderWorkflows_();
      if (this.screen === 'schedules') return this.renderSchedules_();
      return this.params.workflowName ? this.renderScopedExecutions_() : this.renderExecutions_();
    }

    /**
     * Screen heading with actions.
     * @param {string} title - Title
     * @param {string} sub - Subtitle
     * @param {string} [actions] - Action markup
     * @return {string} Markup
     * @private
     */
    head_(title, sub, actions) {
      return `<div class="njwf-head"><div><h2 class="njwf-title">${esc(title)}</h2><p class="njwf-sub">${esc(sub)}</p></div>
        <div class="njwf-row">${actions || ''}</div></div>`;
    }

    /**
     * A collapsible group with a table body.
     * @param {string} screen - Screen the expanded state belongs to
     * @param {string} key - Group key
     * @param {number} count - Items in the group
     * @param {string} noun - Item noun (singular)
     * @param {string} table - Table markup
     * @return {string} Markup
     * @private
     */
    group_(screen, key, count, noun, table) {
      const open = this.ui.expanded[screen][key] !== false;
      return `<section class="njwf-group ${open ? 'open' : ''}">
        <button class="njwf-group-head" type="button" aria-expanded="${open}" data-action="toggle-group" data-key="${esc(key)}">
          ${icon(open ? 'chevronDown' : 'chevronRight', 14)}<span class="njwf-faint">${icon('folder', 15)}</span>
          <span><span class="name">${esc(key)}</span><br><span class="meta">${count} ${noun}${count === 1 ? '' : 's'}</span></span>
          <span class="njwf-count">${count}</span>
        </button>
        ${open ? `<div class="njwf-table-wrap">${table}</div>` : ''}
      </section>`;
    }

    /**
     * Empty-state block.
     * @param {string} iconName - Icon
     * @param {string} heading - Heading
     * @param {string} text - Body text
     * @param {string} [action] - Action markup
     * @return {string} Markup
     * @private
     */
    empty_(iconName, heading, text, action) {
      return `<div class="njwf-card"><div class="njwf-empty">${icon(iconName, 26)}<div class="h">${esc(heading)}</div>
        <div class="njwf-small">${esc(text)}</div>${action ? `<div class="inline-d6f2af6e">${action}</div>` : ''}</div></div>`;
    }

    /**
     * Groups items by a key function, sorted by key.
     * @param {Array<Object>} list - Items
     * @param {function(Object): string} keyOf - Key function
     * @return {Array<{key: string, items: Array<Object>}>}
     * @private
     */
    groupBy_(list, keyOf) {
      const buckets = {};
      for (const item of list) {
        const key = keyOf(item);
        (buckets[key] = buckets[key] || []).push(item);
      }
      return Object.keys(buckets)
        .sort((a, b) => (a === 'Ungrouped') - (b === 'Ungrouped') || a.localeCompare(b))
        .map(key => ({ key, items: buckets[key] }));
    }

    /**
     * The group label of a workflow name.
     * @param {string} workflowName - Workflow name
     * @return {string} Group label
     * @private
     */
    groupOfWorkflow_(workflowName) {
      const w = this.data.workflows.find(x => x.name === workflowName);
      return (w && w.group) || 'Ungrouped';
    }

    // -------------------------------------------------------------------------
    // Workflows screen
    // -------------------------------------------------------------------------

    /**
     * Workflows that pass the current filters.
     * @return {Array<Object>}
     * @private
     */
    filteredWorkflows_() {
      const q = this.ui.search.trim().toLowerCase();
      return this.data.workflows.filter((w) => {
        if (this.ui.starredOnly && !w.starred) return false;
        if (this.ui.statusFilter && (w.status || 'unscheduled') !== this.ui.statusFilter) return false;
        if (this.ui.lastRunFilter) {
          const bucket = outcomeOf(this.data.lastRuns[w.name]);
          if (this.ui.lastRunFilter === 'never') {
            if (this.data.lastRuns[w.name]) return false;
          } else if (bucket !== this.ui.lastRunFilter) return false;
        }
        if (!q) return true;
        return w.name.toLowerCase().includes(q)
          || (w.description || '').toLowerCase().includes(q)
          || (w.group || '').toLowerCase().includes(q)
          || (w.tags || []).some(t => String(t).toLowerCase().includes(q));
      });
    }

    /**
     * Workflow schedule-status badge.
     * @param {?string} status - active | inactive | null
     * @return {string} Markup
     * @private
     */
    scheduleBadge_(status) {
      if (status === 'active') return `<span class="njwf-pill success"><span class="njwf-dot"></span>Scheduled</span>`;
      if (status === 'inactive') return `<span class="njwf-pill warn">Paused</span>`;
      return `<span class="njwf-pill">Unscheduled</span>`;
    }

    /**
     * Last-run cell for a workflow.
     * @param {Object} w - Workflow
     * @return {string} Markup
     * @private
     */
    lastRunCell_(w) {
      const run = this.data.lastRuns[w.name];
      if (!run) return '<span class="njwf-faint njwf-small">Never run</span>';
      const bucket = outcomeOf(run);
      const tip = [fmtDateTime(run.startedAt), triggerLabel(run.trigger), bucket === 'failed' && run.error ? run.error : '']
        .filter(Boolean).join(' · ');
      return `<div class="njwf-cell" title="${esc(tip)}">
        <span class="inline-408b446d njwf-row">${pill(bucket)}<span class="njwf-muted njwf-small njwf-nowrap">${esc(timeAgo(run.startedAt))}</span></span>
        <span class="s njwf-mono">${esc(fmtDuration(run.duration))}</span></div>`;
    }

    /**
     * Renders the workflows list.
     * @return {string} Markup
     * @private
     */
    renderWorkflows_() {
      const ro = this.options.readOnly;
      const list = this.filteredWorkflows_();
      const groups = this.groupBy_(list, w => w.group || 'Ungrouped');
      const chip = (field, value, label, dotTone) => {
        const on = this.ui[field] === value;
        const dot = dotTone ? `<span class="njwf-dot njwf-tone-${dotTone}"></span>` : '';
        return `<button class="njwf-chip" type="button" aria-pressed="${on}" data-action="set-filter" data-filter="${field}" data-value="${esc(value)}">${dot}${esc(label)}</button>`;
      };
      const actions = ro ? '' : `
        <button class="njwf-btn" type="button" data-action="show-import">${icon('upload', 13)} Import</button>
        <button class="njwf-btn primary" type="button" data-action="new-workflow">${icon('plus', 13)} New workflow</button>`;

      const table = items => `<table class="njwf-table">
        <thead><tr>
          <th class="inline-fb6a3156"><span class="njwf-sr">Starred</span></th><th>Name</th>
          <th class="inline-465bfea3">Schedule</th><th class="inline-ec6626e1 njwf-hide-sm">Steps</th>
          <th class="inline-7c07cdf8 njwf-hide-sm">Tags</th><th class="inline-7c07cdf8 njwf-hide-sm">Modified</th>
          <th class="inline-fc2c71fc">Last run</th><th class="inline-fc2c71fc"><span class="njwf-sr">Actions</span></th>
        </tr></thead>
        <tbody>${items.map(w => `<tr>
          <td>${ro ? (w.starred ? `<span class="njwf-faint">${icon('starFilled', 14)}</span>` : '')
            : `<button class="njwf-btn icon ghost ${w.starred ? 'on' : ''}" type="button" title="${w.starred ? 'Unstar' : 'Star'}" aria-pressed="${w.starred}" data-action="toggle-star" data-name="${esc(w.name)}">${icon(w.starred ? 'starFilled' : 'star', 15)}</button>`}</td>
          <td><div class="njwf-cell">
            ${ro ? `<span class="t">${esc(w.name)}</span>` : `<button class="njwf-link t" type="button" data-action="edit-workflow" data-name="${esc(w.name)}">${esc(w.name)}</button>`}
            <span class="s">${esc(w.description || '')}</span></div></td>
          <td>${this.scheduleBadge_(w.status)}</td>
          <td class="njwf-hide-sm"><span class="inline-e51ab5a6 njwf-row"><span class="njwf-faint">${icon('layers', 12)}</span>${w.stepCount}</span></td>
          <td class="njwf-hide-sm">${(w.tags || []).slice(0, 3).map(t => `<span class="njwf-tag">${esc(t)}</span>`).join('') || '<span class="njwf-faint">—</span>'}</td>
          <td class="njwf-hide-sm njwf-muted njwf-small">${esc(fmtDateTime(w.modifiedAt))}</td>
          <td>${this.lastRunCell_(w)}</td>
          <td><div class="njwf-row tight">
            ${ro ? '' : `<button class="njwf-btn icon" type="button" title="Run now" aria-label="Run ${esc(w.name)} now" data-action="run-workflow" data-name="${esc(w.name)}">${icon('play', 13)}</button>
            <button class="njwf-btn icon" type="button" title="Schedule" aria-label="Schedule ${esc(w.name)}" data-action="schedule-workflow" data-name="${esc(w.name)}">${icon('clock', 13)}</button>
            <button class="njwf-btn icon" type="button" title="Edit" aria-label="Edit ${esc(w.name)}" data-action="edit-workflow" data-name="${esc(w.name)}">${icon('pencil', 13)}</button>`}
            <button class="njwf-btn icon" type="button" title="Execution history" aria-label="History of ${esc(w.name)}" data-action="workflow-history" data-name="${esc(w.name)}">${icon('history', 13)}</button>
            ${ro ? '' : `<button class="njwf-btn icon danger" type="button" title="Delete" aria-label="Delete ${esc(w.name)}" data-action="delete-workflow" data-name="${esc(w.name)}">${icon('trash', 13)}</button>`}
          </div></td>
        </tr>`).join('')}</tbody></table>`;

      return `${this.head_('Workflows', 'Define, run and schedule multi-step workflows.', actions)}
        <div class="njwf-card njwf-toolbar">
          <div class="njwf-row">
            <label class="njwf-search">${icon('search', 14)}<span class="njwf-sr">Search workflows</span>
              <input class="njwf-input" data-field="search" placeholder="Search by name, tag, group…" value="${esc(this.ui.search)}"></label>
            <select class="inline-28c0f6ec njwf-select" data-field="statusFilter" aria-label="Schedule status">
              <option value="">Any schedule</option>
              <option value="active"${this.ui.statusFilter === 'active' ? ' selected' : ''}>Scheduled</option>
              <option value="inactive"${this.ui.statusFilter === 'inactive' ? ' selected' : ''}>Paused</option>
              <option value="unscheduled"${this.ui.statusFilter === 'unscheduled' ? ' selected' : ''}>Unscheduled</option>
            </select>
            <button class="njwf-chip" type="button" aria-pressed="${this.ui.starredOnly}" data-action="toggle-starred">${icon('star', 12)} Starred</button>
            <span class="njwf-spacer"></span>
            <button class="njwf-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>
          </div>
          <div class="njwf-row" role="group" aria-label="Filter by last run">
            <span class="njwf-muted njwf-small">Last run:</span>
            ${chip('lastRunFilter', '', 'Any')}
            ${chip('lastRunFilter', 'success', 'Succeeded', 'success')}
            ${chip('lastRunFilter', 'failed', 'Failed', 'danger')}
            ${chip('lastRunFilter', 'running', 'Running', 'info')}
            ${chip('lastRunFilter', 'never', 'Never run')}
          </div>
        </div>
        ${groups.length
    ? `<div class="njwf-groups">${groups.map(g => this.group_('workflows', g.key, g.items.length, 'workflow', table(g.items))).join('')}</div>`
    : this.empty_('workflow', 'No workflows found',
      this.data.workflows.length ? 'Try adjusting the search or filters.' : 'Create your first workflow to get started.',
      ro || this.data.workflows.length ? '' : `<button class="njwf-btn primary" type="button" data-action="new-workflow">${icon('plus', 13)} New workflow</button>`)}
        <div class="njwf-footer">Showing ${list.length} of ${this.data.workflows.length} workflows · ${groups.length} group${groups.length === 1 ? '' : 's'}</div>`;
    }

    /**
     * Workflow create/edit form.
     * @return {string} Markup
     * @private
     */
    renderWorkflowForm_() {
      const f = this.form;
      const editing = !!f.original;
      const groups = Array.from(new Set(this.data.workflows.map(w => w.group).filter(Boolean))).sort();
      const inputStatus = f.inputError
        ? `<div class="njwf-help bad">${icon('alert', 12)} ${esc(f.inputError)}</div>`
        : `<div class="njwf-help">Used when a run is started without input.</div>`;
      return `<button class="inline-da12f285 njwf-btn ghost" type="button" data-action="back">${icon('chevronLeft', 13)} Back to workflows</button>
        <div class="njwf-form">
          <div class="njwf-card pad">
            <h2 class="inline-2b583d73 njwf-title">${editing ? `Edit ${esc(f.original)}` : 'New workflow'}</h2>
            <div class="njwf-grid2">
              <div class="njwf-field"><label class="njwf-label" for="njwf-wf-name">Name <span class="req">*</span></label>
                <input id="njwf-wf-name" class="njwf-input" data-form="name" value="${esc(f.name)}" placeholder="e.g. nightly-ingest" autocomplete="off"></div>
              <div class="njwf-field"><label class="njwf-label" for="njwf-wf-group">Group</label>
                <input id="njwf-wf-group" class="njwf-input" data-form="group" value="${esc(f.group)}" list="njwf-groups" placeholder="Ungrouped" autocomplete="off">
                <datalist id="njwf-groups">${groups.map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
            </div>
            <div class="njwf-field"><label class="njwf-label" for="njwf-wf-desc">Description</label>
              <input id="njwf-wf-desc" class="njwf-input" data-form="description" value="${esc(f.description)}" placeholder="What does this workflow do?"></div>
            <div class="njwf-field"><label class="njwf-label" for="njwf-wf-tags">Tags</label>
              <input id="njwf-wf-tags" class="njwf-input" data-form="tags" value="${esc(f.tags)}" placeholder="Comma separated, e.g. ingest, nightly">
            </div>
            <div class="njwf-field"><span class="njwf-label">Steps <span class="req">*</span></span>
              <div class="njwf-steps">${f.steps.map((step, i) => `
                <div class="njwf-step"><span class="njwf-step-num">${i + 1}</span>
                  <input class="njwf-input mono" data-step="${i}" value="${esc(step)}" placeholder="/path/to/step.js" aria-label="Step ${i + 1} file path">
                  <span class="njwf-row tight">
                    <button class="njwf-btn icon" type="button" title="Move up" aria-label="Move step ${i + 1} up" data-action="step-up" data-index="${i}" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp', 12)}</button>
                    <button class="njwf-btn icon" type="button" title="Move down" aria-label="Move step ${i + 1} down" data-action="step-down" data-index="${i}" ${i === f.steps.length - 1 ? 'disabled' : ''}>${icon('arrowDown', 12)}</button>
                    <button class="njwf-btn icon danger" type="button" title="Remove" aria-label="Remove step ${i + 1}" data-action="step-remove" data-index="${i}" ${f.steps.length === 1 ? 'disabled' : ''}>${icon('x', 12)}</button>
                  </span></div>`).join('')}
              </div>
              <button class="inline-8a77e5a3 njwf-btn" type="button" data-action="step-add">${icon('plus', 12)} Add step</button>
              <div class="njwf-help">Each step is an activity file run by the working service; it receives the input plus every earlier step's output.</div>
            </div>
            <div class="njwf-field"><label class="njwf-label" for="njwf-wf-input">Default input (JSON)</label>
              <textarea id="njwf-wf-input" class="njwf-textarea" data-form="defaultInput" placeholder="{}">${esc(f.defaultInput)}</textarea>
              <div data-region="input-status">${inputStatus}</div></div>
          </div>
          <div class="njwf-card pad njwf-side">
            <h3>${editing ? 'Save changes' : 'Create'}</h3>
            <p>${editing ? 'Renaming keeps this workflow\'s history and schedules.' : 'The workflow can be run or scheduled as soon as it is created.'}</p>
            <button class="njwf-btn primary" type="button" data-action="save-workflow">${icon('check', 13)} ${editing ? 'Save workflow' : 'Create workflow'}</button>
            ${editing ? `<button class="njwf-btn" type="button" data-action="export-workflow" data-name="${esc(f.original)}">${icon('download', 13)} Export JSON</button>
            <button class="njwf-btn danger" type="button" data-action="delete-workflow" data-name="${esc(f.original)}">${icon('trash', 13)} Delete workflow</button>` : ''}
            <button class="njwf-btn ghost" type="button" data-action="back">Cancel</button>
          </div>
        </div>`;
    }

    /**
     * Import form.
     * @return {string} Markup
     * @private
     */
    renderImport_() {
      return `<button class="inline-da12f285 njwf-btn ghost" type="button" data-action="back">${icon('chevronLeft', 13)} Back to workflows</button>
        <div class="inline-765d57b5 njwf-card pad">
          <h2 class="inline-da12f285 njwf-title">Import workflow</h2>
          <div class="njwf-field"><label class="njwf-label" for="njwf-import-file">Workflow JSON file</label>
            <input id="njwf-import-file" class="njwf-input" type="file" accept="application/json,.json" data-form="importFile">
            <div class="njwf-help">A file exported from this workflow manager.</div></div>
          <div class="inline-455f8cca njwf-row">
            <button class="njwf-btn ghost" type="button" data-action="back">Cancel</button>
            <button class="njwf-btn primary" type="button" data-action="do-import">${icon('upload', 13)} Import</button>
          </div>
        </div>`;
    }

    // -------------------------------------------------------------------------
    // Schedules screen
    // -------------------------------------------------------------------------

    /**
     * A schedule's cadence as markup.
     * @param {Object} s - Schedule
     * @return {string} Markup
     * @private
     */
    cadenceCell_(s) {
      if (s.cronExpression) {
        const phrase = describeCron(s.cronExpression);
        return `<div class="njwf-cell"><span class="njwf-code-inline">${esc(s.cronExpression)}</span>${phrase ? `<span class="s">${esc(phrase)}</span>` : ''}</div>`;
      }
      return `<span class="njwf-small">${esc(describeInterval(s.interval))}</span>`;
    }

    /**
     * A schedule's own last-run outcome.
     * @param {Object} s - Schedule
     * @return {string} Markup
     * @private
     */
    scheduleLastRun_(s) {
      if (s.running || s.lastResult === 'running') {
        return `<div class="njwf-cell">${pill('running')}<span class="s">started ${esc(timeAgo(s.lastRun))}</span></div>`;
      }
      if (!s.lastRun) return '<span class="njwf-faint njwf-small">Never run</span>';
      const bucket = s.lastResult === 'success' ? 'success' : (s.lastResult === 'failed' ? 'failed' : 'other');
      const tip = [fmtDateTime(s.lastRun), bucket === 'failed' && s.lastError ? s.lastError : ''].filter(Boolean).join(' · ');
      const runs = s.executionCount ? `${s.executionCount} run${s.executionCount === 1 ? '' : 's'}` : '';
      return `<div class="njwf-cell" title="${esc(tip)}">
        <span class="inline-408b446d njwf-row">${pill(bucket)}<span class="njwf-muted njwf-small njwf-nowrap">${esc(timeAgo(s.lastRun))}</span></span>
        <span class="s">${esc(runs)}${bucket === 'failed' && s.lastError ? ` · ${esc(s.lastError)}` : ''}</span></div>`;
    }

    /**
     * Renders the schedules list.
     * @return {string} Markup
     * @private
     */
    renderSchedules_() {
      const ro = this.options.readOnly;
      const list = this.data.schedules;
      const st = this.data.scheduleStats;
      const actions = `<button class="njwf-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>
        ${ro ? '' : `<button class="njwf-btn primary" type="button" data-action="new-schedule" ${this.data.workflows.length ? '' : 'disabled title="Create a workflow first"'}>${icon('plus', 13)} New schedule</button>`}`;
      const stats = st ? `<div class="njwf-stats">
        <div class="njwf-stat"><div class="l">Schedules</div><div class="v">${st.total}</div></div>
        <div class="njwf-stat"><div class="l">Enabled</div><div class="inline-ca4a80ae v">${st.enabled}</div></div>
        <div class="njwf-stat"><div class="l">Paused</div><div class="v">${st.paused}</div></div>
        <div class="njwf-stat"><div class="l">Last run failed</div><div class="v${st.failing ? ' njwf-tone-danger' : ''}">${st.failing}</div></div>
        <div class="njwf-stat"><div class="l">Runs recorded</div><div class="v">${st.totalExecutions}</div></div>
      </div>` : '';

      const table = items => `<table class="njwf-table">
        <thead><tr><th>Schedule</th><th class="inline-d52ddd08">Cadence</th><th class="inline-28c0f6ec">Next run</th>
          <th class="inline-0fac9183">Last run</th><th class="inline-db4cf10b">Status</th><th class="inline-fc2c71fc"><span class="njwf-sr">Actions</span></th></tr></thead>
        <tbody>${items.map(s => `<tr>
          <td><div class="njwf-cell"><span class="t">${esc(s.name)}</span>
            <span class="s">${s.workflowExists ? esc(s.workflowName) : `<span class="inline-627e98b1">${esc(s.workflowName)} (missing)</span>`}${s.description ? ` · ${esc(s.description)}` : ''}</span></div></td>
          <td>${this.cadenceCell_(s)}</td>
          <td><div class="njwf-cell"><span class="njwf-small">${s.enabled && s.nextRun ? esc(fmtDateTime(s.nextRun)) : '—'}</span>
            <span class="s">${s.enabled && s.nextRun ? esc(timeAgo(s.nextRun)) : ''}</span></div></td>
          <td>${this.scheduleLastRun_(s)}</td>
          <td>${s.enabled ? '<span class="njwf-pill success"><span class="njwf-dot"></span>Enabled</span>' : '<span class="njwf-pill warn">Paused</span>'}</td>
          <td><div class="njwf-row tight">
            ${ro ? '' : `<button class="njwf-btn icon" type="button" title="Run now" aria-label="Run ${esc(s.name)} now" data-action="run-schedule" data-id="${esc(s.id)}" ${s.running || !s.workflowExists ? 'disabled' : ''}>${icon('play', 13)}</button>
            <button class="njwf-btn icon" type="button" title="Edit" aria-label="Edit ${esc(s.name)}" data-action="edit-schedule" data-id="${esc(s.id)}">${icon('pencil', 13)}</button>
            <button class="njwf-btn icon" type="button" title="${s.enabled ? 'Pause' : 'Enable'}" aria-label="${s.enabled ? 'Pause' : 'Enable'} ${esc(s.name)}" data-action="toggle-schedule" data-id="${esc(s.id)}">${icon(s.enabled ? 'pause' : 'play', 13)}</button>`}
            <button class="njwf-btn icon" type="button" title="Execution history" aria-label="History of ${esc(s.workflowName)}" data-action="workflow-history" data-name="${esc(s.workflowName)}">${icon('history', 13)}</button>
            ${ro ? '' : `<button class="njwf-btn icon danger" type="button" title="Delete" aria-label="Delete ${esc(s.name)}" data-action="delete-schedule" data-id="${esc(s.id)}" data-name="${esc(s.name)}">${icon('trash', 13)}</button>`}
          </div></td></tr>`).join('')}</tbody></table>`;

      const groups = this.groupBy_(list, s => this.groupOfWorkflow_(s.workflowName));
      return `${this.head_('Schedules', 'Run workflows automatically on a cron expression or interval.', actions)}
        ${stats}
        ${list.length
    ? `<div class="njwf-groups">${groups.map(g => this.group_('schedules', g.key, g.items.length, 'schedule', table(g.items))).join('')}</div>`
    : this.empty_('clock', 'No schedules', 'Schedule a workflow to run it automatically.',
      ro || !this.data.workflows.length ? '' : `<button class="njwf-btn primary" type="button" data-action="new-schedule">${icon('plus', 13)} New schedule</button>`)}`;
    }

    /**
     * Schedule create/edit form.
     * @return {string} Markup
     * @private
     */
    renderScheduleForm_() {
      const f = this.form;
      const editing = !!f.id;
      const backLabel = f.returnTo === 'workflows' ? 'Back to workflows' : 'Back to schedules';
      const inputStatus = f.inputError
        ? `<div class="njwf-help bad">${icon('alert', 12)} ${esc(f.inputError)}</div>`
        : `<div class="njwf-help">Passed to the workflow on every run.</div>`;
      return `<button class="inline-da12f285 njwf-btn ghost" type="button" data-action="back">${icon('chevronLeft', 13)} ${backLabel}</button>
        <div class="njwf-form">
          <div class="njwf-card pad">
            <h2 class="inline-2b583d73 njwf-title">${editing ? 'Edit schedule' : 'New schedule'}</h2>
            <div class="njwf-field"><label class="njwf-label" for="njwf-s-wf">Workflow <span class="req">*</span></label>
              <select id="njwf-s-wf" class="njwf-select" data-form="workflowName">
                <option value="">Select a workflow…</option>
                ${this.data.workflows.map(w => `<option value="${esc(w.name)}"${w.name === f.workflowName ? ' selected' : ''}>${esc(w.group ? `${w.group} / ${w.name}` : w.name)}</option>`).join('')}
              </select></div>
            <div class="njwf-field"><span class="njwf-label">Runs</span>
              <span class="njwf-seg" role="group" aria-label="Cadence type">
                <button type="button" aria-pressed="${f.mode === 'cron'}" data-action="set-mode" data-mode="cron">On a cron expression</button>
                <button type="button" aria-pressed="${f.mode === 'interval'}" data-action="set-mode" data-mode="interval">Every interval</button>
              </span></div>
            ${f.mode === 'cron' ? `
            <div class="njwf-field"><label class="njwf-label" for="njwf-s-cron">Cron expression <span class="req">*</span></label>
              <input id="njwf-s-cron" class="njwf-input mono" data-form="cron" value="${esc(f.cron)}" spellcheck="false" autocomplete="off" aria-describedby="njwf-cron-status">
              <div id="njwf-cron-status" data-region="cron-status" class="njwf-help"></div>
              <div class="inline-8a77e5a3 njwf-row">${CRON_PRESETS.map(([expr, label]) =>
    `<button class="njwf-chip" type="button" aria-pressed="${f.cron === expr}" data-action="cron-preset" data-cron="${esc(expr)}">${esc(label)}</button>`).join('')}</div>
              <div class="njwf-help">minute · hour · day-of-month · month · day-of-week — numbers only, Sunday is 0. Times are the server's local time.</div>
            </div>` : `
            <div class="njwf-field"><label class="njwf-label" for="njwf-s-int">Interval <span class="req">*</span></label>
              <div class="inline-2aca6dad njwf-row">
                <input id="njwf-s-int" class="inline-7a96d9ba njwf-input" type="number" min="1" step="1" data-form="intervalValue" value="${esc(f.intervalValue)}">
                <select class="inline-7a96d9ba njwf-select" data-form="intervalUnit" aria-label="Interval unit">
                  ${Object.keys(INTERVAL_UNITS).map(u => `<option value="${u}"${f.intervalUnit === u ? ' selected' : ''}>${u}</option>`).join('')}
                </select></div>
              <div class="njwf-help">The first run happens one interval after the schedule is saved.</div>
            </div>`}
            <div class="njwf-field"><label class="njwf-label" for="njwf-s-name">Schedule name</label>
              <input id="njwf-s-name" class="njwf-input" data-form="name" value="${esc(f.name)}" placeholder="${esc(this.derivedScheduleName_())}">
              <div class="njwf-help" data-region="derived-name">Leave empty to use “${esc(this.derivedScheduleName_())}”.</div></div>
            <div class="njwf-field"><label class="njwf-label" for="njwf-s-desc">Description</label>
              <input id="njwf-s-desc" class="njwf-input" data-form="description" value="${esc(f.description)}" placeholder="Optional"></div>
            <div class="njwf-field"><label class="njwf-label" for="njwf-s-input">Input (JSON)</label>
              <textarea id="njwf-s-input" class="njwf-textarea" data-form="input" placeholder="{}">${esc(f.input)}</textarea>
              <div data-region="input-status">${inputStatus}</div></div>
          </div>
          <div class="njwf-card pad njwf-side">
            <h3>${editing ? 'Save changes' : 'Create'}</h3>
            <p>${editing ? 'Changing the cadence re-plans the next run from now.' : 'The schedule starts enabled unless you untick it below.'}</p>
            ${editing ? '' : `<label class="inline-8e737b88 njwf-row"><input type="checkbox" data-form="enabled" ${f.enabled ? 'checked' : ''}> Enabled</label>`}
            <button class="njwf-btn primary" type="button" data-action="save-schedule">${icon('check', 13)} ${editing ? 'Save schedule' : 'Create schedule'}</button>
            <button class="njwf-btn ghost" type="button" data-action="back">Cancel</button>
          </div>
        </div>`;
    }

    /**
     * The name a schedule gets when none is typed: "<workflow> - <cadence>".
     * @return {string} Name
     * @private
     */
    derivedScheduleName_() {
      const f = this.form || {};
      const wf = f.workflowName || 'Workflow';
      const cadence = f.mode === 'interval'
        ? describeInterval((Number(f.intervalValue) || 0) * (INTERVAL_UNITS[f.intervalUnit] || 60000))
        : (describeCron(f.cron) || String(f.cron || '').trim());
      return cadence ? `${wf} - ${cadence}` : wf;
    }

    /**
     * Refreshes the cron validation line under the cron field, asking the
     * server for the authoritative answer and the next fire times.
     * @private
     */
    refreshCronStatus_() {
      const f = this.form;
      if (!f || f.mode !== 'cron' || !this.root) return;
      const el = this.root.querySelector('[data-region="cron-status"]');
      if (!el) return;
      const expr = String(f.cron || '').trim();
      const quick = cronRejection(expr);
      if (quick) {
        f.cronValid = false;
        el.className = 'njwf-help bad';
        el.innerHTML = `${icon('alert', 12)} ${esc(quick)}`;
        return;
      }
      if (f.cronPreview && f.cronPreview.expr === expr) {
        const p = f.cronPreview;
        f.cronValid = p.valid;
        el.className = `njwf-help ${p.valid ? 'ok' : 'bad'}`;
        const phrase = describeCron(expr);
        el.innerHTML = p.valid
          ? `${icon('check', 12)} <span>${phrase ? `${esc(phrase)}. ` : ''}Next: ${p.nextRuns.slice(0, 3).map(r => esc(fmtDateTime(r))).join(' · ')}</span>`
          : `${icon('alert', 12)} ${esc(p.error)}`;
        return;
      }
      el.className = 'njwf-help';
      el.textContent = 'Checking…';
      clearTimeout(this.previewTimer_);
      const seq = ++this.previewSeq_;
      this.previewTimer_ = setTimeout(async () => {
        try {
          const preview = await this.api_('GET', `/cron/preview?count=3&expression=${encodeURIComponent(expr)}`);
          if (seq !== this.previewSeq_ || !this.form) return;
          this.form.cronPreview = { expr, ...preview };
        } catch (err) {
          if (seq !== this.previewSeq_ || !this.form) return;
          this.form.cronPreview = { expr, valid: true, error: null, nextRuns: [], unchecked: true };
        }
        this.refreshCronStatus_();
      }, 250);
    }

    // -------------------------------------------------------------------------
    // Executions screen
    // -------------------------------------------------------------------------

    /**
     * Outcome statistics strip.
     * @param {?Object} s - Stats
     * @return {string} Markup
     * @private
     */
    statStrip_(s) {
      if (!s) return '';
      return `<div class="njwf-stats">
        <div class="njwf-stat"><div class="l">Total runs</div><div class="v">${s.total}</div></div>
        <div class="njwf-stat"><div class="l">Succeeded</div><div class="inline-ca4a80ae v">${s.succeeded}</div></div>
        <div class="njwf-stat"><div class="l">Failed</div><div class="v${s.failed ? ' njwf-tone-danger' : ''}">${s.failed}</div></div>
        <div class="njwf-stat"><div class="l">Running</div><div class="v${s.running ? ' njwf-tone-info' : ''}">${s.running}</div></div>
        <div class="njwf-stat"><div class="l">Success rate</div><div class="v">${s.total ? `${s.successRate}%` : '—'}</div></div>
        <div class="njwf-stat"><div class="l">Avg duration</div><div class="inline-4ff818ff v">${s.averageDuration ? esc(fmtDuration(s.averageDuration)) : '—'}</div></div>
      </div>`;
    }

    /**
     * Status filter chips for executions.
     * @return {string} Markup
     * @private
     */
    execChips_() {
      return [['', 'All'], ['success', 'Succeeded'], ['failed', 'Failed'], ['running', 'Running']]
        .map(([v, label]) => `<button class="njwf-chip" type="button" aria-pressed="${this.ui.execStatus === v}" data-action="exec-status" data-value="${v}">${esc(label)}</button>`)
        .join('');
    }

    /**
     * Action buttons on an execution row.
     * @param {Object} e - Execution summary
     * @return {string} Markup
     * @private
     */
    execActions_(e) {
      const running = outcomeOf(e) === 'running';
      return `<div class="njwf-row tight">
        <button class="njwf-btn icon" type="button" title="Details" aria-label="Run details" data-action="view-run" data-id="${esc(e.executionId)}">${icon('eye', 13)}</button>
        ${!this.options.readOnly && running ? `<button class="njwf-btn icon danger" type="button" title="Cancel" aria-label="Cancel run" data-action="cancel-run" data-id="${esc(e.executionId)}">${icon('stop', 13)}</button>` : ''}
      </div>`;
    }

    /**
     * Progress text for a running execution.
     * @param {Object} e - Execution summary
     * @return {string} Text
     * @private
     */
    progress_(e) {
      if (outcomeOf(e) !== 'running' || !e.stepCount) return '';
      return `step ${Math.max(1, e.currentStep || 1)} of ${e.stepCount}`;
    }

    /**
     * Renders history across workflows.
     * @return {string} Markup
     * @private
     */
    renderExecutions_() {
      const page = this.data.executions || { executions: [], total: 0 };
      const list = page.executions;
      const ro = this.options.readOnly;
      const names = Array.from(new Set(this.data.workflows.map(w => w.name))).sort();
      const table = items => `<table class="njwf-table">
        <thead><tr><th>Workflow</th><th class="inline-d52ddd08">Started</th><th class="inline-60746827">Duration</th>
          <th class="inline-465bfea3 njwf-hide-sm">Trigger</th><th class="inline-7c07cdf8">Status</th><th class="inline-8573bae3"><span class="njwf-sr">Actions</span></th></tr></thead>
        <tbody>${items.map(e => `<tr>
          <td><div class="njwf-cell"><button class="njwf-link t" type="button" data-action="view-run" data-id="${esc(e.executionId)}">${esc(e.workflowName)}</button>
            <span class="s njwf-mono">${esc(String(e.executionId).slice(0, 12))}${e.error && outcomeOf(e) === 'failed' ? ` · <span class="inline-627e98b1">${esc(e.error)}</span>` : ''}</span></div></td>
          <td><div class="njwf-cell"><span class="njwf-small" title="${esc(fmtDateTime(e.startedAt))}">${esc(timeAgo(e.startedAt))}</span></div></td>
          <td class="njwf-mono">${outcomeOf(e) === 'running' ? '—' : esc(fmtDuration(e.duration))}</td>
          <td class="njwf-hide-sm"><div class="njwf-cell"><span class="njwf-small">${esc(triggerLabel(e.trigger))}</span>${e.scheduleName ? `<span class="s">${esc(e.scheduleName)}</span>` : ''}</div></td>
          <td><div class="njwf-cell">${pill(outcomeOf(e))}<span class="s">${esc(this.progress_(e))}</span></div></td>
          <td>${this.execActions_(e)}</td></tr>`).join('')}</tbody></table>`;
      const groups = this.groupBy_(list, e => e.group || this.groupOfWorkflow_(e.workflowName));
      const actions = `<button class="njwf-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>
        ${ro ? '' : `<button class="njwf-btn danger" type="button" data-action="clear-history" ${page.total ? '' : 'disabled'}>${icon('trash', 13)} Clear history</button>`}`;

      return `${this.head_('Execution history', 'Every run: succeeded, failed and in flight.', actions)}
        ${this.statStrip_(this.data.execStats)}
        <div class="njwf-card njwf-toolbar"><div class="njwf-row">
          ${this.execChips_()}
          <span class="njwf-spacer"></span>
          <select class="inline-0fac9183 njwf-select" data-field="execWorkflow" aria-label="Workflow">
            <option value="">All workflows</option>
            ${names.map(n => `<option value="${esc(n)}"${this.ui.execWorkflow === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
        </div></div>
        ${list.length
    ? `<div class="njwf-groups">${groups.map(g => this.group_('executions', g.key, g.items.length, 'run', table(g.items))).join('')}</div>`
    : this.empty_('history', 'No runs', this.ui.execStatus ? 'No runs match this filter.' : 'Runs appear here once workflows execute.')}
        <div class="njwf-footer">Showing ${list.length} of ${page.total} run${page.total === 1 ? '' : 's'}
          ${page.total > list.length ? ` · <button class="njwf-btn" type="button" data-action="load-more">Load more</button>` : ''}</div>`;
    }

    /**
     * Renders one workflow's history.
     * @return {string} Markup
     * @private
     */
    renderScopedExecutions_() {
      const res = this.data.scoped || { executions: [], stats: null, window: {}, workflow: {} };
      const list = res.executions || [];
      const w = res.window || {};
      const name = this.params.workflowName;
      const noun = this.ui.execStatus ? `${this.ui.execStatus} run` : 'run';
      const counts = w.truncated
        ? `Showing the ${list.length} most recent of ${w.matched} ${noun}s`
        : `${list.length} ${noun}${list.length === 1 ? '' : 's'}`;
      const windowLabel = w.days ? `last ${w.days} days` : 'all retained history';
      const table = `<table class="njwf-table">
        <thead><tr><th class="inline-4854a4d7">Started</th><th class="inline-830eb986 njwf-hide-sm">Execution</th><th class="inline-60746827">Duration</th>
          <th class="inline-c6fffdfe njwf-hide-sm">Trigger</th><th class="inline-7c07cdf8">Status</th><th class="inline-8573bae3"><span class="njwf-sr">Actions</span></th></tr></thead>
        <tbody>${list.map(e => `<tr>
          <td><div class="njwf-cell"><button class="njwf-link t" type="button" data-action="view-run" data-id="${esc(e.executionId)}">${esc(fmtDateTime(e.startedAt))}</button><span class="s">${esc(timeAgo(e.startedAt))}</span></div></td>
          <td class="njwf-hide-sm njwf-mono njwf-muted">${esc(String(e.executionId).slice(0, 12))}</td>
          <td class="njwf-mono">${outcomeOf(e) === 'running' ? '—' : esc(fmtDuration(e.duration))}</td>
          <td class="njwf-hide-sm"><div class="njwf-cell"><span class="njwf-small">${esc(triggerLabel(e.trigger))}</span>${e.scheduleName ? `<span class="s">${esc(e.scheduleName)}</span>` : ''}</div></td>
          <td><div class="njwf-cell">${pill(outcomeOf(e))}<span class="s">${outcomeOf(e) === 'failed' && e.error ? esc(e.error) : esc(this.progress_(e))}</span></div></td>
          <td>${this.execActions_(e)}</td></tr>`).join('')}</tbody></table>`;

      return `${this.head_('Execution history', 'Runs of one workflow over a look-back window.',
        `<button class="njwf-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>`)}
        <div class="njwf-card njwf-banner">
          <span class="njwf-faint">${icon('workflow', 18)}</span>
          <div><div class="t">${esc(name)}${res.workflow && res.workflow.exists === false ? ' <span class="njwf-pill warn">deleted</span>' : ''}</div>
            <div class="njwf-inline-note">${esc(counts)} · ${esc(windowLabel)}</div></div>
          <span class="njwf-spacer"></span>
          <div class="njwf-row" role="group" aria-label="Look-back window">${DAY_RANGES.map(r =>
    `<button class="njwf-chip" type="button" aria-pressed="${this.ui.days === r.days}" data-action="set-days" data-days="${r.days}">${esc(r.label)}</button>`).join('')}</div>
          <button class="njwf-btn" type="button" data-action="clear-scope">All workflows</button>
        </div>
        ${this.statStrip_(res.stats)}
        <div class="njwf-card njwf-toolbar"><div class="njwf-row">${this.execChips_()}</div></div>
        ${list.length ? `<div class="njwf-card"><div class="njwf-table-wrap">${table}</div></div>`
    : this.empty_('history', 'No runs in this window',
      `Nothing recorded for this workflow in the ${windowLabel}${this.ui.execStatus ? ` with status "${this.ui.execStatus}"` : ''}. Widen the range to look further back.`)}
        ${w.retainedPerWorkflow ? `<div class="njwf-footer">The newest ${w.retainedPerWorkflow} runs per workflow are kept in memory.</div>` : ''}`;
    }

    /**
     * Renders a run's detail view.
     * @return {string} Markup
     * @private
     */
    renderRunDetail_() {
      const e = this.data.detail;
      if (!e) return `<div class="njwf-loading">Loading…</div>`;
      const bucket = outcomeOf(e);
      const steps = Array.isArray(e.stepExecutions) ? e.stepExecutions : [];
      const ro = this.options.readOnly;
      const pending = bucket === 'running' && e.stepCount ? Math.max(0, e.stepCount - steps.length) : 0;
      return `<button class="inline-da12f285 njwf-btn ghost" type="button" data-action="back">${icon('chevronLeft', 13)} Back</button>
        <div class="njwf-card pad">
          <div class="inline-761d3add njwf-head">
            <div><h2 class="njwf-title">${esc(e.workflowName)}</h2>
              <div class="inline-fe7b4979 njwf-row">${pill(bucket)}<span class="njwf-code-inline">${esc(e.executionId)}</span></div></div>
            <div class="njwf-row">
              <button class="njwf-btn" type="button" data-action="refresh-run" data-id="${esc(e.executionId)}">${icon('refresh', 13)} Refresh</button>
              <button class="njwf-btn" type="button" data-action="workflow-history" data-name="${esc(e.workflowName)}">${icon('history', 13)} Workflow history</button>
              ${!ro && bucket === 'running' ? `<button class="njwf-btn danger" type="button" data-action="cancel-run" data-id="${esc(e.executionId)}">${icon('stop', 13)} Cancel</button>` : ''}
              ${!ro && bucket !== 'running' ? `<button class="njwf-btn danger" type="button" data-action="delete-run" data-id="${esc(e.executionId)}">${icon('trash', 13)} Delete</button>` : ''}
            </div>
          </div>
          <div class="njwf-kv">
            <div><div class="k">Started</div><div class="v">${esc(fmtDateTime(e.startedAt))}</div></div>
            <div><div class="k">Finished</div><div class="v">${esc(fmtDateTime(e.endedAt))}</div></div>
            <div><div class="k">Duration</div><div class="v njwf-mono">${bucket === 'running' ? '—' : esc(fmtDuration(e.duration))}</div></div>
            <div><div class="k">Trigger</div><div class="v">${esc(triggerLabel(e.trigger))}${e.scheduleName ? ` · ${esc(e.scheduleName)}` : ''}</div></div>
            <div><div class="k">Steps</div><div class="v">${steps.length}${e.stepCount ? ` of ${e.stepCount}` : ''}</div></div>
          </div>
          ${e.error ? `<div class="njwf-section"><div class="inline-627e98b1 njwf-label">Error</div><pre class="njwf-pre err">${esc(e.error)}</pre></div>` : ''}
          <div class="njwf-section"><div class="njwf-label">Steps</div>
            ${steps.length || pending ? `<div class="njwf-timeline">
              ${steps.map((st, i) => {
    const sb = st.status === 'completed' ? 'success' : (st.status === 'error' ? 'failed' : 'other');
    return `<details class="njwf-tl-item"${sb === 'failed' ? ' open' : ''}>
                  <summary><span class="njwf-step-num">${i + 1}</span>
                    <span class="njwf-cell"><span class="t">${esc(st.stepName || `Step ${i + 1}`)}</span><span class="s njwf-mono">${esc(st.stepPath || '')}</span></span>
                    <span class="njwf-mono njwf-muted">${esc(fmtDuration(st.duration))}</span>${pill(sb)}</summary>
                  <div class="body">
                    ${st.error ? `<pre class="inline-fdf33f23 njwf-pre err">${esc(st.error)}</pre>` : ''}
                    ${st.outputData ? `<div class="njwf-label">Output</div><pre class="njwf-pre">${esc(prettyJson(st.outputData))}</pre>` : ''}
                  </div></details>`;
  }).join('')}
              ${pending ? `<div class="njwf-tl-item"><div class="inline-cfa1ecf5" class="njwf-row">${pill('running')}<span class="njwf-muted njwf-small">${pending} step${pending === 1 ? '' : 's'} still to run</span></div></div>` : ''}
            </div>` : '<div class="njwf-muted njwf-small">No steps recorded.</div>'}
          </div>
          <div class="njwf-section"><div class="njwf-label">Input</div><pre class="njwf-pre">${esc(prettyJson(e.inputData || {}))}</pre></div>
          ${e.outputData ? `<div class="njwf-section"><div class="njwf-label">${bucket === 'success' ? 'Result' : 'Partial result'}</div><pre class="njwf-pre">${esc(prettyJson(e.outputData))}</pre></div>` : ''}
        </div>`;
    }

    // -------------------------------------------------------------------------
    // Polling
    // -------------------------------------------------------------------------

    /**
     * Whether anything on screen is still running.
     * @return {boolean}
     * @private
     */
    hasRunning_() {
      if (this.view === 'run-detail') return outcomeOf(this.data.detail) === 'running';
      if (this.view !== 'list') return false;
      if (this.screen === 'workflows') return Object.values(this.data.lastRuns).some(r => outcomeOf(r) === 'running');
      if (this.screen === 'schedules') return this.data.schedules.some(s => s.running || s.lastResult === 'running');
      const list = this.params.workflowName
        ? (this.data.scoped && this.data.scoped.executions) || []
        : (this.data.executions && this.data.executions.executions) || [];
      return list.some(e => outcomeOf(e) === 'running');
    }

    /**
     * Arms a refresh while runs are in flight.
     * @private
     */
    schedulePoll_() {
      this.stopPolling_();
      if (!this.options.pollInterval || !this.root || !this.hasRunning_()) return;
      this.pollTimer_ = setTimeout(async () => {
        this.pollTimer_ = null;
        if (!this.root || document.hidden) return this.schedulePoll_();
        if (this.view === 'run-detail' && this.data.detail) {
          await this.openRun_(this.data.detail.executionId, { quiet: true });
        } else if (this.view === 'list') {
          await this.reload({ quiet: true });
        }
        return undefined;
      }, this.options.pollInterval);
    }

    /**
     * Cancels a pending refresh.
     * @private
     */
    stopPolling_() {
      if (this.pollTimer_) clearTimeout(this.pollTimer_);
      this.pollTimer_ = null;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /**
     * Handles typing and select changes.
     * @param {Event} event - DOM event
     * @private
     */
    onInput_(event) {
      const t = event.target;
      if (!t || !t.dataset) return;
      if (t.dataset.field === 'search') {
        this.ui.search = t.value;
        clearTimeout(this.searchTimer_);
        this.searchTimer_ = setTimeout(() => this.paint_(), 150);
      } else if (t.dataset.field === 'statusFilter' && event.type === 'change') {
        this.ui.statusFilter = t.value;
        this.paint_();
      } else if (t.dataset.field === 'execWorkflow' && event.type === 'change') {
        this.ui.execWorkflow = t.value;
        this.ui.execLimit = 200;
        this.reload({ quiet: true });
      } else if (t.dataset.step !== undefined && this.form) {
        this.form.steps[Number(t.dataset.step)] = t.value;
      } else if (t.dataset.form && this.form) {
        this.onFormInput_(t, event.type);
      }
    }

    /**
     * Applies a form field change.
     * @param {HTMLElement} t - Field element
     * @param {string} type - input | change
     * @private
     */
    onFormInput_(t, type) {
      const key = t.dataset.form;
      const f = this.form;
      if (key === 'importFile') return;
      f[key] = t.type === 'checkbox' ? t.checked : t.value;

      if (key === 'defaultInput' || key === 'input') {
        f.inputError = parseJsonObject(t.value).error;
        const region = this.root.querySelector('[data-region="input-status"]');
        if (region) {
          const help = key === 'input' ? 'Passed to the workflow on every run.' : 'Used when a run is started without input.';
          region.innerHTML = f.inputError
            ? `<div class="njwf-help bad">${icon('alert', 12)} ${esc(f.inputError)}</div>`
            : `<div class="njwf-help ${t.value.trim() ? 'ok' : ''}">${t.value.trim() ? `${icon('check', 12)} Valid JSON. ` : ''}${help}</div>`;
        }
      }
      if (f.kind === 'schedule') {
        if (key === 'cron') {
          f.cronPreview = null;
          this.refreshCronStatus_();
          this.root.querySelectorAll('[data-action="cron-preset"]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.cron === t.value.trim()));
          });
        }
        if (['cron', 'workflowName', 'intervalValue', 'intervalUnit'].includes(key)) {
          const derived = this.derivedScheduleName_();
          const nameInput = this.root.querySelector('[data-form="name"]');
          if (nameInput) nameInput.placeholder = derived;
          const note = this.root.querySelector('[data-region="derived-name"]');
          if (note) note.textContent = `Leave empty to use “${derived}”.`;
        }
        if (key === 'workflowName' && type === 'change') this.paint_();
      }
    }

    /**
     * Enter in a form input submits it.
     * @param {KeyboardEvent} event - Key event
     * @private
     */
    onKeyDown_(event) {
      if (event.key !== 'Enter' || !this.form) return;
      const t = event.target;
      if (!t || t.tagName !== 'INPUT' || t.type === 'file' || t.type === 'checkbox') return;
      event.preventDefault();
      if (this.form.kind === 'workflow') this.saveWorkflow_();
      else if (this.form.kind === 'schedule') this.saveSchedule_();
    }

    /**
     * Routes clicks on `[data-action]` elements.
     * @param {MouseEvent} event - Click event
     * @private
     */
    async onClick_(event) {
      const el = event.target.closest('[data-action]');
      if (!el || !this.root.contains(el) || el.disabled) return;
      const action = el.dataset.action;
      const d = el.dataset;
      try {
        switch (action) {
          case 'nav': return this.navigate(d.screen, {});
          case 'retry':
          case 'refresh': return this.reload();
          case 'back': return this.back_();
          case 'toggle-group': {
            const map = this.ui.expanded[this.screen];
            map[d.key] = map[d.key] === false;
            this.save_(`${this.screen}.expanded`, map);
            return this.paint_();
          }
          case 'set-filter':
            this.ui[d.filter] = d.value;
            return this.paint_();
          case 'toggle-starred':
            this.ui.starredOnly = !this.ui.starredOnly;
            return this.paint_();
          case 'toggle-star': return this.toggleStar_(d.name);
          case 'run-workflow': return this.runWorkflow_(d.name);
          case 'schedule-workflow': return this.openScheduleForm_(null, d.name, 'workflows');
          case 'new-workflow': return this.openWorkflowForm_(null);
          case 'edit-workflow': return this.openWorkflowForm_(d.name);
          case 'delete-workflow': return this.deleteWorkflow_(d.name);
          case 'export-workflow': return this.exportWorkflow_(d.name);
          case 'save-workflow': return this.saveWorkflow_();
          case 'step-add':
            this.form.steps.push('');
            this.paint_();
            return this.focusStep_(this.form.steps.length - 1);
          case 'step-remove':
            this.form.steps.splice(Number(d.index), 1);
            return this.paint_();
          case 'step-up':
          case 'step-down': {
            const i = Number(d.index);
            const j = action === 'step-up' ? i - 1 : i + 1;
            const s = this.form.steps;
            [s[i], s[j]] = [s[j], s[i]];
            this.paint_();
            return this.focusStep_(j);
          }
          case 'show-import':
            this.form = { kind: 'import' };
            return this.showView_('import');
          case 'do-import': return this.importWorkflow_();
          case 'workflow-history':
            return this.navigate('executions', { workflowName: d.name });
          case 'new-schedule': return this.openScheduleForm_(null, '', 'schedules');
          case 'edit-schedule': return this.openScheduleForm_(d.id, null, 'schedules');
          case 'set-mode':
            this.form.mode = d.mode;
            return this.paint_();
          case 'cron-preset':
            this.form.cron = d.cron;
            this.form.cronPreview = null;
            return this.paint_();
          case 'save-schedule': return this.saveSchedule_();
          case 'toggle-schedule': return this.toggleSchedule_(d.id);
          case 'run-schedule': return this.runSchedule_(d.id);
          case 'delete-schedule': return this.deleteSchedule_(d.id, d.name);
          case 'exec-status':
            this.ui.execStatus = d.value;
            this.ui.execLimit = 200;
            return this.reload({ quiet: true });
          case 'set-days':
            this.ui.days = Number(d.days) || 0;
            return this.reload({ quiet: true });
          case 'clear-scope': return this.navigate('executions', {});
          case 'load-more':
            this.ui.execLimit += 200;
            return this.reload({ quiet: true });
          case 'clear-history': return this.clearHistory_();
          case 'view-run': return this.openRun_(d.id);
          case 'refresh-run': return this.openRun_(d.id, { quiet: true });
          case 'cancel-run': return this.cancelRun_(d.id);
          case 'delete-run': return this.deleteRun_(d.id);
          default: return undefined;
        }
      } catch (err) {
        this.toast_(err.message, 'danger');
        this.options.onError?.(err);
        return undefined;
      }
    }

    /**
     * Opens a sub-view, bringing the panel's top into view when the page
     * was scrolled down to the row that opened it.
     * @param {string} view - View name
     * @private
     */
    showView_(view) {
      this.view = view;
      this.stopPolling_();
      this.paint_();
      if (this.root && this.root.getBoundingClientRect().top < 0) {
        this.root.scrollIntoView({ block: 'start' });
      }
    }

    /**
     * Focuses a step input in the workflow form.
     * @param {number} index - Step index
     * @private
     */
    focusStep_(index) {
      const input = this.root.querySelector(`[data-step="${index}"]`);
      if (input) input.focus();
    }

    /**
     * Leaves a sub-view.
     * @private
     */
    back_() {
      const returnTo = this.form && this.form.returnTo;
      this.view = 'list';
      this.form = null;
      this.data.detail = null;
      if (returnTo && returnTo !== this.screen) return this.navigate(returnTo, {});
      return this.reload({ quiet: true });
    }

    // -------------------------------------------------------------------------
    // Actions: workflows
    // -------------------------------------------------------------------------

    /**
     * Toggles a workflow's star optimistically.
     * @param {string} name - Workflow name
     * @private
     */
    async toggleStar_(name) {
      const w = this.data.workflows.find(x => x.name === name);
      if (!w) return;
      w.starred = !w.starred;
      this.paint_();
      try {
        await this.api_('POST', `/workflows/${encodeURIComponent(name)}/star`, { starred: w.starred });
      } catch (err) {
        w.starred = !w.starred;
        this.paint_();
        throw err;
      }
    }

    /**
     * Starts a workflow run.
     * @param {string} name - Workflow name
     * @private
     */
    async runWorkflow_(name) {
      await this.api_('POST', `/workflows/${encodeURIComponent(name)}/execute`, {});
      this.toast_(`Started ${name}`, 'success');
      await this.reload({ quiet: true });
    }

    /**
     * Opens the workflow form.
     * @param {?string} name - Workflow to edit, or null for a new one
     * @private
     */
    async openWorkflowForm_(name) {
      let w = null;
      if (name) {
        w = await this.api_('GET', `/workflows/${encodeURIComponent(name)}`);
        this.api_('POST', `/workflows/${encodeURIComponent(name)}/view`).catch(() => {});
      }
      this.form = {
        kind: 'workflow',
        original: w ? w.name : null,
        name: w ? w.name : '',
        group: w ? (w.group || '') : '',
        description: w ? w.description : '',
        tags: w ? (w.tags || []).join(', ') : '',
        steps: w ? w.steps.slice() : [''],
        defaultInput: w && w.defaultInput ? JSON.stringify(w.defaultInput, null, 2) : '',
        inputError: null
      };
      this.showView_('workflow-form');
      const first = this.root.querySelector('[data-form="name"]');
      if (first && !name) first.focus();
    }

    /**
     * Validates and saves the workflow form.
     * @private
     */
    async saveWorkflow_() {
      const f = this.form;
      if (!f || f.kind !== 'workflow') return;
      const steps = f.steps.map(s => s.trim()).filter(Boolean);
      const input = parseJsonObject(f.defaultInput);
      if (!f.name.trim()) return this.toast_('Name is required', 'danger');
      if (!steps.length) return this.toast_('Add at least one step', 'danger');
      if (input.error) return this.toast_(`Default input: ${input.error}`, 'danger');
      const body = {
        name: f.name.trim(),
        group: f.group.trim() || null,
        description: f.description.trim(),
        tags: f.tags.split(',').map(t => t.trim()).filter(Boolean),
        steps,
        defaultInput: Object.keys(input.value).length ? input.value : null
      };
      if (f.original) {
        await this.api_('PUT', `/workflows/${encodeURIComponent(f.original)}`, body);
        this.toast_('Workflow saved', 'success');
      } else {
        await this.api_('POST', '/workflows', body);
        this.toast_('Workflow created', 'success');
      }
      return this.back_();
    }

    /**
     * Deletes a workflow after confirmation.
     * @param {string} name - Workflow name
     * @private
     */
    async deleteWorkflow_(name) {
      const w = this.data.workflows.find(x => x.name === name);
      const extra = w && w.scheduleCount ? ` Its ${w.scheduleCount} schedule${w.scheduleCount === 1 ? '' : 's'} and run history will be deleted too.` : ' Its run history will be deleted too.';
      if (!global.confirm(`Delete workflow "${name}"?${extra} This cannot be undone.`)) return;
      await this.api_('DELETE', `/workflows/${encodeURIComponent(name)}`);
      this.toast_('Workflow deleted', 'success');
      this.view = 'list';
      this.form = null;
      await this.reload({ quiet: true });
    }

    /**
     * Downloads a workflow's export JSON.
     * @param {string} name - Workflow name
     * @private
     */
    async exportWorkflow_(name) {
      const data = await this.api_('GET', `/workflows/${encodeURIComponent(name)}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.workflow.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Imports a workflow file, offering to overwrite on a name clash.
     * @private
     */
    async importWorkflow_() {
      const input = this.root.querySelector('[data-form="importFile"]');
      const file = input && input.files && input.files[0];
      if (!file) return this.toast_('Choose a JSON file first', 'danger');
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        return this.toast_(`Not valid JSON: ${err.message}`, 'danger');
      }
      try {
        await this.api_('POST', '/workflows/import', data);
      } catch (err) {
        if (err.status !== 409 || !global.confirm(`${err.message}. Replace it?`)) throw err;
        await this.api_('POST', '/workflows/import?overwrite=true', data);
      }
      this.toast_('Workflow imported', 'success');
      return this.back_();
    }

    // -------------------------------------------------------------------------
    // Actions: schedules
    // -------------------------------------------------------------------------

    /**
     * Opens the schedule form.
     * @param {?string} id - Schedule to edit, or null for a new one
     * @param {?string} workflowName - Pre-selected workflow for a new schedule
     * @param {string} returnTo - Screen to return to
     * @private
     */
    async openScheduleForm_(id, workflowName, returnTo) {
      let s = null;
      if (id) s = await this.api_('GET', `/schedules/${encodeURIComponent(id)}`);
      if (!this.data.workflows.length) this.data.workflows = await this.api_('GET', '/workflows');
      let intervalValue = 15;
      let intervalUnit = 'minutes';
      if (s && s.interval) {
        const unit = ['hours', 'minutes', 'seconds'].find(u => s.interval % INTERVAL_UNITS[u] === 0) || 'seconds';
        intervalUnit = unit;
        intervalValue = s.interval / INTERVAL_UNITS[unit];
      }
      this.form = {
        kind: 'schedule',
        id: s ? s.id : null,
        returnTo,
        workflowName: s ? s.workflowName : (workflowName || ''),
        mode: s && s.interval ? 'interval' : 'cron',
        cron: s && s.cronExpression ? s.cronExpression : '0 2 * * *',
        intervalValue,
        intervalUnit,
        name: s ? s.name : '',
        description: s ? (s.description || '') : '',
        input: s && s.input && Object.keys(s.input).length ? JSON.stringify(s.input, null, 2) : '',
        enabled: s ? s.enabled : true,
        inputError: null,
        cronPreview: null,
        cronValid: false
      };
      this.showView_('schedule-form');
    }

    /**
     * Validates and saves the schedule form.
     * @private
     */
    async saveSchedule_() {
      const f = this.form;
      if (!f || f.kind !== 'schedule') return;
      if (!f.workflowName) return this.toast_('Choose a workflow', 'danger');
      const input = parseJsonObject(f.input);
      if (input.error) return this.toast_(`Input: ${input.error}`, 'danger');
      const body = {
        workflowName: f.workflowName,
        name: f.name.trim() || this.derivedScheduleName_(),
        description: f.description.trim(),
        input: input.value
      };
      if (f.mode === 'cron') {
        const rejection = cronRejection(f.cron);
        if (rejection) return this.toast_(rejection, 'danger');
        body.cronExpression = f.cron.trim();
        body.interval = null;
      } else {
        const ms = (Number(f.intervalValue) || 0) * INTERVAL_UNITS[f.intervalUnit];
        if (!(ms >= 1000)) return this.toast_('Interval must be at least 1 second', 'danger');
        body.interval = ms;
        body.cronExpression = null;
      }
      if (f.id) {
        // The API takes exactly one cadence; send only the active one.
        if (f.mode === 'cron') delete body.interval; else delete body.cronExpression;
        await this.api_('PUT', `/schedules/${encodeURIComponent(f.id)}`, body);
        this.toast_('Schedule saved', 'success');
      } else {
        if (f.mode === 'cron') delete body.interval; else delete body.cronExpression;
        body.enabled = !!f.enabled;
        await this.api_('POST', '/schedules', body);
        this.toast_(`Scheduled: ${body.name}`, 'success');
      }
      return this.back_();
    }

    /**
     * Pauses or enables a schedule.
     * @param {string} id - Schedule id
     * @private
     */
    async toggleSchedule_(id) {
      const s = await this.api_('POST', `/schedules/${encodeURIComponent(id)}/toggle`, {});
      this.toast_(s.enabled ? `Enabled ${s.name}` : `Paused ${s.name}`, 'success');
      await this.reload({ quiet: true });
    }

    /**
     * Runs a schedule now.
     * @param {string} id - Schedule id
     * @private
     */
    async runSchedule_(id) {
      await this.api_('POST', `/schedules/${encodeURIComponent(id)}/run-now`, {});
      this.toast_('Schedule triggered', 'success');
      await this.reload({ quiet: true });
    }

    /**
     * Deletes a schedule after confirmation.
     * @param {string} id - Schedule id
     * @param {string} name - Schedule name
     * @private
     */
    async deleteSchedule_(id, name) {
      if (!global.confirm(`Delete schedule "${name}"?`)) return;
      await this.api_('DELETE', `/schedules/${encodeURIComponent(id)}`);
      this.toast_('Schedule deleted', 'success');
      await this.reload({ quiet: true });
    }

    // -------------------------------------------------------------------------
    // Actions: runs
    // -------------------------------------------------------------------------

    /**
     * Opens a run's detail view.
     * @param {string} id - Execution id
     * @param {Object} [opts] - `{ quiet: true }` refreshes in place
     * @private
     */
    async openRun_(id, opts = {}) {
      if (!opts.quiet) {
        this.data.detail = null;
        this.showView_('run-detail');
      }
      try {
        this.data.detail = await this.api_('GET', `/runs/${encodeURIComponent(id)}`);
      } catch (err) {
        if (!opts.quiet) {
          this.view = 'list';
          this.paint_();
        }
        throw err;
      }
      if (this.view === 'run-detail') {
        // Keep open <details> panels open across a refresh.
        const open = Array.from(this.root.querySelectorAll('.njwf-tl-item[open]')).map(d => d.querySelector('.t')?.textContent);
        this.paint_();
        this.root.querySelectorAll('.njwf-tl-item').forEach((d) => {
          if (open.includes(d.querySelector('.t')?.textContent)) d.setAttribute('open', '');
        });
      }
      this.schedulePoll_();
    }

    /**
     * Asks a run to stop.
     * @param {string} id - Execution id
     * @private
     */
    async cancelRun_(id) {
      if (!global.confirm('Cancel this run? The step currently running will finish first.')) return;
      await this.api_('POST', `/runs/${encodeURIComponent(id)}/cancel`, {});
      this.toast_('Cancelling after the current step', 'success');
      if (this.view === 'run-detail') await this.openRun_(id, { quiet: true });
      else await this.reload({ quiet: true });
    }

    /**
     * Deletes a finished run's record.
     * @param {string} id - Execution id
     * @private
     */
    async deleteRun_(id) {
      if (!global.confirm('Delete this run from the history?')) return;
      await this.api_('DELETE', `/runs/${encodeURIComponent(id)}`);
      this.toast_('Run deleted', 'success');
      return this.back_();
    }

    /**
     * Clears finished history after confirmation.
     * @private
     */
    async clearHistory_() {
      const scope = this.ui.execWorkflow;
      const what = scope ? `all finished runs of "${scope}"` : 'all finished runs';
      if (!global.confirm(`Clear ${what}? Runs in flight are kept. This cannot be undone.`)) return;
      const res = await this.api_('POST', '/runs/clear', scope ? { workflowName: scope } : {});
      this.toast_(`Cleared ${res.deletedCount} run${res.deletedCount === 1 ? '' : 's'}`, 'success');
      await this.reload({ quiet: true });
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Shows a transient message.
     * @param {string} message - Text
     * @param {string} [kind] - success | danger
     * @private
     */
    toast_(message, kind) {
      const region = this.root && this.root.querySelector('[data-region="toasts"]');
      if (!region) return;
      const el = document.createElement('div');
      el.className = `njwf-toast ${kind || ''}`;
      el.innerHTML = `${icon(kind === 'danger' ? 'alert' : 'check', 14)}<span>${esc(message)}</span>`;
      region.appendChild(el);
      setTimeout(() => el.remove(), kind === 'danger' ? 6000 : 3000);
    }

    /**
     * Reads remembered UI state.
     * @param {string} key - Key suffix
     * @param {*} fallback - Value when missing
     * @return {*} Stored value
     * @private
     */
    load_(key, fallback) {
      try {
        const raw = global.localStorage.getItem(`${this.options.storageKey}.${key}`);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_err) {
        return fallback;
      }
    }

    /**
     * Remembers UI state (best effort).
     * @param {string} key - Key suffix
     * @param {*} value - Value
     * @private
     */
    save_(key, value) {
      try {
        global.localStorage.setItem(`${this.options.storageKey}.${key}`, JSON.stringify(value));
      } catch (_err) {
        /* storage unavailable (private mode / quota) - non-fatal */
      }
    }
  }

  WorkflowManagerUI.describeCron = describeCron;
  WorkflowManagerUI.cronRejection = cronRejection;

  global.WorkflowManagerUI = WorkflowManagerUI;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkflowManagerUI;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
