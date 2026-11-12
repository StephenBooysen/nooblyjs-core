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
            if (!form) return;
            if (isLoading) {
                form.classList.add('loading');
            } else {
                form.classList.remove('loading');
            }
        }

        function toggleDashboardSpinner(isLoading) {
            const spinner = document.getElementById('dashboardSpinner');
            if (!spinner) return;
            spinner.classList.toggle('d-none', !isLoading);
        }

        async function makeRequest(url, method = 'GET', body = null) {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            if (body) {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url, options);
            const contentType = response.headers.get('content-type');

            if (!response.ok) {
                const errorMessage = await response.text();
                throw new Error(errorMessage || 'Request failed');
            }

            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }

            return await response.text();
        }

        function formatDate(isoString) {
            if (!isoString) {
                return '—';
            }
            const date = new Date(isoString);
            if (Number.isNaN(date.getTime())) {
                return '—';
            }
            return date.toLocaleString();
        }

        async function refreshDashboard() {
            toggleDashboardSpinner(true);

            const topMetricsActivityBody = document.getElementById('topMetricsActivityBody');
            const topMetricsActivityCount = document.getElementById('topMetricsActivityCount');
            const metricsTableBody = document.getElementById('metricsTableBody');
            const metricsRowCount = document.getElementById('metricsRowCount');

            if (topMetricsActivityBody) {
                topMetricsActivityBody.innerHTML = `
                    <tr class="loading-row">
                        <td colspan="3">
                            <div class="spinner-border spinner-border-sm me-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            Loading metrics...
                        </td>
                    </tr>
                `;
            }

            if (metricsTableBody) {
                metricsTableBody.innerHTML = `
                    <tr class="loading-row">
                        <td colspan="3">
                            <div class="spinner-border spinner-border-sm me-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            Loading metrics...
                        </td>
                    </tr>
                `;
            }

            try {
                const summary = await makeRequest('/services/measuring/api/analytics/summary');

                document.getElementById('totalMeasurements').textContent = summary?.totals?.totalMeasurements ?? 0;
                document.getElementById('totalUniqueMetrics').textContent = summary?.totals?.uniqueMetrics ?? 0;

                const mostRecentMetric = summary?.topByRecency?.[0];
                document.getElementById('lastMetricName').textContent = mostRecentMetric?.metric ?? '—';
                const lastMetricTimestamp = document.getElementById('lastMetricTimestamp');
                if (lastMetricTimestamp) {
                    lastMetricTimestamp.textContent = mostRecentMetric
                        ? `Last captured ${formatDate(mostRecentMetric.lastCaptured)}`
                        : 'No activity recorded';
                }

                if (topMetricsActivityBody) {
                    const topMetrics = summary?.topByActivity ?? [];
                    if (topMetrics.length === 0) {
                        topMetricsActivityBody.innerHTML = `
                            <tr>
                                <td colspan="3" class="text-center text-muted">No metrics recorded yet.</td>
                            </tr>
                        `;
                    } else {
                        topMetricsActivityBody.innerHTML = topMetrics.map((metric) => `
                            <tr>
                                <td>${metric.metric}</td>
                                <td>${metric.count}</td>
                                <td>${formatDate(metric.lastCaptured)}</td>
                            </tr>
                        `).join('');
                    }
                    topMetricsActivityCount.textContent = topMetrics.length;
                }

                if (metricsTableBody) {
                    const recentMetrics = summary?.topByRecency ?? [];
                    if (recentMetrics.length === 0) {
                        metricsTableBody.innerHTML = `
                            <tr>
                                <td colspan="3" class="text-center text-muted">No metrics recorded yet.</td>
                            </tr>
                        `;
                    } else {
                        metricsTableBody.innerHTML = recentMetrics.map((metric) => `
                            <tr>
                                <td>${metric.metric}</td>
                                <td>${metric.count}</td>
                                <td>${formatDate(metric.lastCaptured)}</td>
                            </tr>
                        `).join('');
                    }
                    metricsRowCount.textContent = recentMetrics.length;
                }
            } catch (error) {
                showAlert('Failed to load analytics: ' + error.message, 'error');
            } finally {
                toggleDashboardSpinner(false);
            }
        }

        document.getElementById('measureForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('measureName').value.trim();
            const value = Number(document.getElementById('measureValue').value);

            if (!name) {
                showAlert('Metric name is required', 'error');
                return;
            }

            if (Number.isNaN(value)) {
                showAlert('Metric value must be numeric', 'error');
                return;
            }

            try {
                setLoading('measureForm', true);
                const result = await makeRequest('/services/measuring/api/add', 'POST', { metric: name, value });
                showResponse('measureResponse', 'measureResponseContent', result);
                showAlert(`Measurement recorded successfully for: ${name}`);
                refreshDashboard();
            } catch (error) {
                showAlert('Error recording measurement: ' + error.message, 'error');
                showResponse('measureResponse', 'measureResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('measureForm', false);
            }
        });

        document.getElementById('queryMetricsForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const metricName = document.getElementById('queryMetricName').value.trim();
            const startDate = document.getElementById('queryStartDate').value;
            const endDate = document.getElementById('queryEndDate').value;
            const operation = document.getElementById('queryOperation').value;

            if (!metricName) {
                showAlert('Metric name is required', 'error');
                return;
            }

            if (!startDate) {
                showAlert('Start date is required', 'error');
                return;
            }

            if (!endDate) {
                showAlert('End date is required', 'error');
                return;
            }

            if (!operation) {
                showAlert('Please select an operation', 'error');
                return;
            }

            try {
                setLoading('queryMetricsForm', true);

                // Convert datetime-local to ISO string
                const startDateTime = new Date(startDate).toISOString();
                const endDateTime = new Date(endDate).toISOString();

                let url;
                switch (operation) {
                    case 'list':
                        url = `/services/measuring/api/list/${encodeURIComponent(metricName)}/${encodeURIComponent(startDateTime)}/${encodeURIComponent(endDateTime)}`;
                        break;
                    case 'total':
                        url = `/services/measuring/api/total/${encodeURIComponent(metricName)}/${encodeURIComponent(startDateTime)}/${encodeURIComponent(endDateTime)}`;
                        break;
                    case 'average':
                        url = `/services/measuring/api/average/${encodeURIComponent(metricName)}/${encodeURIComponent(startDateTime)}/${encodeURIComponent(endDateTime)}`;
                        break;
                    default:
                        showAlert('Invalid operation selected', 'error');
                        return;
                }

                const result = await makeRequest(url, 'GET');
                showResponse('queryMetricsResponse', 'queryMetricsResponseContent', result);
                showAlert(`Query completed successfully for metric: ${metricName}`);
            } catch (error) {
                showAlert('Error querying metric: ' + error.message, 'error');
                showResponse('queryMetricsResponse', 'queryMetricsResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('queryMetricsForm', false);
            }
        });

        function resetQueryMetricsForm() {
            document.getElementById('queryMetricsForm').reset();
            document.getElementById('queryMetricsResponse').style.display = 'none';
        }

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/measuring/api/status');
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        const spec = {
            openapi: '3.0.0',
            info: {
                title: 'Measuring API',
                description: 'REST API for measuring operations',
                version: '1.0.0'
            },
            servers: [
                { url: '/services/measuring/api', description: 'Measuring API' }
            ],
            paths: {
                '/add': {
                    post: {
                        summary: 'Record a measurement',
                        description: 'Records a new measurement value for a given metric name',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            metric: { type: 'string' },
                                            value: { type: 'number' }
                                        },
                                        required: ['metric', 'value']
                                    },
                                    example: { "metric": "response_time", "value": 250 }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Measurement recorded successfully',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'OK' } }
                                }
                            },
                            '400': {
                                description: 'Bad request'
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    }
                },
                '/status': {
                    get: {
                        summary: 'Service status',
                        description: 'Check if the measuring service is running',
                        responses: {
                            '200': {
                                description: 'Service is running',
                                content: {
                                    'application/json': {
                                        schema: { type: 'string', example: 'measuring api running' }
                                    }
                                }
                            }
                        }
                    }
                },
                '/list/{metric}/{datestart}/{dateend}': {
                    get: {
                        summary: 'List metrics by name and date range',
                        description: 'Retrieves a list of metric values for a specific metric within a specified date range',
                        parameters: [
                            {
                                name: 'metric',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The metric name to query'
                            },
                            {
                                name: 'datestart',
                                in: 'path',
                                required: true,
                                schema: { type: 'string', format: 'date-time' },
                                description: 'Start date in ISO 8601 format (e.g., 2024-01-01T00:00:00Z)'
                            },
                            {
                                name: 'dateend',
                                in: 'path',
                                required: true,
                                schema: { type: 'string', format: 'date-time' },
                                description: 'End date in ISO 8601 format (e.g., 2024-12-31T23:59:59Z)'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'List of metric values',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    metric: { type: 'string' },
                                                    value: { type: 'number' },
                                                    date: { type: 'string', format: 'date-time' }
                                                }
                                            }
                                        },
                                        example: [
                                            { metric: 'response_time', value: 250, date: '2024-06-01T12:30:00.000Z' },
                                            { metric: 'response_time', value: 275, date: '2024-06-01T12:31:00.000Z' }
                                        ]
                                    }
                                }
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    }
                },
                '/total/{metric}/{datestart}/{dateend}': {
                    get: {
                        summary: 'Calculate total of metric values',
                        description: 'Calculates the total sum of metric values for a specific metric within a specified date range',
                        parameters: [
                            {
                                name: 'metric',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The metric name to aggregate'
                            },
                            {
                                name: 'datestart',
                                in: 'path',
                                required: true,
                                schema: { type: 'string', format: 'date-time' },
                                description: 'Start date in ISO 8601 format'
                            },
                            {
                                name: 'dateend',
                                in: 'path',
                                required: true,
                                schema: { type: 'string', format: 'date-time' },
                                description: 'End date in ISO 8601 format'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Total sum of metric values',
                                content: {
                                    'application/json': {
                                        schema: { type: 'number' },
                                        example: 5250
                                    }
                                }
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    }
                },
                '/average/{metric}/{datestart}/{dateend}': {
                    get: {
                        summary: 'Calculate average of metric values',
                        description: 'Calculates the average of metric values for a specific metric within a specified date range',
                        parameters: [
                            {
                                name: 'metric',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The metric name to average'
                            },
                            {
                                name: 'datestart',
                                in: 'path',
                                required: true,
                                schema: { type: 'string', format: 'date-time' },
                                description: 'Start date in ISO 8601 format'
                            },
                            {
                                name: 'dateend',
                                in: 'path',
                                required: true,
                                schema: { type: 'string', format: 'date-time' },
                                description: 'End date in ISO 8601 format'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Average of metric values',
                                content: {
                                    'application/json': {
                                        schema: { type: 'number' },
                                        example: 262.5
                                    }
                                }
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    }
                },
                '/metrics': {
                    get: {
                        summary: 'Get all metrics and values',
                        description: 'Retrieves all available metrics and their recorded values for UI display',
                        responses: {
                            '200': {
                                description: 'All available metrics and values',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                success: { type: 'boolean' },
                                                metrics: {
                                                    type: 'array',
                                                    items: { type: 'string' }
                                                },
                                                values: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            metric: { type: 'string' },
                                                            value: { type: 'number' },
                                                            timestamp: { type: 'string', format: 'date-time' }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        example: {
                                            success: true,
                                            metrics: ['response_time', 'cpu_usage', 'memory_usage'],
                                            values: [
                                                { metric: 'response_time', value: 250, timestamp: '2024-06-01T12:30:00.000Z' }
                                            ]
                                        }
                                    }
                                }
                            },
                            '200': {
                                description: 'Empty metrics list'
                            }
                        }
                    }
                },
                '/settings': {
                    get: {
                        summary: 'Get measuring service settings',
                        description: 'Retrieves the current settings for the measuring service',
                        responses: {
                            '200': {
                                description: 'Service settings',
                                content: {
                                    'application/json': {
                                        schema: { type: 'object' }
                                    }
                                }
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    },
                    post: {
                        summary: 'Save measuring service settings',
                        description: 'Saves the settings for the measuring service',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                    example: { enableAnalytics: true, retentionDays: 30 }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Settings saved successfully',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'OK' } }
                                }
                            },
                            '400': {
                                description: 'Bad request - missing settings'
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    }
                },
                '/analytics/summary': {
                    get: {
                        summary: 'Analytics summary',
                        description: 'Retrieves dashboard data including top metrics and totals',
                        parameters: [
                            {
                                name: 'topLimit',
                                in: 'query',
                                schema: { type: 'integer', minimum: 1, maximum: 100 },
                                required: false,
                                description: 'Maximum number of top metrics to return (default 10)'
                            },
                            {
                                name: 'recentLimit',
                                in: 'query',
                                schema: { type: 'integer', minimum: 1, maximum: 250 },
                                required: false,
                                description: 'Maximum number of recent metrics to return (default 100)'
                            },
                            {
                                name: 'historyLimit',
                                in: 'query',
                                schema: { type: 'integer', minimum: 1, maximum: 250 },
                                required: false,
                                description: 'Maximum number of history records to return (default 25)'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Analytics summary payload',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                totals: {
                                                    type: 'object',
                                                    properties: {
                                                        uniqueMetrics: { type: 'integer' },
                                                        totalMeasurements: { type: 'integer' }
                                                    }
                                                },
                                                topByActivity: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            metric: { type: 'string' },
                                                            count: { type: 'integer' },
                                                            lastCaptured: { type: 'string', format: 'date-time' }
                                                        }
                                                    }
                                                },
                                                topByRecency: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            metric: { type: 'string' },
                                                            count: { type: 'integer' },
                                                            lastCaptured: { type: 'string', format: 'date-time' }
                                                        }
                                                    }
                                                },
                                                recentHistory: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            metric: { type: 'string' },
                                                            value: { type: 'number' },
                                                            timestamp: { type: 'string', format: 'date-time' }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        example: {
                                            totals: { uniqueMetrics: 5, totalMeasurements: 123 },
                                            topByActivity: [
                                                { metric: 'response_time', count: 42, lastCaptured: '2024-06-01T12:30:00.000Z' }
                                            ],
                                            topByRecency: [
                                                { metric: 'payload_size', count: 10, lastCaptured: '2024-06-01T12:45:00.000Z' }
                                            ],
                                            recentHistory: [
                                                { metric: 'response_time', value: 250, timestamp: '2024-06-01T12:30:00.000Z' }
                                            ]
                                        }
                                    }
                                }
                            },
                            '503': {
                                description: 'Analytics module unavailable'
                            },
                            '500': {
                                description: 'Server error'
                            }
                        }
                    }
                }
            }
        };

        window.addEventListener('load', () => {
            refreshDashboard();
            checkStatus();
            const ui = SwaggerUIBundle({
                spec: spec,
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.presets.standalone
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "BaseLayout",
                tryItOutEnabled: true
            });
        });
    
        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/measuring/api/settings');
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
            if (data.description) {
                infoContainer.textContent = data.description;
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

                case 'boolean':
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.className = 'form-check-input';
                    input.id = 'setting_' + setting.setting;
                    input.name = setting.setting;
                    input.checked = currentValue === true || currentValue === 'true';
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
            if (setting.description) {
                const helperText = document.createElement('div');
                helperText.className = 'form-text';
                helperText.textContent = setting.description;
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
                    // Handle checkboxes
                    if (document.getElementById('setting_' + key)?.type === 'checkbox') {
                        payload[key] = document.getElementById('setting_' + key).checked;
                    } else {
                        payload[key] = value;
                    }
                }

                // Send to API
                const response = await fetch('/services/measuring/api/settings', {
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

        
