                        let metricsStore = {
                            allMetrics: [],
                            allValues: [],
                            currentMetric: null,
                            filteredValues: []
                        };

                        // Initialize UI on tab show
                        document.getElementById('ui-tab')?.addEventListener('shown.bs.tab', function() {
                            loadMetricsForUI();
                        });

                        async function loadMetricsForUI() {
                            try {
                                const response = await fetch('/services/measuring/api/metrics');
                                if (!response.ok) throw new Error('Failed to load metrics');

                                const data = await response.json();
                                metricsStore.allMetrics = data.metrics || [];
                                metricsStore.allValues = data.values || [];

                                console.log('Metrics loaded:', metricsStore.allMetrics.length, 'metrics');
                                console.log('Values loaded:', metricsStore.allValues.length, 'values');

                                renderMetricsList();
                            } catch (error) {
                                console.error('Could not load metrics:', error.message);
                            }
                        }

                        function renderMetricsList() {
                            const metricsList = document.getElementById('metricsList');
                            if (!metricsList) {
                                console.error('metricsList element not found');
                                return;
                            }

                            metricsList.innerHTML = '';

                            if (metricsStore.allMetrics.length === 0) {
                                metricsList.innerHTML = '<li class="metrics-item" style="text-align: center; color: #999; padding: 1rem;"><em>No metrics available</em></li>';
                                return;
                            }

                            metricsStore.allMetrics.forEach(metricName => {
                                const count = metricsStore.allValues.filter(v => v.metric === metricName).length;
                                const item = document.createElement('li');
                                item.className = 'metrics-item';
                                item.innerHTML = `
                                    <span class="metrics-item-name">${metricName}</span>
                                    <span class="metrics-item-count">${count}</span>
                                `;
                                item.style.cursor = 'pointer';
                                item.addEventListener('click', () => selectMetric(metricName));
                                metricsList.appendChild(item);
                            });
                        }

                        function selectMetric(metricName) {
                            metricsStore.currentMetric = metricName;

                            // Update active state
                            document.querySelectorAll('.metrics-item').forEach(item => {
                                const nameElement = item.querySelector('.metrics-item-name');
                                if (nameElement) {
                                    const name = nameElement.textContent;
                                    item.classList.toggle('active', name === metricName);
                                }
                            });

                            // Load data for this metric
                            loadMetricDetails(metricName);
                        }

                        function loadMetricDetails(metricName) {
                            const values = metricsStore.allValues.filter(v => v.metric === metricName);
                            metricsStore.filteredValues = values;

                            // Update header
                            document.getElementById('metricsContentTitle').textContent = metricName;
                            document.getElementById('metricsContentSubtitle').textContent = `${values.length} values recorded`;

                            // Hide placeholder, show content
                            document.getElementById('metricsContentPlaceholder').style.display = 'none';
                            document.getElementById('metricsStatsGrid').style.display = 'grid';
                            document.getElementById('metricsDateFilter').style.display = 'flex';
                            document.getElementById('metricsDataTable').style.display = 'table';

                            // Calculate and display statistics
                            if (values.length > 0) {
                                const numericValues = values.map(v => v.value).filter(v => !isNaN(v));
                                const average = numericValues.length > 0 ? (numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2) : 0;
                                const maximum = numericValues.length > 0 ? Math.max(...numericValues).toFixed(2) : 0;
                                const minimum = numericValues.length > 0 ? Math.min(...numericValues).toFixed(2) : 0;

                                document.getElementById('metricAverage').textContent = average;
                                document.getElementById('metricMaximum').textContent = maximum;
                                document.getElementById('metricMinimum').textContent = minimum;
                            }

                            // Render table (top 50 entries)
                            const top50 = values.slice(0, 50);
                            renderMetricsTable(top50, values.length);
                        }

                        function renderMetricsTable(values, totalCount) {
                            const tbody = document.getElementById('metricsDataTableBody');
                            tbody.innerHTML = '';

                            if (values.length === 0) {
                                tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #999;">No values recorded</td></tr>';
                                return;
                            }

                            values.forEach(val => {
                                const row = document.createElement('tr');
                                const date = new Date(val.timestamp);
                                row.innerHTML = `
                                    <td>${val.metric}</td>
                                    <td><strong>${val.value}</strong></td>
                                    <td style="font-size: 0.85rem; color: #666;">${date.toLocaleString()}</td>
                                `;
                                tbody.appendChild(row);
                            });

                            // Add footer showing count
                            const tfoot = document.createElement('tfoot');
                            tfoot.innerHTML = `
                                <tr style="background-color: #f8f9fa; font-size: 0.85rem; color: #666;">
                                    <td colspan="3">Showing top ${values.length} of ${totalCount} entries</td>
                                </tr>
                            `;
                            document.getElementById('metricsDataTable').appendChild(tfoot);
                        }

                        function filterMetricsData() {
                            const startDate = new Date(document.getElementById('metricStartDate').value);
                            const endDate = new Date(document.getElementById('metricEndDate').value);

                            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                                alert('Please select valid dates');
                                return;
                            }

                            const allValues = metricsStore.allValues.filter(v => v.metric === metricsStore.currentMetric);
                            const filtered = allValues.filter(v => {
                                const valDate = new Date(v.timestamp);
                                return valDate >= startDate && valDate <= endDate;
                            });

                            renderMetricsTable(filtered.slice(0, 50), filtered.length);
                        }

                        // Setup search
                        const searchInput = document.getElementById('metricsSearch');
                        if (searchInput) {
                            searchInput.addEventListener('input', function(e) {
                                const searchTerm = e.target.value.toLowerCase();
                                document.querySelectorAll('.metrics-item').forEach(item => {
                                    const nameElement = item.querySelector('.metrics-item-name');
                                    if (!nameElement) {
                                        console.warn('metrics-item-name element not found');
                                        return;
                                    }
                                    const metricName = nameElement.textContent.toLowerCase();
                                    item.style.display = metricName.includes(searchTerm) ? '' : 'none';
                                });
                            });
                        }

                        // Load on page load
                        window.addEventListener('load', function() {
                            setTimeout(loadMetricsForUI, 500);
                        });
                    
