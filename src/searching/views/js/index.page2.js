        // Global state
        let currentIndex = '';
        let allIndexes = [];
        let analyticsData = [];
        let currentSort = { column: 'callCount', direction: 'desc' };

        // Index Management Functions
        async function fetchIndexes() {
            try {
                const response = await fetch('/services/searching/api/indexes');
                const data = await response.json();
                return data.indexes || [];
            } catch (error) {
                console.error('Error fetching indexes:', error);
                showAlert('Error fetching indexes: ' + error.message, 'error');
                return [];
            }
        }

        // Populate the top-right index selector and sync currentIndex
        async function loadIndexSelector() {
            try {
                const indexes = await fetchIndexes();
                allIndexes = indexes;

                const selector = document.getElementById('indexSelector');
                if (!selector) return;

                const previous = currentIndex;
                selector.innerHTML = indexes.length
                    ? indexes.map(idx =>
                        `<option value="${escapeHtml(idx.name)}">${escapeHtml(idx.name)}${idx.name === 'default' ? ' (default)' : ''}</option>`
                      ).join('')
                    : '<option value="">No indexes available</option>';

                // Restore previous selection, otherwise prefer the "default" index
                if (indexes.some(idx => idx.name === previous)) {
                    selector.value = previous;
                } else {
                    const fallback = indexes.find(idx => idx.name === 'default') || indexes[0];
                    selector.value = fallback ? fallback.name : '';
                }
                currentIndex = selector.value;
            } catch (error) {
                console.error('Error loading index selector:', error);
            }
        }

        // Refresh data and context for the selected index across all tabs
        function applyIndexContext() {
            refreshAnalytics();    // Dashboard
            refreshIndexStats();   // Data Operations
            loadSettings();        // Settings
        }

        async function createIndex(searchContainer) {
            if (!searchContainer || !searchContainer.trim()) {
                showAlert('Please enter a valid index name', 'error');
                return;
            }

            try {
                // Create index by adding a dummy document
                const dummyDoc = {
                    _indexInit: true,
                    createdAt: new Date().toISOString()
                };

                const response = await fetch(`/services/searching/api/add?searchContainer=${encodeURIComponent(searchContainer)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dummyDoc)
                });

                if (response.ok) {
                    showAlert(`Index "${searchContainer}" created successfully`);
                    await loadIndexSelector();
                    // Switch the active index to the newly created one
                    const selector = document.getElementById('indexSelector');
                    if (selector) {
                        selector.value = searchContainer;
                        currentIndex = searchContainer;
                    }
                    await refreshIndexStats();
                    document.getElementById('newIndexName').value = '';
                } else {
                    const error = await response.text();
                    showAlert(`Error creating index: ${error}`, 'error');
                }
            } catch (error) {
                console.error('Error creating index:', error);
                showAlert('Error creating index: ' + error.message, 'error');
            }
        }

        async function clearIndex(searchContainer) {
            if (!confirm(`Are you sure you want to clear all documents from index "${searchContainer}"? This action cannot be undone.`)) {
                return;
            }

            try {
                const response = await fetch(`/services/searching/api/indexes/${encodeURIComponent(searchContainer)}/clear`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    showAlert(`Index "${searchContainer}" cleared successfully`);
                    await refreshIndexStats();
                } else {
                    const error = await response.text();
                    showAlert(`Error clearing index: ${error}`, 'error');
                }
            } catch (error) {
                console.error('Error clearing index:', error);
                showAlert('Error clearing index: ' + error.message, 'error');
            }
        }

        async function deleteIndex(searchContainer) {
            if (!confirm(`Are you sure you want to DELETE the entire index "${searchContainer}"? This action cannot be undone and will remove all documents.`)) {
                return;
            }

            try {
                const response = await fetch(`/services/searching/api/indexes/${encodeURIComponent(searchContainer)}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    showAlert(`Index "${searchContainer}" deleted successfully`);
                    // Reload the selector; it picks a new active index if the
                    // current one was just deleted
                    await loadIndexSelector();
                    await refreshIndexStats();
                } else {
                    const error = await response.text();
                    showAlert(`Error deleting index: ${error}`, 'error');
                }
            } catch (error) {
                console.error('Error deleting index:', error);
                showAlert('Error deleting index: ' + error.message, 'error');
            }
        }

        async function refreshIndexStats() {
            const indexList = document.getElementById('indexList');

            // Show loading
            indexList.innerHTML = `
                <li class="text-center text-muted py-4">
                    <div class="spinner-border spinner-border-sm me-2" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    Loading indexes...
                </li>
            `;

            try {
                const response = await fetch('/services/searching/api/indexes');
                const data = await response.json();
                const indexes = data.indexes || [];

                if (indexes.length === 0) {
                    indexList.innerHTML = `
                        <li class="text-center text-muted py-4">
                            <i class="bi bi-inbox fs-4"></i>
                            <p class="mb-0 mt-2">No indexes found. Create one to get started!</p>
                        </li>
                    `;
                    return;
                }

                // Render index items
                indexList.innerHTML = indexes.map(index => `
                    <li class="index-item">
                        <div class="index-info">
                            <div class="index-name">
                                <i class="bi bi-folder-fill text-primary"></i>
                                ${escapeHtml(index.name)}
                                ${index.name === currentIndex ? '<span class="badge badge-primary">Active</span>' : ''}
                            </div>
                            <div class="index-stats">
                                <i class="bi bi-file-earmark-text"></i> ${index.count || 0} documents
                            </div>
                        </div>
                        <div class="index-actions">
                            <button class="btn btn-outline-primary btn-sm" data-onclick="clearIndex" data-onclick-args="${nooblyArgs(index.name)}">
                                <i class="bi bi-trash"></i> Clear
                            </button>
                            <button class="btn btn-outline-danger btn-sm" data-onclick="deleteIndex" data-onclick-args="${nooblyArgs(index.name)}">
                                <i class="bi bi-x-circle"></i> Delete
                            </button>
                        </div>
                    </li>
                `).join('');

            } catch (error) {
                console.error('Error loading indexes:', error);
                indexList.innerHTML = `
                    <li class="text-center text-danger py-4">
                        <i class="bi bi-exclamation-triangle fs-4"></i>
                        <p class="mb-0 mt-2">Error loading indexes: ${escapeHtml(error.message)}</p>
                    </li>
                `;
            }
        }

        // JSON validation
        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace('Document', 'Validation'));
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
        document.getElementById('addDocument').addEventListener('input', () => validateJSON('addDocument'));

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
                addDocument: {
                    "title": "Another Document",
                    "content": "This is some more content for another document.",
                    "tags": ["sample", "testing"]
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

        // Analytics functions
        async function fetchAnalytics() {
            try {
                let url = `/services/searching/api/analytics`;
                if (currentIndex) {
                    url += `?searchContainer=${encodeURIComponent(currentIndex)}`;
                }

                const response = await fetch(url);
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching analytics:', error);
                return null;
            }
        }

        function updateStatsCards(data) {
            if (!data || !data.operations) return;

            const operations = data.operations;
            document.getElementById('statTotalAdds').textContent = operations.adds || 0;
            document.getElementById('statTotalDeletes').textContent = operations.deletes || 0;
            document.getElementById('statTotalSearches').textContent = operations.searches || 0;
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

                if (column === 'term') {
                    aVal = a.term || '';
                    bVal = b.term || '';
                    return currentSort.direction === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                } else if (column === 'index') {
                    aVal = (a.index || '').toString();
                    bVal = (b.index || '').toString();
                    return currentSort.direction === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                } else if (column === 'lastCalled') {
                    aVal = a.lastCalled ? new Date(a.lastCalled).getTime() : 0;
                    bVal = b.lastCalled ? new Date(b.lastCalled).getTime() : 0;
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
            const analyticsCount = document.getElementById('analyticsCount');

            if (!analyticsData || analyticsData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No analytics data available</p>
                        </td>
                    </tr>
                `;
                if (analyticsCount) analyticsCount.textContent = '0';
                return;
            }

            // Build table rows
            const rows = analyticsData.map(item => {
                const lastCalled = item.lastCalled ? new Date(item.lastCalled).toLocaleString() : 'N/A';
                const indexName = item.index ? escapeHtml(item.index) : 'default';

                return `
                    <tr>
                        <td>${escapeHtml(item.term)}</td>
                        <td>${indexName}</td>
                        <td style="text-align: right;">${item.callCount || 0}</td>
                        <td style="text-align: right;">${item.totalResults || 0}</td>
                        <td>${lastCalled}</td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;
            if (analyticsCount) analyticsCount.textContent = analyticsData.length;
        }

        async function refreshAnalytics() {
            const tbody = document.getElementById('analyticsTableBody');

            // Show loading state
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-muted py-4">
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
                updateStatsCards(data);
                analyticsData = (data.searchTerms || []).map(entry => ({
                    ...entry,
                    index: entry.index || (data.operations && data.operations.index) || 'default'
                }));

                // Sort by call count by default
                sortTable('callCount');
            } else {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center text-danger py-4">
                            <i class="bi bi-exclamation-triangle fs-4"></i>
                            <p class="mb-0 mt-2">Error loading analytics data. Make sure you are signed in.</p>
                        </td>
                    </tr>
                `;
            }
        }

        // Form handlers
        document.getElementById('addForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const doc = document.getElementById('addDocument').value;
            const searchContainer = currentIndex;

            if (!validateJSON('addDocument')) {
                showAlert('Please enter a valid JSON document', 'error');
                return;
            }

            try {
                setLoading('addForm', true);
                const parsedDoc = JSON.parse(doc);

                let url = '/services/searching/api/add';
                if (searchContainer) {
                    url += `?searchContainer=${encodeURIComponent(searchContainer)}`;
                }

                const result = await makeRequest(url, 'POST', parsedDoc);
                showResponse('addResponse', 'addResponseContent', result);
                showAlert(`Document added successfully to index: ${searchContainer || 'default'}`);

                // Refresh analytics and index stats
                if (document.getElementById('dashboard').classList.contains('show')) {
                    refreshAnalytics();
                }
                await refreshIndexStats();
            } catch (error) {
                showAlert('Error adding document: ' + error.message, 'error');
                showResponse('addResponse', 'addResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('addForm', false);
            }
        });

        document.getElementById('searchForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const term = document.getElementById('searchTerm').value;
            const searchContainer = currentIndex;

            try {
                setLoading('searchForm', true);

                let url = `/services/searching/api/search/${encodeURIComponent(term)}`;
                if (searchContainer) {
                    url += `?searchContainer=${encodeURIComponent(searchContainer)}`;
                }

                const result = await makeRequest(url);
                showResponse('searchResponse', 'searchResponseContent', result);
                showAlert(`Search completed for term: ${term} in index: ${searchContainer || 'all'}`);

                // Refresh analytics
                if (document.getElementById('dashboard').classList.contains('show')) {
                    refreshAnalytics();
                }
            } catch (error) {
                showAlert('Error searching documents: ' + error.message, 'error');
                showResponse('searchResponse', 'searchResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('searchForm', false);
            }
        });

        document.getElementById('deleteForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const key = document.getElementById('deleteKey').value;
            const searchContainer = currentIndex;

            if (!confirm(`Are you sure you want to delete document with key: ${key}?`)) {
                return;
            }

            try {
                setLoading('deleteForm', true);

                let url = `/services/searching/api/delete/${encodeURIComponent(key)}`;
                if (searchContainer) {
                    url += `?searchContainer=${encodeURIComponent(searchContainer)}`;
                }

                const result = await makeRequest(url, 'DELETE');
                showResponse('deleteResponse', 'deleteResponseContent', result);
                showAlert(`Document with key: ${key} deleted successfully from index: ${searchContainer || 'default'}`);

                // Refresh analytics and index stats
                if (document.getElementById('dashboard').classList.contains('show')) {
                    refreshAnalytics();
                }
                await refreshIndexStats();
            } catch (error) {
                showAlert('Error deleting document: ' + error.message, 'error');
                showResponse('deleteResponse', 'deleteResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('deleteForm', false);
            }
        });

        document.getElementById('createIndexForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const searchContainer = document.getElementById('newIndexName').value.trim();
            await createIndex(searchContainer);
        });

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/searching/api/status');
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

        // Load index stats on data operations tab activation
        document.getElementById('data-tab')?.addEventListener('shown.bs.tab', function (e) {
            refreshIndexStats();
        });

        // Swagger UI setup
        const spec = {
            openapi: '3.0.0',
            info: {
                title: 'Searching API',
                description: 'REST API for searching operations with multi-index support',
                version: '1.0.0'
            },
            servers: [
                { url: '/services/searching/api', description: 'Searching API' }
            ],
            paths: {
                '/add': {
                    post: {
                        summary: 'Add a document',
                        description: 'Adds a new document to the search index',
                        parameters: [
                            {
                                name: 'searchContainer',
                                in: 'query',
                                required: false,
                                schema: { type: 'string' },
                                description: 'Name of the index to add the document to'
                            }
                        ],
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                    example: { "title": "My Document", "content": "This is the content." }
                                }
                            }
                        },
                        responses: {
                            '200': {
                                description: 'Document added successfully',
                                content: {
                                    'application/json': { schema: { type: 'object', properties: { key: { type: 'string' } } } }
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
                '/search/{term}': {
                    get: {
                        summary: 'Search documents',
                        description: 'Searches for documents matching the term',
                        parameters: [
                            {
                                name: 'term',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The term to search for'
                            },
                            {
                                name: 'searchContainer',
                                in: 'query',
                                required: false,
                                schema: { type: 'string' },
                                description: 'Name of the index to search in'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Search results',
                                content: {
                                    'application/json': { schema: { type: 'array', items: { type: 'object' } } }
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
                '/delete/{key}': {
                    delete: {
                        summary: 'Delete a document',
                        description: 'Deletes a document from the search index',
                        parameters: [
                            {
                                name: 'key',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'The key of the document to delete'
                            },
                            {
                                name: 'searchContainer',
                                in: 'query',
                                required: false,
                                schema: { type: 'string' },
                                description: 'Name of the index to delete from'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Document deleted successfully',
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
                '/indexes': {
                    get: {
                        summary: 'List all indexes',
                        description: 'Get a list of all available search indexes',
                        responses: {
                            '200': {
                                description: 'List of indexes',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                indexes: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            name: { type: 'string' },
                                                            count: { type: 'number' }
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
                },
                '/indexes/{searchContainer}': {
                    delete: {
                        summary: 'Delete an index',
                        description: 'Deletes an entire index and all its documents',
                        parameters: [
                            {
                                name: 'searchContainer',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'Name of the index to delete'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Index deleted successfully'
                            }
                        }
                    }
                },
                '/indexes/{searchContainer}/clear': {
                    delete: {
                        summary: 'Clear an index',
                        description: 'Removes all documents from an index',
                        parameters: [
                            {
                                name: 'searchContainer',
                                in: 'path',
                                required: true,
                                schema: { type: 'string' },
                                description: 'Name of the index to clear'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Index cleared successfully'
                            }
                        }
                    }
                },
                '/status': {
                    get: {
                        summary: 'Service status',
                        description: 'Check if the searching service is running',
                        responses: {
                            '200': {
                                description: 'Service is running',
                                content: {
                                    'application/json': {
                                        schema: { type: 'string', example: 'searching api running' }
                                    }
                                }
                            }
                        }
                    }
                },
                '/analytics': {
                    get: {
                        summary: 'Get search analytics',
                        description: 'Retrieves analytics data for search operations',
                        parameters: [
                            {
                                name: 'searchContainer',
                                in: 'query',
                                required: false,
                                schema: { type: 'string' },
                                description: 'Filter analytics by index name'
                            }
                        ],
                        responses: {
                            '200': {
                                description: 'Analytics retrieved successfully',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                operations: {
                                                    type: 'object',
                                                    properties: {
                                                        adds: { type: 'number', example: 10 },
                                                        deletes: { type: 'number', example: 5 },
                                                        searches: { type: 'number', example: 30 }
                                                    }
                                                },
                                                searchTerms: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            term: { type: 'string', example: 'test' },
                                                            callCount: { type: 'number', example: 10 },
                                                            totalResults: { type: 'number', example: 25 },
                                                            lastCalled: { type: 'string', example: '2025-10-11T00:00:00.000Z' }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            '401': {
                                description: 'Unauthorized - sign in first',
                                content: {
                                    'application/json': {
                                        schema: {
                                            type: 'object',
                                            properties: {
                                                error: { type: 'string' }
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

        // Initialize Swagger UI and load initial data
        window.onload = async function() {
            checkStatus();
            await loadIndexSelector();
            refreshAnalytics();
            refreshIndexStats();

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

        // ==================== Search UI Functionality ==================== //
        // Initialize search service for the UI tab
        let suggestionsTimeout = null;
        let currentSearchIndex = '';

        // Debounce function for search suggestions
        function debounce(func, delay) {
            return function() {
                clearTimeout(suggestionsTimeout);
                suggestionsTimeout = setTimeout(func, delay);
            };
        }

        // Search box event listeners
        const searchBox = document.getElementById('uiSearchBox');
        const suggestionsDropdown = document.getElementById('searchSuggestions');
        const resultsContainer = document.getElementById('searchResultsContainer');
        const resultsSummary = document.getElementById('resultsSummary');
        const clearResultsBtn = document.getElementById('clearResultsBtn');
        const searchIndexSelect = document.getElementById('uiSearchIndex');
        const refreshIndexBtn = document.getElementById('uiRefreshIndexBtn');

        // Load available indexes on page load
        async function loadSearchIndexes() {
            try {
                const response = await fetch('/services/searching/api/indexes');
                const data = await response.json();
                const indexes = data.indexes || [];

                // Clear existing options except the default one
                searchIndexSelect.innerHTML = '<option value="">All Indexes (Default)</option>';

                // Add index options
                indexes.forEach(index => {
                    const option = document.createElement('option');
                    option.value = index.name;
                    option.textContent = `${index.name} (${index.count} documents)`;
                    searchIndexSelect.appendChild(option);
                });
            } catch (error) {
                console.error('Error loading indexes:', error);
            }
        }

        // Handle index selection change
        if (searchIndexSelect) {
            searchIndexSelect.addEventListener('change', function() {
                currentSearchIndex = this.value;
            });
        }

        // Handle refresh indexes button
        if (refreshIndexBtn) {
            refreshIndexBtn.addEventListener('click', function() {
                loadSearchIndexes();
            });
        }

        // Load indexes when UI tab is shown
        document.getElementById('ui-tab')?.addEventListener('shown.bs.tab', function() {
            loadSearchIndexes();
        });

        if (searchBox) {
            // Handle keyup for suggestions
            searchBox.addEventListener('keyup', debounce(async function() {
                const term = searchBox.value.trim();

                if (term.length < 2) {
                    suggestionsDropdown.style.display = 'none';
                    return;
                }

                try {
                    // Search and get suggestions
                    let url = `/services/searching/api/search/${encodeURIComponent(term)}`;
                    if (currentSearchIndex) {
                        url += `?searchContainer=${encodeURIComponent(currentSearchIndex)}`;
                    }
                    const results = await fetch(url)
                        .then(r => r.json());

                    if (Array.isArray(results) && results.length > 0) {
                        // Show suggestions
                        const suggestions = results.slice(0, 5).map((item, index) => {
                            let displayText = '';
                            if (typeof item === 'object') {
                                // Try to get a meaningful representation
                                for (let key in item) {
                                    if (item[key] && typeof item[key] === 'string') {
                                        displayText = item[key];
                                        break;
                                    }
                                }
                            } else {
                                displayText = String(item);
                            }

                            return `<div class="search-suggestion-item" style="padding: 10px 15px; cursor: pointer; border-bottom: 1px solid #f0f0f0; hover: background-color: #f9f9f9;" data-onclick="selectSuggestion" data-onclick-args="${nooblyArgs(displayText)}">
                                <i class="bi bi-search" style="margin-right: 8px; color: #666;"></i>
                                <span>${escapeHtml(displayText)}</span>
                            </div>`;
                        }).join('');

                        suggestionsDropdown.innerHTML = suggestions;
                        suggestionsDropdown.style.display = 'block';
                    } else {
                        suggestionsDropdown.style.display = 'none';
                    }
                } catch (error) {
                    console.error('Error fetching suggestions:', error);
                    suggestionsDropdown.style.display = 'none';
                }
            }, 300));

            // Handle Enter key
            searchBox.addEventListener('keypress', async function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const term = searchBox.value.trim();
                    if (term) {
                        await performSearch(term);
                        suggestionsDropdown.style.display = 'none';
                    }
                }
            });

            // Hide suggestions when clicking outside
            document.addEventListener('click', function(e) {
                if (!searchBox.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
                    suggestionsDropdown.style.display = 'none';
                }
            });
        }

        // Perform search
        async function performSearch(term) {
            try {
                resultsContainer.innerHTML = '<div style="text-align: center; color: #999;"><i class="bi bi-hourglass-split"></i> Searching...</div>';

                let url = `/services/searching/api/search/${encodeURIComponent(term)}`;
                if (currentSearchIndex) {
                    url += `?searchContainer=${encodeURIComponent(currentSearchIndex)}`;
                }
                const results = await fetch(url)
                    .then(r => r.json());

                displaySearchResults(results, term);
            } catch (error) {
                resultsContainer.innerHTML = `<div style="color: #d32f2f; text-align: center;"><i class="bi bi-exclamation-triangle"></i> <p>Error performing search</p></div>`;
                console.error('Search error:', error);
            }
        }

        // Display search results
        function displaySearchResults(results, searchTerm) {
            if (!results || results.length === 0) {
                const indexInfo = currentSearchIndex ? ` in "${currentSearchIndex}"` : '';
                resultsSummary.textContent = `No results found for "${searchTerm}"${indexInfo}`;
                clearResultsBtn.style.display = 'none';
                resultsContainer.innerHTML = `<div style="text-align: center; color: #999;">
                    <i class="bi bi-inbox fs-3"></i>
                    <p class="mt-3">No documents found matching "${escapeHtml(searchTerm)}"${indexInfo}</p>
                </div>`;
                return;
            }

            const indexInfo = currentSearchIndex ? ` in "${currentSearchIndex}"` : '';
            resultsSummary.textContent = `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${searchTerm}"${indexInfo}`;
            clearResultsBtn.style.display = 'block';

            const resultsHtml = results.slice(0, 20).map((item, index) => {
                const itemContent = typeof item === 'object'
                    ? Object.entries(item)
                        .filter(([key]) => !key.startsWith('_'))
                        .map(([key, value]) => `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value).substring(0, 100))}</div>`)
                        .join('')
                    : `<div>${escapeHtml(String(item))}</div>`;

                return `<div style="padding: 12px; border: 1px solid #e0e0e0; border-radius: 4px; margin-bottom: 10px; background: #fafafa; cursor: pointer;" data-onclick="showResultDetail" data-onclick-args="${nooblyArgs(index)}">
                    ${itemContent}
                </div>`;
            }).join('');

            resultsContainer.innerHTML = resultsHtml;
            resultsContainer.style.display = 'block';

            // Raise event for application to handle
            window.dispatchEvent(new CustomEvent('searchUIResults', {
                detail: { results, searchTerm }
            }));
        }

        // Select suggestion
        function selectSuggestion(suggestion) {
            searchBox.value = suggestion;
            suggestionsDropdown.style.display = 'none';
            performSearch(suggestion);
        }

        // Clear results
        if (clearResultsBtn) {
            clearResultsBtn.addEventListener('click', function() {
                searchBox.value = '';
                resultsContainer.innerHTML = '<div style="text-align: center; text-muted;"><i class="bi bi-search fs-1"></i><p class="mt-3">No search results yet</p></div>';
                resultsSummary.textContent = 'Enter a search term to get started';
                clearResultsBtn.style.display = 'none';
            });
        }

        // Show result detail
        function showResultDetail(index) {
            // Raise event for application to handle result selection
            window.dispatchEvent(new CustomEvent('searchUIResultSelected', {
                detail: { index }
            }));
        }

        // ==================== Settings Functionality ==================== //
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/searching/api/settings');
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
        document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
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
                const response = await fetch('/services/searching/api/settings', {
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

        // ==================== Global Index Selector ==================== //
        // Changing the top-right index selector refreshes data and context
        // for the selected index across the Dashboard, Data and Settings tabs.
        document.getElementById('indexSelector')?.addEventListener('change', function () {
            currentIndex = this.value;
            showAlert(`Active index set to: ${currentIndex || 'default'}`);
            applyIndexContext();
        });

        document.getElementById('refreshIndexSelectorBtn')?.addEventListener('click', async function (e) {
            e.preventDefault();
            await loadIndexSelector();
            applyIndexContext();
        });
    
