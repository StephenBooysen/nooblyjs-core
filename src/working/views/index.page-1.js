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
        document.getElementById('runTask').addEventListener('input', () => validateJSON('runTask'));

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
                runTask: {
                    "task": "./tasks/image-processor.js",
                    "data": {
                        "source": "/uploads/image.jpg",
                        "operations": ["resize", "watermark"]
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
        document.getElementById('runForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const task = document.getElementById('runTask').value;
            
            if (!validateJSON('runTask')) {
                showAlert('Please enter a valid JSON task', 'error');
                return;
            }
            
            try {
                setLoading('runForm', true);
                const parsedTask = JSON.parse(task);
                const result = await makeRequest(`/services/working/api/run`, 'POST', parsedTask);
                showResponse('runResponse', 'runResponseContent', result);
                showAlert(`Task started successfully`);
            } catch (error) {
                showAlert('Error starting task: ' + error.message, 'error');
                showResponse('runResponse', 'runResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('runForm', false);
            }
        });

        document.getElementById('stopForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (!confirm(`Are you sure you want to stop the running task?`)) {
                return;
            }
            
            try {
                setLoading('stopForm', true);
                const result = await makeRequest(`/services/working/api/stop`);
                showResponse('stopResponse', 'stopResponseContent', result);
                showAlert(`Task stopped successfully`);
            } catch (error) {
                showAlert('Error stopping task: ' + error.message, 'error');
                showResponse('stopResponse', 'stopResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('stopForm', false);
            }
        });

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/working/api/status');
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
                const response = await fetch('/services/working/api/swagger/docs.json');
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
        let taskStatsChart = null;

        // Fetch statistics from analytics API
        async function fetchStats() {
            try {
                const response = await fetch('/services/working/api/stats');
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching stats:', error);
                return null;
            }
        }

        // Fetch task analytics from API
        async function fetchAnalytics() {
            try {
                const response = await fetch('/services/working/api/analytics');
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

            const ctx = document.getElementById('taskStatsChart');
            if (!ctx) return;

            // Destroy existing chart if it exists
            if (taskStatsChart) {
                taskStatsChart.destroy();
            }

            // Create new chart
            taskStatsChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Completed', 'Errors', 'Active'],
                    datasets: [{
                        label: 'Task Status',
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

            if (!analyticsData || !analyticsData.tasks || analyticsData.tasks.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No tasks tracked yet</p>
                        </td>
                    </tr>
                `;
                countElement.textContent = '0';
                return;
            }

            // Build table rows
            const rows = analyticsData.tasks.map(task => {
                // Format timestamp
                const lastRunDate = task.lastRun ? new Date(task.lastRun) : null;
                const formattedDate = lastRunDate ? lastRunDate.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) : 'Never';

                return `
                    <tr>
                        <td>
                            <code class="small">${escapeHtml(task.scriptPath)}</code>
                        </td>
                        <td class="text-center">
                            <strong>${task.runCount}</strong>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-success">${task.completedCount}</span>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-danger">${task.errorCount}</span>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-secondary">${task.activeCount}</span>
                        </td>
                        <td class="text-center">
                            ${task.averageDuration.toLocaleString()}
                        </td>
                        <td>
                            <small class="text-muted">${formattedDate}</small>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;
            countElement.textContent = analyticsData.tasks.length;
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
    
