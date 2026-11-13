/**
 * @fileoverview Click dispatcher for dashboards (feature 17b, strict CSP).
 *
 * Pages declare clicks as data attributes instead of inline `onclick` handlers:
 *
 *   <button data-onclick="deleteItem" data-onclick-args='["abc", 2]'>Delete</button>
 *
 * The arguments are JSON. A `{"$this": true}` argument passes the element itself.
 * `navigateTo` (one string argument) sets `window.location.href`. Because clicks
 * are handled by one listener on the document, buttons added later work too.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */
(function () {
  'use strict';

  /**
   * Parses the arguments attribute. Anything malformed becomes no arguments,
   * so a bad attribute cannot run code.
   * @param {string|null} raw
   * @return {Array<*>}
   */
  function parseArgs(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }

  /**
   * Calls a named global function. Only plain identifiers are accepted, so the
   * attribute cannot name a property path or an expression.
   * @param {string} name
   * @param {Array<*>} args
   * @param {Element} element
   */
  function invoke(name, args, element) {
    if (name === 'location.reload') name = 'reloadPage';
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) return;
    const values = args.map((a) => (a && typeof a === 'object' && a.$this === true ? element : a));
    if (name === 'navigateTo') {
      window.location.href = String(values[0] ?? '/');
      return;
    }
    if (name === 'reloadPage') {
      window.location.reload();
      return;
    }
    // Walk dotted names (Namespace.method) by property lookup; never evaluate text.
    let scope = window;
    const parts = name.split('.');
    for (let i = 0; i < parts.length - 1; i += 1) scope = scope?.[parts[i]];
    const fn = scope?.[parts[parts.length - 1]];
    if (typeof fn === 'function') fn.apply(scope, values);
  }

  /**
   * Builds the value of a `data-onclick-args` attribute from JavaScript values.
   * Use it in template strings: `data-onclick-args="${nooblyArgs(id, 2)}"`.
   * @param {...*} values
   * @return {string} HTML-escaped JSON array
   */
  window.nooblyArgs = function nooblyArgs(...values) {
    return JSON.stringify(values)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target.closest('[data-onclick]') : null;
    if (!element) return;
    invoke(element.getAttribute('data-onclick'), parseArgs(element.getAttribute('data-onclick-args')), element);
  });
})();
