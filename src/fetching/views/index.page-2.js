        // Dashboard Analytics
        let urlDistributionChart = null;
        let activityChart = null;
        let urlListData = [];
        let errorsData = [];
        let sortState = {
            url: 'desc',
            totalRequests: 'desc',
            cacheHits: 'desc',
            successCount: 'desc',
            errorCount: 'desc'
        };

        const chartColors = [
            // NooblyJS palette: accent, teal, then the design system's deep avatar tones
            '#C2471F', '#2B7F86', '#4B2E83', '#E4B85C', '#1F4A8A',
            '#8A2440', '#3D5A1E', '#F2A27E', '#6B605A', '#1E5E63'
        ];

        // Load dashboard analytics
        async function loadDashboardAnalytics() {
            const refreshBtn = document.getElementById('refreshBtn');
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Loading<span class="loading-spinner"></span>';

            try {
                const response = await fetch('/services/fetching/api/analytics');
                const data = await response.json();

                if (data.success) {
                    updateStats(data.stats);
                    updateUrlDistributionChart(data.urlDistribution);
                    updateActivityChart(data.timeline);
                    updateUrlListTable(data.urlList);
                    updateErrorsTable(data.topErrors);
                }
            } catch (error) {
                console.error('Error loading analytics:', error);
                showAlert('Error loading analytics: ' + error.message, 'error');
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
            }
        }

        // Update stats cards
        function updateStats(stats) {
            document.getElementById('totalUrls').textContent = (stats.totalUrls || 0).toLocaleString();
            document.getElementById('totalRequests').textContent = (stats.totalRequests || 0).toLocaleString();
            document.getElementById('cacheHitRate').textContent = (stats.cacheHitRate || 0) + '%';
            document.getElementById('totalErrors').textContent = (stats.totalErrors || 0).toLocaleString();
            document.getElementById('successRate').textContent = (stats.successRate || 0) + '%';
        }

        // Update URL distribution pie chart
        function updateUrlDistributionChart(distribution) {
            const ctx = document.getElementById('urlDistributionChart').getContext('2d');

            if (urlDistributionChart) {
                urlDistributionChart.destroy();
            }

            if (!distribution.labels || distribution.labels.length === 0) {
                document.getElementById('urlDistributionChart').style.display = 'none';
                document.getElementById('urlDistributionEmpty').style.display = 'flex';
                return;
            }

            document.getElementById('urlDistributionChart').style.display = 'block';
            document.getElementById('urlDistributionEmpty').style.display = 'none';

            urlDistributionChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: distribution.labels.map(l => l.length > 40 ? l.substring(0, 37) + '...' : l),
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
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${value.toLocaleString()} requests (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Update activity chart
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
                label: dataset.name.length > 40 ? dataset.name.substring(0, 37) + '...' : dataset.name,
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
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `${context.dataset.label}: ${context.parsed.y} requests`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                }
            });
        }

        // Update URL list table
        function updateUrlListTable(urlList) {
            urlListData = urlList || [];
            renderUrlListTable();
        }

        // Render URL list table
        function renderUrlListTable() {
            const tbody = document.getElementById('urlListTableBody');
            const table = document.getElementById('urlListTable');
            const emptyDiv = document.getElementById('urlListEmpty');

            if (urlListData.length === 0) {
                table.style.display = 'none';
                emptyDiv.style.display = 'flex';
                return;
            }

            table.style.display = 'table';
            emptyDiv.style.display = 'none';

            tbody.innerHTML = urlListData.map(url => `
                <tr>
                    <td><span class="url-cell">${escapeHtml(url.name)}</span></td>
                    <td class="metric-value">${url.totalRequests.toLocaleString()}</td>
                    <td class="metric-value">${(url.cacheHitCount + url.dedupHitCount).toLocaleString()}</td>
                    <td class="metric-value"><span class="badge badge-success">${url.successCount.toLocaleString()}</span></td>
                    <td class="metric-value"><span class="badge badge-danger">${url.errorCount.toLocaleString()}</span></td>
                </tr>
            `).join('');
        }

        // Update errors table
        function updateErrorsTable(topErrors) {
            errorsData = topErrors || [];
            renderErrorsTable();
        }

        // Render errors table
        function renderErrorsTable() {
            const tbody = document.getElementById('errorsTableBody');
            const table = document.getElementById('errorsTable');
            const emptyDiv = document.getElementById('errorsEmpty');

            if (errorsData.length === 0) {
                table.style.display = 'none';
                emptyDiv.style.display = 'flex';
                return;
            }

            table.style.display = 'table';
            emptyDiv.style.display = 'none';

            tbody.innerHTML = errorsData.map(err => `
                <tr>
                    <td><span class="url-cell">${escapeHtml(err.url)}</span></td>
                    <td class="metric-value"><span class="badge badge-danger">${err.errorCount.toLocaleString()}</span></td>
                    <td class="metric-value">${(err.stats ? err.stats.totalRequests : 0).toLocaleString()}</td>
                </tr>
            `).join('');
        }

        // Sort table
        function sortTable(column) {
            sortState[column] = sortState[column] === 'asc' ? 'desc' : 'asc';
            urlListData.sort((a, b) => {
                const aVal = a[column];
                const bVal = b[column];
                return sortState[column] === 'asc' ? aVal - bVal : bVal - aVal;
            });
            renderUrlListTable();
        }

        function sortErrorTable(column) {
            errorsData.sort((a, b) => {
                return sortState[column] === 'asc' ? a[column] - b[column] : b[column] - a[column];
            });
            renderErrorsTable();
        }

        // Utility functions
        function showAlert(message, type = 'success') {
            const alertElement = document.getElementById(type + 'Alert');
            const messageElement = document.getElementById(type + 'Message');
            messageElement.textContent = message;
            alertElement.classList.add('show');
            setTimeout(() => alertElement.classList.remove('show'), 5000);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Test fetching
        async function testUrl(url) {
            document.getElementById('fetchUrl').value = url;
            await makeFetchRequest();
        }

        async function loadExample() {
            document.getElementById('fetchUrl').value = 'https://jsonplaceholder.typicode.com/posts/1';
        }

        async function makeFetchRequest() {
            const url = document.getElementById('fetchUrl').value;
            const method = document.getElementById('fetchMethod').value;
            const cacheControl = document.getElementById('cacheControl').value;

            if (!url) {
                showAlert('Please enter a URL', 'error');
                return;
            }

            try {
                const response = await fetch('/services/fetching/api/fetch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url,
                        options: {
                            method: method,
                            cache: cacheControl,
                            next: { revalidate: 60 }
                        }
                    })
                });

                const data = await response.json();
                const responseDiv = document.getElementById('fetchResponse');
                const contentDiv = document.getElementById('fetchResponseContent');

                if (data.success) {
                    contentDiv.textContent = JSON.stringify(data, null, 2);
                    responseDiv.style.display = 'block';
                    showAlert('Request successful! Status: ' + data.status);
                    loadDashboardAnalytics();
                } else {
                    contentDiv.textContent = JSON.stringify(data, null, 2);
                    responseDiv.style.display = 'block';
                    showAlert('Error: ' + data.error, 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        }

        async function clearCache() {
            try {
                const response = await fetch('/services/fetching/api/cache', { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showAlert('Cache cleared successfully');
                    loadDashboardAnalytics();
                } else {
                    showAlert('Error: ' + data.error, 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        }

        async function checkStatus() {
            try {
                const response = await fetch('/services/fetching/api/status');
                const data = await response.json();
                const responseDiv = document.getElementById('statusResponse');
                const contentDiv = document.getElementById('statusResponseContent');
                contentDiv.textContent = JSON.stringify(data, null, 2);
                responseDiv.style.display = 'block';
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        }

        // Settings
        async function loadSettings() {
            try {
                const response = await fetch('/services/fetching/api/settings');
                const data = await response.json();

                if (data.success) {
                    renderSettingsForm(data.data);
                } else {
                    showAlert('Error loading settings: ' + data.error, 'error');
                }
            } catch (error) {
                showAlert('Error loading settings: ' + error.message, 'error');
            }
        }

        function renderSettingsForm(settings) {
            const container = document.getElementById('settingsFormFields');
            container.innerHTML = '';

            if (settings.list && Array.isArray(settings.list)) {
                settings.list.forEach((setting) => {
                    const formGroup = document.createElement('div');
                    formGroup.className = 'mb-3';

                    const label = document.createElement('label');
                    label.className = 'form-label';
                    label.htmlFor = 'setting_' + setting.setting;
                    label.textContent = setting.setting;
                    formGroup.appendChild(label);

                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'form-control';
                    input.id = 'setting_' + setting.setting;
                    input.name = setting.setting;
                    input.value = settings[setting.setting] || '';
                    formGroup.appendChild(input);

                    if (setting.description) {
                        const helper = document.createElement('div');
                        helper.className = 'form-text';
                        helper.textContent = setting.description;
                        formGroup.appendChild(helper);
                    }

                    container.appendChild(formGroup);
                });
            }
        }

        document.getElementById('fetchForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            makeFetchRequest();
        });

        document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(document.getElementById('settingsForm'));
            const payload = {};

            for (let [key, value] of formData.entries()) {
                payload[key] = value;
            }

            try {
                const response = await fetch('/services/fetching/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                const responseDiv = document.getElementById('settingsSaveResponse');
                const contentDiv = document.getElementById('settingsSaveResponseContent');
                contentDiv.textContent = JSON.stringify(data, null, 2);
                responseDiv.style.display = 'block';

                if (data.success) {
                    showAlert('Settings saved successfully');
                    setTimeout(() => loadSettings(), 1000);
                } else {
                    showAlert('Error: ' + data.error, 'error');
                }
            } catch (error) {
                showAlert('Error saving settings: ' + error.message, 'error');
            }
        });

        // Load on page load
        document.addEventListener('DOMContentLoaded', () => {
            loadDashboardAnalytics();
            checkStatus();
            setInterval(loadDashboardAnalytics, 30000);

            document.getElementById('settings-tab')?.addEventListener('shown.bs.tab', () => {
                loadSettings();
            });
        });
    
