        // JSON validation
        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace('Message', 'Validation'));
            const value = element.value.trim();
            
            if (!value) {
                element.classList.remove('json-valid', 'json-invalid');
                validation.style.display = 'none';
                return true;
            }
            
            try {
                JSON.parse(value);
                element.classList.remove('is-invalid');
                element.classList.add('is-valid');
                validation.textContent = '✓ Valid JSON';
                validation.className = 'form-text text-success';
                validation.style.display = 'block';
                return true;
            } catch (e) {
                element.classList.remove('is-valid');
                element.classList.add('is-invalid');
                validation.textContent = '✗ Invalid JSON: ' + e.message;
                validation.className = 'form-text text-danger';
                validation.style.display = 'block';
                return false;
            }
        }

        // Real-time validation for metadata JSON field
        document.getElementById('logMessage').addEventListener('input', () => {
            const value = document.getElementById('logMessage').value.trim();
            // Only validate if field has content
            if (value) {
                validateJSON('logMessage');
            } else {
                // Clear validation message if field is empty
                document.getElementById('logValidation').style.display = 'none';
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
            if (elementId === 'logMessage') {
                // Load example for metadata field
                const exampleMetadata = {
                    "userId": "12345",
                    "ip": "192.168.1.1",
                    "action": "login"
                };
                document.getElementById('logMessageText').value = '[AuthService] User logged in successfully';
                document.getElementById('logMessage').value = JSON.stringify(exampleMetadata, null, 2);
                validateJSON('logMessage');
            }
        }

        // Instance selection state
        let selectedInstance = 'default';
        let logger = null;

        // Initialize logger with selected instance
        function initializeLogger() {
            logger = new nooblyjslogging(selectedInstance);
        }

        // Instance management functions
        async function loadAvailableInstances() {
            try {
                const response = await fetch('/services/logging/api/instances');
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
            return basePath.replace('/services/logging/api/', `/services/logging/api/${selectedInstance}/`);
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
                form.classList.add('core-loading');
            } else {
                form.classList.remove('core-loading');
            }
        }

        // Form handlers using logging client library
        document.getElementById('logForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const logginglevel = document.getElementById('logging-level-select').value;
            const messageText = document.getElementById('logMessageText').value;
            const metadataJson = document.getElementById('logMessage').value;

            // Validate message text
            if (!messageText || messageText.trim() === '') {
                showAlert('Please enter a message', 'error');
                return;
            }

            // Validate metadata JSON if provided
            let metadata = undefined;
            if (metadataJson && metadataJson.trim() !== '') {
                if (!validateJSON('logMessage')) {
                    showAlert('Metadata field contains invalid JSON', 'error');
                    return;
                }
                try {
                    metadata = JSON.parse(metadataJson);
                } catch (err) {
                    showAlert('Failed to parse metadata: ' + err.message, 'error');
                    return;
                }
            }

            try {
                setLoading('logForm', true);

                // Use logging client library to submit log with message and metadata
                let result;
                if (logginglevel === 'info') {
                    result = await logger.info(messageText, metadata);
                } else if (logginglevel === 'warn') {
                    result = await logger.warn(messageText, metadata);
                } else if (logginglevel === 'error') {
                    result = await logger.error(messageText, metadata);
                }

                showResponse('logResponse', 'logResponseContent', { success: true, message: 'Log entry submitted successfully' });
                showAlert(`Log entry submitted successfully`);

                // Clear form
                document.getElementById('logMessageText').value = '';
                document.getElementById('logMessage').value = '';
            } catch (error) {
                showAlert('Error submitting log entry: ' + error.message, 'error');
                showResponse('logResponse', 'logResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('logForm', false);
            }
        });

        async function checkStatus() {
            try {
                const response = await fetch(buildInstanceUrl('/services/logging/api/status'));
                const result = await response.json();
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        // Dashboard functionality
        let currentLogs = [];
        let logStatsChart = null;
        let logTimelineChart = null;

        // Fetch statistics from analytics API
        async function fetchStats() {
            try {
                const statsUrl = buildInstanceUrl('/services/logging/api/stats');
                const response = await fetch(statsUrl);
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching stats:', error);
                return null;
            }
        }

        // Update statistics display
        function updateStatsDisplay(stats) {
            if (!stats) return;

            // Update total count
            document.getElementById('statTotalCount').textContent = stats.total;

            // Update INFO stats
            document.getElementById('statInfoCount').textContent = stats.counts.INFO;
            document.getElementById('statInfoPercent').textContent = stats.percentages.INFO + '%';
            document.getElementById('statInfoBar').style.width = stats.percentages.INFO + '%';

            // Update WARN stats
            document.getElementById('statWarnCount').textContent = stats.counts.WARN;
            document.getElementById('statWarnPercent').textContent = stats.percentages.WARN + '%';
            document.getElementById('statWarnBar').style.width = stats.percentages.WARN + '%';

            // Update ERROR stats
            document.getElementById('statErrorCount').textContent = stats.counts.ERROR;
            document.getElementById('statErrorPercent').textContent = stats.percentages.ERROR + '%';
            document.getElementById('statErrorBar').style.width = stats.percentages.ERROR + '%';

            // Update LOG stats
            document.getElementById('statLogCount').textContent = stats.counts.LOG;
            document.getElementById('statLogPercent').textContent = stats.percentages.LOG + '%';
            document.getElementById('statLogBar').style.width = stats.percentages.LOG + '%';
        }

        // Fetch timeline from analytics API
        async function fetchTimeline() {
            try {
                const timelineUrl = buildInstanceUrl('/services/logging/api/timeline');
                const response = await fetch(timelineUrl);
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching timeline:', error);
                return null;
            }
        }

        // Initialize or update pie chart
        function updateChart(stats) {
            if (!stats) return;

            const ctx = document.getElementById('logStatsChart');
            if (!ctx) return;

            // Destroy existing chart if it exists
            if (logStatsChart) {
                logStatsChart.destroy();
            }

            // Create new chart
            logStatsChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['INFO', 'WARN', 'ERROR', 'LOG'],
                    datasets: [{
                        label: 'Log Levels',
                        data: [
                            stats.counts.INFO,
                            stats.counts.WARN,
                            stats.counts.ERROR,
                            stats.counts.LOG
                        ],
                        backgroundColor: [
                            'rgba(47, 95, 158, 0.8)',   // info
                            'rgba(228, 184, 92, 0.8)',    // warning
                            'rgba(180, 35, 53, 0.8)',    // danger
                            'rgba(143, 131, 124, 0.8)'   // neutral
                        ],
                        borderColor: [
                            'rgba(47, 95, 158, 1)',
                            'rgba(228, 184, 92, 1)',
                            'rgba(180, 35, 53, 1)',
                            'rgba(143, 131, 124, 1)'
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
                                    const percentage = stats.percentages[label] || 0;
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Initialize or update timeline chart
        function updateTimelineChart(timeline) {
            if (!timeline) return;

            const ctx = document.getElementById('logTimelineChart');
            if (!ctx) return;

            // Destroy existing chart if it exists
            if (logTimelineChart) {
                logTimelineChart.destroy();
            }

            // Create new timeline chart
            logTimelineChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: timeline.labels,
                    datasets: [
                        {
                            label: 'INFO',
                            data: timeline.datasets.INFO,
                            borderColor: 'rgba(47, 95, 158, 1)',
                            backgroundColor: 'rgba(47, 95, 158, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 3,
                            pointHoverRadius: 5
                        },
                        {
                            label: 'WARN',
                            data: timeline.datasets.WARN,
                            borderColor: 'rgba(228, 184, 92, 1)',
                            backgroundColor: 'rgba(228, 184, 92, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 3,
                            pointHoverRadius: 5
                        },
                        {
                            label: 'ERROR',
                            data: timeline.datasets.ERROR,
                            borderColor: 'rgba(180, 35, 53, 1)',
                            backgroundColor: 'rgba(180, 35, 53, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 3,
                            pointHoverRadius: 5
                        },
                        {
                            label: 'LOG',
                            data: timeline.datasets.LOG,
                            borderColor: 'rgba(143, 131, 124, 1)',
                            backgroundColor: 'rgba(143, 131, 124, 0.1)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointRadius: 3,
                            pointHoverRadius: 5
                        }
                    ]
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
                                    size: 12,
                                    weight: '500'
                                },
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                title: function(context) {
                                    return 'Time: ' + context[0].label;
                                },
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y || 0;
                                    return `${label}: ${value} log${value !== 1 ? 's' : ''}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            display: true,
                            title: {
                                display: true,
                                text: 'Time (per minute)',
                                font: {
                                    size: 12,
                                    weight: '600'
                                }
                            },
                            grid: {
                                display: false
                            }
                        },
                        y: {
                            display: true,
                            title: {
                                display: true,
                                text: 'Number of Logs',
                                font: {
                                    size: 12,
                                    weight: '600'
                                }
                            },
                            beginAtZero: true,
                            ticks: {
                                stepSize: 1
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        }
                    }
                }
            });
        }

        // Fetch logs from analytics API
        async function fetchLogs(level = '') {
            try {
                const url = level
                    ? `/services/logging/api/logs?level=${level}`
                    : '/services/logging/api/logs';

                const response = await fetch(url);
                const data = await response.json();

                return data;
            } catch (error) {
                console.error('Error fetching logs:', error);
                showAlert('Error fetching logs: ' + error.message, 'error');
                return { logs: [], count: 0 };
            }
        }

        // Parse log message to extract text and metadata
        function parseLogMessage(fullMessage) {
            // Log format: TIMESTAMP - LEVEL - DEVICE - MESSAGE [optional: metadata JSON]
            // Find the third occurrence of " - " to skip timestamp, level, and device
            let parts = fullMessage.split(' - ');
            if (parts.length < 4) {
                return { message: fullMessage, metadata: null };
            }

            // Everything after the device is the message part
            const messagePart = parts.slice(3).join(' - ');

            // Try to extract JSON metadata from the end of the message
            // Match from the first { to the end, accounting for nested braces
            let lastBraceIndex = messagePart.lastIndexOf('}');
            if (lastBraceIndex === -1) {
                return { message: messagePart, metadata: null };
            }

            // Find the matching opening brace
            let braceCount = 0;
            let firstBraceIndex = -1;
            for (let i = lastBraceIndex; i >= 0; i--) {
                if (messagePart[i] === '}') braceCount++;
                else if (messagePart[i] === '{') {
                    braceCount--;
                    if (braceCount === 0) {
                        firstBraceIndex = i;
                        break;
                    }
                }
            }

            if (firstBraceIndex === -1) {
                return { message: messagePart, metadata: null };
            }

            // Try to parse the JSON
            const potentialJson = messagePart.substring(firstBraceIndex);
            try {
                const metadata = JSON.parse(potentialJson);
                const message = messagePart.substring(0, firstBraceIndex).trim();
                return {
                    message: message,
                    metadata: metadata
                };
            } catch (e) {
                // Not valid JSON, return whole message
                return { message: messagePart, metadata: null };
            }
        }

        // Format JSON with syntax highlighting
        function formatJsonPretty(obj) {
            return JSON.stringify(obj, null, 2);
        }

        // Render logs table
        function renderLogsTable(logs) {
            const tbody = document.getElementById('logsTableBody');
            const countElement = document.getElementById('logCount');

            if (!logs || logs.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No logs found</p>
                        </td>
                    </tr>
                `;
                countElement.textContent = '0';
                return;
            }

            // Build table rows
            const rows = logs.map((log, index) => {
                // Determine badge color based on level (theme-proof classes so
                // INFO/LOG don't render red and clash with ERROR).
                let badgeClass = 'core-loglevel-log';
                if (log.level === 'INFO') badgeClass = 'core-loglevel-info';
                else if (log.level === 'WARN') badgeClass = 'core-loglevel-warn';
                else if (log.level === 'ERROR') badgeClass = 'core-loglevel-error';

                // Format timestamp
                const date = new Date(log.timestamp);
                const formattedDate = date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                // Parse message and metadata
                const { message, metadata } = parseLogMessage(log.message);
                const logId = `log-${index}-${Date.now()}`;
                const collapsibleId = `collapse-${logId}`;

                let metadataSection = '';
                let chevronIcon = '';
                if (metadata) {
                    metadataSection = `
                        <div class="collapse mt-2" id="${collapsibleId}">
                            <pre class="inline-44f6449d">${formatJsonPretty(metadata)}</pre>
                        </div>
                    `;
                    chevronIcon = '<i class="inline-0762504b bi bi-chevron-right"></i>';
                }

                return `
                    <tr class="log-row-${index}${metadata ? ' log-row--clickable' : ''}" data-toggle-id="${collapsibleId}" data-has-metadata="${!!metadata}">
                        <td>
                            <span class="badge ${badgeClass}">${log.level}</span>
                        </td>
                        <td>
                            <div class="inline-b441945f">
                                ${chevronIcon}<span class="inline-c6b099a7">${escapeHtml(message)}</span>
                                ${metadataSection}
                            </div>
                        </td>
                        <td>
                            <small class="text-muted">${formattedDate}</small>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;
            countElement.textContent = logs.length;

            // Add click handlers to rows with metadata
            document.querySelectorAll('tr[data-has-metadata="true"]').forEach(row => {
                row.addEventListener('click', function(e) {
                    // Don't trigger if clicking on a link or button
                    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;

                    const toggleId = this.getAttribute('data-toggle-id');
                    const collapseElement = document.getElementById(toggleId);
                    const chevron = this.querySelector('i.bi-chevron-right');

                    if (collapseElement) {
                        const isVisible = collapseElement.classList.contains('show');
                        if (isVisible) {
                            // Collapse
                            collapseElement.classList.remove('show');
                            if (chevron) chevron.style.transform = 'rotate(0deg)';
                        } else {
                            // Expand
                            collapseElement.classList.add('show');
                            if (chevron) chevron.style.transform = 'rotate(90deg)';
                        }
                    }
                });

                // Add hover effect
                row.addEventListener('mouseenter', function() {
                    this.style.backgroundColor = '#f8f9fa';
                });
                row.addEventListener('mouseleave', function() {
                    this.style.backgroundColor = '';
                });
            });
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

        // Refresh dashboard with current filter
        async function refreshDashboard() {
            const levelFilter = document.getElementById('logLevelFilter').value;
            const tbody = document.getElementById('logsTableBody');

            // Show loading state
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center text-muted py-4">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        Loading logs...
                    </td>
                </tr>
            `;

            // Fetch stats, timeline, and logs in parallel
            const [stats, timeline, logsData] = await Promise.all([
                fetchStats(),
                fetchTimeline(),
                fetchLogs(levelFilter)
            ]);

            // Update statistics and pie chart
            if (stats) {
                updateStatsDisplay(stats);
                updateChart(stats);
            }

            // Update timeline chart
            if (timeline) {
                updateTimelineChart(timeline);
            }

            // Update logs table
            currentLogs = logsData.logs || [];
            renderLogsTable(currentLogs);
        }

        // Handle log level filter change
        document.getElementById('logLevelFilter')?.addEventListener('change', refreshDashboard);

        // Load dashboard on tab activation
        document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', function (e) {
            refreshDashboard();
        });

        // Initial dashboard load
        if (document.getElementById('dashboard').classList.contains('show')) {
            refreshDashboard();
        }

        // Swagger UI setup - Load spec from API endpoint
        let swaggerSpec = null;

        // Fetch Swagger specification from API
        async function fetchSwaggerSpec() {
            try {
                const response = await fetch('/services/logging/api/swagger/docs.json');
                if (!response.ok) {
                    console.error('Failed to fetch Swagger spec:', response.statusText);
                    return null;
                }
                return await response.json();
            } catch (error) {
                console.error('Error fetching Swagger spec:', error);
                return null;
            }
        }

        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/logging/api/settings');
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
            if (data.description || data.desciption) {
                infoContainer.textContent = data.description || data.desciption;
                infoContainer.classList.add('show');
            } else {
                infoContainer.classList.remove('show');
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
            if (setting.description || setting.desciption) {
                const helperText = document.createElement('div');
                helperText.className = 'form-text';
                helperText.textContent = setting.description || setting.desciption;
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
                const response = await fetch('/services/logging/api/settings', {
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
            // Re-initialize logger with new instance
            initializeLogger();
            // Reload stats and timeline when instance changes
            loadStats();
            loadTimeline();
        });

        document.getElementById('refreshInstanceBtn')?.addEventListener('click', function (e) {
            e.preventDefault();
            loadAvailableInstances();
        });

        // Initialize Swagger UI with fetched spec
        window.onload = async function() {
            // Initialize logging client library
            initializeLogger();
            checkStatus();
            loadAvailableInstances();

            try {
                // Fetch Swagger specification from API
                swaggerSpec = await fetchSwaggerSpec();

                if (!swaggerSpec) {
                    throw new Error('Failed to load Swagger specification');
                }

                // Initialize Swagger UI with fetched spec
                const ui = SwaggerUIBundle({
                    spec: swaggerSpec,
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
                        console.log('Swagger UI loaded successfully from /services/logging/api/swagger/docs.json');
                    },
                    onFailure: (error) => {
                        console.error('Swagger UI failed to load:', error);
                    }
                });

                window.ui = ui;
            } catch (error) {
                console.error('Error initializing Swagger UI:', error);
                const swaggerContainer = document.getElementById('swagger-ui');
                if (swaggerContainer) {
                    swaggerContainer.innerHTML = `<p class="inline-31981a7d">Error loading API documentation: ${error.message}</p><p class="inline-121b09d1">Check the browser console for more details.</p>`;
                }
            }
        };