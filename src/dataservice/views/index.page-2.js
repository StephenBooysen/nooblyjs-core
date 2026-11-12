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
        document.getElementById('putValue').addEventListener('input', () => validateJSON('putValue'));
        document.getElementById('searchCriteria').addEventListener('input', () => validateJSON('searchCriteria'));

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

        // Load JSON search examples
        function loadPredicateExample() {
            document.getElementById('jsonFindContainer').value = 'users';
            document.getElementById('jsonFindPredicate').value = 'obj.id === 123 && obj.status === "active"';
        }

        function loadPathExample() {
            document.getElementById('pathContainer').value = 'users';
            document.getElementById('pathField').value = 'profile.name';
            document.getElementById('pathValue').value = 'John';
        }

        function loadCriteriaExample() {
            document.getElementById('criteriaContainer').value = 'users';
            const example = {
                "id": 123,
                "status": "active",
                "profile.department": "engineering"
            };
            document.getElementById('searchCriteria').value = JSON.stringify(example, null, 2);
            validateJSON('searchCriteria');
        }

        // Load container examples for basic operations
        function loadContainerExample(operation) {
            const examples = {
                put: { container: 'users' },
                get: { container: 'users', uuid: '123e4567-e89b-12d3-a456-426614174000' },
                delete: { container: 'users', uuid: '123e4567-e89b-12d3-a456-426614174000' }
            };

            const example = examples[operation];
            if (example) {
                document.getElementById(operation + 'Container').value = example.container;
                if (example.uuid) {
                    document.getElementById(operation + 'Uuid').value = example.uuid;
                }
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

        // API functions
        async function makeRequest(url, method = 'GET', body = null) {
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            if (body) {
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

        // Form handlers
        document.getElementById('putForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const container = document.getElementById('putContainer').value;
            const value = document.getElementById('putValue').value;

            if (!validateJSON('putValue')) {
                showAlert('Please enter valid JSON before storing data', 'error');
                return;
            }

            try {
                setLoading('putForm', true);
                const parsedValue = JSON.parse(value);
                const result = await makeRequest(`/services/dataservice/api/${encodeURIComponent(container)}`, 'POST', parsedValue);
                showResponse('putResponse', 'putResponseContent', result);
                showAlert(`Data stored successfully in container: ${container}. UUID: ${result.id}`);
            } catch (error) {
                showAlert('Error storing data: ' + error.message, 'error');
                showResponse('putResponse', 'putResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('putForm', false);
            }
        });

        document.getElementById('getForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const container = document.getElementById('getContainer').value;
            const uuid = document.getElementById('getUuid').value;

            try {
                setLoading('getForm', true);
                const result = await makeRequest(`/services/dataservice/api/${encodeURIComponent(container)}/${encodeURIComponent(uuid)}`);
                showResponse('getResponse', 'getResponseContent', result);
                showAlert(`Data retrieved successfully from container: ${container}, UUID: ${uuid}`);
            } catch (error) {
                showAlert('Error retrieving data: ' + error.message, 'error');
                showResponse('getResponse', 'getResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('getForm', false);
            }
        });

        document.getElementById('deleteForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const container = document.getElementById('deleteContainer').value;
            const uuid = document.getElementById('deleteUuid').value;

            if (!confirm(`Are you sure you want to delete data from container: ${container}, UUID: ${uuid}?`)) {
                return;
            }

            try {
                setLoading('deleteForm', true);
                const result = await makeRequest(`/services/dataservice/api/${encodeURIComponent(container)}/${encodeURIComponent(uuid)}`, 'DELETE');
                showResponse('deleteResponse', 'deleteResponseContent', result);
                showAlert(`Data deleted successfully from container: ${container}, UUID: ${uuid}`);
            } catch (error) {
                showAlert('Error deleting data: ' + error.message, 'error');
                showResponse('deleteResponse', 'deleteResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('deleteForm', false);
            }
        });

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/dataservice/api/status');
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // JSON Search form handlers
        document.getElementById('jsonFindForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const container = document.getElementById('jsonFindContainer').value;
            const predicate = document.getElementById('jsonFindPredicate').value;

            try {
                setLoading('jsonFindForm', true);
                const result = await makeRequest(`/services/dataservice/api/jsonFind/${encodeURIComponent(container)}`, 'POST', { predicate });
                showResponse('jsonFindResponse', 'jsonFindResponseContent', result);
                showAlert(`Found ${result.length || 0} matching objects`);
            } catch (error) {
                showAlert('Error searching with predicate: ' + error.message, 'error');
                showResponse('jsonFindResponse', 'jsonFindResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('jsonFindForm', false);
            }
        });

        document.getElementById('jsonFindByPathForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const container = document.getElementById('pathContainer').value;
            const path = document.getElementById('pathField').value;
            const value = document.getElementById('pathValue').value;

            try {
                setLoading('jsonFindByPathForm', true);
                const result = await makeRequest(`/services/dataservice/api/jsonFindByPath/${encodeURIComponent(container)}/${encodeURIComponent(path)}/${encodeURIComponent(value)}`);
                showResponse('jsonFindByPathResponse', 'jsonFindByPathResponseContent', result);
                showAlert(`Found ${result.length || 0} matching objects`);
            } catch (error) {
                showAlert('Error searching by path: ' + error.message, 'error');
                showResponse('jsonFindByPathResponse', 'jsonFindByPathResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('jsonFindByPathForm', false);
            }
        });

        document.getElementById('jsonFindByCriteriaForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const container = document.getElementById('criteriaContainer').value;
            const criteriaText = document.getElementById('searchCriteria').value;

            if (!validateJSON('searchCriteria')) {
                showAlert('Please enter valid JSON criteria', 'error');
                return;
            }

            try {
                setLoading('jsonFindByCriteriaForm', true);
                const criteria = JSON.parse(criteriaText);
                const result = await makeRequest(`/services/dataservice/api/jsonFindByCriteria/${encodeURIComponent(container)}`, 'POST', criteria);
                showResponse('jsonFindByCriteriaResponse', 'jsonFindByCriteriaResponseContent', result);
                showAlert(`Found ${result.length || 0} matching objects`);
            } catch (error) {
                showAlert('Error searching by criteria: ' + error.message, 'error');
                showResponse('jsonFindByCriteriaResponse', 'jsonFindByCriteriaResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('jsonFindByCriteriaForm', false);
            }
        });

        // Swagger UI setup
        const spec = {
            openapi: '3.0.0',
            info: {
                title: 'Data Service API',
                description: 'REST API for data storage and retrieval operations',
                version: '1.0.0'
            },
            servers: [
                { url: '/services/dataservice/api', description: 'Data Service API' }
            ],
            paths: {
                '/{container}': {
                    post: {
                        summary: 'Store data in container',
                        description: 'Store data in a container and get back a generated UUID',
                        parameters: [
                            {
                                name: 'container',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The container to store the data in'
                            }
                        ],
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                    example: { "message": "Hello World", "timestamp": "2024-01-01" }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Data stored successfully with generated UUID',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'string', description: 'Generated UUID for the stored data' }
                                            }
                                        },
                                        example: { "id": "123e4567-e89b-12d3-a456-426614174000" }
                                    }
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
                '/{container}/{uuid}': {
                    get: {
                        summary: 'Retrieve data from container',
                        description: 'Retrieve data by UUID from a specific container',
                        parameters: [
                            {
                                name: 'container',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The container to retrieve data from'
                            },
                            {
                                name: 'uuid',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The UUID of the data to retrieve'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Data retrieved successfully',
                                content: {
                                    'application/json': {
                                        schema: { type: 'object' },
                                        example: { "message": "Hello World", "timestamp": "2024-01-01" }
                                    }
                                }
                            },
                            '404': {
                                description: 'Data not found',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'null' } }
                                }
                            },
                            '500': {
                                description: 'Server error',
                                content: {
                                    'text/plain': { schema: { type: 'string' } }
                                }
                            }
                        }
                    },
                    delete: {
                        summary: 'Delete data from container',
                        description: 'Delete data by UUID from a specific container',
                        parameters: [
                            {
                                name: 'container',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The container to delete data from'
                            },
                            {
                                name: 'uuid',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The UUID of the data to delete'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Data deleted successfully',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'OK' } }
                                }
                            },
                            '404': {
                                description: 'Data not found',
                                content: {
                                    'text/plain': { schema: { type: 'string', example: 'Not found' } }
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
                '/jsonFind/{containerName}': {
                    post: {
                        summary: 'JSON Search with Predicate',
                        description: 'Search for objects using a JavaScript predicate function',
                        parameters: [
                            {
                                name: 'containerName',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The container to search in'
                            }
                        ],
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            predicate: { type: 'string' }
                                        }
                                    },
                                    example: { "predicate": "obj.id === 123 && obj.status === 'active'" }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Search results',
                                content: {
                                    'application/json': {
                                        schema: { type: 'array', items: { type: 'object' } }
                                    }
                                }
                            }
                        }
                    }
                },
                '/jsonFindByPath/{containerName}/{path}/{value}': {
                    get: {
                        summary: 'JSON Search by Path',
                        description: 'Search for objects where a specific property matches a value',
                        parameters: [
                            {
                                name: 'containerName',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' }
                            },
                            {
                                name: 'path',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'Dot notation path (e.g., user.profile.name)'
                            },
                            {
                                name: 'value',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' }
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Search results',
                                content: {
                                    'application/json': {
                                        schema: { type: 'array', items: { type: 'object' } }
                                    }
                                }
                            }
                        }
                    }
                },
                '/jsonFindByCriteria/{containerName}': {
                    post: {
                        summary: 'JSON Search by Multiple Criteria',
                        description: 'Search for objects matching multiple path-value pairs',
                        parameters: [
                            {
                                name: 'containerName',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' }
                            }
                        ],
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                    example: { "id": 123, "status": "active", "profile.department": "engineering" }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Search results',
                                content: {
                                    'application/json': {
                                        schema: { type: 'array', items: { type: 'object' } }
                                    }
                                }
                            }
                        }
                    }
                },
                '/status': {
                    get: {
                        summary: 'Service status',
                        description: 'Check if the data serve service is running',
                        responses: {
                            '200': {
                                description: 'Service is running',
                                content: {
                                    'application/json': {
                                        schema: { type: 'string', example: 'dataservice api running' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        // Initialize Swagger UI
        window.onload = function () {
            checkStatus();
            try {
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

        // Analytics functionality
        let analyticsData = [];
        let currentSort = { column: 'totalActions', direction: 'desc' };

        async function fetchAnalytics() {
            try {
                const response = await fetch('/services/dataservice/api/analytics', { credentials: 'same-origin' });

                if (!response.ok) {
                    console.error('Failed to fetch analytics:', response.status);
                    return;
                }

                const data = await response.json();

                // Update statistics cards
                document.getElementById('totalAdds').textContent = data.totals.adds.toLocaleString();
                document.getElementById('totalRemoves').textContent = data.totals.removes.toLocaleString();
                document.getElementById('totalFinds').textContent = data.totals.finds.toLocaleString();

                // Store and display analytics data
                analyticsData = data.containers;
                displayAnalytics();
            } catch (error) {
                console.error('Error fetching analytics:', error);
            }
        }

        function displayAnalytics() {
            const tbody = document.getElementById('analyticsTableBody');

            if (analyticsData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No analytics data available</td></tr>';
                document.getElementById('analyticsCount').textContent = '0';
                return;
            }

            // Sort the data
            const sortedData = [...analyticsData].sort((a, b) => {
                let aVal = a[currentSort.column];
                let bVal = b[currentSort.column];

                if (typeof aVal === 'string') {
                    return currentSort.direction === 'asc' ?
                        aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                }

                return currentSort.direction === 'asc' ?
                    aVal - bVal : bVal - aVal;
            });

            // Display the data
            tbody.innerHTML = sortedData.map(item => `
                <tr>
                    <td>${item.container}</td>
                    <td>${item.adds.toLocaleString()}</td>
                    <td>${item.removes.toLocaleString()}</td>
                    <td>${item.finds.toLocaleString()}</td>
                    <td>${item.totalActions.toLocaleString()}</td>
                </tr>
            `).join('');

            // Update count
            document.getElementById('analyticsCount').textContent = sortedData.length;
        }

        function sortTable(column) {
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'desc';
            }

            // Update column headers
            document.querySelectorAll('.sortable').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
            });

            event.target.classList.add('sort-' + currentSort.direction);
            displayAnalytics();
        }

        // Initialize analytics when dashboard tab is shown
        document.getElementById('dashboard-tab').addEventListener('shown.bs.tab', fetchAnalytics);

        // Initial load
        fetchAnalytics();

        // Refresh analytics after operations
        const originalPutHandler = document.getElementById('putForm').onsubmit;
        document.getElementById('putForm').addEventListener('submit', async (e) => {
            // Wait for form to complete, then refresh analytics
            setTimeout(fetchAnalytics, 1000);
        });

        const originalDeleteHandler = document.getElementById('deleteForm').onsubmit;
        document.getElementById('deleteForm').addEventListener('submit', async (e) => {
            setTimeout(fetchAnalytics, 1000);
        });

        const originalGetHandler = document.getElementById('getForm').onsubmit;
        document.getElementById('getForm').addEventListener('submit', async (e) => {
            setTimeout(fetchAnalytics, 1000);
        });
    
        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/dataservice/api/settings');
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
                const response = await fetch('/services/dataservice/api/settings', {
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

        
