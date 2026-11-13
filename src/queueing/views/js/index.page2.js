        let distributionChart = null;
        let activityChart = null;
        let queueListData = [];
        let sortColumn = 'currentSize';
        let sortDirection = 'desc';

        // Instance selection state
        let selectedInstance = 'default';

        // Color palette for charts
        const chartColors = [
            // NooblyJS palette: accent, teal, then the design system's deep avatar tones
            '#C2471F', '#2B7F86', '#4B2E83', '#E4B85C', '#1F4A8A',
            '#8A2440', '#3D5A1E', '#F2A27E', '#6B605A', '#1E5E63'
        ];

        // Instance management functions
        async function loadAvailableInstances() {
            try {
                const response = await fetch('/services/queueing/api/instances');
                if (!response.ok) {
                    console.error('Failed to fetch instances');
                    return;
                }
                const data = await response.json();
                if (data.instances && Array.isArray(data.instances)) {
                    updateInstanceSelector(data.instances);
                }
            } catch (error) {
                console.error('Error loading instances:', error);
            }
        }

        function updateInstanceSelector(instances) {
            const selector = document.getElementById('instanceSelector');
            const currentValue = selector.value;

            // Clear existing options
            selector.innerHTML = '';

            // Add instances as options
            instances.forEach(instance => {
                const option = document.createElement('option');
                option.value = instance.name;
                option.textContent = `${instance.name}${instance.name === 'default' ? ' (default)' : ''}`;
                selector.appendChild(option);
            });

            // Restore previously selected instance if it still exists
            if (instances.some(i => i.name === currentValue)) {
                selector.value = currentValue;
            } else {
                selector.value = 'default';
                selectedInstance = 'default';
            }
        }

        function buildInstanceUrl(basePath) {
            if (selectedInstance === 'default') {
                return basePath;
            }
            // Insert instance name after /api/ in the path
            return basePath.replace('/services/queueing/api/', `/services/queueing/api/${selectedInstance}/`);
        }

        // Load analytics data
        async function loadAnalytics() {
            const refreshBtn = document.getElementById('refreshBtn');
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Loading<span class="loading-spinner"></span>';

            try {
                const analyticsUrl = buildInstanceUrl('/services/queueing/api/analytics');
                const response = await fetch(analyticsUrl);
                const data = await response.json();

                updateStats(data.stats);
                updateDistributionChart(data.distribution);
                updateActivityChart(data.timeline);
                updateQueueTable(data.queueList);
            } catch (error) {
                console.error('Error loading analytics:', error);
                document.getElementById('queueTableBody').innerHTML = '<tr><td colspan="5" class="no-data">Error loading analytics data</td></tr>';
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
            }
        }

        // Update stats cards
        function updateStats(stats) {
            const totalQueues = stats.totalQueues || 0;
            let totalMessages = 0;
            let totalEnqueued = 0;
            let totalDequeued = 0;

            Object.values(stats.queues || {}).forEach(queueStats => {
                totalMessages += queueStats.totalMessages || 0;
                totalEnqueued += queueStats.enqueueCount || 0;
                totalDequeued += queueStats.dequeueCount || 0;
            });

            document.getElementById('totalQueues').textContent = totalQueues;
            document.getElementById('totalMessages').textContent = totalMessages.toLocaleString();
            document.getElementById('totalEnqueued').textContent = totalEnqueued.toLocaleString();
            document.getElementById('totalDequeued').textContent = totalDequeued.toLocaleString();
        }

        // Update distribution pie chart
        function updateDistributionChart(distribution) {
            const ctx = document.getElementById('distributionChart').getContext('2d');

            if (distributionChart) {
                distributionChart.destroy();
            }

            if (!distribution.labels || distribution.labels.length === 0) {
                document.getElementById('distributionChart').style.display = 'none';
                document.getElementById('distributionEmpty').style.display = 'flex';
                return;
            }

            document.getElementById('distributionChart').style.display = 'block';
            document.getElementById('distributionEmpty').style.display = 'none';

            distributionChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: distribution.labels,
                    datasets: [{
                        data: distribution.data,
                        backgroundColor: chartColors,
                        borderColor: '#fff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Update activity line chart
        function updateActivityChart(timeline) {
            const ctx = document.getElementById('activityChart').getContext('2d');

            if (activityChart) {
                activityChart.destroy();
            }

            if (!timeline.labels || timeline.labels.length === 0) {
                document.getElementById('activityChart').style.display = 'none';
                document.getElementById('activityEmpty').style.display = 'flex';
                return;
            }

            document.getElementById('activityChart').style.display = 'block';
            document.getElementById('activityEmpty').style.display = 'none';

            const datasets = timeline.datasets.map((dataset, index) => ({
                label: dataset.name,
                data: dataset.data,
                borderColor: chartColors[index % chartColors.length],
                backgroundColor: chartColors[index % chartColors.length] + '20',
                borderWidth: 2,
                tension: 0.4,
                fill: false
            }));

            activityChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: timeline.labels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `${context.dataset.label}: ${context.parsed.y} operations`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                precision: 0
                            },
                            title: {
                                display: true,
                                text: 'Operations per Minute'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Time'
                            }
                        }
                    }
                }
            });
        }

        // Update queue table
        function updateQueueTable(queueList) {
            queueListData = queueList || [];
            renderQueueTable();
        }

        // Render queue table
        function renderQueueTable() {
            const tbody = document.getElementById('queueTableBody');
            const table = document.getElementById('queueTable');
            const emptyDiv = document.getElementById('queueEmpty');

            if (queueListData.length === 0) {
                table.style.display = 'none';
                emptyDiv.style.display = 'flex';
                return;
            }

            table.style.display = 'table';
            emptyDiv.style.display = 'none';

            // Sort data
            const sortedData = [...queueListData].sort((a, b) => {
                const aVal = a[sortColumn];
                const bVal = b[sortColumn];

                if (sortDirection === 'asc') {
                    return aVal > bVal ? 1 : -1;
                } else {
                    return aVal < bVal ? 1 : -1;
                }
            });

            // Update sort indicators
            document.querySelectorAll('.sortable span').forEach(span => {
                span.className = '';
            });
            const sortIndicator = document.getElementById(`sort-${sortColumn}`);
            if (sortIndicator) {
                sortIndicator.className = sortDirection === 'asc' ? 'sort-asc' : 'sort-desc';
            }

            // Render rows
            tbody.innerHTML = sortedData.map(queue => `
                <tr>
                    <td><span class="queue-name">${escapeHtml(queue.name)}</span></td>
                    <td>${queue.currentSize.toLocaleString()}</td>
                    <td>${queue.totalEnqueued.toLocaleString()}</td>
                    <td>${queue.totalDequeued.toLocaleString()}</td>
                    <td>${queue.totalMessages.toLocaleString()}</td>
                </tr>
            `).join('');

            // Update count
            document.getElementById('queueCount').textContent = sortedData.length;
        }

        // Sort table
        function sortTable(column) {
            if (sortColumn === column) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = column;
                sortDirection = 'desc';
            }
            renderQueueTable();
        }

        // Escape HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Load analytics on page load
        window.addEventListener('load', () => {
            checkStatus();
            loadAvailableInstances();
            loadAnalytics();
            // Auto-refresh every 30 seconds
            setInterval(loadAnalytics, 30000);
        });

        // Instance selector handlers
        // ----- Reliable jobs (feature 06) -----
        function reliableQueue() {
            const name = document.getElementById('reliableQueueName').value.trim();
            if (!name) {
                reliableMessage('Enter a queue name first.', 'warning');
                return null;
            }
            return encodeURIComponent(name);
        }

        function reliableMessage(text, type) {
            const box = document.getElementById('reliableMessage');
            box.textContent = text;
            box.className = `alert alert-${type} fade show`;
            box.style.display = 'block';
        }

        function reliableShow(data) {
            const box = document.getElementById('reliableResult');
            box.textContent = JSON.stringify(data, null, 2);
            box.style.display = 'block';
        }

        async function reliableRequest(url, method = 'GET') {
            const response = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.error || `Request failed (${response.status})`);
            }
            return body;
        }

        async function reliableRefreshCounts(name) {
            const body = await reliableRequest(`/services/queueing/api/queues/${name}/job-counts`);
            const c = body.data || {};
            ['waiting', 'delayed', 'active', 'completed', 'dead'].forEach((key) => {
                document.getElementById('reliable' + key.charAt(0).toUpperCase() + key.slice(1)).textContent = c[key] || 0;
            });
            document.getElementById('reliableCounts').style.display = 'block';
        }

        document.getElementById('reliableCountsBtn')?.addEventListener('click', async function () {
            const name = reliableQueue();
            if (!name) return;
            try {
                await reliableRefreshCounts(name);
                reliableMessage('Counts updated.', 'success');
            } catch (err) {
                reliableMessage(err.message, 'danger');
            }
        });

        document.getElementById('reliableRetryBtn')?.addEventListener('click', async function () {
            const name = reliableQueue();
            if (!name) return;
            try {
                const body = await reliableRequest(`/services/queueing/api/queues/${name}/retry-dead`, 'POST');
                reliableMessage(`Requeued ${body.data?.requeued ?? 0} dead-lettered job(s).`, 'success');
                await reliableRefreshCounts(name);
            } catch (err) {
                reliableMessage(err.message, 'danger');
            }
        });

        document.getElementById('reliableLookupBtn')?.addEventListener('click', async function () {
            const name = reliableQueue();
            const jobId = document.getElementById('reliableJobId').value.trim();
            if (!name) return;
            if (!jobId) {
                reliableMessage('Enter a job ID.', 'warning');
                return;
            }
            try {
                const body = await reliableRequest(`/services/queueing/api/queues/${name}/jobs/${encodeURIComponent(jobId)}`);
                reliableShow(body.data);
                reliableMessage('Job found.', 'success');
            } catch (err) {
                reliableMessage(err.message, 'danger');
            }
        });

        document.getElementById('instanceSelector')?.addEventListener('change', function (e) {
            selectedInstance = this.value;
            loadAnalytics();
        });

        document.getElementById('refreshInstanceBtn')?.addEventListener('click', function (e) {
            e.preventDefault();
            loadAvailableInstances();
        });

        // Data Tab - Functions
        // JSON validation
        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace('Item', 'Validation'));
            const value = element.value.trim();

            if (!value) {
                element.classList.remove('json-valid', 'json-invalid');
                if (validation) validation.style.display = 'none';
                return true;
            }

            try {
                JSON.parse(value);
                element.classList.remove('json-invalid');
                element.classList.add('json-valid');
                if (validation) {
                    validation.textContent = '✓ Valid JSON';
                    validation.className = 'core-validation-message validation-success';
                    validation.style.display = 'block';
                }
                return true;
            } catch (e) {
                element.classList.remove('json-valid');
                element.classList.add('json-invalid');
                if (validation) {
                    validation.textContent = '✗ Invalid JSON: ' + e.message;
                    validation.className = 'core-validation-message validation-error';
                    validation.style.display = 'block';
                }
                return false;
            }
        }

        // Format JSON
        function formatJSON(elementId) {
            const element = document.getElementById(elementId);
            try {
                const parsed = JSON.parse(element.value);
                element.value = JSON.stringify(parsed, null, 2);
                validateJSON(elementId);
            } catch (e) {
                showAlert('Invalid JSON cannot be formatted', 'error');
            }
        }

        // Load example
        function loadExample(elementId) {
            const examples = {
                enqueueItem: {
                    "task": "send-welcome-email",
                    "userId": "user-xyz-123",
                    "template": "welcome-template-v2"
                }
            };

            if (examples[elementId]) {
                document.getElementById(elementId).value = JSON.stringify(examples[elementId], null, 2);
                validateJSON(elementId);
            }
        }

        // Utility functions
        function showAlert(message, type = 'success') {
            const alertElement = document.getElementById(type + 'Alert');
            const messageElement = document.getElementById(type + 'Message');
            if (messageElement && alertElement) {
                messageElement.textContent = message;
                alertElement.classList.add('show');
                setTimeout(() => alertElement.classList.remove('show'), 5000);
            }
        }

        function showResponse(containerId, contentId, data) {
            const container = document.getElementById(containerId);
            const content = document.getElementById(contentId);
            if (content && container) {
                content.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
                container.style.display = 'block';
            }
        }

        function setLoading(formId, isLoading) {
            const form = document.getElementById(formId);
            if (form) {
                if (isLoading) {
                    form.classList.add('loading');
                } else {
                    form.classList.remove('loading');
                }
            }
        }

        // Initialize queueing client
        const queueClient = new nooblyjsqueueing('default', { debug: false });

        // Form handlers using queueing script library
        document.addEventListener('DOMContentLoaded', () => {
            // Real-time validation
            const enqueueItem = document.getElementById('enqueueItem');
            if (enqueueItem) {
                enqueueItem.addEventListener('input', () => validateJSON('enqueueItem'));
            }

            // Enqueue form
            const enqueueForm = document.getElementById('enqueueForm');
            if (enqueueForm) {
                enqueueForm.addEventListener('submit', async (e) => {
                    e.preventDefault();

                    const queueName = document.getElementById('enqueueQueueName').value.trim();
                    const item = document.getElementById('enqueueItem').value;

                    if (!queueName) {
                        showAlert('Please enter a queue name', 'error');
                        return;
                    }

                    if (!validateJSON('enqueueItem')) {
                        showAlert('Please enter a valid JSON item', 'error');
                        return;
                    }

                    try {
                        setLoading('enqueueForm', true);
                        const parsedItem = JSON.parse(item);
                        const result = await queueClient.enqueue(queueName, parsedItem);
                        showResponse('enqueueResponse', 'enqueueResponseContent', result);
                        showAlert(`Item enqueued to '${queueName}' successfully`);
                    } catch (error) {
                        showAlert('Error enqueuing item: ' + error.message, 'error');
                        showResponse('enqueueResponse', 'enqueueResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('enqueueForm', false);
                    }
                });
            }

            // Dequeue form
            const dequeueForm = document.getElementById('dequeueForm');
            if (dequeueForm) {
                dequeueForm.addEventListener('submit', async (e) => {
                    e.preventDefault();

                    const queueName = document.getElementById('dequeueQueueName').value.trim();

                    if (!queueName) {
                        showAlert('Please enter a queue name', 'error');
                        return;
                    }

                    try {
                        setLoading('dequeueForm', true);
                        const result = await queueClient.dequeue(queueName);
                        showResponse('dequeueResponse', 'dequeueResponseContent', result);
                        showAlert(`Item dequeued from '${queueName}' successfully`);
                    } catch (error) {
                        showAlert('Error dequeuing item: ' + error.message, 'error');
                        showResponse('dequeueResponse', 'dequeueResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('dequeueForm', false);
                    }
                });
            }

            // Size form
            const sizeForm = document.getElementById('sizeForm');
            if (sizeForm) {
                sizeForm.addEventListener('submit', async (e) => {
                    e.preventDefault();

                    const queueName = document.getElementById('sizeQueueName').value.trim();

                    if (!queueName) {
                        showAlert('Please enter a queue name', 'error');
                        return;
                    }

                    try {
                        setLoading('sizeForm', true);
                        const result = await queueClient.size(queueName);
                        showResponse('sizeResponse', 'sizeResponseContent', result);
                        showAlert(`Queue size for '${queueName}' retrieved successfully`);
                    } catch (error) {
                        showAlert('Error retrieving queue size: ' + error.message, 'error');
                        showResponse('sizeResponse', 'sizeResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('sizeForm', false);
                    }
                });
            }

            // Purge form
            const purgeForm = document.getElementById('purgeForm');
            if (purgeForm) {
                purgeForm.addEventListener('submit', async (e) => {
                    e.preventDefault();

                    const queueName = document.getElementById('purgeQueueName').value.trim();

                    if (!queueName) {
                        showAlert('Please enter a queue name', 'error');
                        return;
                    }

                    if (!confirm(`Are you sure you want to purge all items from queue '${queueName}'? This cannot be undone.`)) {
                        return;
                    }

                    try {
                        setLoading('purgeForm', true);
                        const result = await queueClient.purge(queueName);
                        showResponse('purgeResponse', 'purgeResponseContent', result);
                        showAlert(`Queue '${queueName}' purged successfully`);
                    } catch (error) {
                        showAlert('Error purging queue: ' + error.message, 'error');
                        showResponse('purgeResponse', 'purgeResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('purgeForm', false);
                    }
                });
            }
        });

        async function listQueues() {
            try {
                const result = await queueClient.listQueues();
                showResponse('listQueuesResponse', 'listQueuesResponseContent', result);
                showAlert('Queue list retrieved successfully');
            } catch (error) {
                showAlert('Error listing queues: ' + error.message, 'error');
                showResponse('listQueuesResponse', 'listQueuesResponseContent', 'Error: ' + error.message);
            }
        }

        async function checkStatus() {
            try {
                const response = await fetch('/services/queueing/api/status');
                const result = await response.json();
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/queueing/api/settings');
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
                const response = await fetch('/services/queueing/api/settings', {
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

        // Swagger UI setup - Load spec from docs.json endpoint
        let spec = null;

        // Initialize Swagger UI

        // Initialize header user profile
        function initializeHeaderUserProfile() {
            const currentUser = localStorage.getItem('currentUser');
            const headerUserAvatar = document.getElementById('headerUserAvatar');
            const headerUserLabel = document.getElementById('headerUserLabel');
            const headerUserName = document.getElementById('headerUserName');
            const headerLogoutBtn = document.getElementById('headerLogoutBtn');

            if (currentUser) {
                try {
                    const user = JSON.parse(currentUser);
                    const userName = user.fullName || user.email || 'User';
                    const initials = userName.substring(0, 1).toUpperCase();

                    if (headerUserAvatar) headerUserAvatar.textContent = initials;
                    if (headerUserLabel) headerUserLabel.textContent = 'User';
                    if (headerUserName) headerUserName.textContent = userName;
                } catch (e) {
                    console.error('Error parsing user data:', e);
                }
            }

            // Setup logout functionality
            if (headerLogoutBtn) {
                headerLogoutBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        await fetch('/services/authservice/api/logout', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: '{}'
                        });
                    } catch (error) {
                        console.error('Logout error:', error);
                    }
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('currentUser');
                    window.location.href = '/services/authservice/views/login.html';
                });
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            initializeHeaderUserProfile();
            if (typeof SwaggerUIBundle === 'undefined') {
                console.error('SwaggerUIBundle not loaded');
                const swaggerContainer = document.getElementById('swagger-ui');
                if (swaggerContainer) {
                    swaggerContainer.innerHTML = '<div style="color: red; padding: 20px; text-align: center;">Swagger UI failed to load. Please check your internet connection and refresh the page.</div>';
                }
                return;
            }

            // Fetch Swagger spec from docs.json endpoint
            fetch('/services/queueing/api/swagger/docs.json')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Failed to fetch API documentation');
                    }
                    return response.json();
                })
                .then(swaggerSpec => {
                    initializeSwaggerUI(swaggerSpec);
                })
                .catch(error => {
                    console.error('Error loading Swagger documentation:', error);
                    const container = document.getElementById('swagger-ui');
                    if (container) {
                        container.innerHTML = '<div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;"><strong>Error loading API documentation</strong><br>Error: ' + error.message + '<br><button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px;">Reload Page</button></div>';
                    }
                });

            function initializeSwaggerUI(swaggerSpec) {
                try {
                    const container = document.getElementById('swagger-ui');
                    if (!container) return;

                    container.innerHTML = '';

                    const ui = SwaggerUIBundle({
                        spec: swaggerSpec,
                    dom_id: '#swagger-ui',
                    deepLinking: false,
                    presets: [
                        SwaggerUIBundle.presets.apis
                    ],
                    plugins: [
                        SwaggerUIBundle.plugins.DownloadUrl
                    ],
                    layout: "BaseLayout",
                    validatorUrl: null,
                    tryItOutEnabled: true,
                    displayOperationId: false,
                    showExtensions: false,
                    showCommonExtensions: false,
                    docExpansion: 'list',
                    defaultModelsExpandDepth: 1,
                    defaultModelExpandDepth: 1,
                    filter: false,
                    showRequestHeaders: false,
                    supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
                    onComplete: function() {
                        console.log('Swagger UI initialized successfully');
                        const topbar = document.querySelector('#swagger-ui .topbar');
                        if (topbar) {
                            topbar.style.display = 'none';
                        }
                        const swaggerContainer = document.querySelector('#swagger-ui');
                        if (swaggerContainer) {
                            swaggerContainer.style.fontFamily = 'inherit';
                        }
                    },
                    onFailure: function(error) {
                        console.error('Swagger UI initialization failed:', error);
                        document.getElementById('swagger-ui').innerHTML = '<div style="color: red; padding: 20px;">Failed to initialize API documentation: ' + error.message + '</div>';
                    }
                });

                    window.swaggerUI = ui;
                } catch (error) {
                    console.error('Critical error initializing Swagger UI:', error);
                    const swaggerContainer = document.getElementById('swagger-ui');
                    if (swaggerContainer) {
                        swaggerContainer.innerHTML = '<div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;"><strong>Error loading API documentation</strong><br>Error: ' + error.message + '<br><button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px;">Reload Page</button></div>';
                    }
                }
            }
        });
    
