/**
 * @fileoverview Webhooks panel for the notifying dashboard (feature 12).
 * Lists subscriptions and recent deliveries, creates and removes subscriptions,
 * publishes a test event and redelivers an earlier one. Clicks reach these
 * functions through data-onclick="NooblyJSWebhooks.<name>" (strict CSP, no
 * inline handlers). Rows are built with DOM APIs, never innerHTML, so values
 * supplied by subscribers cannot inject markup.
 *
 * @author NooblyJS Team
 * @since 1.2.0
 */
(function () {
  'use strict';

  const API = '/services/notifying/api/webhooks';

  /**
   * Creates an element with text content and optional attributes.
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

  /** Attributes that make a button call a namespaced handler with JSON args. */
  function action(handler, args, label, cls) {
    return el('button', {
      type: 'button',
      class: cls,
      'data-onclick': handler,
      'data-onclick-args': JSON.stringify(args)
    }, [label]);
  }

  /** Shows a message in the panel's alert box. */
  function notify(message, kind = 'success') {
    const box = document.getElementById('webhookAlert');
    if (!box) return;
    box.className = `alert alert-${kind} fade show`;
    box.textContent = message;
  }

  /**
   * Calls the API and returns the parsed JSON, or throws the server's message.
   * @param {string} path
   * @param {Object=} options
   * @return {Promise<Object>}
   */
  async function call(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function renderSubscriptions(subscriptions) {
    const tbody = document.getElementById('webhookSubscriptions');
    if (!tbody) return;
    tbody.replaceChildren();
    if (!subscriptions.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '6', class: 'text-muted' }, ['No subscriptions yet.'])]));
      return;
    }
    for (const sub of subscriptions) {
      tbody.append(el('tr', {}, [
        el('td', { class: 'text-break' }, [sub.url]),
        el('td', {}, [sub.events.join(', ')]),
        el('td', {}, [el('span', { class: sub.active ? 'badge bg-success' : 'badge bg-secondary' }, [sub.active ? 'Active' : 'Disabled'])]),
        el('td', {}, [String(sub.failures)]),
        el('td', { class: 'small text-muted' }, [sub.secret]),
        el('td', {}, [action('NooblyJSWebhooks.remove', [sub.id], 'Delete', 'btn btn-sm btn-outline-danger')])
      ]));
    }
  }

  function renderDeliveries(deliveries) {
    const tbody = document.getElementById('webhookDeliveries');
    if (!tbody) return;
    tbody.replaceChildren();
    if (!deliveries.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7', class: 'text-muted' }, ['No deliveries yet.'])]));
      return;
    }
    for (const d of deliveries) {
      const statusClass = { delivered: 'bg-success', queued: 'bg-info', failed: 'bg-warning text-dark', dead: 'bg-danger', skipped: 'bg-secondary' }[d.status] || 'bg-secondary';
      tbody.append(el('tr', {}, [
        el('td', { class: 'small' }, [new Date(d.at).toLocaleString()]),
        el('td', {}, [d.event]),
        el('td', {}, [el('span', { class: `badge ${statusClass}` }, [d.status])]),
        el('td', {}, [String(d.attempt ?? '')]),
        el('td', {}, [d.code == null ? '-' : String(d.code)]),
        el('td', { class: 'small text-break' }, [d.error || '']),
        el('td', {}, [action('NooblyJSWebhooks.redeliver', [d.deliveryId], 'Redeliver', 'btn btn-sm btn-outline-primary')])
      ]));
    }
  }

  const NooblyJSWebhooks = {
    /** Loads subscriptions and deliveries into the panel. */
    async refresh() {
      try {
        const [subs, deliveries] = await Promise.all([call(API), call(`${API}/deliveries?limit=100`)]);
        renderSubscriptions(subs.subscriptions);
        renderDeliveries(deliveries.deliveries);
      } catch (err) {
        notify(err.message, 'danger');
      }
    },

    /** Creates a subscription from the form, then shows its secret once. */
    async create() {
      const url = document.getElementById('webhookUrl').value.trim();
      const events = document.getElementById('webhookEvents').value.split(',').map((s) => s.trim()).filter(Boolean);
      const description = document.getElementById('webhookDescription').value.trim();
      try {
        const created = await call(API, { method: 'POST', body: JSON.stringify({ url, events, description }) });
        notify(`Subscription created. Signing secret (shown once): ${created.secret}`, 'success');
        document.getElementById('webhookUrl').value = '';
        await NooblyJSWebhooks.refresh();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },

    /** Deletes a subscription after confirmation. */
    async remove(id) {
      if (!window.confirm('Delete this webhook subscription?')) return;
      try {
        await call(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        notify('Subscription deleted.');
        await NooblyJSWebhooks.refresh();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },

    /** Publishes the test event from the form. */
    async publish() {
      const event = document.getElementById('webhookEvent').value.trim();
      const raw = document.getElementById('webhookPayload').value.trim();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (_err) {
        notify('Payload must be valid JSON.', 'danger');
        return;
      }
      try {
        const res = await call(`${API}/publish`, { method: 'POST', body: JSON.stringify({ event, data }) });
        notify(`Queued for ${res.queued} subscription(s).`);
        await NooblyJSWebhooks.refresh();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },

    /** Sends an earlier delivery again. */
    async redeliver(deliveryId) {
      try {
        await call(`${API}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`, { method: 'POST' });
        notify('Redelivery queued.');
        await NooblyJSWebhooks.refresh();
      } catch (err) {
        notify(err.message, 'danger');
      }
    }
  };

  window.NooblyJSWebhooks = NooblyJSWebhooks;
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('webhookSubscriptions')) NooblyJSWebhooks.refresh();
  });
})();
