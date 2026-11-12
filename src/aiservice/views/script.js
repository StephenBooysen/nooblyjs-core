/**
 * @fileoverview AI Service Factory views script 
 * Client-side JavaScript for managing AI service views, including prompt submission, analytics display, and settings management.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

const numberFormatter = new Intl.NumberFormat();

let analyticsData = [];
let currentSort = { column: 'lastPrompt', direction: 'desc' };
let isProcessing = false;
let selectedInstance = 'default';

function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '0';
    }
    return numberFormatter.format(value);
}

function formatDate(value) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function showAlert(message, type = 'success') {
    const alertElement = document.getElementById(type + 'Alert');
    const messageElement = document.getElementById(type + 'Message');
    if (!alertElement || !messageElement) return;
    messageElement.textContent = message;
    alertElement.classList.add('show');
    setTimeout(() => alertElement.classList.remove('show'), 5000);
}

function showResponse(containerId, contentId, data) {
    const container = document.getElementById(containerId);
    const content = document.getElementById(contentId);
    if (!container || !content) return;
    content.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    container.style.display = 'block';
}

function setLoading(isLoading) {
    isProcessing = Boolean(isLoading);
    const submitBtn = document.getElementById('submitBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (submitBtn) submitBtn.disabled = isProcessing;
    if (loadingIndicator) loadingIndicator.classList.toggle('d-none', !isProcessing);
}

async function makeRequest(url, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
        throw new Error(typeof payload === 'string' && payload ? payload : `Request failed with status ${response.status}`);
    }

    return payload;
}

/**
 * Rewrites an AI API path to target the currently selected instance.
 * The default instance uses the unprefixed path.
 * @param {string} basePath - A `/services/ai/api/...` path.
 * @returns {string} The instance-scoped path.
 */
function buildAiUrl(basePath) {
    if (selectedInstance === 'default') {
        return basePath;
    }
    return basePath.replace('/services/ai/api/', `/services/ai/api/${selectedInstance}/`);
}

/** Loads the list of available AI service instances into the selector. */
async function loadAiInstances() {
    try {
        const response = await fetch('/services/ai/api/instances');
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        if (data.instances && Array.isArray(data.instances)) {
            updateAiInstanceSelector(data.instances);
        }
    } catch (error) {
        console.error('Error loading instances:', error);
    }
}

/**
 * Populates the instance dropdown, preserving the current selection when possible.
 * @param {Array<{name: string}>} instances - Available instances.
 */
function updateAiInstanceSelector(instances) {
    const selector = document.getElementById('instanceSelector');
    if (!selector) {
        return;
    }
    const currentValue = selector.value;
    selector.innerHTML = '';
    instances.forEach((instance) => {
        const option = document.createElement('option');
        option.value = instance.name;
        option.textContent = `${instance.name}${instance.name === 'default' ? ' (default)' : ''}`;
        selector.appendChild(option);
    });
    if (instances.some((i) => i.name === currentValue)) {
        selector.value = currentValue;
    } else {
        selector.value = 'default';
        selectedInstance = 'default';
    }
}

function toggleAdvanced() {
    const content = document.getElementById('advancedContent');
    if (content) {
        content.classList.toggle('show');
    }
}

function handleExamplePrompts() {
    document.querySelectorAll('.core-example-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const textarea = document.getElementById('promptText');
            if (textarea) {
                textarea.value = btn.dataset.prompt;
            }
        });
    });
}

function renderOverview(overview) {
    const {
        totalPrompts = 0,
        totalCalls = 0,
        totalPromptTokens = 0,
        totalCompletionTokens = 0,
        lastPromptAt = null
    } = overview || {};

    const totalPromptsEl = document.getElementById('totalPrompts');
    const totalCallsEl = document.getElementById('totalCalls');
    const totalPromptTokensEl = document.getElementById('totalPromptTokens');
    const totalCompletionTokensEl = document.getElementById('totalCompletionTokens');
    const lastPromptEl = document.getElementById('lastPrompt');

    if (totalPromptsEl) totalPromptsEl.textContent = formatNumber(totalPrompts);
    if (totalCallsEl) totalCallsEl.textContent = formatNumber(totalCalls);
    if (totalPromptTokensEl) totalPromptTokensEl.textContent = formatNumber(totalPromptTokens);
    if (totalCompletionTokensEl) totalCompletionTokensEl.textContent = formatNumber(totalCompletionTokens);
    if (lastPromptEl) lastPromptEl.textContent = formatDate(lastPromptAt);
}

function renderTopPrompts(prompts) {
    const list = document.getElementById('topPromptsList');
    if (!list) return;

    list.innerHTML = '';

    if (!prompts || prompts.length === 0) {
        list.innerHTML = '<div class="list-group-item text-muted">No prompt activity recorded yet.</div>';
        return;
    }

    prompts.forEach((prompt, index) => {
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex justify-content-between align-items-center';

        const details = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'fw-semibold core-prompt-snippet';
        title.title = prompt.prompt;
        title.textContent = `${index + 1}. ${prompt.prompt}`;

        const meta = document.createElement('div');
        meta.className = 'text-muted small';
        meta.textContent = `User: ${prompt.username || 'anonymous'} • Calls: ${formatNumber(prompt.calls)} • Tokens (in/out): ${formatNumber(prompt.promptTokens || 0)} / ${formatNumber(prompt.completionTokens || 0)}`;

        details.appendChild(title);
        details.appendChild(meta);

        const badge = document.createElement('span');
        badge.className = 'badge bg-secondary rounded-pill';
        badge.textContent = formatNumber(prompt.calls);

        item.appendChild(details);
        item.appendChild(badge);
        list.appendChild(item);
    });
}

function renderPromptsTable(prompts) {
    const tableBody = document.getElementById('promptsTableBody');
    const rowCount = document.getElementById('promptsRowCount');
    if (!tableBody) return;

    if (!prompts || prompts.length === 0) {
        tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No prompt activity recorded yet.</p>
                        </td>
                    </tr>`;
        if (rowCount) rowCount.textContent = '0';
        return;
    }

    tableBody.innerHTML = prompts.map((prompt) => `
                <tr>
                    <td class="prompt-snippet" title="${escapeHtml(prompt.prompt)}">${escapeHtml(prompt.prompt)}</td>
                    <td>${escapeHtml(prompt.username || 'anonymous')}</td>
                    <td>${formatNumber(prompt.promptTokens || 0)}</td>
                    <td>${formatNumber(prompt.completionTokens || 0)}</td>
                    <td>${formatDate(prompt.lastPrompt)}</td>
                </tr>
            `).join('');

    if (rowCount) {
        rowCount.textContent = String(prompts.length);
    }
}

function sortTable(column) {
    if (!analyticsData || analyticsData.length === 0) {
        renderPromptsTable([]);
        return;
    }

    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = column === 'lastPrompt' ? 'desc' : 'desc';
    }

    document.querySelectorAll('.sortable span').forEach((span) => {
        span.parentElement.classList.remove('sort-asc', 'sort-desc');
    });

    const sortElement = document.getElementById(`sort-${column}`);
    if (sortElement) {
        sortElement.parentElement.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    analyticsData.sort((a, b) => {
        let aVal;
        let bVal;

        switch (column) {
            case 'prompt':
                aVal = (a.prompt || '').toLowerCase();
                bVal = (b.prompt || '').toLowerCase();
                return currentSort.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 'username':
                aVal = (a.username || '').toLowerCase();
                bVal = (b.username || '').toLowerCase();
                return currentSort.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            case 'lastPrompt':
                aVal = a.lastPrompt ? new Date(a.lastPrompt).getTime() : 0;
                bVal = b.lastPrompt ? new Date(b.lastPrompt).getTime() : 0;
                return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
            case 'promptTokens':
            case 'completionTokens':
                aVal = a[column] || 0;
                bVal = b[column] || 0;
                return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
            default:
                return 0;
        }
    });

    renderPromptsTable(analyticsData);
}

function toggleAnalyticsLoading(isLoading) {
    const spinner = document.getElementById('analyticsSpinner');
    const button = document.getElementById('analyticsRefreshButton');
    if (spinner) spinner.classList.toggle('d-none', !isLoading);
    if (button) button.disabled = Boolean(isLoading);
}

function setAnalyticsPlaceholders() {
    const list = document.getElementById('topPromptsList');
    const tableBody = document.getElementById('promptsTableBody');
    const rowCount = document.getElementById('promptsRowCount');

    if (list) {
        list.innerHTML = `
                    <div class="list-group-item text-center text-muted py-3">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        Loading analytics...
                    </div>`;
    }

    if (tableBody) {
        tableBody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center text-muted py-4">
                            <div class="spinner-border spinner-border-sm me-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            Loading analytics...
                        </td>
                    </tr>`;
    }

    if (rowCount) {
        rowCount.textContent = '0';
    }
}

async function loadAnalytics() {
    toggleAnalyticsLoading(true);
    setAnalyticsPlaceholders();

    try {
        const response = await makeRequest(buildAiUrl('/services/ai/api/analytics'));
        renderOverview(response.overview || {});
        renderTopPrompts(response.topPrompts || []);
        analyticsData = response.topRecent || [];

        const analyticsContainer = document.getElementById('analyticsData');
        const analyticsContent = document.getElementById('analyticsContent');
        const analyticsCount = document.getElementById('analyticsCount');

        if (analyticsContainer && analyticsContent) {
            analyticsContainer.style.display = 'block';
            analyticsContent.textContent = JSON.stringify(response, null, 2);
        }

        if (analyticsCount) {
            const totalCalls = response?.overview?.totalCalls || 0;
            analyticsCount.textContent = `${formatNumber(totalCalls)} calls recorded`;
        }

        currentSort.column = '';
        currentSort.direction = 'desc';
        sortTable('lastPrompt');
    } catch (error) {
        console.error('Error loading analytics:', error);
        showAlert('Error loading analytics: ' + error.message, 'error');
    } finally {
        toggleAnalyticsLoading(false);
    }
}

function calculateCost(usage, provider) {
    const rates = {
        claude: { input: 0.000003, output: 0.000015 },
        chatgpt: { input: 0.0000005, output: 0.0000015 },
        ollama: { input: 0, output: 0 }
    };
    const rate = rates[provider] || rates.ollama;
    const promptCost = (usage.promptTokens || 0) * rate.input;
    const completionCost = (usage.completionTokens || 0) * rate.output;
    return promptCost + completionCost;
}

async function handlePromptSubmit(event) {
    event.preventDefault();
    if (isProcessing) return;

    const prompt = document.getElementById('promptText')?.value.trim();
    const maxTokensValue = parseInt(document.getElementById('maxTokens')?.value || '0', 10);
    const temperatureValue = parseFloat(document.getElementById('temperature')?.value || '0.7');

    if (!prompt) {
        showAlert('Please enter a prompt', 'error');
        return;
    }

    const maxTokens = Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? maxTokensValue : undefined;
    const temperature = Number.isFinite(temperatureValue) ? temperatureValue : 0.7;

    try {
        setLoading(true);
        const requestBody = {
            prompt,
            options: {
                maxTokens,
                temperature
            }
        };

        const result = await makeRequest(buildAiUrl('/services/ai/api/prompt'), 'POST', requestBody);

        const responseContainer = document.getElementById('responseContainer');
        const aiResponse = document.getElementById('aiResponse');
        if (responseContainer && aiResponse) {
            responseContainer.style.display = 'block';
            aiResponse.textContent = result.content || JSON.stringify(result, null, 2);
        }

        if (result.usage) {
            document.getElementById('usageInfo').style.display = 'block';
            document.getElementById('promptTokens').textContent = formatNumber(result.usage.promptTokens || 0);
            document.getElementById('responseTokens').textContent = formatNumber(result.usage.completionTokens || 0);
            document.getElementById('totalTokens').textContent = formatNumber(result.usage.totalTokens || 0);
            document.getElementById('estimatedCost').textContent =
                '$' + calculateCost(result.usage, result.provider).toFixed(6);
        }

        showAlert(`Response received from ${result.provider || 'AI'}`);
        loadAnalytics();
    } catch (error) {
        showAlert('Error: ' + error.message, 'error');
        console.error('Prompt error:', error);
    } finally {
        setLoading(false);
    }
}

function clearPrompt() {
    const textarea = document.getElementById('promptText');
    if (textarea) textarea.value = '';
    const responseContainer = document.getElementById('responseContainer');
    if (responseContainer) responseContainer.style.display = 'none';
}

async function checkStatus() {
    try {
        const result = await makeRequest(buildAiUrl('/services/ai/api/status'));
        showResponse('statusResponse', 'statusResponseContent', result);
        showAlert('Status checked successfully');
    } catch (error) {
        showAlert('Error checking status: ' + error.message, 'error');
        showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
    }
}

async function checkModels() {
    try {
        const result = await makeRequest(buildAiUrl('/services/ai/api/models'));
        showResponse('statusResponse', 'statusResponseContent', result);
        showAlert('Models retrieved successfully');
    } catch (error) {
        showAlert('Error retrieving models: ' + error.message, 'error');
        showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
    }
}

async function checkHealth() {
    try {
        const result = await makeRequest(buildAiUrl('/services/ai/api/health'));
        showResponse('statusResponse', 'statusResponseContent', result);
        showAlert('Health check completed');
    } catch (error) {
        showAlert('Error during health check: ' + error.message, 'error');
        showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
    }
}

async function checkServiceStatus() {
    try {
        const result = await makeRequest(buildAiUrl('/services/ai/api/status'));
        const submitBtn = document.getElementById('submitBtn');
        const promptTextarea = document.getElementById('promptText');

        if (result.enabled === false) {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'API Key Required';
            }
            if (promptTextarea) {
                promptTextarea.placeholder = 'AI service disabled - API key required';
            }
        } else {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Prompt';
            }
            if (promptTextarea) {
                promptTextarea.placeholder = 'Enter your prompt here...';
            }
        }
    } catch (error) {
        console.error('Error checking service status:', error);
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Service Unavailable';
            submitBtn.className = 'btn btn-secondary';
        }
    }
}

// Settings functionality
let currentSettings = {};

// Fetch settings from API
async function loadSettings() {
    try {
        const response = await fetch(buildAiUrl('/services/ai/api/settings'));
        const data = await response.json();
        currentSettings = data;
        renderSettingsForm(data);
    } catch (error) {
        showAlert('Error loading settings: ' + error.message, 'error');
        console.error('Error loading settings:', error);
    }
}

// Render settings form based on settings structure
function renderSettingsForm(data) {
    const formFieldsContainer = document.getElementById('settingsFormFields');
    const infoContainer = document.getElementById('settingsInfo');

    // Clear existing form fields
    formFieldsContainer.innerHTML = '';

    // Display description if available
    if (data.desciption) {
        infoContainer.textContent = data.desciption;
        infoContainer.style.display = 'block';
    }

    // Render form fields from settings list
    if (data.list && Array.isArray(data.list)) {
        data.list.forEach((setting) => {
            const formGroup = createFormField(setting, data);
            formFieldsContainer.appendChild(formGroup);
        });
    }
}

// Create form field based on setting type
function createFormField(setting, settingsData) {
    const formGroup = document.createElement('div');
    formGroup.className = 'mb-3';

    // Create label
    const label = document.createElement('label');
    label.className = 'form-label';
    label.htmlFor = 'setting_' + setting.setting;
    label.textContent = setting.setting;
    formGroup.appendChild(label);

    // Get current value from settings
    const currentValue = settingsData[setting.setting] || '';

    // Create input based on type
    let input;
    switch (setting.type) {
        case 'string':
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-control';
            input.id = 'setting_' + setting.setting;
            input.name = setting.setting;
            input.value = currentValue;
            if (setting.values && setting.values.length > 0) {
                input.placeholder = setting.values[0];
            }
            break;

        case 'integer':
            input = document.createElement('input');
            input.type = 'number';
            input.className = 'form-control';
            input.id = 'setting_' + setting.setting;
            input.name = setting.setting;
            input.value = currentValue;
            input.step = '1';
            break;

        case 'number':
            input = document.createElement('input');
            input.type = 'number';
            input.className = 'form-control';
            input.id = 'setting_' + setting.setting;
            input.name = setting.setting;
            input.value = currentValue;
            input.step = 'any';
            break;

        case 'date':
            input = document.createElement('input');
            input.type = 'date';
            input.className = 'form-control';
            input.id = 'setting_' + setting.setting;
            input.name = setting.setting;
            input.value = currentValue;
            break;

        case 'list':
        case 'options':
            input = document.createElement('select');
            input.className = 'form-select';
            input.id = 'setting_' + setting.setting;
            input.name = setting.setting;

            // Add options
            if (setting.values && Array.isArray(setting.values)) {
                setting.values.forEach((value) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    if (value === currentValue) {
                        option.selected = true;
                    }
                    input.appendChild(option);
                });
            }
            break;

        default:
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-control';
            input.id = 'setting_' + setting.setting;
            input.name = setting.setting;
            input.value = currentValue;
    }

    formGroup.appendChild(input);

    // Add description helper text if available
    if (setting.desciption) {
        const helperText = document.createElement('div');
        helperText.className = 'form-text';
        helperText.textContent = setting.desciption;
        formGroup.appendChild(helperText);
    }

    return formGroup;
}

// Handle settings form submission
document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        // Collect form data
        const formData = new FormData(document.getElementById('settingsForm'));
        const payload = {};

        // Build payload from form fields
        for (let [key, value] of formData.entries()) {
            payload[key] = value;
        }

        // Send to API
        const response = await fetch(buildAiUrl('/services/ai/api/settings'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();

        // Show response
        showResponse('settingsSaveResponse', 'settingsSaveResponseContent', responseText);

        if (response.ok) {
            showAlert('Settings saved successfully', 'success');
            // Reload settings to reflect changes
            setTimeout(() => loadSettings(), 1000);
        } else {
            showAlert('Error saving settings: ' + responseText, 'error');
        }
    } catch (error) {
        showAlert('Error saving settings: ' + error.message, 'error');
        showResponse('settingsSaveResponse', 'settingsSaveResponseContent', 'Error: ' + error.message);
    }
});

// Load settings when settings tab is shown
document.getElementById('settings-tab')?.addEventListener('shown.bs.tab', function (e) {
    loadSettings();
});

async function initializeSwagger() {
    try {
        const response = await fetch('/services/ai/api/swagger/docs.json');
        if (!response.ok) {
            throw new Error(`Failed to load Swagger docs: ${response.status}`);
        }
        const spec = await response.json();

        SwaggerUIBundle({
            spec,
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.presets.standalone],
            plugins: [SwaggerUIBundle.plugins.DownloadUrl],
            layout: 'BaseLayout',
            tryItOutEnabled: true
        });
    } catch (error) {
        console.error('Error initializing Swagger UI:', error);
        const swaggerContainer = document.getElementById('swagger-ui');
        if (swaggerContainer) {
            swaggerContainer.innerHTML = '<p class="text-danger">Error loading API documentation. Please refresh the page.</p>';
        }
    }
}

function initializeEventHandlers() {
    const promptForm = document.getElementById('promptForm');
    if (promptForm) {
        promptForm.addEventListener('submit', handlePromptSubmit);
    }

    const clearButton = document.getElementById('clearPromptButton');
    if (clearButton) {
        clearButton.addEventListener('click', clearPrompt);
    }

    const advancedToggle = document.getElementById('advancedToggle');
    if (advancedToggle) {
        advancedToggle.addEventListener('click', toggleAdvanced);
    }

    const temperatureInput = document.getElementById('temperature');
    if (temperatureInput) {
        temperatureInput.addEventListener('input', (event) => {
            const valueEl = document.getElementById('temperatureValue');
            if (valueEl) valueEl.textContent = event.target.value;
        });
    }

    const refreshButton = document.getElementById('analyticsRefreshButton');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => loadAnalytics());
    }

    document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', () => loadAnalytics());
    document.getElementById('data-tab')?.addEventListener('shown.bs.tab', () => checkServiceStatus());

    document.getElementById('refreshInstanceBtn')?.addEventListener('click', () => loadAiInstances());
}

// ─── Train tab ────────────────────────────────────────────────────────────────

let trainPollInterval = null;

/**
 * Like makeRequest but returns { ok, status, data } instead of throwing on
 * non-2xx, so callers can inspect 501 responses without a try/catch.
 */
async function fetchRaw(url, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const response = await fetch(url, opts);
    const ct = response.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await response.json() : await response.text();
    return { ok: response.ok, status: response.status, data };
}

/** Renders the status badge with colour-coded pill. */
function renderTrainStatusBadge(status) {
    const badge = document.getElementById('trainStatusBadge');
    if (!badge) return;
    const colours = { idle: 'success', scheduled: 'warning', training: 'primary' };
    const colour = colours[status] || 'secondary';
    badge.innerHTML = `<span class="badge bg-${colour} fs-6 px-3 py-2">${status || '—'}</span>`;
}

/** Renders the model-ready indicator. */
function renderTrainModelReady(ready) {
    const el = document.getElementById('trainModelReady');
    if (!el) return;
    el.innerHTML = ready
        ? '<span class="badge bg-success fs-6 px-3 py-2"><i class="bi bi-check-circle me-1"></i>Yes</span>'
        : '<span class="badge bg-secondary fs-6 px-3 py-2"><i class="bi bi-hourglass me-1"></i>No</span>';
}

/** Fetches training status and updates the status section of the Train tab. */
async function loadTrainStatus() {
    const { ok, status, data } = await fetchRaw(buildAiUrl('/services/ai/api/train/status'));

    const loading   = document.getElementById('trainLoading');
    const supported = document.getElementById('trainSupported');
    const notSupp   = document.getElementById('trainNotSupported');

    if (loading)   loading.style.display   = 'none';

    if (status === 501 || (data && data.supported === false)) {
        if (supported) supported.style.display = 'none';
        if (notSupp)   notSupp.style.display   = 'block';
        const msg = document.getElementById('trainNotSupportedMessage');
        if (msg) msg.textContent = data.error || 'This provider does not support training.';
        stopTrainPolling();
        return;
    }

    if (!ok) {
        showAlert('Error loading training status: ' + (data.error || status), 'error');
        return;
    }

    if (notSupp)   notSupp.style.display   = 'none';
    if (supported) supported.style.display = 'block';

    renderTrainStatusBadge(data.status);
    renderTrainModelReady(data.modelReady);

    const docCount  = document.getElementById('trainDocCount');
    const vocabSize = document.getElementById('trainVocabSize');
    if (docCount)  docCount.textContent  = formatNumber(data.dataCount  || 0);
    if (vocabSize) vocabSize.textContent = formatNumber(data.vocabSize  || 0);

    // Auto-poll while training is active; stop when idle.
    if (data.status === 'training' || data.status === 'scheduled') {
        startTrainPolling();
    } else {
        stopTrainPolling();
        // Refresh the docs table once training settles so counts are current.
        loadTrainDocs();
    }
}

function startTrainPolling() {
    if (trainPollInterval) return;
    trainPollInterval = setInterval(loadTrainStatus, 3000);
}

function stopTrainPolling() {
    if (trainPollInterval) {
        clearInterval(trainPollInterval);
        trainPollInterval = null;
    }
}

/** Fetches and renders the training documents table. */
async function loadTrainDocs() {
    const { ok, data } = await fetchRaw(buildAiUrl('/services/ai/api/train/data'));
    if (!ok || data.supported === false) return;

    const tbody = document.getElementById('trainDocsTableBody');
    const countEl = document.getElementById('trainDocsCount');
    if (!tbody) return;

    const docs = data.documents || {};
    const entries = Object.entries(docs);

    if (countEl) countEl.textContent = `${entries.length} document${entries.length !== 1 ? 's' : ''}`;

    if (entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">
            No training documents yet. Add one above.</td></tr>`;
        return;
    }

    tbody.innerHTML = entries.map(([key, text]) => {
        const preview  = escapeHtml(text.slice(0, 120)) + (text.length > 120 ? '…' : '');
        const safeKey  = escapeHtml(key);
        const safeText = escapeHtml(text);
        return `
        <tr>
            <td><code style="font-size:13px;">${safeKey}</code></td>
            <td style="color:var(--ink-2); font-size:13px;">${preview}</td>
            <td style="text-align:right; font-size:13px;">${formatNumber(text.length)}</td>
            <td style="text-align:center;">
                <div class="d-flex gap-1 justify-content-center">
                    <button class="btn btn-secondary btn-sm"
                        onclick="editTrainDoc(${JSON.stringify(safeKey)}, ${JSON.stringify(safeText)})"
                        title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm" style="background:var(--danger-soft,#fef2f2); color:#dc2626; border-color:#fca5a5;"
                        onclick="deleteTrainDoc(${JSON.stringify(safeKey)})"
                        title="Delete">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

/** Pre-fills the add/update form so the user can edit an existing document. */
function editTrainDoc(key, text) {
    const keyInput  = document.getElementById('docKey');
    const textInput = document.getElementById('docText');
    const label     = document.getElementById('addDocBtnLabel');
    if (keyInput)  keyInput.value  = key;
    if (textInput) textInput.value = text;
    if (label)     label.textContent = 'Update';
    keyInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    keyInput?.focus();
}

/** Deletes a training document after a quick confirmation. */
async function deleteTrainDoc(key) {
    if (!confirm(`Delete training document "${key}"?\n\nThe model will retrain without this document.`)) return;
    const { ok, data } = await fetchRaw(
        buildAiUrl(`/services/ai/api/train/data/${encodeURIComponent(key)}`), 'DELETE'
    );
    if (ok) {
        showAlert(`Document "${key}" removed — retraining scheduled`);
        loadTrainStatus();
        loadTrainDocs();
    } else {
        showAlert('Error deleting document: ' + (data.error || 'unknown error'), 'error');
    }
}

function clearTrainDocForm() {
    const keyInput  = document.getElementById('docKey');
    const textInput = document.getElementById('docText');
    const label     = document.getElementById('addDocBtnLabel');
    if (keyInput)  keyInput.value  = '';
    if (textInput) textInput.value = '';
    if (label)     label.textContent = 'Add / Update';
}

async function handleAddTrainDoc(event) {
    event.preventDefault();
    const key  = document.getElementById('docKey')?.value.trim();
    const text = document.getElementById('docText')?.value.trim();

    if (!key)  { showAlert('Document key is required', 'error'); return; }
    if (!text) { showAlert('Training text is required', 'error'); return; }

    const btn     = document.getElementById('addDocBtn');
    const spinner = document.getElementById('addDocSpinner');
    if (btn)     btn.disabled = true;
    if (spinner) spinner.classList.remove('d-none');

    try {
        const { ok, data } = await fetchRaw(buildAiUrl('/services/ai/api/train/data'), 'POST', { key, text });
        if (ok) {
            showAlert(data.isUpdate ? `Document "${key}" updated — retraining scheduled` : `Document "${key}" added — training scheduled`);
            clearTrainDocForm();
            loadTrainStatus();
            loadTrainDocs();
        } else {
            showAlert('Error: ' + (data.error || 'could not save document'), 'error');
        }
    } catch (err) {
        showAlert('Error: ' + err.message, 'error');
    } finally {
        if (btn)     btn.disabled = false;
        if (spinner) spinner.classList.add('d-none');
    }
}

// ─── End train tab ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    handleExamplePrompts();
    initializeEventHandlers();
    initializeSwagger();
    loadAiInstances();
    checkServiceStatus();
    loadAnalytics();
    setInterval(loadAnalytics, 30000);

    // Train tab wiring
    document.getElementById('addDocForm')?.addEventListener('submit', handleAddTrainDoc);
    document.getElementById('clearDocFormBtn')?.addEventListener('click', clearTrainDocForm);
    document.getElementById('trainRefreshBtn')?.addEventListener('click', () => {
        loadTrainStatus();
        loadTrainDocs();
    });
    document.getElementById('train-tab')?.addEventListener('shown.bs.tab', () => {
        loadTrainStatus();
        loadTrainDocs();
    });
    document.getElementById('train-tab')?.addEventListener('hidden.bs.tab', stopTrainPolling);

    // Also reload train state when the instance selector changes.
    document.getElementById('instanceSelector')?.addEventListener('change', function () {
        selectedInstance = this.value || 'default';
        loadAnalytics();
        checkServiceStatus();
        if (document.getElementById('train')?.classList.contains('active')) {
            loadTrainStatus();
            loadTrainDocs();
        }
    });
});

// ---------------------------------------------------------------------------
// Playground (feature 02): streams from POST /services/ai/api/stream, which
// answers as Server-Sent Events. Authenticated by the session cookie.
// ---------------------------------------------------------------------------
const playgroundUsage = new Map();
let playgroundController = null;

function formatCostUsd(value) {
    const n = Number(value) || 0;
    return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

async function loadPlaygroundModels() {
    const select = document.getElementById('playgroundModel');
    if (!select) return;
    try {
        const response = await fetch(buildAiUrl('/services/ai/api/models'), { credentials: 'same-origin' });
        if (!response.ok) return;
        const data = await response.json();
        const models = Array.isArray(data) ? data : (data.models || []);
        select.innerHTML = '<option value="">Instance default</option>';
        for (const m of models) {
            const option = document.createElement('option');
            option.value = typeof m === 'string' ? m : (m.id || m.name);
            option.textContent = typeof m === 'string' ? m : (m.name || m.id);
            select.appendChild(option);
        }
    } catch (error) {
        console.error('Error loading models:', error);
    }
}

function renderPlaygroundUsage() {
    const tbody = document.getElementById('playgroundUsageTable');
    if (!tbody) return;
    if (playgroundUsage.size === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No calls yet</td></tr>';
        return;
    }
    tbody.innerHTML = Array.from(playgroundUsage.entries()).map(([model, u]) => `
        <tr><td>${escapeHtml(model)}</td><td class="text-end">${formatNumber(u.calls)}</td>
        <td class="text-end">${formatNumber(u.input)}</td><td class="text-end">${formatNumber(u.output)}</td>
        <td class="text-end">${formatCostUsd(u.cost)}</td></tr>`).join('');
}

/** Reads an SSE body and calls onEvent(name, data) per event. */
async function readServerSentEvents(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let name = 'message';
            const data = [];
            for (const line of raw.split('\n')) {
                if (line.startsWith('event:')) name = line.slice(6).trim();
                else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (data.length) {
                try { onEvent(name, JSON.parse(data.join('\n'))); } catch (_) { /* ignore a malformed event */ }
            }
        }
    }
}

async function sendPlaygroundPrompt(event) {
    event.preventDefault();
    const output = document.getElementById('playgroundOutput');
    const usageBadge = document.getElementById('playgroundUsage');
    const send = document.getElementById('playgroundSend');
    const stop = document.getElementById('playgroundStop');
    const prompt = document.getElementById('playgroundPrompt').value.trim();
    if (!prompt) return;
    const body = {
        messages: [{ role: 'user', content: prompt }],
        maxTokens: parseInt(document.getElementById('playgroundMaxTokens').value, 10) || 1000
    };
    const system = document.getElementById('playgroundSystem').value.trim();
    const model = document.getElementById('playgroundModel').value;
    if (system) body.system = system;
    if (model) body.model = model;

    output.textContent = '';
    usageBadge.textContent = 'Streaming…';
    send.disabled = true;
    stop.disabled = false;
    playgroundController = new AbortController();
    try {
        const response = await fetch(buildAiUrl('/services/ai/api/stream'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: playgroundController.signal
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || err.message || `HTTP ${response.status}`);
        }
        await readServerSentEvents(response, (name, data) => {
            if (name === 'text_delta') output.textContent += data.text;
            else if (name === 'error') throw new Error(data.message || 'The model request failed');
            else if (name === 'usage') {
                const u = data.usage || {};
                usageBadge.textContent = `${formatNumber(u.input_tokens || 0)} in · ${formatNumber(u.output_tokens || 0)} out · ${formatCostUsd(data.cost)}`;
                const row = playgroundUsage.get(data.model) || { calls: 0, input: 0, output: 0, cost: 0 };
                row.calls += 1;
                row.input += u.input_tokens || 0;
                row.output += u.output_tokens || 0;
                row.cost += Number(data.cost) || 0;
                playgroundUsage.set(data.model, row);
                renderPlaygroundUsage();
            }
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            usageBadge.textContent = 'Failed';
            showAlert(error.message, 'error');
        } else {
            usageBadge.textContent = 'Stopped';
        }
    } finally {
        send.disabled = false;
        stop.disabled = true;
        playgroundController = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('playgroundForm')?.addEventListener('submit', sendPlaygroundPrompt);
    document.getElementById('playgroundStop')?.addEventListener('click', () => playgroundController?.abort());
    document.getElementById('playground-tab')?.addEventListener('shown.bs.tab', loadPlaygroundModels);
});
