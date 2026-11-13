        // Initialise the filing-instance selector state up front. This MUST
        // come before any code that calls buildInstanceUrl(), because
        // buildInstanceUrl reads window.filingInstance.selectedInstance and
        // the dashboard's auto-refresh on page load (further down this file)
        // runs synchronously into buildInstanceUrl before hitting its first
        // await.
        window.filingInstance = window.filingInstance || {};
        if (window.filingInstance.selectedInstance == null) {
            window.filingInstance.selectedInstance = 'default';
        }

        // Analytics data and sorting
        let analyticsData = [];
        let currentSort = { column: 'total', direction: 'desc' };

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

        // API functions
        async function makeRequest(url, method = 'GET', body = null) {
            const options = {
                method,
                headers: {},
            };

            if (body instanceof FormData) {
                options.body = body;
            } else if (body) {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url, options);
            const contentType = response.headers.get('content-type');

            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        }

        // Analytics functions
        async function fetchAnalytics() {
            try {
                const analyticsUrl = buildInstanceUrl('/services/filing/api/analytics');
                const response = await fetch(analyticsUrl);
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching analytics:', error);
                return null;
            }
        }

        function updateStatsCards(stats) {
            if (!stats) return;

            document.getElementById('statTotalPaths').textContent = stats.totalPaths || 0;
            document.getElementById('statTotalReads').textContent = stats.totalReads || 0;
            document.getElementById('statTotalWrites').textContent = stats.totalWrites || 0;
            document.getElementById('statTotalDeletes').textContent = stats.totalDeletes || 0;
        }

        function sortTable(column) {
            // Update sort direction
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'desc';
            }

            // Update sort indicators
            document.querySelectorAll('.sortable span').forEach(span => {
                span.parentElement.classList.remove('sort-asc', 'sort-desc');
            });

            const sortElement = document.getElementById(`sort-${column}`);
            if (sortElement) {
                sortElement.parentElement.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }

            // Sort data
            analyticsData.sort((a, b) => {
                let aVal, bVal;

                if (column === 'total') {
                    aVal = (a.reads || 0) + (a.writes || 0) + (a.deletes || 0);
                    bVal = (b.reads || 0) + (b.writes || 0) + (b.deletes || 0);
                } else if (column === 'path') {
                    aVal = a.path || '';
                    bVal = b.path || '';
                    return currentSort.direction === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                } else {
                    aVal = a[column] || 0;
                    bVal = b[column] || 0;
                }

                return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
            });

            // Re-render table
            renderAnalyticsTable();
        }

        function renderAnalyticsTable() {
            const tbody = document.getElementById('analyticsTableBody');

            if (!analyticsData || analyticsData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No analytics data available</p>
                        </td>
                    </tr>
                `;
                return;
            }

            // Build table rows (limit to 250)
            const rows = analyticsData.slice(0, 250).map(item => {
                const total = (item.reads || 0) + (item.writes || 0) + (item.deletes || 0);
                const lastAccess = item.lastAccess ? new Date(item.lastAccess).toLocaleString() : 'N/A';

                return `
                    <tr>
                        <td class="key-cell">${escapeHtml(item.path)}</td>
                        <td class="hits-cell">${item.reads || 0}</td>
                        <td class="hits-cell">${item.writes || 0}</td>
                        <td class="hits-cell">${item.deletes || 0}</td>
                        <td class="hits-cell">${total}</td>
                        <td class="date-cell">${lastAccess}</td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;
        }

        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return String(text).replace(/[&<>"']/g, m => map[m]);
        }

        async function refreshAnalytics() {
            const tbody = document.getElementById('analyticsTableBody');

            // Show loading state
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-4">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        Loading analytics...
                    </td>
                </tr>
            `;

            // Fetch analytics data
            const data = await fetchAnalytics();

            if (data) {
                updateStatsCards(data.stats);
                analyticsData = data.data || [];

                // Sort by total activity by default
                sortTable('total');
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center text-danger py-4">
                            <i class="bi bi-exclamation-triangle fs-4"></i>
                            <p class="mb-0 mt-2">Error loading analytics data</p>
                        </td>
                    </tr>
                `;
            }
        }

        // Form handlers
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('uploadKey').value;
            const fileInput = document.getElementById('uploadFile');
            const file = fileInput.files[0];

            if (!file) {
                showAlert('Please select a file to upload', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                setLoading('uploadForm', true);
                const result = await makeRequest(`/services/filing/api/upload/${encodeURIComponent(key)}`, 'POST', formData);
                showResponse('uploadResponse', 'uploadResponseContent', result);
                showAlert(`File uploaded successfully with key: ${key}`);

                // Refresh analytics if on dashboard tab
                if (document.getElementById('dashboard').classList.contains('show')) {
                    refreshAnalytics();
                }
            } catch (error) {
                showAlert('Error uploading file: ' + error.message, 'error');
                showResponse('uploadResponse', 'uploadResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('uploadForm', false);
            }
        });

        document.getElementById('downloadForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('downloadKey').value;

            try {
                setLoading('downloadForm', true);
                const result = await makeRequest(`/services/filing/api/download/${encodeURIComponent(key)}`);
                showResponse('downloadResponse', 'downloadResponseContent', result);
                showAlert(`File downloaded successfully for key: ${key}`);

                // Refresh analytics if on dashboard tab
                if (document.getElementById('dashboard').classList.contains('show')) {
                    refreshAnalytics();
                }
            } catch (error) {
                showAlert('Error downloading file: ' + error.message, 'error');
                showResponse('downloadResponse', 'downloadResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('downloadForm', false);
            }
        });

        document.getElementById('deleteForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('deleteKey').value;

            if (!confirm(`Are you sure you want to delete the file with key: ${key}?`)) {
                return;
            }

            try {
                setLoading('deleteForm', true);
                const result = await makeRequest(`/services/filing/api/remove/${encodeURIComponent(key)}`, 'DELETE');
                showResponse('deleteResponse', 'deleteResponseContent', result);
                showAlert(`File deleted successfully for key: ${key}`);

                // Refresh analytics if on dashboard tab
                if (document.getElementById('dashboard').classList.contains('show')) {
                    refreshAnalytics();
                }
            } catch (error) {
                showAlert('Error deleting file: ' + error.message, 'error');
                showResponse('deleteResponse', 'deleteResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('deleteForm', false);
            }
        });

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/filing/api/status');
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // Load analytics on dashboard tab activation
        document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', function (e) {
            refreshAnalytics();
        });

        // Initial analytics load if dashboard is active
        if (document.getElementById('dashboard').classList.contains('show')) {
            refreshAnalytics();
        }

        // Swagger UI setup
        const spec = {
            openapi: '3.0.0',
            info: {
                title: 'Filing API',
                description: 'REST API for file management operations',
                version: '1.0.0'
            },
            servers: [
                { url: '/services/filing/api', description: 'Filing API' }
            ],
            paths: {
                '/upload/{key}': {
                    post: {
                        summary: 'Upload a file',
                        description: 'Upload a file with the specified key',
                        parameters: [
                            {
                                name: 'key',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The key to store the file under'
                            }
                        ],
                        requestBody: {
                            required: true,
                            content: {
                                'multipart/form-data': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            file: {
                                                type: 'string',
                                                format: 'binary'
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'File uploaded successfully',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'OK' } }
                                }
                            },
                            '500': {
                                description: 'Server error',
                                content: {
                                    'text/plain': { schema: { type: 'string' } }
                                }
                            }
                        }
                    }
                },
                '/download/{key}': {
                    get: {
                        summary: 'Download a file',
                        description: 'Download a file by key',
                        parameters: [
                            {
                                name: 'key',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The key to retrieve the file for'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'File downloaded successfully',
                                content: {
                                    'application/octet-stream': {}
                                }
                            },
                            '500': {
                                description: 'Server error',
                                content: {
                                    'text/plain': { schema: { type: 'string' } }
                                }
                            }
                        }
                    }
                },
                '/remove/{key}': {
                    delete: {
                        summary: 'Delete a file',
                        description: 'Delete a file by key',
                        parameters: [
                            {
                                name: 'key',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The key to delete the file for'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'File deleted successfully',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'OK' } }
                                }
                            },
                            '500': {
                                description: 'Server error',
                                content: {
                                    'text/plain': { schema: { type: 'string' } }
                                }
                            }
                        }
                    }
                },
                '/status': {
                    get: {
                        summary: 'Service status',
                        description: 'Check if the filing service is running',
                        responses: {
                            '200': {
                                description: 'Service is running',
                                content: {
                                    'application/json': {
                                        schema: { type: 'string', example: 'filing api running' }
                                    }
                                }
                            }
                        }
                    }
                },
                '/analytics': {
                    get: {
                        summary: 'Get file analytics',
                        description: 'Retrieves analytics data for file operations',
                        responses: {
                            '200': {
                                description: 'Analytics retrieved successfully',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                stats: {
                                                    type: 'object',
                                                    properties: {
                                                        totalPaths: { type: 'number', example: 10 },
                                                        totalReads: { type: 'number', example: 45 },
                                                        totalWrites: { type: 'number', example: 30 },
                                                        totalDeletes: { type: 'number', example: 5 },
                                                        totalOperations: { type: 'number', example: 80 }
                                                    }
                                                },
                                                data: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            path: { type: 'string', example: '/folder/path' },
                                                            reads: { type: 'number', example: 10 },
                                                            writes: { type: 'number', example: 5 },
                                                            deletes: { type: 'number', example: 2 },
                                                            lastAccess: { type: 'string', example: '2025-10-11T00:00:00.000Z' }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        // Initialize Swagger UI
        window.onload = function() {
            checkStatus();
            try {
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
                    tryItOutEnabled: true,
                    requestInterceptor: (request) => {
                        // Add any headers or modify request if needed
                        return request;
                    },
                    responseInterceptor: (response) => {
                        // Handle response if needed
                        return response;
                    },
                    onComplete: () => {
                        console.log('Swagger UI loaded successfully');
                    },
                    onFailure: (error) => {
                        console.error('Swagger UI failed to load:', error);
                    }
                });

                window.ui = ui;
            } catch (error) {
                console.error('Error initializing Swagger UI:', error);
                document.getElementById('swagger-ui').innerHTML = '<p style="color: red;">Error loading API documentation. Please refresh the page.</p>';
            }
        };
    
        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const settingsUrl = buildInstanceUrl('/services/filing/api/settings');
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
                const settingsUrl = buildInstanceUrl('/services/filing/api/settings');
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

        // ==================== Instance Management ==================== //

        // Note: window.filingInstance is initialised at the top of this
        // script block so that buildInstanceUrl() is safe to call from any
        // earlier code path (e.g. the dashboard auto-refresh on load).

        /**
         * Builds instance-aware URL by inserting instance name after /api/
         * @param {string} basePath - Base API path
         * @returns {string} Instance-aware URL path
         */
        function buildInstanceUrl(basePath) {
            const instance = (window.filingInstance && window.filingInstance.selectedInstance) || 'default';
            if (instance === 'default') {
                return basePath;
            }
            // Insert instance name after /api/ in the path
            return basePath.replace('/services/filing/api/', `/services/filing/api/${instance}/`);
        }

        /**
         * Loads available filing service instances from the API
         */
        async function loadAvailableInstances() {
            try {
                const response = await fetch('/services/filing/api/instances');
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

        /**
         * Updates the instance selector dropdown with available instances
         * @param {Array} instances - Array of instance objects with name, provider, status
         */
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
                window.filingInstance.selectedInstance = 'default';
            }
        }

        /**
         * Initialize instance selector and event listeners
         */
        function initializeInstanceSelector() {
            const selector = document.getElementById('instanceSelector');
            const refreshBtn = document.getElementById('refreshInstanceBtn');

            // Handle instance selection change
            selector.addEventListener('change', (e) => {
                window.filingInstance.selectedInstance = e.target.value;

                // Refresh current data with new instance
                const activeTab = document.querySelector('.nav-link.active');
                if (activeTab?.id === 'dashboard-tab' && typeof refreshAnalytics === 'function') {
                    refreshAnalytics();
                }

                // Refresh file browser if it exists. Keep its instance in sync
                // with the selector so it browses the selected instance's baseDir.
                if (typeof fileBrowser !== 'undefined' && fileBrowser && typeof fileBrowser.loadFileTree === 'function') {
                    fileBrowser.instance = window.filingInstance.selectedInstance;
                    fileBrowser.currentPath = '';
                    fileBrowser.loadFileTree();
                }
            });

            // Handle refresh button click
            refreshBtn.addEventListener('click', loadAvailableInstances);

            // Load instances on page load
            loadAvailableInstances();
        }

        // ==================== Initialize Advanced File Browser ==================== //
        // All file browser business logic is now in /services/filing/scripts/js/index.js

        let fileBrowser = null;

        /**
         * Makes the file tree sidebar resizable via the drag handle, and
         * remembers the chosen width across page loads.
         */
        function initSidebarResizer() {
            const resizer = document.getElementById('fileBrowserResizer');
            const sidebar = document.querySelector('.core-advanced-file-browser .core-file-browser-sidebar');
            if (!resizer || !sidebar) return;

            const MIN_WIDTH = 180;
            const MAX_WIDTH = 600;

            // Restore a previously saved width.
            const saved = parseInt(localStorage.getItem('filingSidebarWidth'), 10);
            if (!isNaN(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
                sidebar.style.flex = `0 0 ${saved}px`;
            }

            let dragging = false;
            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (e) => {
                if (!dragging) return;
                let width = startWidth + (e.clientX - startX);
                width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
                sidebar.style.flex = `0 0 ${width}px`;
            };

            const onMouseUp = () => {
                if (!dragging) return;
                dragging = false;
                resizer.classList.remove('core-resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                const finalWidth = Math.round(sidebar.getBoundingClientRect().width);
                localStorage.setItem('filingSidebarWidth', String(finalWidth));
            };

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                dragging = true;
                startX = e.clientX;
                startWidth = sidebar.getBoundingClientRect().width;
                resizer.classList.add('core-resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // Double-click resets to the default width.
            resizer.addEventListener('dblclick', () => {
                sidebar.style.flex = '';
                localStorage.removeItem('filingSidebarWidth');
            });
        }

        // Initialize the file browser when the page is ready
        document.addEventListener('DOMContentLoaded', function() {
            try {
                // Initialize instance selector first
                initializeInstanceSelector();

                // Enable sidebar resizing
                initSidebarResizer();

                fileBrowser = new FilingUIManager({
                    navigationContainerId: 'fileTreeContainer',
                    contentContainerId: 'fileContentArea',
                    breadcrumbId: 'fileBreadcrumb',
                    refreshButtonId: 'refreshFileTreeBtn',
                    // Honour the currently selected instance so the browser
                    // queries the right baseDir (otherwise it falls back to the
                    // 'default' instance which points at the project root).
                    instance: (window.filingInstance && window.filingInstance.selectedInstance) || 'default'
                });

                // Initialize the file browser
                fileBrowser.initialize().catch(error => {
                    console.error('Failed to initialize filing browser:', error);
                });
            } catch (error) {
                console.error('Error initializing FilingUIManager:', error);
            }
        });

        
