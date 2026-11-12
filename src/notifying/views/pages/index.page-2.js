        // Global variable to track current instance
        let currentInstance = 'default';
        const numberFormatter = new Intl.NumberFormat();

        /**
         * Gets the current instance name
         * @returns {string} The selected instance name
         */
        function getCurrentInstance() {
            const select = document.getElementById('instanceSelect');
            return select ? select.value : 'default';
        }

        /**
         * Gets the API path for instance-specific endpoints
         * @param {string} basePath - The base API path
         * @returns {string} The full API path with instance if not default
         */
        function getInstanceApiPath(basePath) {
            const instance = getCurrentInstance();
            if (instance === 'default') {
                return basePath;
            }
            // Insert instance name after /api/ in the path
            return basePath.replace('/api/', `/api/${instance}/`);
        }

        /**
         * Loads available instances and populates the dropdown
         */
        async function loadInstances() {
            try {
                const response = await fetch('/services/notifying/api/instances');
                if (!response.ok) {
                    throw new Error(`Failed to load instances: ${response.status}`);
                }
                const data = await response.json();
                const instances = data.instances || ['default'];

                const select = document.getElementById('instanceSelect');
                if (select) {
                    const currentValue = select.value;
                    select.innerHTML = '';
                    instances.forEach((instance) => {
                        const option = document.createElement('option');
                        option.value = instance;
                        option.textContent = instance;
                        select.appendChild(option);
                    });
                    if (instances.includes(currentValue)) {
                        select.value = currentValue;
                    } else {
                        select.value = 'default';
                    }
                }
            } catch (error) {
                console.error('Error loading instances:', error);
            }
        }

        function formatNumber(value) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return '0';
            }
            return numberFormatter.format(value);
        }

        function formatDate(value) {
            if (!value) {
                return '—';
            }
            try {
                return new Date(value).toLocaleString();
            } catch (error) {
                return value;
            }
        }

        function validateJSON(elementId) {
            const element = document.getElementById(elementId);
            const validation = document.getElementById(elementId.replace('Message', 'Validation'));
            if (!element || !validation) {
                return true;
            }

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
            } catch (error) {
                element.classList.remove('json-valid');
                element.classList.add('json-invalid');
                validation.textContent = '✗ Invalid JSON: ' + error.message;
                validation.className = 'core-validation-message validation-error';
                validation.style.display = 'block';
                return false;
            }
        }

        function showAlert(message, type = 'success') {
            const alertElement = document.getElementById(type + 'Alert');
            const messageElement = document.getElementById(type + 'Message');
            if (!alertElement || !messageElement) {
                return;
            }
            messageElement.textContent = message;
            alertElement.classList.add('show');
            setTimeout(() => alertElement.classList.remove('show'), 5000);
        }

        function showResponse(containerId, contentId, data) {
            const container = document.getElementById(containerId);
            const content = document.getElementById(contentId);
            if (!container || !content) {
                return;
            }
            content.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            container.style.display = 'block';
        }

        function setLoading(elementId, isLoading) {
            const element = document.getElementById(elementId);
            if (!element) {
                return;
            }
            element.classList.toggle('loading', Boolean(isLoading));
        }


        function toggleAnalyticsLoading(isLoading) {
            const button = document.getElementById('analyticsRefreshButton');
            const spinner = document.getElementById('analyticsRefreshSpinner');
            if (button) {
                button.disabled = Boolean(isLoading);
            }
            if (spinner) {
                spinner.classList.toggle('d-none', !isLoading);
            }
        }

        function setAnalyticsPlaceholders() {
            const list = document.getElementById('topTopicsList');
            const tableBody = document.getElementById('topicsTableBody');
            if (list) {
                list.innerHTML = `
                    <div class="list-group-item loading-row">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        Loading topics...
                    </div>`;
            }
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr class="loading-row">
                        <td colspan="4">
                            <div class="spinner-border spinner-border-sm me-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            Loading topics...
                        </td>
                    </tr>`;
            }
            const rowCount = document.getElementById('topicsRowCount');
            if (rowCount) {
                rowCount.textContent = '0';
            }
        }

        async function fetchAnalytics(url) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed request with status ${response.status}`);
            }
            return response.json();
        }

        function updateInstanceDisplay() {
            const instanceBadge = document.getElementById('instanceBadge');
            if (instanceBadge) {
                instanceBadge.textContent = getCurrentInstance();
            }
        }

        function renderOverview(data) {
            const {
                topics = 0,
                subscribers = 0,
                notifications = 0,
                lastNotificationAt = null,
            } = data || {};

            const totalTopics = document.getElementById('totalTopics');
            const totalSubscribers = document.getElementById('totalSubscribers');
            const totalNotifications = document.getElementById('totalNotifications');
            const lastNotification = document.getElementById('lastNotification');

            if (totalTopics) totalTopics.textContent = formatNumber(topics);
            if (totalSubscribers) totalSubscribers.textContent = formatNumber(subscribers);
            if (totalNotifications) totalNotifications.textContent = formatNumber(notifications);
            if (lastNotification) lastNotification.textContent = formatDate(lastNotificationAt);

            // Update instance display
            updateInstanceDisplay();
        }

        function renderTopTopics(topics) {
            const list = document.getElementById('topTopicsList');
            const emptyDiv = document.getElementById('topTopicsEmpty');
            if (!list) {
                return;
            }

            list.innerHTML = '';

            if (!topics || topics.length === 0) {
                list.style.display = 'none';
                if (emptyDiv) emptyDiv.style.display = 'flex';
                return;
            }

            list.style.display = 'block';
            if (emptyDiv) emptyDiv.style.display = 'none';

            topics.forEach((topic, index) => {
                const item = document.createElement('div');
                item.className = 'list-group-item d-flex justify-content-between align-items-center';

                const details = document.createElement('div');
                const name = document.createElement('div');
                name.className = 'fw-semibold';
                name.textContent = `${index + 1}. ${topic.topic}`;

                const meta = document.createElement('div');
                meta.className = 'text-muted small';
                meta.textContent = `Subscribers: ${formatNumber(topic.subscriberCount)} • Posts: ${formatNumber(topic.notificationCount)} • Last post: ${formatDate(topic.lastNotificationAt)}`;

                details.appendChild(name);
                details.appendChild(meta);

                const badge = document.createElement('span');
                badge.className = 'badge bg-secondary rounded-pill';
                badge.textContent = formatNumber(topic.notificationCount);

                item.appendChild(details);
                item.appendChild(badge);

                list.appendChild(item);
            });
        }

        function renderTopicsTable(topics) {
            const tableBody = document.getElementById('topicsTableBody');
            const rowCount = document.getElementById('topicsRowCount');
            if (!tableBody) {
                return;
            }

            tableBody.innerHTML = '';

            if (!topics || topics.length === 0) {
                tableBody.innerHTML = `
                    <tr class="loading-row">
                        <td colspan="4">No topic activity recorded yet.</td>
                    </tr>`;
                if (rowCount) {
                    rowCount.textContent = '0';
                }
                return;
            }

            topics.forEach((topic) => {
                const row = document.createElement('tr');

                const topicCell = document.createElement('td');
                topicCell.textContent = topic.topic;

                const subscribersCell = document.createElement('td');
                subscribersCell.textContent = formatNumber(topic.subscriberCount);

                const notificationsCell = document.createElement('td');
                notificationsCell.textContent = formatNumber(topic.notificationCount);

                const lastPostCell = document.createElement('td');
                lastPostCell.textContent = formatDate(topic.lastNotificationAt);

                row.appendChild(topicCell);
                row.appendChild(subscribersCell);
                row.appendChild(notificationsCell);
                row.appendChild(lastPostCell);
                tableBody.appendChild(row);
            });

            if (rowCount) {
                rowCount.textContent = String(topics.length);
            }
        }

        async function loadAnalytics() {
            toggleAnalyticsLoading(true);
            setAnalyticsPlaceholders();
            try {
                const [overview, topTopicsPayload, topicsPayload] = await Promise.all([
                    fetchAnalytics(getInstanceApiPath('/services/notifying/api/analytics/overview')),
                    fetchAnalytics(getInstanceApiPath('/services/notifying/api/analytics/top-topics?limit=10')),
                    fetchAnalytics(getInstanceApiPath('/services/notifying/api/analytics/topics?limit=100')),
                ]);

                renderOverview(overview);
                renderTopTopics((topTopicsPayload && topTopicsPayload.topics) || []);
                renderTopicsTable((topicsPayload && topicsPayload.topics) || []);
            } catch (error) {
                showAlert('Error loading analytics: ' + error.message, 'error');
            } finally {
                toggleAnalyticsLoading(false);
            }
        }

        async function checkStatus() {
            try {
                const instanceName = getCurrentInstance();
                const notifying = new nooblyjsNotifying({ instanceName });
                const result = await notifying.getStatus();
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        async function initializeSwagger() {
            try {
                // Fetch the Swagger specification from the API endpoint
                const response = await fetch(getInstanceApiPath('/services/notifying/api/swagger/docs.json'));
                if (!response.ok) {
                    throw new Error(`Failed to load Swagger docs: ${response.status}`);
                }
                const spec = await response.json();

                // Initialize Swagger UI with the fetched specification
                SwaggerUIBundle({
                    spec,
                    dom_id: '#swagger-ui',
                    deepLinking: true,
                    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.presets.standalone],
                    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
                    layout: 'BaseLayout',
                    tryItOutEnabled: true,
                });
            } catch (error) {
                console.error('Error initializing Swagger UI:', error);
                const swaggerContainer = document.getElementById('swagger-ui');
                if (swaggerContainer) {
                    swaggerContainer.innerHTML =
                        '<p class="text-danger">Error loading API documentation. Please refresh the page.</p>';
                }
            }
        }

        /**
         * Makes the notification left nav resizable via the drag handle, and
         * remembers the chosen width across page loads.
         */
        function initNavResizer() {
            const resizer = document.getElementById('notificationNavResizer');
            const nav = document.getElementById('contentLeftNav');
            if (!resizer || !nav) return;

            const MIN_WIDTH = 150;
            const MAX_WIDTH = 600;

            // Restore a previously saved width.
            const saved = parseInt(localStorage.getItem('notifyingNavWidth'), 10);
            if (!isNaN(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
                nav.style.flex = `0 0 ${saved}px`;
            }

            let dragging = false;
            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (e) => {
                if (!dragging) return;
                let width = startWidth + (e.clientX - startX);
                width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
                nav.style.flex = `0 0 ${width}px`;
            };

            const onMouseUp = () => {
                if (!dragging) return;
                dragging = false;
                resizer.classList.remove('core-resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                const finalWidth = Math.round(nav.getBoundingClientRect().width);
                localStorage.setItem('notifyingNavWidth', String(finalWidth));
            };

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                dragging = true;
                startX = e.clientX;
                startWidth = nav.getBoundingClientRect().width;
                resizer.classList.add('core-resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // Double-click resets to the default width.
            resizer.addEventListener('dblclick', () => {
                nav.style.flex = '';
                localStorage.removeItem('notifyingNavWidth');
            });
        }

        document.addEventListener('DOMContentLoaded', () => {
            // Load instances and set up instance change listener
            loadInstances();

            // Enable left nav resizing in the UI tab
            initNavResizer();

            const instanceSelect = document.getElementById('instanceSelect');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', () => {
                    currentInstance = getCurrentInstance();
                    loadAnalytics();
                    checkStatus();
                    // Store instance preference in localStorage
                    localStorage.setItem('notifying-instance-preference', currentInstance);
                });
            }

            // Restore instance preference from localStorage
            const savedInstance = localStorage.getItem('notifying-instance-preference');
            if (savedInstance && instanceSelect) {
                instanceSelect.value = savedInstance;
                currentInstance = savedInstance;
            }

            const sendMessageInput = document.getElementById('sendMessage');
            if (sendMessageInput) {
                sendMessageInput.addEventListener('input', () => validateJSON('sendMessage'));
            }

            const formatButton = document.getElementById('formatSendButton');
            if (formatButton) {
                formatButton.addEventListener('click', () => {
                    const element = document.getElementById('sendMessage');
                    if (!element) {
                        return;
                    }
                    try {
                        const parsed = JSON.parse(element.value);
                        element.value = JSON.stringify(parsed, null, 2);
                        validateJSON('sendMessage');
                    } catch (error) {
                        showAlert('Invalid JSON cannot be formatted', 'error');
                    }
                });
            }

            const exampleButton = document.getElementById('exampleSendButton');
            if (exampleButton) {
                exampleButton.addEventListener('click', () => {
                    const element = document.getElementById('sendMessage');
                    if (!element) {
                        return;
                    }
                    const example = {
                        channel: 'sms',
                        recipient: '+1234567890',
                        body: 'Your package has been shipped!',
                    };
                    element.value = JSON.stringify(example, null, 2);
                    validateJSON('sendMessage');
                });
            }

            // Handle Create Topic Form
            const createTopicForm = document.getElementById('createTopicForm');
            if (createTopicForm) {
                createTopicForm.addEventListener('submit', async (event) => {
                    event.preventDefault();

                    try {
                        setLoading('createTopicForm', true);
                        const instanceName = getCurrentInstance();
                        const notifying = new nooblyjsNotifying({ instanceName });
                        const topicName = document.getElementById('topicName').value.trim();

                        if (!topicName) {
                            showAlert('Please enter a topic name', 'error');
                            return;
                        }

                        const result = await notifying.createTopic(topicName);
                        showResponse('createTopicResponse', 'createTopicResponseContent', result);
                        showAlert(`Topic "${topicName}" created successfully`);
                        document.getElementById('topicName').value = '';
                    } catch (error) {
                        showAlert('Error creating topic: ' + error.message, 'error');
                        showResponse('createTopicResponse', 'createTopicResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('createTopicForm', false);
                    }
                });
            }

            // Handle Create Subscriber Form
            const createSubscriberForm = document.getElementById('createSubscriberForm');
            if (createSubscriberForm) {
                createSubscriberForm.addEventListener('submit', async (event) => {
                    event.preventDefault();

                    try {
                        setLoading('createSubscriberForm', true);
                        // JavaScript callback functions are only for local pub/sub, not server-based
                        // So we create a local notifying instance without instanceName
                        const notifying = new nooblyjsNotifying();
                        const topic = document.getElementById('subscriberTopic').value.trim();
                        const callbackFunctionStr = document.getElementById('callbackFunction').value.trim();

                        if (!topic || !callbackFunctionStr) {
                            showAlert('Please enter both topic name and callback function', 'error');
                            return;
                        }

                        // P2-4: Never eval()/new Function() a user-supplied string —
                        // that is arbitrary code execution. For this local pub/sub demo
                        // we attach a safe built-in callback that renders delivered
                        // messages in the UI. The text field is treated as a
                        // human-readable label only and is never executed.
                        const callbackLabel = callbackFunctionStr;
                        const callbackFunction = (message) => {
                            const area = document.getElementById('createSubscriberResponseContent');
                            const entry = '[' + new Date().toISOString() + '] ' + topic + ': '
                                + (typeof message === 'string' ? message : JSON.stringify(message));
                            if (area) {
                                area.textContent = entry + '\n' + (area.textContent || '');
                            }
                            console.log('Notification received', { topic, label: callbackLabel, message });
                        };

                        const result = await notifying.subscribe(topic, callbackFunction);
                        showResponse('createSubscriberResponse', 'createSubscriberResponseContent', result);
                        showAlert(`Subscriber created successfully for topic "${topic}" (Local Service)`);
                        document.getElementById('subscriberTopic').value = '';
                        document.getElementById('callbackFunction').value = '';
                    } catch (error) {
                        showAlert('Error creating subscriber: ' + error.message, 'error');
                        showResponse('createSubscriberResponse', 'createSubscriberResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('createSubscriberForm', false);
                    }
                });
            }

            // Handle Create Server-Side Subscriber Form
            const createServerSubscriberForm = document.getElementById('createServerSubscriberForm');
            if (createServerSubscriberForm) {
                createServerSubscriberForm.addEventListener('submit', async (event) => {
                    event.preventDefault();

                    try {
                        setLoading('createServerSubscriberForm', true);
                        const topic = document.getElementById('serverSubscriberTopic').value.trim();
                        const callbackUrl = document.getElementById('serverCallbackUrl').value.trim();

                        if (!topic || !callbackUrl) {
                            showAlert('Please enter both a topic name and a callback URL', 'error');
                            return;
                        }

                        const url = getInstanceApiPath(
                            '/services/notifying/api/subscribe/topic/' + encodeURIComponent(topic)
                        );
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ callbackUrl })
                        });
                        const result = await response.json();
                        if (!response.ok) {
                            throw new Error(result.error || ('Request failed with status ' + response.status));
                        }

                        showResponse('createServerSubscriberResponse', 'createServerSubscriberResponseContent', result);
                        showAlert(`Server-side subscriber registered for topic "${topic}"`);
                        document.getElementById('serverSubscriberTopic').value = '';
                        document.getElementById('serverCallbackUrl').value = '';
                    } catch (error) {
                        showAlert('Error creating server subscriber: ' + error.message, 'error');
                        showResponse('createServerSubscriberResponse', 'createServerSubscriberResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('createServerSubscriberForm', false);
                    }
                });
            }

            // Handle Load Example button for callback function
            const exampleCallbackButton = document.getElementById('exampleCallbackButton');
            if (exampleCallbackButton) {
                exampleCallbackButton.addEventListener('click', () => {
                    const element = document.getElementById('callbackFunction');
                    if (!element) {
                        return;
                    }
                    const example = `(msg) => {
  console.log('Received message:', msg);
  // You can add your custom logic here
  // Example: update UI, store data, send to server, etc.
}`;
                    element.value = example;
                });
            }

            // Handle Send Notification Form
            const sendForm = document.getElementById('sendForm');
            if (sendForm) {
                sendForm.addEventListener('submit', async (event) => {
                    event.preventDefault();

                    if (!validateJSON('sendMessage')) {
                        showAlert('Please enter a valid JSON notification message', 'error');
                        return;
                    }

                    try {
                        setLoading('sendForm', true);
                        const instanceName = getCurrentInstance();
                        const notifying = new nooblyjsNotifying({ instanceName });
                        const topic = document.getElementById('notificationTopic').value.trim();
                        const message = JSON.parse(document.getElementById('sendMessage').value);

                        if (!topic) {
                            showAlert('Please enter a topic name', 'error');
                            return;
                        }

                        // Use the client library to send notification to the specified topic
                        const result = await notifying.notify(topic, message);
                        showResponse('sendResponse', 'sendResponseContent', result);
                        showAlert(`Notification sent successfully to topic "${topic}"`);
                    } catch (error) {
                        showAlert('Error sending notification: ' + error.message, 'error');
                        showResponse('sendResponse', 'sendResponseContent', 'Error: ' + error.message);
                    } finally {
                        setLoading('sendForm', false);
                    }
                });
            }

            const statusButton = document.getElementById('statusButton');
            if (statusButton) {
                statusButton.addEventListener('click', () => checkStatus());
            }

            const refreshButton = document.getElementById('analyticsRefreshButton');
            if (refreshButton) {
                refreshButton.addEventListener('click', () => loadAnalytics());
            }
        });

        window.addEventListener('load', () => {
            loadAnalytics();
            checkStatus();
            initializeSwagger();
        });
    
        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch(getInstanceApiPath('/services/notifying/api/settings'));
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

                case 'boolean': {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'form-check-input';
                    checkbox.id = 'setting_' + setting.setting;
                    checkbox.name = setting.setting;
                    checkbox.setAttribute('role', 'switch');
                    checkbox.checked = currentValue === true || currentValue === 'true';

                    // Wrap in a Bootstrap switch so the boolean renders as a toggle
                    input = document.createElement('div');
                    input.className = 'form-check form-switch';
                    input.appendChild(checkbox);
                    break;
                }

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
                const response = await fetch(getInstanceApiPath('/services/notifying/api/settings'), {
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

        // Refresh analytics whenever the dashboard tab is shown, so changes made
        // on the Data tab (new topics, posted messages) appear without a manual refresh.
        document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', function (e) {
            loadAnalytics();
        });

        // ============================================================
        // NOTIFICATION UI TAB FUNCTIONALITY
        // ============================================================

        let notificationStore = {
            notifications: [],
            subscriptions: [],
            currentNotification: null,
            currentTopic: null,
            currentFolder: 'inbox'
        };

        /**
         * Toggle right panel visibility
         */
        function toggleRightPanel() {
            const panel = document.getElementById('contentRightNav');
            if (panel) {
                panel.classList.toggle('open');
            }
        }

        /**
         * Fetch notifications from API
         */
        async function fetchNotificationsFromAPI() {
            try {
                const response = await fetch(getInstanceApiPath('/services/notifying/api/notifications'));
                if (!response.ok) {
                    console.warn('API not available, no notifications to display');
                    return [];
                }

                const data = await response.json();
                if (data.success && data.notifications) {
                    return data.notifications.sort((a, b) => b.timestamp - a.timestamp);
                }
                return [];
            } catch (error) {
                console.warn('Could not fetch notifications from API:', error.message);
                return [];
            }
        }

        /**
         * Fetch subscription topics from API
         */
        async function fetchSubscriptionsFromAPI() {
            try {
                const response = await fetch('/api/notifications/stats');
                if (!response.ok) {
                    return [];
                }

                const data = await response.json();
                if (data.messagesByTopic) {
                    return Object.keys(data.messagesByTopic);
                }
                return [];
            } catch (error) {
                console.warn('Could not fetch subscriptions from API:', error.message);
                return [];
            }
        }

        /**
         * Initialize the notification UI
         */
        async function initializeNotificationUI() {
            // Fetch real data from API
            const notifications = await fetchNotificationsFromAPI();
            const subscriptions = await fetchSubscriptionsFromAPI();

            notificationStore.notifications = notifications;
            notificationStore.subscriptions = subscriptions.length > 0 ? subscriptions : [];

            // Setup event listeners
            setupFolderListeners();
            setupSearchListener();
            setupSubscriptionForm();
            setupPostToTopicForm();
            setupNotificationActions();
            setupRightPanel();

            // Update folder counts
            updateFolderCounts();

            // Refresh notifications every 5 seconds
            setInterval(refreshNotifications, 5000);
        }

        /**
         * Update folder counts without expanding them
         */
        function updateFolderCounts() {
            const inboxCount = notificationStore.notifications.filter(n => !n.read).length;
            const readCount = notificationStore.notifications.filter(n => n.read).length;

            const inboxCountEl = document.getElementById('inboxCount');
            const readCountEl = document.getElementById('readCount');
            if (inboxCountEl) inboxCountEl.textContent = inboxCount;
            if (readCountEl) readCountEl.textContent = readCount;
        }

        /**
         * Refresh notifications from API
         */
        async function refreshNotifications() {
            try {
                const response = await fetch(getInstanceApiPath('/services/notifying/api/notifications'));
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.notifications) {
                        // Preserve client-side read state across refreshes so that
                        // the 5s poll does not reset notifications the user has read.
                        const readState = new Map(
                            notificationStore.notifications.map(n => [n.id, n.read])
                        );
                        notificationStore.notifications = data.notifications
                            .map(n => ({ ...n, read: readState.has(n.id) ? readState.get(n.id) : n.read }))
                            .sort((a, b) => b.timestamp - a.timestamp);

                        // Update folder counts
                        updateFolderCounts();

                        // Refresh current topic view if one is selected
                        if (notificationStore.currentTopic && notificationStore.currentFolder) {
                            loadNotificationsForTopic(notificationStore.currentTopic, notificationStore.currentFolder);
                        }

                        // Refresh expanded folder if any
                        const expandedFolders = document.querySelectorAll('.notification-folder-content[style*="display: block"]');
                        expandedFolders.forEach(folderContent => {
                            const folderName = folderContent.id.replace('-topics', '');
                            loadTopicsForFolder(folderName);
                        });
                    }
                }
            } catch (error) {
                console.warn('Error refreshing notifications:', error.message);
            }
        }

        /**
         * Setup folder click listeners
         */
        function setupFolderListeners() {
            // Folders are now handled by toggleFolder function
        }

        /**
         * Toggle folder expansion
         */
        function toggleFolder(folderName) {
            const folderContent = document.getElementById(`${folderName}-topics`);
            const toggleIcon = document.getElementById(`${folderName}-toggle`);

            if (!folderContent) return;

            const isOpen = folderContent.style.display !== 'none';

            if (isOpen) {
                folderContent.style.display = 'none';
                toggleIcon.classList.remove('rotated');
            } else {
                folderContent.style.display = 'block';
                toggleIcon.classList.add('rotated');
                loadTopicsForFolder(folderName);
            }
        }

        /**
         * Load topics for a specific folder
         */
        function loadTopicsForFolder(folderName) {
            const folderContent = document.getElementById(`${folderName}-topics`);
            if (!folderContent) return;

            // Get notifications for this folder
            const folderNotifications = folderName === 'inbox'
                ? notificationStore.notifications.filter(n => !n.read)
                : notificationStore.notifications.filter(n => n.read);

            // Get unique topics
            const topicMap = {};
            folderNotifications.forEach(notification => {
                if (!topicMap[notification.topic]) {
                    const topicNotifs = folderNotifications.filter(n => n.topic === notification.topic);
                    topicMap[notification.topic] = topicNotifs.length;
                }
            });

            // Update folder count
            const countEl = document.getElementById(`${folderName}Count`);
            if (countEl) countEl.textContent = folderNotifications.length;

            // Render topics
            if (Object.keys(topicMap).length === 0) {
                folderContent.innerHTML = '<div style="padding: 0.5rem 1rem; color: #999; font-size: 0.9rem;">No notifications</div>';
                return;
            }

            folderContent.innerHTML = Object.entries(topicMap)
                .sort((a, b) => b[1] - a[1])
                .map(([topic, count]) => `
                    <div class="topic-item" data-topic="${topic}" data-folder="${folderName}">
                        <span class="topic-item-name">${topic}</span>
                        <span class="topic-item-count">${count}</span>
                    </div>
                `).join('');

            // Setup topic click listeners
            folderContent.querySelectorAll('.topic-item').forEach(item => {
                item.addEventListener('click', () => {
                    const topic = item.dataset.topic;
                    const folder = item.dataset.folder;

                    // Update active state
                    document.querySelectorAll('.topic-item').forEach(t => t.classList.remove('active'));
                    item.classList.add('active');

                    // Load notifications for this topic
                    loadNotificationsForTopic(topic, folder);
                });
            });
        }

        /**
         * Get notifications for the current folder
         */
        function getNotificationsForFolder(folder) {
            if (folder === 'inbox') {
                return notificationStore.notifications.filter(n => !n.read);
            } else if (folder === 'read') {
                return notificationStore.notifications.filter(n => n.read);
            }
            return notificationStore.notifications;
        }

        /**
         * Get unique topics for the current folder
         */
        function getTopicsForFolder(folder) {
            const folderNotifications = getNotificationsForFolder(folder);
            const topicMap = {};

            folderNotifications.forEach(notification => {
                if (!topicMap[notification.topic]) {
                    const unreadCount = folderNotifications.filter(n => n.topic === notification.topic && !n.read).length;
                    const totalCount = folderNotifications.filter(n => n.topic === notification.topic).length;

                    topicMap[notification.topic] = {
                        name: notification.topic,
                        total: totalCount,
                        unread: unreadCount
                    };
                }
            });

            return Object.values(topicMap).sort((a, b) => b.total - a.total);
        }

        /**
         * Load notifications for a specific topic
         */
        function loadNotificationsForTopic(topicName, folderName) {
            notificationStore.currentTopic = topicName;
            notificationStore.currentFolder = folderName;
            notificationStore.currentNotification = null;

            // Get notifications for this topic and folder
            const folderNotifications = folderName === 'inbox'
                ? notificationStore.notifications.filter(n => !n.read)
                : notificationStore.notifications.filter(n => n.read);

            const topicNotifications = folderNotifications.filter(n => n.topic === topicName);

            const contentBody = document.getElementById('contentBody');
            if (!contentBody) return;

            // Update header
            const titleEl = document.getElementById('contentTitle');
            const subtitleEl = document.getElementById('contentSubtitle');
            if (titleEl) titleEl.textContent = topicName;
            if (subtitleEl) subtitleEl.textContent = `${topicNotifications.length} message${topicNotifications.length !== 1 ? 's' : ''}`;

            if (topicNotifications.length === 0) {
                contentBody.innerHTML = '<div class="no-selection">No messages for this topic</div>';
                return;
            }

            // Render notification list for this topic
            contentBody.innerHTML = `
                <div class="notification-list-by-topic">
                    ${topicNotifications.map(notification => `
                        <div class="notification-item-in-topic ${notification.read ? '' : 'unread'}" data-notification-id="${notification.id}">
                            <div class="notification-item-preview">${notification.message.substring(0, 100)}</div>
                            <div class="notification-item-time">${new Date(notification.timestamp).toLocaleString()}</div>
                        </div>
                    `).join('')}
                </div>
            `;

            // Setup notification item click listeners
            contentBody.querySelectorAll('.notification-item-in-topic').forEach(item => {
                item.addEventListener('click', () => {
                    contentBody.querySelectorAll('.notification-item-in-topic').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');

                    const notificationId = item.dataset.notificationId;
                    const notification = topicNotifications.find(n => n.id === notificationId);
                    if (notification) {
                        loadNotificationDetails(notification);
                    }
                });
            });

            const contentActions = document.getElementById('contentActions');
            if (contentActions) {
                contentActions.style.display = 'none';
            }
        }

        /**
         * Load and display notification details
         */
        function loadNotificationDetails(notification) {
            notificationStore.currentNotification = notification;

            const contentBody = document.getElementById('contentBody');
            if (!contentBody) return;

            // Mark as read automatically
            if (!notification.read) {
                notification.read = true;
                loadNotificationFolder(notificationStore.currentFolder);
            }

            // Render detailed view
            contentBody.innerHTML = `
                <div class="notification-detail-view">
                    <div class="notification-detail-header">
                        <div class="notification-detail-topic">${notification.topic}</div>
                        <div class="notification-detail-title">${notification.message}</div>
                        <div class="notification-detail-time">${new Date(notification.timestamp).toLocaleString()}</div>
                    </div>
                    <div class="notification-detail-content">${notification.fullContent}</div>
                    <div class="notification-detail-actions">
                        <button id="toggleReadDetailBtn">
                            <i class="bi bi-check-circle"></i> Mark as Unread
                        </button>
                        <button id="deleteDetailBtn" style="color: #dc3545; border-color: #dc3545;">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;

            // Setup action buttons
            const toggleBtn = contentBody.querySelector('#toggleReadDetailBtn');
            const deleteBtn = contentBody.querySelector('#deleteDetailBtn');

            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    notification.read = !notification.read;
                    loadNotificationFolder(notificationStore.currentFolder);
                });
            }

            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete this notification?')) {
                        notificationStore.notifications = notificationStore.notifications.filter(n => n.id !== notification.id);
                        loadNotificationFolder(notificationStore.currentFolder);
                    }
                });
            }
        }

        /**
         * Setup search functionality
         */
        function setupSearchListener() {
            const searchInput = document.getElementById('contentSearch');
            if (!searchInput) return;

            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const items = document.querySelectorAll('.notification-list-item');

                items.forEach(item => {
                    const text = item.textContent.toLowerCase();
                    item.style.display = text.includes(query) ? '' : 'none';
                });
            });
        }

        /**
         * Setup notification action buttons (legacy - no longer needed)
         */
        function setupNotificationActions() {
            // Action buttons are now part of the notification detail view
        }

        /**
         * Setup right panel subscriptions
         */
        async function setupRightPanel() {
            await loadSubscriptions();
        }

        /**
         * Load subscriptions in right panel
         */
        async function loadSubscriptions() {
            const panel = document.getElementById('subscriptionsPanel');
            if (!panel) return;

            // If no subscriptions loaded, try to fetch from API
            if (notificationStore.subscriptions.length === 0) {
                notificationStore.subscriptions = await fetchSubscriptionsFromAPI();
            }

            if (notificationStore.subscriptions.length === 0) {
                panel.innerHTML = `
                    <div class="subscription-section">
                        <div class="subscription-section-title">No Subscriptions</div>
                        <p style="color: #999; font-size: 0.9rem; margin-top: 0.5rem;">
                            No active topic subscriptions. Subscribe to a topic to get started.
                        </p>
                    </div>
                `;
            } else {
                panel.innerHTML = `
                    <div class="subscription-section">
                        <div class="subscription-section-title">Active Topics</div>
                        ${notificationStore.subscriptions.map(topic => `
                            <div class="subscription-topic">
                                <span class="subscription-topic-name">${topic}</span>
                                <button class="subscription-btn subscribed" data-onclick="unsubscribeTopic" data-args='[&quot;${topic}&quot;]'>Unsubscribe</button>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        }

        /**
         * Subscribe to a topic
         */
        function subscribeTopic(topic) {
            if (!notificationStore.subscriptions.includes(topic)) {
                notificationStore.subscriptions.push(topic);
                loadSubscriptions();
                showAlert(`Successfully subscribed to "${topic}"`, 'success');
            }
        }

        /**
         * Unsubscribe from a topic
         */
        function unsubscribeTopic(topic) {
            notificationStore.subscriptions = notificationStore.subscriptions.filter(t => t !== topic);
            loadSubscriptions();
            showAlert(`Unsubscribed from "${topic}"`, 'success');
        }

        /**
         * Setup subscription form
         */
        function setupSubscriptionForm() {
            const form = document.getElementById('subscribeForm');
            if (!form) return;

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const topicInput = document.getElementById('topicToSubscribe');
                const topic = topicInput.value.trim();

                if (!topic) {
                    showAlert('Please enter a topic name', 'error');
                    return;
                }

                subscribeTopic(topic);
                topicInput.value = '';

                // Show response
                const responseContainer = document.getElementById('subscribeResponse');
                const responseContent = document.getElementById('subscribeResponseContent');
                if (responseContainer && responseContent) {
                    responseContent.textContent = JSON.stringify({
                        success: true,
                        message: `Successfully subscribed to topic: ${topic}`,
                        subscription: { topic, subscribedAt: new Date().toISOString() }
                    }, null, 2);
                    responseContainer.style.display = 'block';
                }
            });
        }

        /**
         * Setup the post-to-topic form
         */
        function setupPostToTopicForm() {
            const form = document.getElementById('postToTopicForm');
            if (!form) return;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();

                const topicInput = document.getElementById('postTopicName');
                const messageInput = document.getElementById('postTopicMessage');
                const topic = topicInput.value.trim();
                const rawMessage = messageInput.value.trim();

                if (!topic || !rawMessage) {
                    showAlert('Please enter both a topic name and a message', 'error');
                    return;
                }

                // Send valid JSON as an object; otherwise send the raw text.
                let message;
                try {
                    message = JSON.parse(rawMessage);
                } catch (parseError) {
                    message = rawMessage;
                }

                const responseContainer = document.getElementById('postToTopicResponse');
                const responseContent = document.getElementById('postToTopicResponseContent');

                try {
                    const url = getInstanceApiPath(
                        '/services/notifying/api/notify/topic/' + encodeURIComponent(topic)
                    );
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message })
                    });
                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || ('Request failed with status ' + response.status));
                    }

                    if (responseContainer && responseContent) {
                        responseContent.textContent = JSON.stringify(result, null, 2);
                        responseContainer.style.display = 'block';
                    }
                    showAlert(`Message posted to "${topic}"`, 'success');
                    messageInput.value = '';

                    // Pull in any new notifications triggered by the post
                    refreshNotifications();
                } catch (error) {
                    if (responseContainer && responseContent) {
                        responseContent.textContent = 'Error: ' + error.message;
                        responseContainer.style.display = 'block';
                    }
                    showAlert('Error posting message: ' + error.message, 'error');
                }
            });
        }

        // Initialize notification UI when the tab is shown
        document.getElementById('ui-tab')?.addEventListener('shown.bs.tab', function (e) {
            initializeNotificationUI();
        });

        
