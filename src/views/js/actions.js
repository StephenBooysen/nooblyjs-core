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
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
    const values = args.map((a) => (a && typeof a === 'object' && a.$this === true ? element : a));
    if (name === 'navigateTo') {
      window.location.href = String(values[0] ?? '/');
      return;
    }
    if (name === 'reloadPage') {
      window.location.reload();
      return;
    }
    const fn = window[name];
    if (typeof fn === 'function') fn.apply(window, values);
  }

  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target.closest('[data-onclick]') : null;
    if (!element) return;
    invoke(element.getAttribute('data-onclick'), parseArgs(element.getAttribute('data-onclick-args')), element);
  });
})();
