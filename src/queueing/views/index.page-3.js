        // Feature 06: reliable jobs panel. Uses the session cookie; a named
        // instance is chosen with ?instance=.
        (function () {
            let deadQueue = null;
            const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            const jobsUrl = (path) => {
                const inst = (typeof selectedInstance !== 'undefined' && selectedInstance !== 'default') ? `?instance=${encodeURIComponent(selectedInstance)}` : '';
                return `/services/queueing/api/jobs${path}${inst}`;
            };
            const call = async (path, init = {}) => {
                const res = await fetch(jobsUrl(path), { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
                return body;
            };
            const notify = (msg, type) => (typeof showAlert === 'function' ? showAlert(msg, type) : console.log(msg));

            async function loadJobQueues() {
                const tbody = document.getElementById('jobsQueueTable');
                try {
                    const data = await call('');
                    document.getElementById('jobsStoreNote').textContent = data.durable
                        ? 'Counts by state (durable, shared job store)'
                        : 'Counts by state (in-process job store: not shared, lost on restart)';
                    if (!data.queues.length) {
                        tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No job queues yet</td></tr>';
                        return;
                    }
                    tbody.innerHTML = data.queues.map((q) => `<tr>
                        <td>${esc(q.name)}</td><td class="text-end">${q.waiting}</td><td class="text-end">${q.delayed}</td>
                        <td class="text-end">${q.active}</td><td class="text-end">${q.dead}</td>
                        <td class="text-end">${q.processed.completed}</td><td class="text-end">${q.processed.failed}</td>
                        <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-dead="${esc(q.name)}">Dead letters</button></td></tr>`).join('');
                } catch (error) {
                    tbody.innerHTML = `<tr><td colspan="8" class="text-muted">${esc(error.message)}</td></tr>`;
                }
            }

            async function loadDead(queue) {
                deadQueue = queue;
                document.getElementById('jobsDeadQueue').textContent = `· ${queue}`;
                const tbody = document.getElementById('jobsDeadTable');
                const retryAll = document.getElementById('jobsRetryAllBtn');
                try {
                    const { jobs } = await call(`/${encodeURIComponent(queue)}/dead`);
                    retryAll.disabled = jobs.length === 0;
                    tbody.innerHTML = jobs.length ? jobs.map((j) => `<tr>
                        <td><code>${esc(j.id)}</code></td><td class="text-end">${j.attempts}</td>
                        <td class="text-truncate" style="max-width: 20rem;">${esc(j.lastError)}</td>
                        <td>${j.finishedAt ? new Date(j.finishedAt).toLocaleString() : ''}</td>
                        <td class="text-end text-nowrap">
                            <button class="btn btn-sm btn-outline-primary" data-retry="${esc(j.id)}">Retry</button>
                            <button class="btn btn-sm btn-outline-danger" data-delete="${esc(j.id)}">Delete</button>
                        </td></tr>`).join('') : '<tr><td colspan="5" class="text-muted">No dead letters</td></tr>';
                } catch (error) {
                    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">${esc(error.message)}</td></tr>`;
                }
            }

            document.addEventListener('click', async (event) => {
                const el = event.target.closest('[data-dead],[data-retry],[data-delete]');
                if (!el) return;
                try {
                    if (el.dataset.dead) return loadDead(el.dataset.dead);
                    if (el.dataset.retry) {
                        await call(`/${encodeURIComponent(deadQueue)}/dead/retry`, { method: 'POST', body: JSON.stringify({ ids: [el.dataset.retry] }) });
                        notify('Job requeued', 'success');
                    } else if (el.dataset.delete) {
                        await call(`/${encodeURIComponent(deadQueue)}/job/${encodeURIComponent(el.dataset.delete)}`, { method: 'DELETE' });
                        notify('Job deleted', 'success');
                    }
                    await loadDead(deadQueue);
                    await loadJobQueues();
                } catch (error) {
                    notify(error.message, 'error');
                }
            });

            document.addEventListener('DOMContentLoaded', () => {
                document.getElementById('jobs-tab')?.addEventListener('shown.bs.tab', loadJobQueues);
                document.getElementById('jobsRefreshBtn')?.addEventListener('click', loadJobQueues);
                document.getElementById('jobsRetryAllBtn')?.addEventListener('click', async () => {
                    if (!deadQueue) return;
                    try {
                        const { retried } = await call(`/${encodeURIComponent(deadQueue)}/dead/retry`, { method: 'POST', body: '{}' });
                        notify(`${retried} job(s) requeued`, 'success');
                        await loadDead(deadQueue);
                        await loadJobQueues();
                    } catch (error) {
                        notify(error.message, 'error');
                    }
                });
            });
        })();
    
