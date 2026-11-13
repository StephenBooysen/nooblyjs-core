        // Dashboard Analytics
        let hitDistributionChart = null;
        let activityChart = null;
        let keyListData = [];
        let missesData = [];
        let sortState = {
            keyList: { column: 'hitCount', direction: 'desc' },
            misses: { column: 'missCount', direction: 'desc' }
        };

        // Data  Analytics (old list view)
        let analyticsData = [];
        let currentSort = { column: 'hits', direction: 'desc' };

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
                const response = await fetch('/services/caching/api/instances');
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
            return basePath.replace('/services/caching/api/', `/services/caching/api/${selectedInstance}/`);
        }

        // Load dashboard analytics data
        async function loadDashboardAnalytics() {
            const refreshBtn = document.getElementById('refreshBtn');
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Loading<span class="loading-spinner"></span>';

            try {
                const analyticsUrl = buildInstanceUrl('/services/caching/api/analytics');
                const response = await fetch(analyticsUrl);
                const data = await response.json();

                updateStats(data.stats);
                updateHitDistributionChart(data.hitDistribution);
                updateActivityChart(data.timeline);
                updateKeyListTable(data.keyList);
                updateMissesTable(data.topMisses);
            } catch (error) {
                console.error('Error loading analytics:', error);
                document.getElementById('keyListTableBody').innerHTML = '<tr><td colspan="5" class="no-data">Error loading analytics data</td></tr>';
                document.getElementById('missesTableBody').innerHTML = '<tr><td colspan="3" class="no-data">Error loading analytics data</td></tr>';
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
            }
        }

        // Update stats cards
        function updateStats(stats) {
            document.getElementById('totalKeys').textContent = (stats.totalKeys || 0).toLocaleString();
            document.getElementById('totalHits').textContent = (stats.totalHits || 0).toLocaleString();
            document.getElementById('totalMisses').textContent = (stats.totalMisses || 0).toLocaleString();
            document.getElementById('totalReads').textContent = (stats.totalReads || 0).toLocaleString();
            document.getElementById('totalWrites').textContent = (stats.totalWrites || 0).toLocaleString();
        }

        // Update hit distribution pie chart
        function updateHitDistributionChart(distribution) {
            const ctx = document.getElementById('hitDistributionChart').getContext('2d');

            if (hitDistributionChart) {
                hitDistributionChart.destroy();
            }

            if (!distribution.labels || distribution.labels.length === 0) {
                document.getElementById('hitDistributionChart').style.display = 'none';
                document.getElementById('hitDistributionEmpty').style.display = 'flex';
                return;
            }

            document.getElementById('hitDistributionChart').style.display = 'block';
            document.getElementById('hitDistributionEmpty').style.display = 'none';

            hitDistributionChart = new Chart(ctx, {
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
                                    return `${label}: ${value.toLocaleString()} hits (${percentage}%)`;
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

        // Update key list table
        function updateKeyListTable(keyList) {
            keyListData = keyList || [];
            renderKeyListTable();
        }

        // Render key list table
        function renderKeyListTable() {
            const tbody = document.getElementById('keyListTableBody');
            const table = document.getElementById('keyListTable');
            const emptyDiv = document.getElementById('keyListEmpty');

            if (keyListData.length === 0) {
                table.style.display = 'none';
                emptyDiv.style.display = 'flex';
                return;
            }

            table.style.display = 'table';
            emptyDiv.style.display = 'none';

            // Sort data
            const sortedData = [...keyListData].sort((a, b) => {
                const aVal = a[sortState.keyList.column];
                const bVal = b[sortState.keyList.column];

                if (sortState.keyList.direction === 'asc') {
                    return aVal > bVal ? 1 : -1;
                } else {
                    return aVal < bVal ? 1 : -1;
                }
            });

            // Update sort indicators
            document.querySelectorAll('[id^="sort-keyList-"]').forEach(span => {
                span.className = '';
            });
            const sortIndicator = document.getElementById(`sort-keyList-${sortState.keyList.column}`);
            if (sortIndicator) {
                sortIndicator.className = sortState.keyList.direction === 'asc' ? 'sort-asc' : 'sort-desc';
            }

            // Render rows
            tbody.innerHTML = sortedData.map(key => `
                <tr>
                    <td><span class="key-name">${escapeHtml(key.name)}</span></td>
                    <td>${key.hitCount.toLocaleString()}</td>
                    <td>${key.missCount.toLocaleString()}</td>
                    <td>${key.totalReads.toLocaleString()}</td>
                    <td>${key.totalWrites.toLocaleString()}</td>
                </tr>
            `).join('');

            // Update count
            document.getElementById('keyListCount').textContent = sortedData.length;
        }

        // Update misses table
        function updateMissesTable(topMisses) {
            missesData = topMisses || [];
            renderMissesTable();
        }

        // Render misses table
        function renderMissesTable() {
            const tbody = document.getElementById('missesTableBody');
            const table = document.getElementById('missesTable');
            const emptyDiv = document.getElementById('missesEmpty');

            if (missesData.length === 0) {
                table.style.display = 'none';
                emptyDiv.style.display = 'flex';
                return;
            }

            table.style.display = 'table';
            emptyDiv.style.display = 'none';

            // Sort data
            const sortedData = [...missesData].sort((a, b) => {
                const aVal = a[sortState.misses.column];
                const bVal = b[sortState.misses.column];

                if (sortState.misses.direction === 'asc') {
                    return aVal > bVal ? 1 : -1;
                } else {
                    return aVal < bVal ? 1 : -1;
                }
            });

            // Update sort indicators
            document.querySelectorAll('[id^="sort-misses-"]').forEach(span => {
                span.className = '';
            });
            const sortIndicator = document.getElementById(`sort-misses-${sortState.misses.column}`);
            if (sortIndicator) {
                sortIndicator.className = sortState.misses.direction === 'asc' ? 'sort-asc' : 'sort-desc';
            }

            // Render rows
            tbody.innerHTML = sortedData.map(miss => `
                <tr>
                    <td><span class="key-name">${escapeHtml(miss.key)}</span></td>
                    <td><span class="badge bg-danger">${miss.missCount.toLocaleString()}</span></td>
                    <td>${(miss.stats ? miss.stats.hitCount : 0).toLocaleString()}</td>
                </tr>
            `).join('');

            // Update count
            document.getElementById('misseCount').textContent = sortedData.length;
        }

        // Sort dashboard table
        function sortDashboardTable(tableName, column) {
            if (sortState[tableName].column === column) {
                sortState[tableName].direction = sortState[tableName].direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState[tableName].column = column;
                sortState[tableName].direction = 'desc';
            }

            if (tableName === 'keyList') {
                renderKeyListTable();
            } else if (tableName === 'misses') {
                renderMissesTable();
            }
        }

        // Data  Tab - Load analytics
        async function loadDataAnalytics() {
            try {
                const listUrl = buildInstanceUrl('/services/caching/api/list');
                const response = await fetch(listUrl);
                const result = await response.json();

                if (result.success) {
                    analyticsData = result.data;
                    updateDataAnalyticsTable();
                    document.getElementById('analyticsCount').textContent = result.total || analyticsData.length;
                } else {
                    showAnalyticsError(result.error || 'Failed to load analytics data');
                }
            } catch (error) {
                showAnalyticsError('Network error: ' + error.message);
            }
        }

        function updateDataAnalyticsTable() {
            const tbody = document.getElementById('analyticsTableBody');

            if (!analyticsData || analyticsData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="no-data">No cache operations recorded yet. Start using the cache to see analytics data here.</td></tr>';
                return;
            }

            // Sort data
            const sortedData = [...analyticsData].sort((a, b) => {
                let valueA, valueB;

                switch (currentSort.column) {
                    case 'key':
                        valueA = a.key.toLowerCase();
                        valueB = b.key.toLowerCase();
                        break;
                    case 'hits':
                        valueA = a.hits;
                        valueB = b.hits;
                        break;
                    case 'lastHit':
                        valueA = new Date(a.lastHit);
                        valueB = new Date(b.lastHit);
                        break;
                    default:
                        return 0;
                }

                if (currentSort.direction === 'asc') {
                    return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
                } else {
                    return valueA > valueB ? -1 : valueA < valueB ? 1 : 0;
                }
            });

            // Generate table rows
            tbody.innerHTML = sortedData.map(entry => `
                <tr>
                    <td class="key-cell">${escapeHtml(entry.key)}</td>
                    <td class="hits-cell">${entry.hits}</td>
                    <td class="date-cell">${formatDate(entry.lastHit)}</td>
                </tr>
            `).join('');

            // Update sort indicators
            updateSortIndicators();
        }

        function sortDataTable(column) {
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = column === 'hits' ? 'desc' : 'asc';
            }
            updateDataAnalyticsTable();
        }

        function updateSortIndicators() {
            document.querySelectorAll('.analytics-table th').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
            });

            const currentTh = document.querySelector(`[data-column="${currentSort.column}"]`);
            if (currentTh) {
                currentTh.classList.add(`sort-${currentSort.direction}`);
            }
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;

            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        function showAnalyticsError(message) {
            const tbody = document.getElementById('analyticsTableBody');
            tbody.innerHTML = `<tr><td colspan="3" class="no-data" style="color: var(--custom-danger);">Error: ${escapeHtml(message)}</td></tr>`;
            document.getElementById('analyticsCount').textContent = '0';
        }

        // JSON validation
        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace('Value', 'Validation'));
            const value = element.value.trim();

            if (!value) {
                element.classList.remove('json-valid', 'json-invalid');
                validation.style.display = 'none';
                return true;
            }

            try {
                JSON.parse(value);
                element.classList.remove('json-invalid');
                element.classList.add('json-valid');
                validation.textContent = '✓ Valid JSON';
                validation.className = 'core-validation-message validation-success';
                validation.style.display = 'block';
                return true;
            } catch (e) {
                element.classList.remove('json-valid');
                element.classList.add('json-invalid');
                validation.textContent = '✗ Invalid JSON: ' + e.message;
                validation.className = 'core-validation-message validation-error';
                validation.style.display = 'block';
                return false;
            }
        }

        // Real-time validation
        document.addEventListener('DOMContentLoaded', () => {
            const putValue = document.getElementById('putValue');
            if (putValue) {
                putValue.addEventListener('input', () => validateJSON('putValue'));
            }
        });

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
                putValue: {
                    "name": "John Doe",
                    "email": "john@example.com",
                    "metadata": {
                        "created": "2024-01-01T00:00:00Z",
                        "tags": ["user", "active"]
                    }
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
            messageElement.textContent = message;
            alertElement.classList.add('show');
            setTimeout(() => alertElement.classList.remove('show'), 5000);
        }

        function showResponse(containerId, contentId, data) {
            const container = document.getElementById(containerId);
            const content = document.getElementById(contentId);
            content.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            container.style.display = 'block';
        }

        function setLoading(formId, isLoading) {
            const form = document.getElementById(formId);
            if (isLoading) {
                form.classList.add('loading');
            } else {
                form.classList.remove('loading');
            }
        }


        // Initialize cache client from script library
        const cacheClient = new nooblyjsCaching({ instanceName: selectedInstance, debug: false });

        // Form handlers using caching script library
        document.getElementById('putForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('putKey').value;
            const value = document.getElementById('putValue').value;

            if (!validateJSON('putValue')) {
                showAlert('Please enter valid JSON before storing data', 'error');
                return;
            }

            try {
                setLoading('putForm', true);
                const parsedValue = JSON.parse(value);
                await cacheClient.put(key, parsedValue);
                showResponse('putResponse', 'putResponseContent', { success: true, message: 'OK' });
                showAlert(`Cache entry stored successfully with key: ${key}`);
                loadDataAnalytics();
            } catch (error) {
                showAlert('Error storing cache entry: ' + error.message, 'error');
                showResponse('putResponse', 'putResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('putForm', false);
            }
        });

        document.getElementById('getForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('getKey').value;

            try {
                setLoading('getForm', true);
                const result = await cacheClient.get(key);
                showResponse('getResponse', 'getResponseContent', result);
                showAlert(`Cache entry retrieved successfully for key: ${key}`);
                loadDataAnalytics();
            } catch (error) {
                showAlert('Error retrieving cache entry: ' + error.message, 'error');
                showResponse('getResponse', 'getResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('getForm', false);
            }
        });

        document.getElementById('deleteForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('deleteKey').value;

            if (!confirm(`Are you sure you want to delete the cache entry with key: ${key}?`)) {
                return;
            }

            try {
                setLoading('deleteForm', true);
                await cacheClient.delete(key);
                showResponse('deleteResponse', 'deleteResponseContent', { success: true, message: 'OK' });
                showAlert(`Cache entry deleted successfully for key: ${key}`);
                loadDataAnalytics();
            } catch (error) {
                showAlert('Error deleting cache entry: ' + error.message, 'error');
                showResponse('deleteResponse', 'deleteResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('deleteForm', false);
            }
        });

        async function checkStatus() {
            try {
                const result = await cacheClient.status();
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // Escape HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const settingsUrl = buildInstanceUrl('/services/caching/api/settings');
                const response = await fetch(settingsUrl);
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
                const settingsUrl = buildInstanceUrl('/services/caching/api/settings');
                const response = await fetch(settingsUrl, {
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

        // Instance selector handlers
        document.getElementById('instanceSelector')?.addEventListener('change', function (e) {
            selectedInstance = this.value;
            loadDashboardAnalytics();
            loadDataAnalytics();
        });

        document.getElementById('refreshInstanceBtn')?.addEventListener('click', function (e) {
            e.preventDefault();
            loadAvailableInstances();
        });

        // Load Swagger spec from external docs.json file
        async function initializeSwaggerUI() {
            try {
                // Fetch the Swagger specification from the external docs.json file
                const response = await fetch('/services/caching/api/swagger/docs.json');
                if (!response.ok) {
                    throw new Error(`Failed to load Swagger docs: ${response.status}`);
                }
                const spec = await response.json();

                // Initialize Swagger UI with the loaded spec
                initializeSwagger(spec);
            } catch (error) {
                console.error('Error loading Swagger documentation:', error);
                document.getElementById('swagger-ui').innerHTML = `
                    <div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;">
                        <strong>Error loading API documentation</strong><br>
                        Failed to load Swagger specification from docs.json<br>
                        Error: ${error.message}<br>
                        <button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px;">Reload Page</button>
                    </div>
                `;
            }
        }

        // Initialize Swagger UI with the provided spec
        function initializeSwagger(spec) {
            // Ensure Swagger UI dependencies are loaded
            if (typeof SwaggerUIBundle === 'undefined') {
                console.error('SwaggerUIBundle not loaded');
                document.getElementById('swagger-ui').innerHTML = '<div style="color: red; padding: 20px; text-align: center;">Swagger UI failed to load. Please check your internet connection and refresh the page.</div>';
                return;
            }

            try {
                const container = document.getElementById('swagger-ui');
                container.innerHTML = '';

                const ui = SwaggerUIBundle({
                    spec: spec,
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

                setTimeout(function() {
                    const swaggerContent = document.querySelector('#swagger-ui .swagger-ui');
                    if (!swaggerContent) {
                        console.warn('Swagger UI may not have initialized properly');
                        document.getElementById('swagger-ui').innerHTML = '<div style="color: orange; padding: 20px;">API documentation is loading... If this message persists, please refresh the page.</div>';
                    }
                }, 3000);

            } catch (error) {
                console.error('Critical error initializing Swagger UI:', error);
                document.getElementById('swagger-ui').innerHTML = '<div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;"><strong>Error loading API documentation</strong><br>Error: ' + error.message + '<br><button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px;">Reload Page</button></div>';
            }
        }

        // Initialize: Load instances, analytics, and Swagger docs on page load
        document.addEventListener('DOMContentLoaded', function () {
            loadAvailableInstances();
            loadDashboardAnalytics();
            initializeSwaggerUI();

            // Cache Hits table now lives on the dashboard tab
            loadDataAnalytics();

            // Auto-refresh dashboard analytics every 30 seconds
            setInterval(loadDashboardAnalytics, 30000);
            setInterval(loadDataAnalytics, 30000);
        });
    
