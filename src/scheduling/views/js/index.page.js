        // JSON validation
        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace('Task', 'Validation'));
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
        document.getElementById('scheduleTask').addEventListener('input', () => validateJSON('scheduleTask'));

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
                scheduleTask: {
                    "type": "cleanup-logs",
                    "maxAgeDays": 30
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
        document.getElementById('scheduleForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const task = document.getElementById('scheduleTask').value;
            const cron = document.getElementById('scheduleCron').value;
            
            if (!validateJSON('scheduleTask')) {
                showAlert('Please enter a valid JSON task', 'error');
                return;
            }
            
            try {
                setLoading('scheduleForm', true);
                const parsedTask = JSON.parse(task);
                const result = await makeRequest(`/services/scheduling/api/schedule`, 'POST', { task: parsedTask, cron });
                showResponse('scheduleResponse', 'scheduleResponseContent', result);
                showAlert(`Task scheduled successfully`);
            } catch (error) {
                showAlert('Error scheduling task: ' + error.message, 'error');
                showResponse('scheduleResponse', 'scheduleResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('scheduleForm', false);
            }
        });

        document.getElementById('cancelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const taskId = document.getElementById('cancelTaskId').value;
            
            if (!confirm(`Are you sure you want to cancel task with ID: ${taskId}?`)) {
                return;
            }
            
            try {
                setLoading('cancelForm', true);
                const result = await makeRequest(`/services/scheduling/api/cancel/${encodeURIComponent(taskId)}`, 'DELETE');
                showResponse('cancelResponse', 'cancelResponseContent', result);
                showAlert(`Task with ID: ${taskId} canceled successfully`);
            } catch (error) {
                showAlert('Error canceling task: ' + error.message, 'error');
                showResponse('cancelResponse', 'cancelResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('cancelForm', false);
            }
        });

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/scheduling/api/status');
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // Analytics functionality
        let currentSortColumn = -1;
        let currentSortDirection = 'asc';

        async function fetchAnalytics() {
            try {
                const headers = {
                    'Content-Type': 'application/json',
                };

                const response = await fetch('/services/scheduling/api/analytics', {
                    method: 'GET',
                    headers: headers
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                updateAnalyticsDisplay(data);
            } catch (error) {
                console.error('Error fetching analytics:', error);
                const tbody = document.getElementById('analyticsTableBody');
                tbody.innerHTML = '<tr><td colspan="6" class="no-data">Error loading analytics data</td></tr>';
            }
        }

        function updateAnalyticsDisplay(data) {
            // Update statistics cards
            document.getElementById('totalSchedules').textContent = data.totalSchedules || 0;
            document.getElementById('totalPending').textContent = data.totalPending || 0;
            document.getElementById('totalRunning').textContent = data.totalRunning || 0;
            document.getElementById('totalCompleted').textContent = data.totalCompleted || 0;
            document.getElementById('totalErrors').textContent = data.totalErrors || 0;

            // Update analytics table
            const tbody = document.getElementById('analyticsTableBody');

            if (!data.schedules || data.schedules.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="no-data">No schedule data available</td></tr>';
                return;
            }

            const rows = data.schedules.map(schedule => {
                const lastRun = schedule.lastRun ? new Date(schedule.lastRun).toLocaleString() : 'Never';
                return `
                    <tr>
                        <td class="key-cell">${escapeHtml(schedule.name || schedule.scheduleId)}</td>
                        <td class="hits-cell">${schedule.pending || 0}</td>
                        <td class="hits-cell">${schedule.runCount || 0}</td>
                        <td class="hits-cell">${schedule.completeCount || 0}</td>
                        <td class="hits-cell">${schedule.errorCount || 0}</td>
                        <td class="date-cell">${lastRun}</td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;
        }

        function sortTable(columnIndex) {
            const table = document.querySelector('.analytics-table');
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));

            // Check if we have data rows (not just the "no data" row)
            if (rows.length === 0 || rows[0].cells.length < 2) {
                return;
            }

            // Update sort direction
            if (currentSortColumn === columnIndex) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = columnIndex;
                currentSortDirection = 'asc';
            }

            // Remove sort indicators from all headers
            const headers = table.querySelectorAll('th');
            headers.forEach(header => {
                header.classList.remove('sort-asc', 'sort-desc');
            });

            // Add sort indicator to current column
            headers[columnIndex].classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');

            // Sort rows
            rows.sort((a, b) => {
                let aValue = a.cells[columnIndex].textContent.trim();
                let bValue = b.cells[columnIndex].textContent.trim();

                // Handle numeric columns (Pending, Run Count, Complete Count, Error Count)
                if (columnIndex >= 1 && columnIndex <= 4) {
                    aValue = parseInt(aValue) || 0;
                    bValue = parseInt(bValue) || 0;
                } else if (columnIndex === 5) {
                    // Handle date column
                    aValue = aValue === 'Never' ? 0 : new Date(aValue).getTime();
                    bValue = bValue === 'Never' ? 0 : new Date(bValue).getTime();
                }

                if (aValue < bValue) {
                    return currentSortDirection === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return currentSortDirection === 'asc' ? 1 : -1;
                }
                return 0;
            });

            // Rebuild table body
            rows.forEach(row => tbody.appendChild(row));
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

        // Load analytics on dashboard tab activation
        document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', function (e) {
            fetchAnalytics();
        });

        // Initial analytics load if dashboard is active
        if (document.getElementById('dashboard').classList.contains('show')) {
            fetchAnalytics();
        }

        // Swagger UI setup
        const spec = {
            openapi: '3.0.0',
            info: {
                title: 'Scheduling API',
                description: 'REST API for scheduling operations',
                version: '1.0.0'
            },
            servers: [
                { url: '/services/scheduling/api', description: 'Scheduling API' }
            ],
            paths: {
                '/schedules': {
                    get: {
                        summary: 'List all schedules',
                        description: 'Retrieves list of all schedules with details for UI',
                        parameters: [
                            {
                                name: 'limit',
                                in: 'query',
                                schema: { type: 'integer', minimum: 1, maximum: 1000 },
                                required: false,
                                description: 'Maximum number of schedules to return (default 1000)'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'List of schedules',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    scheduleId: { type: 'string' },
                                                    name: { type: 'string' },
                                                    cron: { type: 'string' },
                                                    activity: { type: 'object' },
                                                    createdAt: { type: 'string', format: 'date-time' }
                                                }
                                            }
                                        },
                                        example: [
                                            {
                                                "scheduleId": "schedule-123",
                                                "name": "Daily Report",
                                                "cron": "0 0 * * *",
                                                "activity": { "type": "generate-report" },
                                                "createdAt": "2024-06-01T12:00:00.000Z"
                                            }
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
                '/schedule': {
                    post: {
                        summary: 'Schedule a task',
                        description: 'Schedules a new task with a cron expression',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            task: { type: 'object' },
                                            cron: { type: 'string' }
                                        }
                                    },
                                    example: { "task": { "type": "send-report" }, "cron": "0 0 * * *" }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Task scheduled successfully',
                                content: {
                                    'application/json': { schema: { type: 'object', properties: { taskId: { type: 'string' } } } }
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
                '/cancel/{taskId}': {
                    delete: {
                        summary: 'Cancel a task',
                        description: 'Cancels a scheduled task by its ID',
                        parameters: [
                            {
                                name: 'taskId',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The ID of the task to cancel'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Task canceled successfully',
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
                        description: 'Check if the scheduling service is running',
                        responses: {
                            '200': {
                                description: 'Service is running',
                                content: {
                                    'application/json': {
                                        schema: { type: 'string', example: 'scheduling api running' }
                                    }
                                }
                            }
                        }
                    }
                },
                // ---- Schedule manager (UI tab) ----
                '/tasks': {
                    get: { tags: ['Schedule Manager'], summary: 'List tasks with next run and own last result', responses: { '200': { description: 'Tasks, soonest next run first' } } },
                    post: {
                        tags: ['Schedule Manager'], summary: 'Create a task',
                        description: 'Give cronExpression or intervalSeconds. Interval tasks created here first run one interval after creation.',
                        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'scriptPath'], properties: {
                            name: { type: 'string' }, scriptPath: { type: 'string' }, cronExpression: { type: 'string', example: '0 2 * * *' },
                            intervalSeconds: { type: 'integer', minimum: 1 }, data: {}, description: { type: 'string' }, group: { type: 'string' }, enabled: { type: 'boolean', default: true }
                        } } } } },
                        responses: { '201': { description: 'Created' }, '400': { description: 'Invalid input' }, '409': { description: 'Name already used' } }
                    }
                },
                '/tasks/stats': { get: { tags: ['Schedule Manager'], summary: 'Task and run counts', responses: { '200': { description: 'Stats' } } } },
                '/tasks/{name}': {
                    get: { tags: ['Schedule Manager'], summary: 'Get a task', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Task' }, '404': { description: 'Not found' } } },
                    put: {
                        tags: ['Schedule Manager'], summary: 'Update a task in place (keeps history)',
                        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
                        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
                            cronExpression: { type: 'string' }, intervalSeconds: { type: 'integer' }, scriptPath: { type: 'string' }, data: {}, description: { type: 'string' }, group: { type: 'string' }, enabled: { type: 'boolean' }
                        } } } } },
                        responses: { '200': { description: 'Updated' }, '400': { description: 'Invalid input' }, '404': { description: 'Not found' } }
                    },
                    delete: { tags: ['Schedule Manager'], summary: 'Stop and remove a task', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } } }
                },
                '/tasks/{name}/toggle': { post: { tags: ['Schedule Manager'], summary: 'Pause / enable (flips when enabled is omitted)', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' } } } } } }, responses: { '200': { description: 'Task' } } } },
                '/tasks/{name}/run-now': { post: { tags: ['Schedule Manager'], summary: 'Run once now', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { '202': { description: 'Started' }, '409': { description: 'Already running' } } } },
                '/runs': {
                    get: {
                        tags: ['Schedule Manager'], summary: 'Recent runs, newest first (last 50 per task)',
                        parameters: [
                            { name: 'taskName', in: 'query', schema: { type: 'string' } },
                            { name: 'status', in: 'query', schema: { type: 'string', enum: ['success', 'failed', 'running', 'skipped'] } },
                            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000 } }
                        ],
                        responses: { '200': { description: '{ runs, total }' } }
                    }
                },
                '/runs/{id}': { get: { tags: ['Schedule Manager'], summary: 'One run with its result', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Run' }, '404': { description: 'Not found' } } } },
                '/cron/preview': { get: { tags: ['Schedule Manager'], summary: 'Validate a cron expression and preview fire times', parameters: [{ name: 'expression', in: 'query', required: true, schema: { type: 'string' } }, { name: 'count', in: 'query', schema: { type: 'integer', maximum: 20 } }], responses: { '200': { description: '{ valid, error, nextRuns }' } } } }
            }
        };

        // Initialize Swagger UI
        window.onload = function() {
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
    
