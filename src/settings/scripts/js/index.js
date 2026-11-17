/**
 * @fileoverview NooblyJS Core Settings UI Client Library.
 * Renders a fully featured settings console — group navigation, key/value
 * editing, secret masking and group management — into any container element in
 * a consuming application.
 *
 * The panel is deliberately self-contained: it injects its own namespaced
 * styles, has no Bootstrap (or any other framework) dependency, and uses an
 * inline editor rather than an overlay modal so it cannot interfere with the
 * host page's stacking context.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 *
 * @example
 * // <script src="/services/settings/scripts"></script>
 * const panel = new SettingsUIManager({ containerId: 'settingsPanel' });
 * panel.initialize();
 *
 * @example
 * // Restricted to two groups, read only, with an auth header
 * const panel = new SettingsUIManager({
 *   containerId: 'settingsPanel',
 *   groups: ['smtp', 'database'],
 *   readOnly: true,
 *   fetchOptions: { headers: { 'x-api-key': token } }
 * });
 * panel.initialize();
 */

(function (global) {
  'use strict';

  /** @const {string} Identifier of the injected style element. */
  const STYLE_ID = 'nooblyjs-settings-ui-styles';

  /** @const {string} Placeholder shown in place of a masked secret. */
  const MASK = '********';

  /**
   * Namespaced styles for the panel. Colours resolve against the host
   * application's custom properties where they exist and fall back to a
   * neutral palette otherwise, so the panel blends into the consuming app.
   *
   * @const {string}
   */

  /**
   * Settings console UI manager.
   *
   * @class
   */
  class SettingsUIManager {
    /**
     * @param {Object} options Configuration for the panel.
     * @param {string} [options.containerId] Id of the container element.
     * @param {Element} [options.container] The container element itself.
     * @param {string} [options.apiBaseUrl='/services/settings/api'] Base URL of
     *     the settings API.
     * @param {Array<string>} [options.groups] Restrict the panel to these group
     *     names. Omit to show every group.
     * @param {boolean} [options.readOnly=false] Render values without editing.
     * @param {boolean} [options.allowGroupManagement=true] Allow creating and
     *     deleting groups.
     * @param {boolean} [options.allowReveal=true] Allow unmasking secrets.
     * @param {boolean} [options.showStatistics=true] Show the counts strip.
     * @param {boolean} [options.showHeader=true] Show the title and subtitle.
     * @param {string} [options.title='Settings'] Panel title.
     * @param {string} [options.subtitle] Panel subtitle.
     * @param {boolean} [options.injectStyles=true] Inject the panel stylesheet.
     * @param {Object} [options.fetchOptions] Extra options merged into every
     *     fetch call, e.g. authentication headers.
     * @param {Function} [options.onChange] Called after any successful change.
     * @param {Function} [options.onError] Called when a request fails.
     * @throws {Error} When no container is supplied or it cannot be found.
     */
    constructor(options = {}) {
      this.container = options.container
          || (options.containerId ? document.getElementById(options.containerId) : null);

      if (!this.container) {
        throw new Error(
            'SettingsUIManager requires a container or containerId that exists in the DOM');
      }

      this.apiBaseUrl = (options.apiBaseUrl || '/services/settings/api').replace(/\/$/, '');
      this.groupFilter = Array.isArray(options.groups) && options.groups.length
          ? options.groups.slice()
          : null;
      this.readOnly = options.readOnly === true;
      this.allowGroupManagement = options.allowGroupManagement !== false && !this.readOnly;
      this.allowReveal = options.allowReveal !== false;
      this.showStatistics = options.showStatistics !== false;
      this.showHeader = options.showHeader !== false;
      this.title = options.title || 'Settings';
      this.subtitle = options.subtitle
          || 'Grouped key/value settings, encrypted at rest';
      this.injectStyles = options.injectStyles !== false;
      this.fetchOptions = options.fetchOptions || {};
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.onError = typeof options.onError === 'function' ? options.onError : null;

      /** @private {?string} Currently selected group. */
      this.currentGroup = null;
      /** @private {boolean} Whether secrets are shown in clear text. */
      this.reveal = false;
      /** @private {Array<Object>} Cached group summaries. */
      this.groups = [];
      /** @private {?Object} Cached detail of the selected group. */
      this.groupDetail = null;
      /** @private {?Object} Cached statistics. */
      this.statistics = null;
      /** @private {?string} 'setting', 'group' or null when nothing is open. */
      this.editorMode = null;
      /** @private {?string} Key being edited, null when adding. */
      this.editingKey = null;
      /** @private {*} Clear value backing the open editor. */
      this.editorValue_ = '';
      /** @private {?Object} Pending inline note, survives a repaint. */
      this.note = null;
      /** @private {?number} Timer that hides the inline note. */
      this.noteTimer_ = null;
      /** @private {?Function} Bound click handler, kept for destroy(). */
      this.clickHandler_ = null;
      /** @private {?Function} Bound submit handler, kept for destroy(). */
      this.submitHandler_ = null;
    }

    // ----------------------------------------------------------- lifecycle

    /**
     * Loads data and renders the panel.
     *
     * @return {Promise<SettingsUIManager>} This instance, for chaining.
     */
    async initialize() {
      if (this.injectStyles) this.ensureStyles_();

      this.container.classList.add('dtcs-root');
      this.clickHandler_ = (event) => this.handleClick_(event);
      this.submitHandler_ = (event) => this.handleSubmit_(event);
      this.container.addEventListener('click', this.clickHandler_);
      this.container.addEventListener('submit', this.submitHandler_);

      await this.refresh();
      this.emit_('settings:ready', { groups: this.groups.length });
      return this;
    }

    /**
     * Reloads groups, statistics and the selected group, then repaints.
     *
     * @return {Promise<void>} Resolves once the panel has repainted.
     */
    async refresh() {
      try {
        await this.loadGroups_();
        if (this.showStatistics) await this.loadStatistics_();
        if (this.currentGroup) await this.loadGroupDetail_();
        this.render();
      } catch (error) {
        this.fail_(error);
        this.render();
      }
    }

    /**
     * Selects a group and repaints.
     *
     * @param {string} name Group to select.
     * @return {Promise<void>} Resolves once the group is loaded.
     */
    async selectGroup(name) {
      this.currentGroup = name;
      this.reveal = false;
      this.editorMode = null;
      await this.loadGroupDetail_();
      this.render();
    }

    /**
     * Returns the currently loaded values as a plain key/value object.
     * Secrets are masked unless they were revealed.
     *
     * @return {Object} Key/value map for the selected group.
     */
    getValues() {
      const values = {};
      (this.groupDetail?.entries || []).forEach((entry) => {
        values[entry.key] = entry.value;
      });
      return values;
    }

    /**
     * Removes listeners and empties the container.
     *
     * @return {void}
     */
    destroy() {
      if (this.clickHandler_) {
        this.container.removeEventListener('click', this.clickHandler_);
      }
      if (this.submitHandler_) {
        this.container.removeEventListener('submit', this.submitHandler_);
      }
      this.clickHandler_ = null;
      this.submitHandler_ = null;
      clearTimeout(this.noteTimer_);
      this.container.classList.remove('dtcs-root');
      this.container.innerHTML = '';
    }

    // ----------------------------------------------------------- data access

    /**
     * Calls the settings API and unwraps the JSON envelope.
     *
     * @param {string} url Path relative to the API base.
     * @param {Object=} init Fetch options.
     * @return {Promise<Object>} Parsed response body.
     * @throws {Error} When the request fails or the API reports an error.
     * @private
     */
    async api_(url, init = {}) {
      const { headers: extraHeaders, ...extraInit } = this.fetchOptions;

      const response = await fetch(this.apiBaseUrl + url, {
        ...extraInit,
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(init.headers || {})
        }
      });

      const text = await response.text();
      let body = {};

      if (text) {
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new Error(
              `Settings API returned a non-JSON response (${response.status})`);
        }
      }

      if (!response.ok) {
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      return body;
    }

    /**
     * Loads group summaries, applying the optional group filter.
     *
     * @return {Promise<void>} Resolves when groups are cached.
     * @private
     */
    async loadGroups_() {
      const { groups } = await this.api_('/groups');
      this.groups = this.groupFilter
          ? groups.filter((group) => this.groupFilter.includes(group.name))
          : groups;

      if (this.currentGroup
          && !this.groups.some((group) => group.name === this.currentGroup)) {
        this.currentGroup = null;
        this.groupDetail = null;
      }
      if (!this.currentGroup && this.groups.length) {
        this.currentGroup = this.groups[0].name;
      }
    }

    /**
     * Loads the detail of the selected group.
     *
     * @return {Promise<void>} Resolves when the detail is cached.
     * @private
     */
    async loadGroupDetail_() {
      if (!this.currentGroup) {
        this.groupDetail = null;
        return;
      }

      const { group } = await this.api_(
          `/groups/${encodeURIComponent(this.currentGroup)}?reveal=${this.reveal}`);
      this.groupDetail = group;
    }

    /**
     * Loads store statistics.
     *
     * @return {Promise<void>} Resolves when statistics are cached.
     * @private
     */
    async loadStatistics_() {
      const { statistics } = await this.api_('/statistics');
      this.statistics = statistics;
    }

    // ----------------------------------------------------------- rendering

    /**
     * Injects the panel stylesheet once per document.
     *
     * @return {void}
     * @private
     */
    ensureStyles_() {
      if (document.getElementById(STYLE_ID)) return;

      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/services/css/settings-ui.css';
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    /**
     * Escapes text for safe interpolation into markup.
     * Quotes are escaped as well as angle brackets: values such as a setting
     * description are free text and are interpolated into HTML attributes,
     * where an unescaped quote would let the value break out of the attribute
     * and inject an event handler.
     *
     * @param {*} text Value to escape.
     * @return {string} Escaped text, safe in both element and attribute context.
     * @private
     */
    escape_(text) {
      return String(text == null ? '' : text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
    }

    /**
     * Renders a value for display, keeping objects readable.
     *
     * @param {*} value Stored value.
     * @return {string} Display text.
     * @private
     */
    display_(value) {
      if (value === null) return 'null';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }

    /**
     * Repaints the whole panel.
     *
     * @return {void}
     */
    render() {
      this.container.innerHTML = `
        ${this.showHeader ? this.renderHeader_() : ''}
        <div class="dtcs-note" data-note hidden></div>
        <div class="dtcs-body">
          ${this.renderGroups_()}
          ${this.renderSettings_()}
        </div>
      `;

      // Re-apply any message that was raised by the action causing this paint.
      this.applyNote_();
    }

    /**
     * Renders the title block and statistics strip.
     *
     * @return {string} Header markup.
     * @private
     */
    renderHeader_() {
      const statistics = this.showStatistics && this.statistics ? `
        <div class="dtcs-stats">
          <div class="dtcs-stat"><div class="n">${this.statistics.groups}</div><div class="l">Groups</div></div>
          <div class="dtcs-stat"><div class="n">${this.statistics.keys}</div><div class="l">Settings</div></div>
          <div class="dtcs-stat"><div class="n">${this.statistics.secrets}</div><div class="l">Secrets</div></div>
        </div>` : '';

      return `
        <div class="dtcs-head">
          <div>
            <h3 class="dtcs-title">${this.escape_(this.title)}</h3>
            <p class="dtcs-sub">${this.escape_(this.subtitle)}</p>
          </div>
          ${statistics}
        </div>
        ${this.statistics?.usingFallbackSecret ? `
          <div class="dtcs-note warn">
            Settings are encrypted with the built-in development secret.
            Set <code>SETTINGS_SECRET</code> before storing production values.
          </div>` : ''}
      `;
    }

    /**
     * Renders the group navigation column.
     *
     * @return {string} Group list markup.
     * @private
     */
    renderGroups_() {
      const items = this.groups.length
          ? this.groups.map((group) => `
              <button type="button" class="dtcs-group ${group.name === this.currentGroup ? 'active' : ''}"
                      data-action="select-group" data-group="${this.escape_(group.name)}">
                <span class="name">${this.escape_(group.name)}</span>
                <span class="count">${group.count}</span>
              </button>`).join('')
          : '<div class="dtcs-empty">No groups</div>';

      const newGroupForm = this.editorMode === 'group' ? `
        <form class="dtcs-editor" data-form="group">
          <div class="dtcs-field">
            <label for="dtcs-group-name">Group name</label>
            <input class="dtcs-input" id="dtcs-group-name" name="name" required placeholder="database">
          </div>
          <div class="dtcs-field">
            <label for="dtcs-group-desc">Description</label>
            <input class="dtcs-input" id="dtcs-group-desc" name="description" placeholder="Connection details">
          </div>
          <div class="dtcs-actions">
            <button type="button" class="dtcs-btn" data-action="cancel-editor">Cancel</button>
            <button type="submit" class="dtcs-btn primary">Create</button>
          </div>
        </form>` : '';

      return `
        <div class="dtcs-panel">
          <div class="dtcs-panel-head">
            <h4>Groups</h4>
            ${this.allowGroupManagement
              ? '<button type="button" class="dtcs-btn icon" data-action="new-group" title="New group">+</button>'
              : ''}
          </div>
          <div class="dtcs-panel-body">${items}</div>
          ${newGroupForm}
        </div>
      `;
    }

    /**
     * Renders the key/value table for the selected group.
     *
     * @return {string} Settings table markup.
     * @private
     */
    renderSettings_() {
      if (!this.currentGroup) {
        return `
          <div class="dtcs-panel">
            <div class="dtcs-panel-head"><h4>Settings</h4></div>
            <div class="dtcs-empty">Select a group to view its settings</div>
          </div>`;
      }

      const entries = this.groupDetail?.entries || [];
      const rows = entries.length
          ? entries.map((entry) => `
              <tr>
                <td class="dtcs-key">
                  ${this.escape_(entry.key)}
                  ${entry.description ? `<div class="desc">${this.escape_(entry.description)}</div>` : ''}
                </td>
                <td class="dtcs-value">${this.escape_(this.display_(entry.value))}</td>
                <td>${entry.secret
                    ? '<span class="dtcs-tag">Secret</span>'
                    : '<span class="dtcs-muted">&ndash;</span>'}</td>
                ${this.readOnly ? '' : `
                <td class="inline-93c6e1d4">
                  <button type="button" class="dtcs-btn icon" data-action="edit-setting"
                          data-key="${this.escape_(entry.key)}" title="Edit">Edit</button>
                  <button type="button" class="dtcs-btn icon danger" data-action="delete-setting"
                          data-key="${this.escape_(entry.key)}" title="Delete">&times;</button>
                </td>`}
              </tr>`).join('')
          : `<tr><td colspan="${this.readOnly ? 3 : 4}" class="dtcs-empty">No settings in this group</td></tr>`;

      return `
        <div class="dtcs-panel">
          <div class="dtcs-panel-head">
            <h4>${this.escape_(this.currentGroup)}</h4>
            <div class="inline-a6025727">
              ${this.allowReveal ? `
                <button type="button" class="dtcs-btn" data-action="toggle-reveal">
                  ${this.reveal ? 'Hide' : 'Reveal'}
                </button>` : ''}
              ${this.readOnly ? '' : `
                <button type="button" class="dtcs-btn primary" data-action="new-setting">Add setting</button>`}
              ${this.allowGroupManagement ? `
                <button type="button" class="dtcs-btn danger icon" data-action="delete-group"
                        title="Delete group">&times;</button>` : ''}
            </div>
          </div>
          ${this.groupDetail?.description
            ? `<div class="inline-b65327f7"
                    class="dtcs-muted">${this.escape_(this.groupDetail.description)}</div>`
            : ''}
          <table class="dtcs-table">
            <thead>
              <tr>
                <th>Key</th><th>Value</th><th class="inline-1b3b3079">Secret</th>
                ${this.readOnly ? '' : '<th class="inline-9ed99d3b">Actions</th>'}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${this.editorMode === 'setting' ? this.renderEditor_() : ''}
        </div>
      `;
    }

    /**
     * Renders the inline add/edit form for a setting.
     *
     * @return {string} Editor markup.
     * @private
     */
    renderEditor_() {
      const entry = this.editingKey
          ? (this.groupDetail?.entries || []).find((item) => item.key === this.editingKey)
          : null;

      const type = entry?.type && ['string', 'number', 'boolean', 'json'].includes(entry.type)
          ? entry.type
          : 'string';
      // The clear value is fetched separately for secrets, so the form never
      // saves a mask back over the real value.
      const value = entry ? this.display_(this.editorValue_) : '';

      return `
        <form class="dtcs-editor" data-form="setting">
          <div class="dtcs-row">
            <div class="dtcs-field">
              <label for="dtcs-key">Key</label>
              <input class="dtcs-input" id="dtcs-key" name="key" required
                     value="${this.escape_(entry?.key || '')}"
                     ${entry ? 'readonly' : ''} placeholder="host">
            </div>
            <div class="dtcs-field">
              <label for="dtcs-type">Type</label>
              <select class="dtcs-select" id="dtcs-type" name="type">
                ${['string', 'number', 'boolean', 'json'].map((option) => `
                  <option value="${option}" ${option === type ? 'selected' : ''}>${option}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="dtcs-field">
            <label for="dtcs-value">Value</label>
            <textarea class="dtcs-textarea" id="dtcs-value" name="value" placeholder="localhost">${this.escape_(value)}</textarea>
          </div>
          <div class="dtcs-field">
            <label for="dtcs-desc">Description</label>
            <input class="dtcs-input" id="dtcs-desc" name="description"
                   value="${this.escape_(entry?.description || '')}" placeholder="Database hostname">
          </div>
          <label class="dtcs-check">
            <input type="checkbox" name="secret" ${entry?.secret ? 'checked' : ''}>
            Secret &mdash; mask this value in listings
          </label>
          <div class="dtcs-actions">
            <button type="button" class="dtcs-btn" data-action="cancel-editor">Cancel</button>
            <button type="submit" class="dtcs-btn primary">Save setting</button>
          </div>
        </form>
      `;
    }

    /**
     * Shows an inline note above the panel body.
     * The note is held in state rather than written straight to the DOM,
     * because saving repaints the panel and would otherwise wipe the message
     * before it could be read.
     *
     * @param {string} message Message to display.
     * @param {string=} tone 'success', 'error' or 'warn'.
     * @return {void}
     * @private
     */
    note_(message, tone = 'success') {
      this.note = { message, tone };
      this.applyNote_();
    }

    /**
     * Writes the pending note into the freshly rendered panel.
     *
     * @return {void}
     * @private
     */
    applyNote_() {
      const element = this.container.querySelector('[data-note]');
      if (!element || !this.note) return;

      element.className = `dtcs-note ${this.note.tone}`;
      element.textContent = this.note.message;
      element.hidden = false;

      clearTimeout(this.noteTimer_);
      this.noteTimer_ = setTimeout(() => {
        element.hidden = true;
        this.note = null;
      }, 4000);
    }

    /**
     * Reports a failure through the note, the callback and a DOM event.
     *
     * @param {Error} error The failure.
     * @return {void}
     * @private
     */
    fail_(error) {
      this.note_(error.message, 'error');
      if (this.onError) this.onError(error);
      this.emit_('settings:error', { error: error.message });
    }

    /**
     * Dispatches a CustomEvent on the container.
     *
     * @param {string} name Event name.
     * @param {Object} detail Event detail.
     * @return {void}
     * @private
     */
    emit_(name, detail) {
      this.container.dispatchEvent(
          new CustomEvent(name, { detail, bubbles: true }));
    }

    // ----------------------------------------------------------- interaction

    /**
     * Handles delegated clicks within the panel.
     *
     * @param {Event} event The click event.
     * @return {Promise<void>} Resolves when the action completes.
     * @private
     */
    async handleClick_(event) {
      const target = event.target.closest('[data-action]');
      if (!target || !this.container.contains(target)) return;

      event.preventDefault();
      const action = target.dataset.action;

      try {
        switch (action) {
          case 'select-group':
            await this.selectGroup(target.dataset.group);
            break;

          case 'toggle-reveal':
            this.reveal = !this.reveal;
            await this.loadGroupDetail_();
            this.render();
            break;

          case 'new-group':
            this.editorMode = 'group';
            this.render();
            break;

          case 'new-setting':
            this.editingKey = null;
            this.editorValue_ = '';
            this.editorMode = 'setting';
            this.render();
            break;

          case 'edit-setting':
            await this.openEditor_(target.dataset.key);
            break;

          case 'cancel-editor':
            this.editorMode = null;
            this.editingKey = null;
            this.render();
            break;

          case 'delete-setting':
            await this.deleteSetting_(target.dataset.key);
            break;

          case 'delete-group':
            await this.deleteGroup_();
            break;

          default:
            break;
        }
      } catch (error) {
        this.fail_(error);
      }
    }

    /**
     * Handles delegated form submissions within the panel.
     *
     * @param {Event} event The submit event.
     * @return {Promise<void>} Resolves when the save completes.
     * @private
     */
    async handleSubmit_(event) {
      const form = event.target.closest('[data-form]');
      if (!form || !this.container.contains(form)) return;

      event.preventDefault();

      try {
        if (form.dataset.form === 'group') {
          await this.createGroup_(form);
        } else {
          await this.saveSetting_(form);
        }
      } catch (error) {
        this.fail_(error);
      }
    }

    /**
     * Opens the editor for an existing key, fetching its clear value first.
     *
     * @param {string} key Key to edit.
     * @return {Promise<void>} Resolves once the editor is rendered.
     * @private
     */
    async openEditor_(key) {
      const detail = await this.api_(
          `/values/${encodeURIComponent(this.currentGroup)}/${encodeURIComponent(key)}?reveal=true`);

      this.editingKey = key;
      this.editorValue_ = typeof detail.value === 'object' && detail.value !== null
          ? JSON.stringify(detail.value, null, 2)
          : detail.value;
      this.editorMode = 'setting';
      this.render();
    }

    /**
     * Converts raw form text into the typed value to store.
     *
     * @param {string} raw Textarea contents.
     * @param {string} type Selected type.
     * @return {*} The typed value.
     * @throws {Error} When the input does not match the selected type.
     * @private
     */
    parseValue_(raw, type) {
      switch (type) {
        case 'number': {
          const value = Number(raw);
          if (raw.trim() === '' || Number.isNaN(value)) {
            throw new Error('Value is not a valid number');
          }
          return value;
        }
        case 'boolean':
          return raw.trim().toLowerCase() === 'true';
        case 'json':
          try {
            return JSON.parse(raw);
          } catch (error) {
            throw new Error('Value is not valid JSON');
          }
        default:
          return raw;
      }
    }

    /**
     * Saves the setting described by the editor form.
     *
     * @param {HTMLFormElement} form The editor form.
     * @return {Promise<void>} Resolves once saved and repainted.
     * @private
     */
    async saveSetting_(form) {
      const data = new FormData(form);
      const key = String(data.get('key')).trim();
      const type = String(data.get('type'));
      const value = this.parseValue_(String(data.get('value')), type);

      await this.api_(
          `/values/${encodeURIComponent(this.currentGroup)}/${encodeURIComponent(key)}`, {
            method: 'POST',
            body: JSON.stringify({
              value,
              type,
              secret: data.get('secret') === 'on',
              description: String(data.get('description') || '')
            })
          });

      this.editorMode = null;
      this.editingKey = null;
      this.note_(`Saved ${key}`);
      this.changed_({ action: 'set', group: this.currentGroup, key });
      await this.refresh();
    }

    /**
     * Deletes a setting after confirmation.
     *
     * @param {string} key Key to delete.
     * @return {Promise<void>} Resolves once deleted and repainted.
     * @private
     */
    async deleteSetting_(key) {
      if (!global.confirm(`Delete setting '${key}' from group '${this.currentGroup}'?`)) {
        return;
      }

      await this.api_(
          `/values/${encodeURIComponent(this.currentGroup)}/${encodeURIComponent(key)}`,
          { method: 'DELETE' });

      this.note_(`Deleted ${key}`);
      this.changed_({ action: 'delete', group: this.currentGroup, key });
      await this.refresh();
    }

    /**
     * Creates a group from the group form.
     *
     * @param {HTMLFormElement} form The group form.
     * @return {Promise<void>} Resolves once created and repainted.
     * @private
     */
    async createGroup_(form) {
      const data = new FormData(form);
      const name = String(data.get('name')).trim();

      await this.api_('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: String(data.get('description') || '')
        })
      });

      this.editorMode = null;
      this.currentGroup = name;
      this.note_(`Created group ${name}`);
      this.changed_({ action: 'create-group', group: name });
      await this.refresh();
    }

    /**
     * Deletes the selected group after confirmation.
     *
     * @return {Promise<void>} Resolves once deleted and repainted.
     * @private
     */
    async deleteGroup_() {
      const group = this.currentGroup;
      if (!group) return;
      if (!global.confirm(`Delete group '${group}' and all of its settings?`)) return;

      await this.api_(`/groups/${encodeURIComponent(group)}`, { method: 'DELETE' });

      this.currentGroup = null;
      this.groupDetail = null;
      this.note_(`Deleted group ${group}`);
      this.changed_({ action: 'delete-group', group });
      await this.refresh();
    }

    /**
     * Notifies the host application that something changed.
     *
     * @param {Object} detail Change description.
     * @return {void}
     * @private
     */
    changed_(detail) {
      if (this.onChange) this.onChange(detail);
      this.emit_('settings:changed', detail);
    }
  }

  /**
   * Feature flags for the browser (feature 13). Each answer is evaluated on the
   * server for the signed-in user, so roles and ids never come from the page.
   * Results are cached for `ttlMs`. A failed request answers "off" (fail closed).
   *
   * @class
   * @example
   * const flags = new SettingsFlags();
   * if (await flags.isEnabled('new-checkout')) showNewCheckout();
   */
  class SettingsFlags {
    /**
     * @param {Object} [options]
     * @param {string} [options.apiBaseUrl='/services/settings/api'] Settings API base URL.
     * @param {Object} [options.fetchOptions] Extra fetch options (for example headers).
     * @param {number} [options.ttlMs=30000] How long an evaluation is reused.
     */
    constructor(options = {}) {
      this.apiBaseUrl = (options.apiBaseUrl || '/services/settings/api').replace(/\/$/, '');
      this.fetchOptions = options.fetchOptions || {};
      this.ttlMs = options.ttlMs === undefined ? 30000 : options.ttlMs;
      this.cache_ = new Map();
    }

    /**
     * Evaluates a flag for the signed-in user.
     *
     * @param {string} name Flag name.
     * @return {Promise<{enabled: boolean, variant: string, reason: string}>}
     */
    async evaluate(name) {
      const cached = this.cache_.get(name);
      if (cached && cached.until > Date.now()) return cached.result;

      const { headers: extraHeaders, ...extraInit } = this.fetchOptions;
      try {
        const response = await fetch(
            `${this.apiBaseUrl}/flags/${encodeURIComponent(name)}/evaluate`, {
              credentials: 'same-origin',
              ...extraInit,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...extraHeaders }
            });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const result = { enabled: body.enabled === true, variant: body.variant || 'off', reason: body.reason || '' };
        this.cache_.set(name, { result, until: Date.now() + this.ttlMs });
        return result;
      } catch (error) {
        if (typeof console !== 'undefined') console.warn(`[SettingsFlags] ${name}: ${error.message}`);
        return { enabled: false, variant: 'off', reason: 'error' };
      }
    }

    /**
     * Whether a flag is on for the signed-in user.
     *
     * @param {string} name Flag name.
     * @return {Promise<boolean>}
     */
    async isEnabled(name) {
      return (await this.evaluate(name)).enabled;
    }

    /**
     * The variant the signed-in user sees.
     *
     * @param {string} name Flag name.
     * @return {Promise<string>}
     */
    async variant(name) {
      return (await this.evaluate(name)).variant;
    }

    /**
     * Drops cached answers, for example after sign-in or sign-out.
     *
     * @return {void}
     */
    clear() {
      this.cache_.clear();
    }
  }

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettingsUIManager;
    module.exports.SettingsFlags = SettingsFlags;
  } else {
    global.SettingsUIManager = SettingsUIManager;
    global.SettingsFlags = SettingsFlags;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
