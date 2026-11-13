/**
 * Settings service admin screen.
 * Talks to /services/settings/api/* to manage grouped key/value settings held
 * in the encrypted settings store.
 */
(function () {
    'use strict';

    const API = '/services/settings/api';

    /** @type {?string} Currently selected group name. */
    let currentGroup = null;
    /** @type {boolean} Whether secret values are shown in clear text. */
    let reveal = false;
    /** @type {?string} Key being edited, or null when adding a new setting. */
    let editingKey = null;

    // ---------------------------------------------------------------- helpers

    function showAlert(message, type = 'success') {
        const alertElement = document.getElementById(type + 'Alert');
        const messageElement = document.getElementById(type + 'Message');
        if (!alertElement || !messageElement) return;

        messageElement.textContent = message;
        alertElement.style.display = 'block';
        alertElement.classList.add('show');
        setTimeout(() => {
            alertElement.classList.remove('show');
            alertElement.style.display = 'none';
        }, 5000);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB'];
        let value = bytes;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
    }

    function formatDate(iso) {
        return iso ? new Date(iso).toLocaleString() : '-';
    }

    /**
     * Calls the settings API and unwraps the JSON envelope.
     *
     * @param {string} url Path relative to the settings API root.
     * @param {Object=} init Fetch options.
     * @return {Promise<Object>} The parsed response body.
     * @throws {Error} When the request fails or the API reports an error.
     */
    async function api(url, init = {}) {
        const response = await fetch(API + url, {
            headers: { 'Content-Type': 'application/json' },
            ...init
        });

        const text = await response.text();
        const body = text ? JSON.parse(text) : {};

        if (!response.ok) {
            throw new Error(body.error || `Request failed (${response.status})`);
        }
        return body;
    }

    /**
     * Renders a value for the table, keeping objects readable.
     *
     * @param {*} value The stored value.
     * @return {string} Display text.
     */
    function displayValue(value) {
        if (value === null) return 'null';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    // ---------------------------------------------------------------- dashboard

    async function loadStatistics() {
        try {
            const { statistics } = await api('/statistics');

            document.getElementById('statGroups').textContent = statistics.groups;
            document.getElementById('statKeys').textContent = statistics.keys;
            document.getElementById('statSecrets').textContent = statistics.secrets;
            document.getElementById('statFileSize').textContent = formatBytes(statistics.fileSize);

            document.getElementById('infoAlgorithm').textContent = statistics.algorithm;
            document.getElementById('infoFilepath').textContent = statistics.filepath;
            document.getElementById('infoCreated').textContent = formatDate(statistics.created);
            document.getElementById('infoUpdated').textContent = formatDate(statistics.updated);

            document.getElementById('secretWarning').style.display =
                statistics.usingFallbackSecret ? 'block' : 'none';
        } catch (error) {
            showAlert('Error loading statistics: ' + error.message, 'error');
        }
    }

    // ---------------------------------------------------------------- groups

    async function loadGroups() {
        try {
            const { groups } = await api('/groups');
            const container = document.getElementById('groupList');

            if (!groups.length) {
                container.innerHTML = '<div class="core-empty-state">No groups yet</div>';
                return;
            }

            container.innerHTML = groups.map((group) => `
                <a href="#" class="core-sidebar-item ${group.name === currentGroup ? 'active' : ''}"
                   data-group="${escapeHtml(group.name)}">
                    <i class="bi bi-folder2"></i>
                    <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(group.name)}</span>
                    <span class="core-chip" style="margin-left: auto; font-size: 10px;">${group.count}</span>
                </a>
            `).join('');

            container.querySelectorAll('[data-group]').forEach((element) => {
                element.addEventListener('click', (event) => {
                    event.preventDefault();
                    selectGroup(element.dataset.group);
                });
            });
        } catch (error) {
            showAlert('Error loading groups: ' + error.message, 'error');
        }
    }

    async function selectGroup(name) {
        currentGroup = name;
        reveal = false;
        updateToolbar();
        await loadGroups();
        await loadGroupSettings();
    }

    function updateToolbar() {
        const enabled = Boolean(currentGroup);
        document.getElementById('newSettingBtn').disabled = !enabled;
        document.getElementById('deleteGroupBtn').disabled = !enabled;
        document.getElementById('toggleRevealBtn').disabled = !enabled;
        document.getElementById('currentGroupName').textContent =
            currentGroup || 'Select a group';
        document.getElementById('toggleRevealBtn').innerHTML = reveal
            ? '<i class="bi bi-eye-slash"></i> Hide'
            : '<i class="bi bi-eye"></i> Reveal';
    }

    async function loadGroupSettings() {
        const body = document.getElementById('settingsTableBody');
        const description = document.getElementById('groupDescription');

        if (!currentGroup) {
            body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--neutral-dot);">Select a group to view its settings</td></tr>';
            description.style.display = 'none';
            return;
        }

        try {
            const { group } = await api(
                `/groups/${encodeURIComponent(currentGroup)}?reveal=${reveal}`);

            if (group.description) {
                description.textContent = group.description;
                description.style.display = 'block';
            } else {
                description.style.display = 'none';
            }

            if (!group.entries.length) {
                body.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--neutral-dot);">No settings in this group</td></tr>';
                return;
            }

            body.innerHTML = group.entries.map((entry) => `
                <tr>
                    <td style="font-weight: 600; font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                        ${escapeHtml(entry.key)}
                        ${entry.description
                            ? `<div style="font-family: inherit; font-weight: 400; font-size: 11px; color: var(--neutral-dot);">${escapeHtml(entry.description)}</div>`
                            : ''}
                    </td>
                    <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; word-break: break-all;">
                        ${escapeHtml(displayValue(entry.value))}
                    </td>
                    <td>${entry.secret
                        ? '<span class="core-chip warn"><i class="bi bi-shield-lock"></i> Secret</span>'
                        : '<span style="color: var(--neutral-dot);">-</span>'}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" data-edit="${escapeHtml(entry.key)}" style="height: 28px;" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" data-delete="${escapeHtml(entry.key)}" style="height: 28px;" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            body.querySelectorAll('[data-edit]').forEach((element) => {
                element.addEventListener('click',
                    () => openSettingModal(element.dataset.edit));
            });
            body.querySelectorAll('[data-delete]').forEach((element) => {
                element.addEventListener('click',
                    () => deleteSetting(element.dataset.delete));
            });
        } catch (error) {
            showAlert('Error loading settings: ' + error.message, 'error');
        }
    }

    // ---------------------------------------------------------------- mutations

    async function openSettingModal(key) {
        editingKey = key || null;

        document.getElementById('settingModalTitle').textContent =
            key ? `Edit ${key}` : 'Add Setting';
        document.getElementById('settingKeyInput').value = key || '';
        document.getElementById('settingKeyInput').disabled = Boolean(key);
        document.getElementById('settingValueInput').value = '';
        document.getElementById('settingDescriptionInput').value = '';
        document.getElementById('settingSecretInput').checked = false;
        document.getElementById('settingTypeInput').value = 'string';

        if (key) {
            try {
                // Always read the clear value when editing, otherwise saving
                // would overwrite a secret with its mask.
                const detail = await api(
                    `/values/${encodeURIComponent(currentGroup)}/${encodeURIComponent(key)}?reveal=true`);
                const type = detail.meta?.type || typeof detail.value;

                document.getElementById('settingValueInput').value =
                    typeof detail.value === 'object' && detail.value !== null
                        ? JSON.stringify(detail.value, null, 2)
                        : String(detail.value);
                document.getElementById('settingDescriptionInput').value =
                    detail.meta?.description || '';
                document.getElementById('settingSecretInput').checked =
                    Boolean(detail.meta?.secret);
                document.getElementById('settingTypeInput').value =
                    ['string', 'number', 'boolean', 'json'].includes(type) ? type : 'string';
            } catch (error) {
                showAlert('Error loading setting: ' + error.message, 'error');
                return;
            }
        }

        bootstrap.Modal.getOrCreateInstance(
            document.getElementById('settingModal')).show();
    }

    /**
     * Converts the modal's raw text into the typed value to store.
     *
     * @param {string} raw The textarea contents.
     * @param {string} type The selected type.
     * @return {*} The typed value.
     * @throws {Error} When the input does not match the selected type.
     */
    function parseValue(raw, type) {
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

    async function saveSetting(event) {
        event.preventDefault();
        if (!currentGroup) return;

        const key = document.getElementById('settingKeyInput').value.trim();
        const type = document.getElementById('settingTypeInput').value;

        try {
            const value = parseValue(
                document.getElementById('settingValueInput').value, type);

            await api(`/values/${encodeURIComponent(currentGroup)}/${encodeURIComponent(key)}`, {
                method: 'POST',
                body: JSON.stringify({
                    value,
                    type,
                    secret: document.getElementById('settingSecretInput').checked,
                    description: document.getElementById('settingDescriptionInput').value
                })
            });

            bootstrap.Modal.getOrCreateInstance(
                document.getElementById('settingModal')).hide();
            showAlert(editingKey ? `Updated ${key}` : `Added ${key}`);

            await loadGroupSettings();
            await loadGroups();
            await loadStatistics();
        } catch (error) {
            showAlert('Error saving setting: ' + error.message, 'error');
        }
    }

    async function deleteSetting(key) {
        if (!confirm(`Delete setting '${key}' from group '${currentGroup}'?`)) return;

        try {
            await api(`/values/${encodeURIComponent(currentGroup)}/${encodeURIComponent(key)}`,
                { method: 'DELETE' });
            showAlert(`Deleted ${key}`);
            await loadGroupSettings();
            await loadGroups();
            await loadStatistics();
        } catch (error) {
            showAlert('Error deleting setting: ' + error.message, 'error');
        }
    }

    async function createGroup(event) {
        event.preventDefault();
        const name = document.getElementById('groupNameInput').value.trim();

        try {
            await api('/groups', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    description: document.getElementById('groupDescriptionInput').value
                })
            });

            bootstrap.Modal.getOrCreateInstance(
                document.getElementById('groupModal')).hide();
            document.getElementById('groupForm').reset();
            showAlert(`Created group ${name}`);

            await selectGroup(name);
            await loadStatistics();
        } catch (error) {
            showAlert('Error creating group: ' + error.message, 'error');
        }
    }

    async function deleteGroup() {
        if (!currentGroup) return;
        if (!confirm(`Delete group '${currentGroup}' and all of its settings?`)) return;

        try {
            await api(`/groups/${encodeURIComponent(currentGroup)}`, { method: 'DELETE' });
            showAlert(`Deleted group ${currentGroup}`);
            currentGroup = null;
            updateToolbar();
            await loadGroups();
            await loadGroupSettings();
            await loadStatistics();
        } catch (error) {
            showAlert('Error deleting group: ' + error.message, 'error');
        }
    }

    // ---------------------------------------------------------------- provider config

    window.loadProviderSettings = async function loadProviderSettings() {
        try {
            const response = await fetch(API + '/settings');
            const data = await response.json();
            const container = document.getElementById('settingsFormFields');
            container.innerHTML = '';

            (data.list || []).forEach((setting) => {
                const group = document.createElement('div');
                group.className = 'mb-3';

                const label = document.createElement('label');
                label.className = 'form-label';
                label.htmlFor = 'setting_' + setting.setting;
                label.textContent = setting.setting;
                group.appendChild(label);

                const current = data[setting.setting] ?? '';
                let input;

                if (setting.type === 'options' || setting.type === 'list') {
                    input = document.createElement('select');
                    (setting.values || []).forEach((value) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = value;
                        option.selected = String(value) === String(current);
                        input.appendChild(option);
                    });
                } else {
                    input = document.createElement('input');
                    input.type = setting.type === 'number' ? 'number' : 'text';
                    input.value = current;
                }

                input.className = 'form-control';
                input.id = 'setting_' + setting.setting;
                input.name = setting.setting;
                group.appendChild(input);

                if (setting.description) {
                    const helper = document.createElement('div');
                    helper.className = 'form-text';
                    helper.textContent = setting.description;
                    group.appendChild(helper);
                }

                container.appendChild(group);
            });
        } catch (error) {
            showAlert('Error loading configuration: ' + error.message, 'error');
        }
    };

    async function saveProviderSettings(event) {
        event.preventDefault();

        const payload = {};
        new FormData(document.getElementById('settingsForm'))
            .forEach((value, key) => { payload[key] = value; });

        try {
            await api('/settings', { method: 'POST', body: JSON.stringify(payload) });
            showAlert('Configuration saved');
            await loadStatistics();
            await loadGroups();
        } catch (error) {
            showAlert('Error saving configuration: ' + error.message, 'error');
        }
    }

    // ---------------------------------------------------------------- wiring

    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof NooblyJSNavigation !== 'undefined') {
            NooblyJSNavigation.renderNavigation('navigation-sidebar', 'settings');
        }

        document.getElementById('newGroupBtn').addEventListener('click', () => {
            document.getElementById('groupForm').reset();
            bootstrap.Modal.getOrCreateInstance(
                document.getElementById('groupModal')).show();
        });
        document.getElementById('groupForm').addEventListener('submit', createGroup);
        document.getElementById('deleteGroupBtn').addEventListener('click', deleteGroup);
        document.getElementById('newSettingBtn').addEventListener('click', () => openSettingModal(null));
        document.getElementById('settingForm').addEventListener('submit', saveSetting);
        document.getElementById('settingsForm').addEventListener('submit', saveProviderSettings);

        document.getElementById('toggleRevealBtn').addEventListener('click', async () => {
            reveal = !reveal;
            updateToolbar();
            await loadGroupSettings();
        });

        document.getElementById('reloadStoreBtn').addEventListener('click', async () => {
            try {
                await api('/reload', { method: 'POST' });
                showAlert('Settings reloaded from disk');
                await loadStatistics();
                await loadGroups();
                await loadGroupSettings();
            } catch (error) {
                showAlert('Error reloading settings: ' + error.message, 'error');
            }
        });

        document.getElementById('settings-tab')
            .addEventListener('shown.bs.tab', window.loadProviderSettings);

        await loadStatistics();
        await loadGroups();
    });
})();
