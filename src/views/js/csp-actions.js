/**
 * @fileoverview Click handling for dashboards under a strict Content-Security-Policy
 * (feature 17b). Inline `onclick="…"` attributes need 'unsafe-inline', so the
 * dashboards use these attributes instead:
 *
 *   data-onclick="functionName"        the global function to call (dotted names allowed)
 *   data-args='["a", 1, {"$el": true}]' its arguments; {"$el": true} stands for `this`
 *   data-href="/services/x/"           navigate to a URL
 *
 * One listener on the document runs them, from the clicked element up to the
 * root, as an inline handler would. Nothing is evaluated: a name is resolved
 * against `window`, and only functions are called. A handler that returns
 * `false` cancels the click, as it does for an inline handler.
 *
 * The helpers cspReload, cspAddClass and cspNavigate exist for the few
 * handlers that were not calls to a page function.
 */
(function () {
  'use strict';

  var NAME = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

  /** Finds a global function by name, or null. */
  function resolve(name) {
    if (!NAME.test(name)) return null;
    var target = window;
    var parts = name.split('.');
    for (var i = 0; i < parts.length; i += 1) {
      if (target === null || target === undefined) return null;
      target = target[parts[i]];
    }
    return typeof target === 'function' ? target : null;
  }

  /** Parses data-args; anything malformed means no arguments. */
  function argsOf(el) {
    var raw = el.getAttribute('data-args');
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function invoke(el, event) {
    var fn = resolve(el.getAttribute('data-onclick'));
    if (!fn) return true;
    var args = argsOf(el).map(function (arg) {
      return arg && typeof arg === 'object' && arg.$el === true ? el : arg;
    });
    return fn.apply(el, args);
  }

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('data-onclick')) {
        if (invoke(node, event) === false) event.preventDefault();
      }
      if (node.hasAttribute('data-href')) {
        window.location.href = node.getAttribute('data-href');
      }
      node = node.parentElement;
    }
  });

  window.cspReload = function () { window.location.reload(); };
  window.cspNavigate = function (url) { window.location.href = url; };
  window.cspAddClass = function (id, cls) {
    var el = document.getElementById(id);
    if (el) el.classList.add(cls);
  };
})();
