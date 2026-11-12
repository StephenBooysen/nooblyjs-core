        // JSON validation
        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace(/Steps|Data/, 'Validation'));
            const value = element.value.trim();

            if (!value && elementId === 'startData') { // Optional field
                element.classList.remove('json-valid', 'json-invalid');
                if(validation) validation.style.display = 'none';
                return true;
            }

            if (!value) {
                element.classList.remove('json-valid', 'json-invalid');
                if(validation) validation.style.display = 'none';
                return true;
            }

            try {
                JSON.parse(value);
                element.classList.remove('json-invalid');
                element.classList.add('json-valid');
                if(validation) {
                    validation.textContent = '✓ Valid JSON';
                    validation.className = 'core-validation-message validation-success';
                    validation.style.display = 'block';
                }
                return true;
            } catch (e) {
                element.classList.remove('json-valid');
                element.classList.add('json-invalid');
                if(validation) {
                    validation.textContent = '✗ Invalid JSON: ' + e.message;
                    validation.className = 'core-validation-message validation-error';
                    validation.style.display = 'block';
                }
                return false;
            }
        }

        // Real-time validation
        document.getElementById('defineSteps').addEventListener('input', () => validateJSON('defineSteps'));
        document.getElementById('startData').addEventListener('input', () => validateJSON('startData'));

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
                defineSteps: ["validate-order", "process-payment", "ship-order"],
                startData: {
                    "orderId": "xyz-789",
                    "amount": 99.99,
                    "customer": {
                        "id": "cust-456",
                        "email": "customer@example.com"
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
        document.getElementById('defineForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('defineName').value;
            const steps = document.getElementById('defineSteps').value;

            if (!validateJSON('defineSteps')) {
                showAlert('Please enter a valid JSON array of steps', 'error');
                return;
            }

            try {
                setLoading('defineForm', true);
                const parsedSteps = JSON.parse(steps);
                const result = await makeRequest(`/services/workflow/api/defineworkflow`, 'POST', { name, steps: parsedSteps });
                showResponse('defineResponse', 'defineResponseContent', result);
                showAlert(`Workflow "${name}" defined successfully`);
            } catch (error) {
                showAlert('Error defining workflow: ' + error.message, 'error');
                showResponse('defineResponse', 'defineResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('defineForm', false);
            }
        });

        document.getElementById('startForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('startName').value;
            const data = document.getElementById('startData').value;

            if (data && !validateJSON('startData')) {
                showAlert('Please enter valid JSON for the initial data', 'error');
                return;
            }

            try {
                setLoading('startForm', true);
                const initialData = data ? JSON.parse(data) : {};
                const result = await makeRequest(`/services/workflow/api/start`, 'POST', { name, data: initialData });
                showResponse('startResponse', 'startResponseContent', result);
                showAlert(`Workflow "${name}" started successfully`);
            } catch (error) {
                showAlert('Error starting workflow: ' + error.message, 'error');
                showResponse('startResponse', 'startResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('startForm', false);
            }
        });

        // Retrieve Workflow Form
        document.getElementById('retrieveForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('retrieveName').value;

            try {
                setLoading('retrieveForm', true);
                const result = await makeRequest(`/services/workflow/api/definitions/${encodeURIComponent(name)}`);
                showResponse('retrieveResponse', 'retrieveResponseContent', result);
                showAlert(`Workflow "${name}" retrieved successfully`);
            } catch (error) {
                showAlert('Error retrieving workflow: ' + error.message, 'error');
                showResponse('retrieveResponse', 'retrieveResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('retrieveForm', false);
            }
        });

        // Update Workflow Form
        document.getElementById('updateForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('updateName').value;
            const steps = document.getElementById('updateSteps').value;
            const metadata = document.getElementById('updateMetadata').value;

            if (!validateJSON('updateSteps')) {
                showAlert('Please enter a valid JSON array for steps', 'error');
                return;
            }

            if (metadata && !validateJSON('updateMetadata')) {
                showAlert('Please enter valid JSON for metadata', 'error');
                return;
            }

            try {
                setLoading('updateForm', true);
                const parsedSteps = JSON.parse(steps);
                const parsedMetadata = metadata ? JSON.parse(metadata) : {};

                const requestBody = { steps: parsedSteps };
                if (metadata) {
                    requestBody.metadata = parsedMetadata;
                }

                const result = await makeRequest(`/services/workflow/api/definitions/${encodeURIComponent(name)}`, 'PUT', requestBody);
                showResponse('updateResponse', 'updateResponseContent', result);
                showAlert(`Workflow "${name}" updated successfully`);
            } catch (error) {
                showAlert('Error updating workflow: ' + error.message, 'error');
                showResponse('updateResponse', 'updateResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('updateForm', false);
            }
        });

        // List All Workflows
        async function listWorkflows() {
            try {
                const result = await makeRequest('/services/workflow/api/definitions');
                if (result.definitions && Array.isArray(result.definitions)) {
                    const formatted = {
                        count: result.count,
                        definitions: result.definitions.map(def => ({
                            name: def.name,
                            steps: def.steps,
                            metadata: def.metadata
                        }))
                    };
                    showResponse('listResponse', 'listResponseContent', formatted);
                    showAlert(`Found ${result.count} workflow(s)`);
                } else {
                    showResponse('listResponse', 'listResponseContent', result);
                }
            } catch (error) {
                showAlert('Error listing workflows: ' + error.message, 'error');
                showResponse('listResponse', 'listResponseContent', 'Error: ' + error.message);
            }
        }

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/workflow/api/status');
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // Swagger UI setup - Load from external docs.json file
        async function initializeSwagger() {
            try {
                const response = await fetch('/services/workflow/api/swagger/docs.json');
                const spec = await response.json();

                SwaggerUIBundle({
                    spec: spec,
                    dom_id: '#swagger-ui',
                    presets: [
                        SwaggerUIBundle.presets.apis,
                        SwaggerUIBundle.SwaggerUIStandalonePreset
                    ],
                    layout: "BaseLayout",
                    deepLinking: true
                });
            } catch (error) {
                console.error('Error loading Swagger spec:', error);
                document.getElementById('swagger-ui').innerHTML = '<div class="alert alert-danger alert-dismissible fade">Failed to load API documentation: ' + error.message + '</div>';
            }
        }

        // Dashboard functionality
        let statsChart = null;

        // Fetch statistics from analytics API
        async function fetchStats() {
            try {
                const response = await fetch('/services/workflow/api/stats');
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching stats:', error);
                return null;
            }
        }

        // Fetch workflow analytics from API
        async function fetchAnalytics() {
            try {
                const response = await fetch('/services/workflow/api/analytics');
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching analytics:', error);
                return null;
            }
        }

        // Update statistics display
        function updateStatsDisplay(stats) {
            if (!stats) return;

            // Update total count
            document.getElementById('statTotalCount').textContent = stats.total;

            // Update COMPLETED stats
            document.getElementById('statCompletedCount').textContent = stats.counts.completed;
            document.getElementById('statCompletedPercent').textContent = stats.percentages.completed + '%';
            document.getElementById('statCompletedBar').style.width = stats.percentages.completed + '%';

            // Update ERRORS stats
            document.getElementById('statErrorsCount').textContent = stats.counts.errors;
            document.getElementById('statErrorsPercent').textContent = stats.percentages.errors + '%';
            document.getElementById('statErrorsBar').style.width = stats.percentages.errors + '%';

            // Update ACTIVE stats
            document.getElementById('statActiveCount').textContent = stats.counts.active;
            document.getElementById('statActivePercent').textContent = stats.percentages.active + '%';
            document.getElementById('statActiveBar').style.width = stats.percentages.active + '%';

            // Update last run
            if (stats.lastRun) {
                const lastRunDate = new Date(stats.lastRun);
                document.getElementById('statLastRun').textContent = lastRunDate.toLocaleString();
            } else {
                document.getElementById('statLastRun').textContent = 'Never';
            }
        }

        // Initialize or update pie chart
        function updateChart(stats) {
            if (!stats) return;

            const ctx = document.getElementById('statsChart');
            if (!ctx) return;

            // Destroy existing chart if it exists
            if (statsChart) {
                statsChart.destroy();
            }

            // Create new chart
            statsChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Completed', 'Errors', 'Active'],
                    datasets: [{
                        label: 'Workflow Status',
                        data: [
                            stats.counts.completed,
                            stats.counts.errors,
                            stats.counts.active
                        ],
                        backgroundColor: [
                            'rgba(31, 122, 77, 0.8)',    // success
                            'rgba(180, 35, 53, 0.8)',    // danger
                            'rgba(47, 95, 158, 0.8)'    // info
                        ],
                        borderColor: [
                            'rgba(31, 122, 77, 1)',
                            'rgba(180, 35, 53, 1)',
                            'rgba(47, 95, 158, 1)'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12,
                                    weight: '500'
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const percentage = stats.percentages[label.toLowerCase()] || 0;
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Render analytics table
        function renderAnalyticsTable(analyticsData) {
            const tbody = document.getElementById('analyticsTableBody');
            const countElement = document.getElementById('analyticsCount');

            if (!analyticsData || !analyticsData.workflows || analyticsData.workflows.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No workflows tracked yet</p>
                        </td>
                    </tr>
                `;
                countElement.textContent = '0';
                return;
            }

            // Build table rows
            const rows = analyticsData.workflows.map(workflow => {
                // Format timestamp
                const lastRunDate = workflow.lastRun ? new Date(workflow.lastRun) : null;
                const formattedDate = lastRunDate ? lastRunDate.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) : 'N/A';

                // Format average duration or show N/A
                const avgDuration = workflow.averageDuration != null ? workflow.averageDuration.toLocaleString() : 'N/A';

                return `
                    <tr>
                        <td>
                            <code class="small">${escapeHtml(workflow.workflowName)}</code>
                        </td>
                        <td class="text-center">
                            <strong>${workflow.runCount}</strong>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-success">${workflow.completedCount}</span>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-danger">${workflow.errorCount}</span>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-secondary">${workflow.activeCount}</span>
                        </td>
                        <td class="text-center">
                            ${avgDuration}
                        </td>
                        <td>
                            <small class="text-muted">${formattedDate}</small>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;
            countElement.textContent = analyticsData.workflows.length;
        }

        // Escape HTML to prevent XSS
        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, m => map[m]);
        }

        // Refresh dashboard
        async function refreshDashboard() {
            const tbody = document.getElementById('analyticsTableBody');

            // Show loading state
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted py-4">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        Loading analytics...
                    </td>
                </tr>
            `;

            // Fetch stats and analytics in parallel
            const [stats, analyticsData] = await Promise.all([
                fetchStats(),
                fetchAnalytics()
            ]);

            // Update statistics and chart
            if (stats) {
                updateStatsDisplay(stats);
                updateChart(stats);
            }

            // Update analytics table
            renderAnalyticsTable(analyticsData);
        }

        // Load dashboard on tab activation
        document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', function (e) {
            refreshDashboard();
        });

        // Initialize page
        window.onload = function() {
            checkStatus();

            // Load dashboard if it's the active tab
            if (document.getElementById('dashboard').classList.contains('show')) {
                refreshDashboard();
            }

            // Initialize Swagger UI from external docs
            initializeSwagger();
        };
    
