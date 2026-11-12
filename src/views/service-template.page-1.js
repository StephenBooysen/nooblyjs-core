        // Initialize navigation
        document.addEventListener('DOMContentLoaded', function() {
            if (typeof NooblyJSNavigation !== 'undefined') {
                NooblyJSNavigation.renderNavigation('navigation-sidebar', '[[SERVICE_NAME]]');
            }
        });

        // Shared utility functions
        function showAlert(message, type = 'success') {
            const alertElement = document.getElementById(type + 'Alert');
            const messageElement = document.getElementById(type + 'Message');
            if (messageElement && alertElement) {
                messageElement.textContent = message;
                alertElement.style.display = 'block';
                const alert = new bootstrap.Alert(alertElement);
                setTimeout(() => alert.close(), 5000);
            }
        }

        function showResponse(containerId, contentId, data) {
            const container = document.getElementById(containerId);
            const content = document.getElementById(contentId);
            if (content && container) {
                content.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
                container.style.display = 'block';
            }
        }

        function setLoading(formId, isLoading) {
            const form = document.getElementById(formId);
            if (form) {
                const buttons = form.querySelectorAll('button');
                buttons.forEach(btn => btn.disabled = isLoading);
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Settings form submission handler
        document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();

            try {
                const formData = new FormData(document.getElementById('settingsForm'));
                const payload = {};

                for (let [key, value] of formData.entries()) {
                    payload[key] = value;
                }

                const response = await fetch('./api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload)
                });

                const responseText = await response.text();
                showResponse('settingsSaveResponse', 'settingsSaveResponseContent', responseText);

                if (response.ok) {
                    showAlert('Settings saved successfully', 'success');
                    setTimeout(() => loadSettings(), 1000);
                } else {
                    showAlert('Error saving settings: ' + responseText, 'error');
                }
            } catch (error) {
                showAlert('Error saving settings: ' + error.message, 'error');
                showResponse('settingsSaveResponse', 'settingsSaveResponseContent', 'Error: ' + error.message);
            }
        });

        // Load settings form
        async function loadSettings() {
            try {
                const response = await fetch('./api/settings');
                const data = await response.json();
                renderSettingsForm(data);
            } catch (error) {
                showAlert('Error loading settings: ' + error.message, 'error');
                console.error('Error loading settings:', error);
            }
        }

        function renderSettingsForm(data) {
            const formFieldsContainer = document.getElementById('settingsFormFields');
            formFieldsContainer.innerHTML = '';

            if (data.list && Array.isArray(data.list)) {
                data.list.forEach((setting) => {
                    const formGroup = createFormField(setting, data);
                    formFieldsContainer.appendChild(formGroup);
                });
            }
        }

        function createFormField(setting, settingsData) {
            const formGroup = document.createElement('div');
            formGroup.className = 'mb-3';

            const label = document.createElement('label');
            label.htmlFor = 'setting_' + setting.setting;
            label.textContent = setting.setting;
            formGroup.appendChild(label);

            const currentValue = settingsData[setting.setting] || '';

            let input;
            switch (setting.type) {
                case 'string':
                    input = document.createElement('input');
                    input.type = 'text';
                    input.id = 'setting_' + setting.setting;
                    input.name = setting.setting;
                    input.value = currentValue;
                    break;

                case 'integer':
                case 'number':
                    input = document.createElement('input');
                    input.type = 'number';
                    input.id = 'setting_' + setting.setting;
                    input.name = setting.setting;
                    input.value = currentValue;
                    input.step = setting.type === 'integer' ? '1' : 'any';
                    break;

                case 'list':
                case 'options':
                    input = document.createElement('select');
                    input.id = 'setting_' + setting.setting;
                    input.name = setting.setting;

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
                    input.id = 'setting_' + setting.setting;
                    input.name = setting.setting;
                    input.value = currentValue;
            }

            formGroup.appendChild(input);

            if (setting.description || setting.desciption) {
                const helperText = document.createElement('div');
                helperText.style.fontSize = '12px';
                helperText.style.color = 'var(--neutral-dot)';
                helperText.style.marginTop = '4px';
                helperText.textContent = setting.description || setting.desciption;
                formGroup.appendChild(helperText);
            }

            return formGroup;
        }

        // Load settings when settings tab is shown
        document.getElementById('settings-tab')?.addEventListener('shown.bs.tab', function (e) {
            loadSettings();
        });
    
