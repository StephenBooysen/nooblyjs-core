/**
 * @fileoverview NooblyJS Core Schedule Manager UI Client Library.
 * Renders the schedule manager - grouped schedules with cadence, next run,
 * each schedule's own last result, pause / run now / edit, live cron
 * validation, and run history with run details - into any container element.
 *
 * It shares its look with the workflow manager (`/services/workflow/scripts/js/index.js`)
 * but has its own namespaced styles (`njsc-`), so both can load on one page.
 * Sub-views render inline rather than in overlay modals, and colours resolve
 * against the host's NooblyJS design tokens (`--ink`, `--accent`, ... from
 * `/services/css/styles.css` and `core.css`).
 *
 * @author NooblyJS Core Team
 * @version 1.1.0
 * @since 1.0.15
 *
 * @example
 * // <script src="/services/scheduling/scripts/js/index.js"></script>
 * new ScheduleManagerUI({ containerId: 'scheduleManager' }).initialize();
 *
 * @example
 * // Run history only, read only
 * new ScheduleManagerUI({ containerId: 'runs', screens: ['runs'], readOnly: true }).initialize();
 */

(function (global) {
  'use strict';

  /** @const {string} Identifier of the injected style element. */
  const STYLE_ID = 'nooblyjs-scheduling-ui-styles';

  /** @const {number} Largest result payload rendered in a run's detail view. */
  const MAX_JSON_CHARS = 200000;

  /** @const {!Array<!Array<string>>} Cron presets (numeric day-of-week: the parser has no names). */
  const CRON_PRESETS = [
    ['*/15 * * * *', 'Every 15 min'],
    ['0 * * * *', 'Hourly'],
    ['0 2 * * *', 'Daily 02:00'],
    ['0 8 * * 1-5', 'Weekdays 08:00'],
    ['0 0 1 * *', 'Monthly']
  ];

  /** @const {!Array<string>} */
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /** @const {!Array<string>} */
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    return `<span class="njsc-pill ${cls}"><span class="njsc-dot"></span>${esc(label || text)}</span>`;
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

  /** @const {!Object<string, string>} Screen titles. */
  const SCREENS = {
    schedules: 'Schedules',
    runs: 'Run history'
  };

  /** @const {!Object<string, number>} Interval units in seconds. */
  const INTERVAL_SECONDS = { seconds: 1, minutes: 60, hours: 3600 };

  /**
   * Parses any JSON value; empty input means null.
   * @param {string} raw - Raw text
   * @return {{value: *, error: ?string}}
   */
  function parseJsonValue(raw) {
    const text = String(raw || '').trim();
    if (!text) return { value: null, error: null };
    try {
      return { value: JSON.parse(text), error: null };
    } catch (err) {
      return { value: null, error: `Invalid JSON: ${err.message}` };
    }
  }

  /**
   * The last path segment of a script path.
   * @param {?string} p - Path
   * @return {string} File name
   */
  function baseName(p) {
    return String(p || '').split(/[\\/]/).pop();
  }

  /**
   * Schedule manager UI for the scheduling service.
   * @class
   */
  class ScheduleManagerUI {
    /**
     * @param {Object} options - Options
     * @param {string} options.containerId - Id of the element to render into
     * @param {string} [options.apiBaseUrl='/services/scheduling/api'] - Scheduling API root
     * @param {Object} [options.fetchOptions] - Extra fetch options (e.g. `headers`, `credentials`)
     * @param {Array<string>} [options.screens] - Screens to offer: schedules, runs
     * @param {string} [options.initialScreen] - Screen shown first
     * @param {boolean} [options.readOnly=false] - Hide every action that changes state
     * @param {number} [options.pollInterval=5000] - Refresh cadence (ms) while runs are in flight; 0 disables
     * @param {string} [options.storageKey='njsc'] - Prefix for remembered UI state in localStorage
     * @param {function(string, Object)} [options.onNavigate] - Called with (screen, params) on navigation
     * @param {function(Error)} [options.onError] - Called when an API call fails
     */
    constructor(options = {}) {
      this.options = {
        apiBaseUrl: '/services/scheduling/api',
        fetchOptions: {},
        screens: ['schedules', 'runs'],
        readOnly: false,
        pollInterval: 5000,
        storageKey: 'njsc',
        ...options
      };
      this.options.screens = this.options.screens.filter(s => SCREENS[s]);
      if (this.options.screens.length === 0) this.options.screens = ['schedules'];

      this.root = null;
      this.screen = this.options.screens.includes(this.options.initialScreen)
        ? this.options.initialScreen : this.options.screens[0];
      this.view = 'list';
      this.params = {};
      this.data = { tasks: [], stats: null, runs: null, detail: null };
      this.ui = { search: '', statusFilter: '', runStatus: '', runTask: '', runLimit: 200, expanded: {} };
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
      if (!this.root) throw new Error(`ScheduleManagerUI: no element with id "${this.options.containerId}"`);
      this.injectStyles_();
      for (const screen of Object.keys(SCREENS)) {
        this.ui.expanded[screen] = this.load_(`${screen}.expanded`, {});
      }
      this.root.classList.add('njsc-root');
      this.root.innerHTML = `
        <nav class="njsc-tabs" role="tablist" aria-label="Schedule manager" data-region="tabs"></nav>
        <div data-region="body"></div>
        <div class="njsc-toasts" data-region="toasts" role="status" aria-live="polite"></div>`;
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
      this.root.classList.remove('njsc-root');
      this.root = null;
    }

    /**
     * Shows a screen.
     * @param {string} screen - schedules | runs
     * @param {Object} [params] - `{ taskName }` scopes run history to one schedule
     * @return {Promise<void>}
     */
    async navigate(screen, params = {}) {
      if (!this.options.screens.includes(screen)) return;
      const prevScope = this.params.taskName || null;
      this.screen = screen;
      this.params = params || {};
      this.view = 'list';
      this.form = null;
      if (screen === 'runs' && (this.params.taskName || null) !== prevScope) {
        this.ui.runStatus = '';
        this.ui.runTask = '';
        this.ui.runLimit = 200;
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
     * Calls the scheduling API.
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
      const jobs = [
        this.api_('GET', '/tasks').then((t) => { this.data.tasks = t || []; }),
        this.api_('GET', '/tasks/stats').then((s) => { this.data.stats = s; }).catch(() => {})
      ];
      if (this.screen === 'runs') {
        const qs = new URLSearchParams({ limit: String(this.ui.runLimit) });
        const scope = this.params.taskName || this.ui.runTask;
        if (scope) qs.set('taskName', scope);
        if (this.ui.runStatus) qs.set('status', this.ui.runStatus);
        jobs.push(this.api_('GET', `/runs?${qs}`).then((r) => { this.data.runs = r; }));
      }
      await Promise.all(jobs);
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
      style.href = '/services/css/scheduling-ui.css';
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
      tabs.innerHTML = this.options.screens.map((s) => {
        const iconName = s === 'schedules' ? 'clock' : 'history';
        const count = s === 'schedules' && this.data.tasks.length ? `<span class="njsc-count">${this.data.tasks.length}</span>` : '';
        return `<button class="njsc-tab" role="tab" type="button" aria-selected="${s === this.screen}" data-action="nav" data-screen="${s}">${icon(iconName, 14)} ${esc(SCREENS[s])}${count}</button>`;
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
      if (this.loading && !this.hasData_()) html = `<div class="njsc-loading">Loading…</div>`;
      else if (this.error && !this.hasData_()) html = this.errorBlock_(this.error);
      else html = this.renderScreen_();
      body.innerHTML = html;

      if (field === 'search') {
        const input = body.querySelector('[data-field="search"]');
        if (input) {
          input.focus();
          if (caret !== null) input.setSelectionRange(caret, caret);
        }
      }
      if (this.form) this.refreshCronStatus_();
    }

    /**
     * Whether the current screen has data to show while reloading.
     * @return {boolean}
     * @private
     */
    hasData_() {
      return this.screen === 'runs' ? !!this.data.runs : this.data.tasks.length > 0;
    }

    /**
     * Error block with a retry button.
     * @param {Error} err - The error
     * @return {string} Markup
     * @private
     */
    errorBlock_(err) {
      return `<div class="njsc-error" role="alert">${icon('alert', 16)}<span>Could not load: ${esc(err.message)}</span>
        <span class="njsc-spacer"></span><button class="njsc-btn" type="button" data-action="retry">${icon('refresh', 13)} Retry</button></div>`;
    }

    /**
     * Renders the active screen/view.
     * @return {string} Markup
     * @private
     */
    renderScreen_() {
      if (this.view === 'form') return this.renderForm_();
      if (this.view === 'run-detail') return this.renderRunDetail_();
      if (this.screen === 'runs') return this.renderRuns_();
      return this.renderSchedules_();
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
      return `<div class="njsc-head"><div><h2 class="njsc-title">${esc(title)}</h2><p class="njsc-sub">${esc(sub)}</p></div>
        <div class="njsc-row">${actions || ''}</div></div>`;
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
      return `<section class="njsc-group ${open ? 'open' : ''}">
        <button class="njsc-group-head" type="button" aria-expanded="${open}" data-action="toggle-group" data-key="${esc(key)}">
          ${icon(open ? 'chevronDown' : 'chevronRight', 14)}<span class="njsc-faint">${icon('folder', 15)}</span>
          <span><span class="name">${esc(key)}</span><br><span class="meta">${count} ${noun}${count === 1 ? '' : 's'}</span></span>
          <span class="njsc-count">${count}</span>
        </button>
        ${open ? `<div class="njsc-table-wrap">${table}</div>` : ''}
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
      return `<div class="njsc-card"><div class="njsc-empty">${icon(iconName, 26)}<div class="h">${esc(heading)}</div>
        <div class="njsc-small">${esc(text)}</div>${action ? `<div class="inline-d6f2af6e">${action}</div>` : ''}</div></div>`;
    }

    /**
     * Groups items by a key function; typed fallback groups sort last.
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
      const fallback = k => (k === 'Cron schedules' || k === 'Interval schedules' ? 1 : 0);
      return Object.keys(buckets)
        .sort((a, b) => fallback(a) - fallback(b) || a.localeCompare(b))
        .map(key => ({ key, items: buckets[key] }));
    }

    /**
     * A task's group label: its own group, else its type.
     * @param {?Object} t - Task summary
     * @return {string} Group label
     * @private
     */
    groupOf_(t) {
      if (!t) return 'Removed schedules';
      return t.group || (t.type === 'interval' ? 'Interval schedules' : 'Cron schedules');
    }

    // -------------------------------------------------------------------------
    // Schedules screen
    // -------------------------------------------------------------------------

    /**
     * A task's cadence as markup.
     * @param {Object} t - Task summary
     * @return {string} Markup
     * @private
     */
    cadenceCell_(t) {
      if (t.type === 'cron') {
        const phrase = describeCron(t.cron);
        return `<div class="njsc-cell"><span class="njsc-code-inline">${esc(t.cron)}</span>${phrase ? `<span class="s">${esc(phrase)}</span>` : ''}</div>`;
      }
      return `<span class="njsc-small">${esc(describeInterval((t.intervalSeconds || 0) * 1000))}</span>`;
    }

    /**
     * A task's own last-run outcome.
     * @param {Object} t - Task summary
     * @return {string} Markup
     * @private
     */
    lastRunCell_(t) {
      if (t.running) {
        return `<div class="njsc-cell">${pill('running')}<span class="s">started ${esc(timeAgo(t.lastStartedAt))}</span></div>`;
      }
      if (!t.lastResult) return '<span class="njsc-faint njsc-small">Never run</span>';
      const bucket = t.lastResult === 'success' ? 'success' : 'failed';
      const at = t.lastFinishedAt || t.lastStartedAt;
      const tip = [fmtDateTime(at), bucket === 'failed' && t.lastError ? t.lastError : ''].filter(Boolean).join(' · ');
      const runs = t.executionCount ? `${t.executionCount} run${t.executionCount === 1 ? '' : 's'}` : '';
      return `<div class="njsc-cell" title="${esc(tip)}">
        <span class="inline-408b446d njsc-row">${pill(bucket)}<span class="njsc-muted njsc-small njsc-nowrap">${esc(timeAgo(at))}</span></span>
        <span class="s">${esc(runs)}${t.lastDurationMs !== null && t.lastDurationMs !== undefined ? ` · ${esc(fmtDuration(t.lastDurationMs))}` : ''}${bucket === 'failed' && t.lastError ? ` · ${esc(t.lastError)}` : ''}</span></div>`;
    }

    /**
     * Tasks that pass the search and status filters.
     * @return {Array<Object>}
     * @private
     */
    filteredTasks_() {
      const q = this.ui.search.trim().toLowerCase();
      return this.data.tasks.filter((t) => {
        if (this.ui.statusFilter === 'enabled' && !t.enabled) return false;
        if (this.ui.statusFilter === 'paused' && t.enabled) return false;
        if (this.ui.statusFilter === 'failing' && t.lastResult !== 'failed') return false;
        if (this.ui.statusFilter === 'running' && !t.running) return false;
        if (!q) return true;
        return [t.name, t.scriptPath, t.description, t.group, t.cron]
          .some(v => String(v || '').toLowerCase().includes(q));
      });
    }

    /**
     * Renders the schedules list.
     * @return {string} Markup
     * @private
     */
    renderSchedules_() {
      const ro = this.options.readOnly;
      const list = this.filteredTasks_();
      const st = this.data.stats;
      const actions = `<button class="njsc-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>
        ${ro ? '' : `<button class="njsc-btn primary" type="button" data-action="new-schedule">${icon('plus', 13)} New schedule</button>`}`;
      const stats = st ? `<div class="njsc-stats">
        <div class="njsc-stat"><div class="l">Schedules</div><div class="v">${st.total}</div></div>
        <div class="njsc-stat"><div class="l">Enabled</div><div class="inline-9fb34ef3 v">${st.enabled}</div></div>
        <div class="njsc-stat"><div class="l">Paused</div><div class="v">${st.paused}</div></div>
        <div class="njsc-stat"><div class="l">Last run failed</div><div class="v${st.failing ? ' njsc-tone-danger' : ''}">${st.failing}</div></div>
        <div class="njsc-stat"><div class="l">Runs recorded</div><div class="v">${st.totalExecutions}</div></div>
        <div class="njsc-stat"><div class="l">Active jobs</div><div class="v">${st.activeJobs}<span class="inline-eb673ec6 njsc-muted"> / ${st.maxConcurrentJobs}</span></div></div>
      </div>` : '';
      const chip = (value, label) => `<button class="njsc-chip" type="button" aria-pressed="${this.ui.statusFilter === value}" data-action="status-filter" data-value="${value}">${esc(label)}</button>`;

      const table = items => `<table class="njsc-table">
        <thead><tr><th>Schedule</th><th class="inline-d52ddd08">Cadence</th><th class="inline-28c0f6ec">Next run</th>
          <th class="inline-45d1f59d">Last run</th><th class="inline-db4cf10b">Status</th><th class="inline-fc2c71fc"><span class="njsc-sr">Actions</span></th></tr></thead>
        <tbody>${items.map(t => `<tr>
          <td><div class="njsc-cell">
            ${ro ? `<span class="t">${esc(t.name)}</span>` : `<button class="njsc-link t" type="button" data-action="edit-schedule" data-name="${esc(t.name)}">${esc(t.name)}</button>`}
            <span class="s" title="${esc(t.scriptPath || '')}">${t.scriptPath ? `<span class="njsc-mono">${esc(baseName(t.scriptPath))}</span>` : '<span class="njsc-faint">no script — recorded only</span>'}${t.description ? ` · ${esc(t.description)}` : ''}</span></div></td>
          <td>${this.cadenceCell_(t)}</td>
          <td><div class="njsc-cell"><span class="njsc-small">${t.nextRun ? esc(fmtDateTime(t.nextRun)) : '—'}</span>
            <span class="s">${t.nextRun ? esc(timeAgo(t.nextRun)) : ''}</span></div></td>
          <td>${this.lastRunCell_(t)}</td>
          <td>${t.enabled ? '<span class="njsc-pill success"><span class="njsc-dot"></span>Enabled</span>' : '<span class="njsc-pill warn">Paused</span>'}</td>
          <td><div class="njsc-row tight">
            ${ro ? '' : `<button class="njsc-btn icon" type="button" title="Run now" aria-label="Run ${esc(t.name)} now" data-action="run-now" data-name="${esc(t.name)}" ${t.running ? 'disabled' : ''}>${icon('play', 13)}</button>
            <button class="njsc-btn icon" type="button" title="Edit" aria-label="Edit ${esc(t.name)}" data-action="edit-schedule" data-name="${esc(t.name)}">${icon('pencil', 13)}</button>
            <button class="njsc-btn icon" type="button" title="${t.enabled ? 'Pause' : 'Enable'}" aria-label="${t.enabled ? 'Pause' : 'Enable'} ${esc(t.name)}" data-action="toggle" data-name="${esc(t.name)}">${icon(t.enabled ? 'pause' : 'play', 13)}</button>`}
            <button class="njsc-btn icon" type="button" title="Run history" aria-label="Run history of ${esc(t.name)}" data-action="history" data-name="${esc(t.name)}">${icon('history', 13)}</button>
            ${ro ? '' : `<button class="njsc-btn icon danger" type="button" title="Delete" aria-label="Delete ${esc(t.name)}" data-action="delete" data-name="${esc(t.name)}">${icon('trash', 13)}</button>`}
          </div></td></tr>`).join('')}</tbody></table>`;

      const groups = this.groupBy_(list, t => this.groupOf_(t));
      const toolbar = this.data.tasks.length ? `<div class="njsc-card njsc-toolbar"><div class="njsc-row">
          <label class="njsc-search">${icon('search', 14)}<span class="njsc-sr">Search schedules</span>
            <input class="njsc-input" data-field="search" placeholder="Search by name, script, group…" value="${esc(this.ui.search)}"></label>
          <span class="njsc-spacer"></span>
          ${chip('', 'All')}${chip('enabled', 'Enabled')}${chip('paused', 'Paused')}${chip('failing', 'Last run failed')}${chip('running', 'Running')}
        </div></div>` : '';

      return `${this.head_('Schedules', 'Run activity scripts on a cron expression or interval.', actions)}
        ${stats}${toolbar}
        ${list.length
    ? `<div class="njsc-groups">${groups.map(g => this.group_('schedules', g.key, g.items.length, 'schedule', table(g.items))).join('')}</div>`
    : (this.data.tasks.length
      ? this.empty_('search', 'No matching schedules', 'Try adjusting the search or filters.')
      : this.empty_('clock', 'No schedules', 'Schedule an activity script to run it automatically.',
        ro ? '' : `<button class="njsc-btn primary" type="button" data-action="new-schedule">${icon('plus', 13)} New schedule</button>`))}
        ${this.data.tasks.length ? `<div class="njsc-footer">Showing ${list.length} of ${this.data.tasks.length} schedules · ${groups.length} group${groups.length === 1 ? '' : 's'}</div>` : ''}`;
    }

    /**
     * Schedule create/edit form.
     * @return {string} Markup
     * @private
     */
    renderForm_() {
      const f = this.form;
      const editing = !!f.original;
      const groups = Array.from(new Set(this.data.tasks.map(t => t.group).filter(Boolean))).sort();
      const dataStatus = f.dataError
        ? `<div class="njsc-help bad">${icon('alert', 12)} ${esc(f.dataError)}</div>`
        : `<div class="njsc-help">Passed to the script on every run. Any JSON value; leave empty for none.</div>`;
      return `<button class="inline-da12f285 njsc-btn ghost" type="button" data-action="back">${icon('chevronLeft', 13)} Back to schedules</button>
        <div class="njsc-form">
          <div class="njsc-card pad">
            <h2 class="inline-2b583d73 njsc-title">${editing ? `Edit ${esc(f.original)}` : 'New schedule'}</h2>
            <div class="njsc-grid2">
              <div class="njsc-field"><label class="njsc-label" for="njsc-name">Name <span class="req">*</span></label>
                <input id="njsc-name" class="njsc-input" data-form="name" value="${esc(f.name)}" placeholder="e.g. nightly-cleanup" autocomplete="off" ${editing ? 'readonly aria-readonly="true"' : ''}>
                ${editing ? '<div class="njsc-help">The name identifies the schedule and cannot be changed.</div>' : ''}</div>
              <div class="njsc-field"><label class="njsc-label" for="njsc-group">Group</label>
                <input id="njsc-group" class="njsc-input" data-form="group" value="${esc(f.group)}" list="njsc-groups" placeholder="Grouped by type when empty" autocomplete="off">
                <datalist id="njsc-groups">${groups.map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
            </div>
            <div class="njsc-field"><label class="njsc-label" for="njsc-script">Activity script <span class="req">*</span></label>
              <input id="njsc-script" class="njsc-input mono" data-form="scriptPath" value="${esc(f.scriptPath)}" placeholder="/path/to/activity.js" spellcheck="false" autocomplete="off">
              <div class="njsc-help">Run by the working service in a worker thread; the file exports <span class="njsc-code-inline">{ run }</span>.</div></div>
            <div class="njsc-field"><span class="njsc-label">Runs</span>
              <span class="njsc-seg" role="group" aria-label="Cadence type">
                <button type="button" aria-pressed="${f.mode === 'cron'}" data-action="set-mode" data-mode="cron">On a cron expression</button>
                <button type="button" aria-pressed="${f.mode === 'interval'}" data-action="set-mode" data-mode="interval">Every interval</button>
              </span></div>
            ${f.mode === 'cron' ? `
            <div class="njsc-field"><label class="njsc-label" for="njsc-cron">Cron expression <span class="req">*</span></label>
              <input id="njsc-cron" class="njsc-input mono" data-form="cron" value="${esc(f.cron)}" spellcheck="false" autocomplete="off" aria-describedby="njsc-cron-status">
              <div id="njsc-cron-status" data-region="cron-status" class="njsc-help"></div>
              <div class="inline-8a77e5a3 njsc-row">${CRON_PRESETS.map(([expr, label]) =>
    `<button class="njsc-chip" type="button" aria-pressed="${f.cron === expr}" data-action="cron-preset" data-cron="${esc(expr)}">${esc(label)}</button>`).join('')}</div>
              <div class="njsc-help">minute · hour · day-of-month · month · day-of-week — numbers only, Sunday is 0. Times are the server's local time.</div>
            </div>` : `
            <div class="njsc-field"><label class="njsc-label" for="njsc-int">Interval <span class="req">*</span></label>
              <div class="inline-2aca6dad njsc-row">
                <input id="njsc-int" class="inline-7a96d9ba njsc-input" type="number" min="1" step="1" data-form="intervalValue" value="${esc(f.intervalValue)}">
                <select class="inline-7a96d9ba njsc-select" data-form="intervalUnit" aria-label="Interval unit">
                  ${Object.keys(INTERVAL_SECONDS).map(u => `<option value="${u}"${f.intervalUnit === u ? ' selected' : ''}>${u}</option>`).join('')}
                </select></div>
              <div class="njsc-help">${editing ? 'Changing the interval restarts its timer from now.' : 'The first run happens one interval after the schedule is saved.'}</div>
            </div>`}
            <div class="njsc-field"><label class="njsc-label" for="njsc-desc">Description</label>
              <input id="njsc-desc" class="njsc-input" data-form="description" value="${esc(f.description)}" placeholder="Optional"></div>
            <div class="njsc-field"><label class="njsc-label" for="njsc-data">Data (JSON)</label>
              <textarea id="njsc-data" class="njsc-textarea" data-form="data" placeholder="{}">${esc(f.data)}</textarea>
              <div data-region="data-status">${dataStatus}</div></div>
          </div>
          <div class="njsc-card pad njsc-side">
            <h3>${editing ? 'Save changes' : 'Create'}</h3>
            <p>${editing ? 'Run history and counters are kept. Changing the cadence re-plans the next run from now.' : 'The schedule starts enabled unless you untick it below.'}</p>
            ${editing ? '' : `<label class="inline-8e737b88 njsc-row"><input type="checkbox" data-form="enabled" ${f.enabled ? 'checked' : ''}> Enabled</label>`}
            <button class="njsc-btn primary" type="button" data-action="save">${icon('check', 13)} ${editing ? 'Save schedule' : 'Create schedule'}</button>
            ${editing ? `<button class="njsc-btn" type="button" data-action="history" data-name="${esc(f.original)}">${icon('history', 13)} Run history</button>
            <button class="njsc-btn danger" type="button" data-action="delete" data-name="${esc(f.original)}">${icon('trash', 13)} Delete schedule</button>` : ''}
            <button class="njsc-btn ghost" type="button" data-action="back">Cancel</button>
          </div>
        </div>`;
    }

    /**
     * Refreshes the cron validation line, asking the server for the
     * authoritative answer and the next fire times.
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
        el.className = 'njsc-help bad';
        el.innerHTML = `${icon('alert', 12)} ${esc(quick)}`;
        return;
      }
      if (f.cronPreview && f.cronPreview.expr === expr) {
        const p = f.cronPreview;
        el.className = `njsc-help ${p.valid ? 'ok' : 'bad'}`;
        const phrase = describeCron(expr);
        el.innerHTML = p.valid
          ? `${icon('check', 12)} <span>${phrase ? `${esc(phrase)}. ` : ''}${p.nextRuns.length ? `Next: ${p.nextRuns.slice(0, 3).map(r => esc(fmtDateTime(r))).join(' · ')}` : ''}</span>`
          : `${icon('alert', 12)} ${esc(p.error)}`;
        return;
      }
      el.className = 'njsc-help';
      el.textContent = 'Checking…';
      clearTimeout(this.previewTimer_);
      const seq = ++this.previewSeq_;
      this.previewTimer_ = setTimeout(async () => {
        try {
          const preview = await this.api_('GET', `/cron/preview?count=3&expression=${encodeURIComponent(expr)}`);
          if (seq !== this.previewSeq_ || !this.form) return;
          this.form.cronPreview = { expr, ...preview };
        } catch (_err) {
          if (seq !== this.previewSeq_ || !this.form) return;
          this.form.cronPreview = { expr, valid: true, error: null, nextRuns: [] };
        }
        this.refreshCronStatus_();
      }, 250);
    }

    // -------------------------------------------------------------------------
    // Run history screen
    // -------------------------------------------------------------------------

    /**
     * Outcome bucket of a run.
     * @param {Object} r - Run
     * @return {string} Bucket
     * @private
     */
    runBucket_(r) {
      if (r.status === 'skipped') return 'skipped';
      if (r.status === 'recorded') return 'recorded';
      return outcomeOf(r);
    }

    /**
     * Stats strip over the loaded runs.
     * @param {Array<Object>} runs - Runs
     * @return {string} Markup
     * @private
     */
    runStats_(runs) {
      const count = b => runs.filter(r => this.runBucket_(r) === b).length;
      const succ = count('success');
      const fail = count('failed');
      const finished = succ + fail;
      const durations = runs.filter(r => r.status === 'completed' && r.durationMs).map(r => r.durationMs);
      const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      return `<div class="njsc-stats">
        <div class="njsc-stat"><div class="l">Runs shown</div><div class="v">${runs.length}</div></div>
        <div class="njsc-stat"><div class="l">Succeeded</div><div class="inline-9fb34ef3 v">${succ}</div></div>
        <div class="njsc-stat"><div class="l">Failed</div><div class="v${fail ? ' njsc-tone-danger' : ''}">${fail}</div></div>
        <div class="njsc-stat"><div class="l">Running</div><div class="v${count('running') ? ' njsc-tone-info' : ''}">${count('running')}</div></div>
        <div class="njsc-stat"><div class="l">Skipped</div><div class="v${count('skipped') ? ' njsc-tone-warn' : ''}">${count('skipped')}</div></div>
        <div class="njsc-stat"><div class="l">Success rate</div><div class="v">${finished ? `${Math.round((succ / finished) * 100)}%` : '—'}</div></div>
        <div class="njsc-stat"><div class="l">Avg duration</div><div class="inline-4ff818ff v">${avg ? esc(fmtDuration(avg)) : '—'}</div></div>
      </div>`;
    }

    /**
     * Status pill for a run.
     * @param {Object} r - Run
     * @return {string} Markup
     * @private
     */
    runPill_(r) {
      const b = this.runBucket_(r);
      if (b === 'skipped') return `<span class="njsc-pill warn"><span class="njsc-dot"></span>Skipped</span>`;
      if (b === 'recorded') return `<span class="njsc-pill"><span class="njsc-dot"></span>Recorded</span>`;
      return pill(b);
    }

    /**
     * Renders run history (all schedules, or one).
     * @return {string} Markup
     * @private
     */
    renderRuns_() {
      const res = this.data.runs || { runs: [], total: 0 };
      const runs = res.runs;
      const scope = this.params.taskName;
      const taskByName = {};
      this.data.tasks.forEach((t) => { taskByName[t.name] = t; });
      const chips = [['', 'All'], ['success', 'Succeeded'], ['failed', 'Failed'], ['running', 'Running'], ['skipped', 'Skipped']]
        .map(([v, label]) => `<button class="njsc-chip" type="button" aria-pressed="${this.ui.runStatus === v}" data-action="run-status" data-value="${v}">${esc(label)}</button>`).join('');

      const table = (items, showName) => `<table class="njsc-table">
        <thead><tr>${showName ? '<th>Schedule</th>' : ''}<th class="inline-2acaf3b5">Started</th><th class="inline-60746827">Duration</th>
          <th class="inline-60746827 njsc-hide-sm">Trigger</th><th class="inline-581be415 njsc-hide-sm">Attempts</th><th class="inline-0fac9183">Status</th><th class="inline-bd09c419"><span class="njsc-sr">Actions</span></th></tr></thead>
        <tbody>${items.map(r => `<tr>
          ${showName ? `<td><div class="njsc-cell"><button class="njsc-link t" type="button" data-action="view-run" data-id="${esc(r.executionId)}">${esc(r.taskName)}</button><span class="s njsc-mono">${esc(r.executionId)}</span></div></td>` : ''}
          <td><div class="njsc-cell">${showName ? `<span class="njsc-small" title="${esc(fmtDateTime(r.startedAt))}">${esc(timeAgo(r.startedAt))}</span>`
    : `<button class="njsc-link t" type="button" data-action="view-run" data-id="${esc(r.executionId)}">${esc(fmtDateTime(r.startedAt))}</button><span class="s">${esc(timeAgo(r.startedAt))}</span>`}</div></td>
          <td class="njsc-mono">${r.durationMs === null || r.durationMs === undefined ? '—' : esc(fmtDuration(r.durationMs))}</td>
          <td class="njsc-hide-sm njsc-small">${esc(triggerLabel(r.trigger))}</td>
          <td class="njsc-hide-sm njsc-small">${r.attempts || '—'}</td>
          <td><div class="njsc-cell">${this.runPill_(r)}${r.error ? `<span class="s" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}</div></td>
          <td><button class="njsc-btn icon" type="button" title="Details" aria-label="Run details" data-action="view-run" data-id="${esc(r.executionId)}">${icon('eye', 13)}</button></td>
        </tr>`).join('')}</tbody></table>`;

      const footer = `<div class="njsc-footer">Showing ${runs.length} of ${res.total} run${res.total === 1 ? '' : 's'}
        ${res.total > runs.length ? ` · <button class="njsc-btn" type="button" data-action="load-more">Load more</button>` : ''}
        <br>The most recent 50 runs of each schedule are kept in memory.</div>`;

      if (scope) {
        const t = taskByName[scope];
        return `${this.head_('Run history', 'Recent runs of one schedule.', `<button class="njsc-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>`)}
          <div class="njsc-card njsc-banner">
            <span class="njsc-faint">${icon('clock', 18)}</span>
            <div><div class="t">${esc(scope)}${t ? '' : ' <span class="njsc-pill warn">deleted</span>'}</div>
              <div class="njsc-inline-note">${t ? `${t.type === 'cron' ? esc(describeCron(t.cron) || t.cron) : esc(describeInterval(t.intervalSeconds * 1000))} · ${t.enabled ? 'enabled' : 'paused'}${t.nextRun ? ` · next ${esc(timeAgo(t.nextRun))}` : ''}` : ''}</div></div>
            <span class="njsc-spacer"></span>
            ${t && !this.options.readOnly ? `<button class="njsc-btn" type="button" data-action="run-now" data-name="${esc(scope)}" ${t.running ? 'disabled' : ''}>${icon('play', 13)} Run now</button>
            <button class="njsc-btn" type="button" data-action="edit-schedule" data-name="${esc(scope)}">${icon('pencil', 13)} Edit</button>` : ''}
            <button class="njsc-btn" type="button" data-action="clear-scope">All schedules</button>
          </div>
          ${this.runStats_(runs)}
          <div class="njsc-card njsc-toolbar"><div class="njsc-row">${chips}</div></div>
          ${runs.length ? `<div class="njsc-card"><div class="njsc-table-wrap">${table(runs, false)}</div></div>`
    : this.empty_('history', 'No runs', this.ui.runStatus ? 'No runs match this filter.' : 'This schedule has not run yet.')}
          ${footer}`;
      }

      const groups = this.groupBy_(runs, r => this.groupOf_(taskByName[r.taskName]));
      const names = this.data.tasks.map(t => t.name).sort();
      return `${this.head_('Run history', 'Every run: succeeded, failed, skipped and in flight.', `<button class="njsc-btn" type="button" data-action="refresh">${icon('refresh', 13)} Refresh</button>`)}
        ${this.runStats_(runs)}
        <div class="njsc-card njsc-toolbar"><div class="njsc-row">
          ${chips}
          <span class="njsc-spacer"></span>
          <select class="inline-0fac9183 njsc-select" data-field="runTask" aria-label="Schedule">
            <option value="">All schedules</option>
            ${names.map(n => `<option value="${esc(n)}"${this.ui.runTask === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
        </div></div>
        ${runs.length
    ? `<div class="njsc-groups">${groups.map(g => this.group_('runs', g.key, g.items.length, 'run', table(g.items, true))).join('')}</div>`
    : this.empty_('history', 'No runs', this.ui.runStatus ? 'No runs match this filter.' : 'Runs appear here once schedules fire.')}
        ${footer}`;
    }

    /**
     * Renders a run's detail view.
     * @return {string} Markup
     * @private
     */
    renderRunDetail_() {
      const r = this.data.detail;
      if (!r) return `<div class="njsc-loading">Loading…</div>`;
      const t = this.data.tasks.find(x => x.name === r.taskName);
      return `<button class="inline-da12f285 njsc-btn ghost" type="button" data-action="back">${icon('chevronLeft', 13)} Back</button>
        <div class="njsc-card pad">
          <div class="inline-761d3add njsc-head">
            <div><h2 class="njsc-title">${esc(r.taskName)}</h2>
              <div class="inline-fe7b4979 njsc-row">${this.runPill_(r)}<span class="njsc-code-inline">${esc(r.executionId)}</span></div></div>
            <div class="njsc-row">
              <button class="njsc-btn" type="button" data-action="refresh-run" data-id="${esc(r.executionId)}">${icon('refresh', 13)} Refresh</button>
              <button class="njsc-btn" type="button" data-action="history" data-name="${esc(r.taskName)}">${icon('history', 13)} Schedule history</button>
            </div>
          </div>
          <div class="njsc-kv">
            <div><div class="k">Started</div><div class="v">${esc(fmtDateTime(r.startedAt))}</div></div>
            <div><div class="k">Finished</div><div class="v">${esc(fmtDateTime(r.finishedAt))}</div></div>
            <div><div class="k">Duration</div><div class="v njsc-mono">${r.durationMs === null || r.durationMs === undefined ? '—' : esc(fmtDuration(r.durationMs))}</div></div>
            <div><div class="k">Trigger</div><div class="v">${esc(triggerLabel(r.trigger))}</div></div>
            <div><div class="k">Attempts</div><div class="v">${r.attempts || '—'}</div></div>
          </div>
          ${t ? `<div class="njsc-kv">
            <div><div class="k">Script</div><div class="v njsc-mono">${esc(t.scriptPath || '—')}</div></div>
            <div><div class="k">Cadence</div><div class="v">${t.type === 'cron' ? `<span class="njsc-code-inline">${esc(t.cron)}</span>` : esc(describeInterval(t.intervalSeconds * 1000))}</div></div>
          </div>` : ''}
          ${r.error ? `<div class="njsc-section"><div class="inline-d40c5990 njsc-label">Error</div><pre class="njsc-pre err">${esc(r.error)}</pre></div>` : ''}
          ${t && t.data !== null && t.data !== undefined ? `<div class="njsc-section"><div class="njsc-label">Data (current schedule input)</div><pre class="njsc-pre">${esc(prettyJson(t.data))}</pre></div>` : ''}
          ${r.result !== undefined && r.result !== null ? `<div class="njsc-section"><div class="njsc-label">Result</div><pre class="njsc-pre">${esc(prettyJson(r.result))}</pre></div>` : ''}
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
      if (this.view === 'run-detail') return !!this.data.detail && this.data.detail.status === 'running';
      if (this.view !== 'list') return false;
      if (this.screen === 'schedules') return this.data.tasks.some(t => t.running);
      return !!this.data.runs && this.data.runs.runs.some(r => r.status === 'running');
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
        if (this.view === 'run-detail' && this.data.detail) await this.openRun_(this.data.detail.executionId, { quiet: true });
        else if (this.view === 'list') await this.reload({ quiet: true });
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
      } else if (t.dataset.field === 'runTask' && event.type === 'change') {
        this.ui.runTask = t.value;
        this.ui.runLimit = 200;
        this.reload({ quiet: true });
      } else if (t.dataset.form && this.form) {
        const key = t.dataset.form;
        this.form[key] = t.type === 'checkbox' ? t.checked : t.value;
        if (key === 'data') {
          this.form.dataError = parseJsonValue(t.value).error;
          const region = this.root.querySelector('[data-region="data-status"]');
          if (region) {
            region.innerHTML = this.form.dataError
              ? `<div class="njsc-help bad">${icon('alert', 12)} ${esc(this.form.dataError)}</div>`
              : `<div class="njsc-help ${t.value.trim() ? 'ok' : ''}">${t.value.trim() ? `${icon('check', 12)} Valid JSON. ` : ''}Passed to the script on every run.</div>`;
          }
        }
        if (key === 'cron') {
          this.form.cronPreview = null;
          this.refreshCronStatus_();
          this.root.querySelectorAll('[data-action="cron-preset"]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.cron === t.value.trim()));
          });
        }
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
      if (!t || t.tagName !== 'INPUT' || t.type === 'checkbox') return;
      event.preventDefault();
      this.save_();
    }

    /**
     * Routes clicks on `[data-action]` elements.
     * @param {MouseEvent} event - Click event
     * @private
     */
    async onClick_(event) {
      const el = event.target.closest('[data-action]');
      if (!el || !this.root.contains(el) || el.disabled) return;
      const d = el.dataset;
      try {
        switch (d.action) {
          case 'nav': return this.navigate(d.screen, {});
          case 'retry':
          case 'refresh': return this.reload();
          case 'back': return this.back_();
          case 'toggle-group': {
            const map = this.ui.expanded[this.screen];
            map[d.key] = map[d.key] === false;
            this.remember_(`${this.screen}.expanded`, map);
            return this.paint_();
          }
          case 'status-filter':
            this.ui.statusFilter = d.value;
            return this.paint_();
          case 'new-schedule': return this.openForm_(null);
          case 'edit-schedule': return this.openForm_(d.name);
          case 'set-mode':
            this.form.mode = d.mode;
            return this.paint_();
          case 'cron-preset':
            this.form.cron = d.cron;
            this.form.cronPreview = null;
            return this.paint_();
          case 'save': return this.save_();
          case 'toggle': return this.toggle_(d.name);
          case 'run-now': return this.runNow_(d.name);
          case 'delete': return this.delete_(d.name);
          case 'history': return this.navigate('runs', { taskName: d.name });
          case 'clear-scope': return this.navigate('runs', {});
          case 'run-status':
            this.ui.runStatus = d.value;
            this.ui.runLimit = 200;
            return this.reload({ quiet: true });
          case 'load-more':
            this.ui.runLimit += 200;
            return this.reload({ quiet: true });
          case 'view-run': return this.openRun_(d.id);
          case 'refresh-run': return this.openRun_(d.id, { quiet: true });
          default: return undefined;
        }
      } catch (err) {
        this.toast_(err.message, 'danger');
        this.options.onError?.(err);
        return undefined;
      }
    }

    /**
     * Opens a sub-view, bringing the panel's top into view if needed.
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
     * Leaves a sub-view.
     * @private
     */
    back_() {
      this.view = 'list';
      this.form = null;
      this.data.detail = null;
      return this.reload({ quiet: true });
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /**
     * Opens the create/edit form.
     * @param {?string} name - Schedule to edit, or null for a new one
     * @private
     */
    async openForm_(name) {
      const t = name ? await this.api_('GET', `/tasks/${encodeURIComponent(name)}`) : null;
      let intervalValue = 15;
      let intervalUnit = 'minutes';
      if (t && t.type === 'interval') {
        intervalUnit = ['hours', 'minutes', 'seconds'].find(u => t.intervalSeconds % INTERVAL_SECONDS[u] === 0) || 'seconds';
        intervalValue = t.intervalSeconds / INTERVAL_SECONDS[intervalUnit];
      }
      this.form = {
        original: t ? t.name : null,
        name: t ? t.name : '',
        group: t ? (t.group || '') : '',
        scriptPath: t ? (t.scriptPath || '') : '',
        mode: t && t.type === 'interval' ? 'interval' : 'cron',
        cron: t && t.type === 'cron' ? t.cron : '0 2 * * *',
        intervalValue,
        intervalUnit,
        description: t ? (t.description || '') : '',
        data: t && t.data !== null && t.data !== undefined ? JSON.stringify(t.data, null, 2) : '',
        enabled: t ? t.enabled : true,
        dataError: null,
        cronPreview: null,
        originalCadence: t ? (t.type === 'cron' ? `c:${t.cron}` : `i:${t.intervalSeconds}`) : null
      };
      this.showView_('form');
      if (!name) this.root.querySelector('[data-form="name"]')?.focus();
    }

    /**
     * Validates and saves the form.
     * @private
     */
    async save_() {
      const f = this.form;
      if (!f) return;
      if (!f.name.trim()) return this.toast_('Name is required', 'danger');
      if (!f.scriptPath.trim()) return this.toast_('Activity script is required', 'danger');
      const data = parseJsonValue(f.data);
      if (data.error) return this.toast_(`Data: ${data.error}`, 'danger');
      const body = {
        scriptPath: f.scriptPath.trim(),
        group: f.group.trim() || null,
        description: f.description.trim() || null,
        data: data.value
      };
      let cadence;
      if (f.mode === 'cron') {
        const rejection = cronRejection(f.cron);
        if (rejection) return this.toast_(rejection, 'danger');
        body.cronExpression = f.cron.trim();
        cadence = `c:${body.cronExpression}`;
      } else {
        const seconds = (Number(f.intervalValue) || 0) * INTERVAL_SECONDS[f.intervalUnit];
        if (!(seconds >= 1)) return this.toast_('Interval must be at least 1 second', 'danger');
        body.intervalSeconds = seconds;
        cadence = `i:${seconds}`;
      }
      if (f.original) {
        // Only send the cadence when it changed, so an unrelated edit never
        // restarts an interval timer or re-plans a cron.
        if (cadence === f.originalCadence) {
          delete body.cronExpression;
          delete body.intervalSeconds;
        }
        await this.api_('PUT', `/tasks/${encodeURIComponent(f.original)}`, body);
        this.toast_('Schedule saved', 'success');
      } else {
        body.name = f.name.trim();
        body.enabled = !!f.enabled;
        await this.api_('POST', '/tasks', body);
        this.toast_(`Scheduled: ${body.name}`, 'success');
      }
      return this.back_();
    }

    /**
     * Pauses or enables a schedule.
     * @param {string} name - Schedule name
     * @private
     */
    async toggle_(name) {
      const t = await this.api_('POST', `/tasks/${encodeURIComponent(name)}/toggle`, {});
      this.toast_(t.enabled ? `Enabled ${t.name}` : `Paused ${t.name}`, 'success');
      await this.reload({ quiet: true });
    }

    /**
     * Runs a schedule now.
     * @param {string} name - Schedule name
     * @private
     */
    async runNow_(name) {
      await this.api_('POST', `/tasks/${encodeURIComponent(name)}/run-now`, {});
      this.toast_(`Started ${name}`, 'success');
      await this.reload({ quiet: true });
    }

    /**
     * Deletes a schedule after confirmation.
     * @param {string} name - Schedule name
     * @private
     */
    async delete_(name) {
      if (!global.confirm(`Delete schedule "${name}"? It stops immediately and its run history is removed.`)) return;
      await this.api_('DELETE', `/tasks/${encodeURIComponent(name)}`);
      this.toast_('Schedule deleted', 'success');
      if (this.params.taskName === name) return this.navigate('schedules', {});
      return this.back_();
    }

    /**
     * Opens a run's detail view.
     * @param {string} id - Run id
     * @param {Object} [opts] - `{ quiet: true }` refreshes in place
     * @private
     */
    async openRun_(id, opts = {}) {
      if (!opts.quiet) {
        this.data.detail = null;
        this.showView_('run-detail');
      }
      try {
        const [run, tasks] = await Promise.all([
          this.api_('GET', `/runs/${encodeURIComponent(id)}`),
          this.api_('GET', '/tasks')
        ]);
        this.data.detail = run;
        this.data.tasks = tasks || [];
      } catch (err) {
        if (!opts.quiet) {
          this.view = 'list';
          this.paint_();
        }
        throw err;
      }
      if (this.view === 'run-detail') this.paint_();
      this.schedulePoll_();
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
      el.className = `njsc-toast ${kind || ''}`;
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
    remember_(key, value) {
      try {
        global.localStorage.setItem(`${this.options.storageKey}.${key}`, JSON.stringify(value));
      } catch (_err) {
        /* storage unavailable (private mode / quota) - non-fatal */
      }
    }
  }

  ScheduleManagerUI.describeCron = describeCron;
  ScheduleManagerUI.cronRejection = cronRejection;

  global.ScheduleManagerUI = ScheduleManagerUI;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScheduleManagerUI;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
