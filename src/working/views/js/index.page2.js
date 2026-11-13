        NooblyJSNavigation.renderNavigation('navigation-sidebar', 'working');
    
        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/working/api/settings');
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
                const response = await fetch('/services/working/api/settings', {
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

        
