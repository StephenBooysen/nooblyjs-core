        const numberFormatter = new Intl.NumberFormat();
        let analyticsData = [];
        let currentSort = { column: 'loginCount', direction: 'desc' };
        const DEFAULT_ROLE_OPTIONS = ['admin', 'user', 'guest'];
        let roleOptions = [...DEFAULT_ROLE_OPTIONS];
        let userTableData = [];

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
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return value;
            }
            return date.toLocaleString();
        }

        function capitalize(value) {
            if (!value) {
                return '';
            }
            return value.charAt(0).toUpperCase() + value.slice(1);
        }

        function escapeAttribute(value) {
            return String(value ?? '').replace(/"/g, '&quot;');
        }

        function formatRole(role) {
            return capitalize(role || 'user');
        }

        function populateRoleOptions(selectElement, selectedRole) {
            if (!selectElement) {
                return;
            }
            const optionsHtml = roleOptions.map((role) => {
                const isSelected = role === selectedRole ? ' selected' : '';
                return `<option value="${escapeHtml(role)}"${isSelected}>${escapeHtml(capitalize(role))}</option>`;
            }).join('');
            selectElement.innerHTML = optionsHtml;
        }

        function updateCreatePasswordHelper(message, password) {
            const helper = document.getElementById('createPasswordHelper');
            if (!helper) {
                return;
            }

            if (!message) {
                helper.innerHTML = '';
                return;
            }

            const passwordMarkup = password ? ` <code>${escapeHtml(password)}</code>` : '';
            helper.innerHTML = `${escapeHtml(message)}${passwordMarkup}`;
        }

        function setPasswordFeedback(username, password) {
            const feedback = document.getElementById('userPasswordFeedback');
            if (!feedback) {
                return;
            }

            if (!password) {
                feedback.classList.add('d-none');
                feedback.innerHTML = '';
                return;
            }

            const label = username
                ? `Temporary password for ${escapeHtml(username)}`
                : 'Generated password';

            feedback.innerHTML = `${label}: <code>${escapeHtml(password)}</code>`;
            feedback.classList.remove('d-none');
        }

        function setUserCreationBusy(isBusy) {
            const row = document.getElementById('userCreateRow');
            if (!row) {
                return;
            }
            row.classList.toggle('loading', Boolean(isBusy));
            row.querySelectorAll('input, select, button').forEach((element) => {
                element.disabled = Boolean(isBusy);
            });
        }

        function setRowBusy(row, isBusy) {
            if (!row) {
                return;
            }
            row.classList.toggle('loading', Boolean(isBusy));
            row.querySelectorAll('input, select, button').forEach((element) => {
                element.disabled = Boolean(isBusy);
            });
        }

        function findUserRow(email) {
            const tableBody = document.getElementById('userManagementTableBody');
            if (!tableBody) {
                return null;
            }
            return Array.from(tableBody.querySelectorAll('tr[data-email]')).find(
                (row) => row.dataset.email === email
            ) || null;
        }

        function isUnauthorized(error) {
            return Boolean(error && Number(error.status) === 401);
        }

        function showAuthRequiredAlert() {
            showAlert('Please sign in with an authorized account to manage users.', 'error');
        }

        function renderUserRow(user) {
            const fullName = user.fullName ? escapeHtml(user.fullName) : '—';
            const email = user.email ? escapeHtml(user.email) : '—';
            const emailAttr = escapeAttribute(user.email || '');
            const roleLabel = escapeHtml(formatRole(user.role));
            const statusBadge = user.isActive
                ? '<span class="badge text-bg-success">Active</span>'
                : '<span class="badge text-bg-secondary">Inactive</span>';
            const createdAt = escapeHtml(formatDate(user.createdAt));
            const lastLogin = escapeHtml(formatDate(user.lastLogin));

            return `
                <tr data-email="${emailAttr}">
                    <td>${fullName}</td>
                    <td>${email}</td>
                    <td>${roleLabel}</td>
                    <td>${statusBadge}</td>
                    <td>${createdAt}</td>
                    <td>${lastLogin}</td>
                    <td class="text-end">
                        <div class="user-action-buttons">
                            <button type="button" class="btn btn-outline-primary btn-sm js-user-edit">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            <button type="button" class="btn btn-outline-secondary btn-sm js-user-reset">
                                <i class="bi bi-shield-lock"></i> Reset Password
                            </button>
                            <button type="button" class="btn btn-outline-danger btn-sm js-user-delete">
                                <i class="bi bi-trash"></i> Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }

        function renderUserManagementTable(users, options = {}) {
            const tableBody = document.getElementById('userManagementTableBody');
            const spinner = document.getElementById('userTableSpinner');
            if (!tableBody) {
                return;
            }

            if (spinner) {
                spinner.classList.toggle('d-none', !options.loading);
            }

            if (options.loading) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-4">
                            <div class="spinner-border spinner-border-sm me-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            Loading users...
                        </td>
                    </tr>`;
                return;
            }

            if (!users || users.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-4">
                            <i class="bi bi-people-fill me-2"></i>
                            No users found.
                        </td>
                    </tr>`;
                return;
            }

            tableBody.innerHTML = users.map((user) => renderUserRow(user)).join('');
        }

        function enterUserEditMode(email) {
            if (!email) {
                return;
            }

            renderUserManagementTable(userTableData);
            const row = findUserRow(email);
            const user = userTableData.find((item) => item.email === email);

            if (!row || !user) {
                return;
            }

            const createdAt = escapeHtml(formatDate(user.createdAt));
            const lastLogin = escapeHtml(formatDate(user.lastLogin));

            row.classList.add('editing');
            row.innerHTML = `
                <td>
                    <input type="text" class="form-control user-edit-fullname" value="${escapeAttribute(user.fullName || '')}" placeholder="Full Name">
                </td>
                <td>${escapeHtml(user.email || '')}</td>
                <td>
                    <select class="form-select user-edit-role"></select>
                </td>
                <td>
                    <select class="form-select user-edit-status">
                        <option value="true"${user.isActive ? ' selected' : ''}>Active</option>
                        <option value="false"${user.isActive ? '' : ' selected'}>Inactive</option>
                    </select>
                </td>
                <td>${createdAt}</td>
                <td>${lastLogin}</td>
                <td class="text-end">
                    <div class="user-action-buttons">
                        <button type="button" class="btn btn-primary btn-sm js-user-save">
                            <i class="bi bi-check2"></i> Save
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm js-user-cancel">
                            <i class="bi bi-x"></i> Cancel
                        </button>
                    </div>
                </td>
            `;

            populateRoleOptions(row.querySelector('.user-edit-role'), user.role);
        }

        async function saveUserEdits(email) {
            if (!email) {
                return;
            }

            const row = findUserRow(email);
            if (!row) {
                return;
            }

            const fullNameInput = row.querySelector('.user-edit-fullname');
            const roleSelect = row.querySelector('.user-edit-role');
            const statusSelect = row.querySelector('.user-edit-status');

            const payload = {
                fullName: fullNameInput ? fullNameInput.value.trim() : undefined,
                role: roleSelect ? roleSelect.value : undefined,
                isActive: statusSelect ? statusSelect.value !== 'false' : undefined
            };

            Object.keys(payload).forEach((key) => {
                if (payload[key] === undefined || payload[key] === '') {
                    delete payload[key];
                }
            });

            try {
                setRowBusy(row, true);
                const result = await makeRequest(
                    `/services/authservice/api/users/${encodeURIComponent(email)}`,
                    'PUT',
                    payload
                );
                showUserTableResponse(result);
                showAlert(`User "${email}" updated successfully`);
                await loadUserManagement();
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error updating user: ' + error.message, 'error');
                }
                showUserTableResponse(error && error.payload ? error.payload : `Error: ${error.message}`);
            } finally {
                if (row.isConnected) {
                    setRowBusy(row, false);
                }
            }
        }

        async function deleteUserByUsername(email) {
            if (!email) {
                return;
            }

            const row = findUserRow(email);
            if (!row) {
                return;
            }

            if (!confirm(`Are you sure you want to delete user "${email}"?`)) {
                return;
            }

            try {
                setRowBusy(row, true);
                const result = await makeRequest(
                    `/services/authservice/api/users/${encodeURIComponent(email)}`,
                    'DELETE'
                );
                showUserTableResponse(result);
                showAlert(`User "${email}" deleted successfully`);
                await loadUserManagement();
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error deleting user: ' + error.message, 'error');
                }
                showUserTableResponse(error && error.payload ? error.payload : `Error: ${error.message}`);
            } finally {
                if (row.isConnected) {
                    setRowBusy(row, false);
                }
            }
        }

        function randomIndex(max) {
            if (max <= 0) {
                return 0;
            }

            // Never fall back to a non-cryptographic random source for passwords (P0-3).
            if (!(window.crypto && window.crypto.getRandomValues)) {
                throw new Error('Secure random number generator unavailable in this browser');
            }
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            return array[0] % max;
        }

        function shuffleArray(array) {
            for (let i = array.length - 1; i > 0; i -= 1) {
                const j = randomIndex(i + 1);
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }

        function generateSecurePassword(length = 12) {
            const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            const lowercase = 'abcdefghijkmnopqrstuvwxyz';
            const digits = '23456789';
            const symbols = '!@#$%^&*';
            const pools = [uppercase, lowercase, digits, symbols];
            const allCharacters = uppercase + lowercase + digits + symbols;
            const passwordChars = pools.map((pool) => pool[randomIndex(pool.length)]);

            for (let i = passwordChars.length; i < length; i += 1) {
                passwordChars.push(allCharacters[randomIndex(allCharacters.length)]);
            }

            return shuffleArray(passwordChars).join('');
        }

        async function resetUserPassword(email) {
            if (!email) {
                return;
            }

            const row = findUserRow(email);
            const password = generateSecurePassword();

            try {
                if (row) {
                    setRowBusy(row, true);
                }
                const result = await makeRequest(
                    `/services/authservice/api/users/${encodeURIComponent(email)}`,
                    'PUT',
                    { password }
                );
                showUserTableResponse(result);
                showAlert(`Password reset for "${email}"`);
                setPasswordFeedback(email, password);
                await loadUserManagement();
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error resetting password: ' + error.message, 'error');
                }
                showUserTableResponse(error && error.payload ? error.payload : `Error: ${error.message}`);
            } finally {
                if (row && row.isConnected) {
                    setRowBusy(row, false);
                }
            }
        }

        async function handleCreateUser() {
            const fullNameInput = document.getElementById('createUserFullName');
            const emailInput = document.getElementById('createUserEmail');
            const passwordInput = document.getElementById('createUserPassword');
            const roleSelect = document.getElementById('createUserRole');
            const statusSelect = document.getElementById('createUserStatus');

            if (!fullNameInput || !emailInput || !passwordInput || !roleSelect || !statusSelect) {
                return;
            }

            const fullName = fullNameInput.value.trim();
            const email = emailInput.value.trim();
            const role = roleSelect.value || (roleOptions[0] || 'user');
            let password = passwordInput.value.trim();
            const isActive = statusSelect.value !== 'false';

            if (!fullName || !email) {
                showAlert('Full name and email are required to create a user', 'error');
                return;
            }

            if (!password) {
                password = generateSecurePassword();
                passwordInput.value = password;
                updateCreatePasswordHelper('Generated a strong password automatically', password);
            }

            const payload = { email, fullName, password, role, isActive };

            try {
                setUserCreationBusy(true);
                const result = await makeRequest('/services/authservice/api/users', 'POST', payload);
                showUserTableResponse(result);
                showAlert(`User "${email}" created successfully`);
                setPasswordFeedback(email, password);
                updateCreatePasswordHelper(`User "${email}" created with password`, password);

                fullNameInput.value = '';
                emailInput.value = '';
                passwordInput.value = '';
                statusSelect.value = 'true';
                roleSelect.value = role;

                // Collapse the inline create panel now the user is saved.
                document.getElementById('userCreatePanel')?.classList.add('d-none');

                await loadUserManagement();
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error creating user: ' + error.message, 'error');
                }
                showUserTableResponse(error && error.payload ? error.payload : `Error: ${error.message}`);
            } finally {
                setUserCreationBusy(false);
            }
        }

        function handleGenerateCreatePassword() {
            const passwordInput = document.getElementById('createUserPassword');
            if (!passwordInput) {
                return;
            }

            const password = generateSecurePassword();
            passwordInput.value = password;
            updateCreatePasswordHelper('Generated password ready to use', password);
            setPasswordFeedback(null, password);
        }

        function showUserTableResponse(data) {
            const container = document.getElementById('userTableResponse');
            const content = document.getElementById('userTableResponseContent');
            if (!container || !content) {
                return;
            }

            content.textContent = typeof data === 'object'
                ? JSON.stringify(data, null, 2)
                : String(data);
            container.style.display = 'block';
        }

        async function loadUserManagement() {
            const tableBody = document.getElementById('userManagementTableBody');
            if (!tableBody) {
                return;
            }

            renderUserManagementTable([], { loading: true });

            try {
                const result = await makeRequest('/services/authservice/api/users');
                userTableData = Array.isArray(result.data) ? result.data : [];
                renderUserManagementTable(userTableData);
            } catch (error) {
                renderUserManagementTable([]);
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error loading users: ' + error.message, 'error');
                }
            }
        }

        async function preloadRoleOptions() {
            const defaultRole = roleOptions.includes('user') ? 'user' : (roleOptions[0] || 'user');

            try {
                const result = await makeRequest('/services/authservice/api/roles');
                if (Array.isArray(result.data) && result.data.length) {
                    roleOptions = result.data;
                }
            } catch (error) {
                if (isUnauthorized(error)) {
                    console.info('Role listing requires authentication; using default role options.');
                } else {
                    console.warn('Unable to load roles', error);
                    showAlert('Error retrieving available roles: ' + error.message, 'error');
                }
            } finally {
                const createSelect = document.getElementById('createUserRole');
                const resolvedDefault = roleOptions.includes('user') ? 'user' : (roleOptions[0] || defaultRole);
                populateRoleOptions(createSelect, resolvedDefault);

                const assignRoleSelect = document.getElementById('assignRole');
                if (assignRoleSelect) {
                    const previousValue = assignRoleSelect.value;
                    const selection = roleOptions.includes(previousValue)
                        ? previousValue
                        : resolvedDefault;
                    populateRoleOptions(assignRoleSelect, selection);
                }
            }
        }

        async function handleUserTableClick(event) {
            const button = event.target.closest('button');
            if (!button) {
                return;
            }

            const row = button.closest('tr[data-email]');
            if (!row) {
                return;
            }

            const email = row.dataset.email;

            if (button.classList.contains('js-user-edit')) {
                enterUserEditMode(email);
            } else if (button.classList.contains('js-user-save')) {
                await saveUserEdits(email);
            } else if (button.classList.contains('js-user-cancel')) {
                renderUserManagementTable(userTableData);
            } else if (button.classList.contains('js-user-delete')) {
                await deleteUserByUsername(email);
            } else if (button.classList.contains('js-user-reset')) {
                await resetUserPassword(email);
            }
        }

        function initializeUserOperations() {
            const refreshButton = document.getElementById('refreshUsersButton');
            const toggleButton = document.getElementById('toggleCreateUserButton');
            const cancelButton = document.getElementById('cancelCreateUserButton');
            const createPanel = document.getElementById('userCreatePanel');
            const createForm = document.getElementById('dataCreateUserForm');
            const generateButton = document.getElementById('generateCreatePasswordButton');
            const tableBody = document.getElementById('userManagementTableBody');

            populateRoleOptions(
                document.getElementById('createUserRole'),
                roleOptions.includes('user') ? 'user' : (roleOptions[0] || 'user')
            );

            if (refreshButton) {
                refreshButton.addEventListener('click', () => {
                    loadUserManagement();
                });
            }

            // "Create User" reveals/hides the inline create panel.
            if (toggleButton && createPanel) {
                toggleButton.addEventListener('click', () => {
                    createPanel.classList.toggle('d-none');
                    if (!createPanel.classList.contains('d-none')) {
                        document.getElementById('createUserFullName')?.focus();
                    }
                });
            }

            // Cancel hides the panel and clears the form.
            if (cancelButton && createPanel) {
                cancelButton.addEventListener('click', () => {
                    createPanel.classList.add('d-none');
                    if (createForm) createForm.reset();
                });
            }

            // Submitting the panel (Save User button) creates the user.
            if (createForm) {
                createForm.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    await handleCreateUser();
                });
            }

            if (generateButton) {
                generateButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    handleGenerateCreatePassword();
                });
            }

            if (tableBody) {
                tableBody.addEventListener('click', (event) => {
                    handleUserTableClick(event);
                });
            }
        }

        function showAlert(message, type = 'success') {
            const alertElement = document.getElementById(type + 'Alert');
            const messageElement = document.getElementById(type + 'Message');
            if (!alertElement || !messageElement) return;
            messageElement.textContent = message;
            alertElement.classList.add('show');
            setTimeout(() => alertElement.classList.remove('show'), 5000);
        }

        function showResponse(containerId, contentId, data) {
            const container = document.getElementById(containerId);
            const content = document.getElementById(contentId);
            if (!container || !content) return;
            content.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            container.style.display = 'block';
        }

        function setLoading(elementId, isLoading) {
            const element = document.getElementById(elementId);
            if (!element) return;
            element.classList.toggle('loading', Boolean(isLoading));
        }

        async function makeRequest(url, method = 'GET', body = null) {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
            };

            if (body) {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url, options);
            const contentType = response.headers.get('content-type') || '';
            const payload = contentType.includes('application/json')
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                const error = new Error(
                    typeof payload === 'string' && payload
                        ? payload
                        : `Request failed with status ${response.status}`
                );
                error.status = response.status;
                error.payload = payload;
                throw error;
            }

            return payload;
        }

        function toggleAnalyticsLoading(isLoading) {
            const spinner = document.getElementById('analyticsSpinner');
            const button = document.getElementById('analyticsRefreshButton');
            if (spinner) spinner.classList.toggle('d-none', !isLoading);
            if (button) button.disabled = Boolean(isLoading);
        }

        function setAnalyticsPlaceholders() {
            const list = document.getElementById('topUsersList');
            const tableBody = document.getElementById('usersTableBody');
            const rowCount = document.getElementById('usersRowCount');

            if (list) {
                list.innerHTML = `
                    <div class="list-group-item text-center text-muted py-3">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        Loading analytics...
                    </div>`;
            }

            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center text-muted py-4">
                            <div class="spinner-border spinner-border-sm me-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            Loading analytics...
                        </td>
                    </tr>`;
            }

            if (rowCount) {
                rowCount.textContent = '0';
            }
        }

        function renderOverview(overview) {
            const { totalUsers = 0, totalLogins = 0, totalFailures = 0, lastLoginAt = null } = overview || {};
            const totalUsersEl = document.getElementById('totalUsers');
            const totalLoginsEl = document.getElementById('totalLogins');
            const totalFailuresEl = document.getElementById('totalFailures');
            const lastLoginEl = document.getElementById('lastLogin');

            if (totalUsersEl) totalUsersEl.textContent = formatNumber(totalUsers);
            if (totalLoginsEl) totalLoginsEl.textContent = formatNumber(totalLogins);
            if (totalFailuresEl) totalFailuresEl.textContent = formatNumber(totalFailures);
            if (lastLoginEl) lastLoginEl.textContent = formatDate(lastLoginAt);
        }

        function renderTopUsers(topUsers) {
            const list = document.getElementById('topUsersList');
            if (!list) return;

            list.innerHTML = '';

            if (!topUsers || topUsers.length === 0) {
                list.innerHTML = '<div class="list-group-item text-muted">No user activity recorded yet.</div>';
                return;
            }

            topUsers.forEach((user, index) => {
                const item = document.createElement('div');
                item.className = 'list-group-item d-flex justify-content-between align-items-center';

                const details = document.createElement('div');
                const name = document.createElement('div');
                name.className = 'fw-semibold';
                name.textContent = `${index + 1}. ${user.email}`;

                const meta = document.createElement('div');
                meta.className = 'text-muted small';
                meta.textContent = `Logins: ${formatNumber(user.loginCount || 0)} • Failures: ${formatNumber(user.failedCount || 0)} • Last login: ${formatDate(user.lastLogin)}`;

                details.appendChild(name);
                details.appendChild(meta);

                const badge = document.createElement('span');
                badge.className = 'badge bg-secondary rounded-pill';
                badge.textContent = formatNumber(user.loginCount || 0);

                item.appendChild(details);
                item.appendChild(badge);
                list.appendChild(item);
            });
        }

        function escapeHtml(text) {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return String(text).replace(/[&<>"']/g, (m) => map[m]);
        }

        function renderUsersTable(users) {
            const tableBody = document.getElementById('usersTableBody');
            const rowCount = document.getElementById('usersRowCount');
            if (!tableBody) return;

            if (!users || users.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center text-muted py-4">
                            <i class="bi bi-info-circle fs-4"></i>
                            <p class="mb-0 mt-2">No user activity recorded yet.</p>
                        </td>
                    </tr>`;
                if (rowCount) rowCount.textContent = '0';
                return;
            }

            tableBody.innerHTML = users.map((user) => `
                <tr>
                    <td class="key-cell">${escapeHtml(user.email)}</td>
                    <td class="hits-cell">${formatNumber(user.loginCount || 0)}</td>
                    <td class="hits-cell">${formatNumber(user.failedCount || 0)}</td>
                    <td class="date-cell">${formatDate(user.lastLogin)}</td>
                </tr>
            `).join('');

            if (rowCount) {
                rowCount.textContent = String(users.length);
            }
        }

        function sortTable(column) {
            if (!analyticsData || analyticsData.length === 0) {
                renderUsersTable([]);
                return;
            }

            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'desc';
            }

            document.querySelectorAll('.sortable span').forEach((span) => {
                span.parentElement.classList.remove('sort-asc', 'sort-desc');
            });

            const sortElement = document.getElementById(`sort-${column}`);
            if (sortElement) {
                sortElement.parentElement.classList.add(
                    currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc'
                );
            }

            analyticsData.sort((a, b) => {
                if (column === 'email') {
                    const aVal = (a.email || '').toLowerCase();
                    const bVal = (b.email || '').toLowerCase();
                    return currentSort.direction === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                }

                if (column === 'lastLogin') {
                    const aTime = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
                    const bTime = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
                    return currentSort.direction === 'asc' ? aTime - bTime : bTime - aTime;
                }

                const aVal = a[column] || 0;
                const bVal = b[column] || 0;
                return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
            });

            renderUsersTable(analyticsData);
        }

        async function loadAnalytics() {
            toggleAnalyticsLoading(true);
            setAnalyticsPlaceholders();

            try {
                const data = await makeRequest('/services/authservice/api/analytics');

                renderOverview(data.overview || {});
                renderTopUsers(data.topUsers || []);

                analyticsData = data.topRecent || [];
                sortTable(currentSort.column);
            } catch (error) {
                console.error('Error loading analytics:', error);
                showAlert('Error loading analytics: ' + error.message, 'error');
            } finally {
                toggleAnalyticsLoading(false);
            }
        }

        function fillDefaultAdmin() {
            document.getElementById('loginEmail').value = 'admin@localhost';
            document.getElementById('loginPassword').value = 'admin';
        }

        function fillDefaultUser() {
            document.getElementById('loginEmail').value = 'user@localhost';
            document.getElementById('loginPassword').value = 'password';
        }

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                email: document.getElementById('loginEmail').value,
                password: document.getElementById('loginPassword').value
            };

            try {
                setLoading('loginForm', true);
                const result = await makeRequest('/services/authservice/api/login', 'POST', payload);
                showResponse('loginResponse', 'loginResponseContent', result);
                if (result?.data?.session?.token) {
                    document.getElementById('sessionToken').value = result.data.session.token;
                    showAlert(`Login successful! Session expires: ${new Date(result.data.session.expiresAt).toLocaleString()}`);
                } else {
                    showAlert('Login successful!');
                }
                loadAnalytics();
            } catch (error) {
                showAlert('Error during login: ' + error.message, 'error');
                showResponse('loginResponse', 'loginResponseContent', 'Error: ' + error.message);
            } finally {
                setLoading('loginForm', false);
            }
        });

        async function validateSession() {
            const token = document.getElementById('sessionToken').value;
            if (!token) {
                showAlert('Please enter a session token', 'error');
                return;
            }

            try {
                const result = await makeRequest('/services/authservice/api/validate', 'POST', { token });
                showResponse('sessionResponse', 'sessionResponseContent', result);
                if (result.success) {
                    showAlert(`Session valid! User: ${result.data.email}, Role: ${result.data.role}`);
                } else {
                    showAlert('Session validated successfully!');
                }
            } catch (error) {
                showAlert('Error validating session: ' + error.message, 'error');
                showResponse('sessionResponse', 'sessionResponseContent', 'Error: ' + error.message);
            }
        }

        async function logoutSession() {
            const token = document.getElementById('sessionToken').value;
            if (!token) {
                showAlert('No session token to logout', 'error');
                return;
            }

            try {
                const result = await makeRequest('/services/authservice/api/logout', 'POST', { token });
                showResponse('sessionResponse', 'sessionResponseContent', result);
                showAlert('Logged out successfully!');
                document.getElementById('sessionToken').value = '';
            } catch (error) {
                showAlert('Error during logout: ' + error.message, 'error');
                showResponse('sessionResponse', 'sessionResponseContent', 'Error: ' + error.message);
            }
        }

        function clearSessionToken() {
            document.getElementById('sessionToken').value = '';
            showAlert('Session token cleared');
        }

        async function assignRole() {
            const email = document.getElementById('roleEmail').value;
            const role = document.getElementById('assignRole').value;

            if (!email) {
                showAlert('Please enter an email', 'error');
                return;
            }

            try {
                const result = await makeRequest(`/services/authservice/api/users/${encodeURIComponent(email)}/role`, 'POST', { role });
                showResponse('roleResponse', 'roleResponseContent', result);
                showAlert(`Role "${role}" assigned to user "${email}"`);
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error assigning role: ' + error.message, 'error');
                }
                showResponse('roleResponse', 'roleResponseContent', 'Error: ' + error.message);
            }
        }

        async function listRoles() {
            try {
                const result = await makeRequest('/services/authservice/api/roles');
                showResponse('roleResponse', 'roleResponseContent', result);
                const count = result.data ? result.data.length : 0;
                if (Array.isArray(result.data) && result.data.length) {
                    roleOptions = result.data;
                    const defaultRole = roleOptions.includes('user') ? 'user' : roleOptions[0];
                    populateRoleOptions(document.getElementById('createUserRole'), defaultRole);
                    const assignRoleSelect = document.getElementById('assignRole');
                    if (assignRoleSelect) {
                        const previousValue = assignRoleSelect.value;
                        const selectedRole = roleOptions.includes(previousValue) ? previousValue : defaultRole;
                        populateRoleOptions(assignRoleSelect, selectedRole);
                    }
                }
                showAlert(`Found ${count} roles`);
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error retrieving roles: ' + error.message, 'error');
                }
                showResponse('roleResponse', 'roleResponseContent', 'Error: ' + error.message);
            }
        }

        async function getUsersInRole() {
            const role = document.getElementById('assignRole').value;

            try {
                const result = await makeRequest(`/services/authservice/api/roles/${encodeURIComponent(role)}/users`);
                showResponse('roleResponse', 'roleResponseContent', result);
                const count = result.data ? result.data.length : 0;
                showAlert(`Found ${count} users in "${role}" role`);
            } catch (error) {
                if (isUnauthorized(error)) {
                    showAuthRequiredAlert();
                } else {
                    showAlert('Error retrieving users in role: ' + error.message, 'error');
                }
                showResponse('roleResponse', 'roleResponseContent', 'Error: ' + error.message);
            }
        }

        async function checkStatus() {
            try {
                const result = await makeRequest('/services/authservice/api/status');
                showResponse('statusResponse', 'statusResponseContent', result);
                showAlert('Status checked successfully');
            } catch (error) {
                showAlert('Error checking status: ' + error.message, 'error');
                showResponse('statusResponse', 'statusResponseContent', 'Error: ' + error.message);
            }
        }

        async function refreshAll() {
            try {
                await Promise.all([
                    checkStatus(),
                    loadUserManagement(),
                    listRoles(),
                    loadAnalytics()
                ]);
                showAlert('All data refreshed successfully');
            } catch (error) {
                showAlert('Some operations failed during refresh', 'error');
            }
        }

        const analyticsRefreshButton = document.getElementById('analyticsRefreshButton');
        if (analyticsRefreshButton) {
            analyticsRefreshButton.addEventListener('click', () => loadAnalytics());
        }

        document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', () => {
            loadAnalytics();
        });

        document.getElementById('data-tab')?.addEventListener('shown.bs.tab', () => {
            checkStatus();
            loadUserManagement();
            preloadRoleOptions();
        });

        window.addEventListener('load', () => {
            initializeUserOperations();
            loadAnalytics();
            checkStatus();
            preloadRoleOptions();
            loadUserManagement();
            //initializeSwagger();
        });

        // Settings functionality
        let currentSettings = {};

        // Fetch settings from API
        async function loadSettings() {
            try {
                const response = await fetch('/services/authservice/api/settings');
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
                const response = await fetch('/services/authservice/api/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload)
                });

                const responseText = await response.text();

                // Show response
                const container = document.getElementById('settingsSaveResponse');
                const content = document.getElementById('settingsSaveResponseContent');
                if (container && content) {
                    content.textContent = responseText;
                    container.style.display = 'block';
                }

                if (response.ok) {
                    showAlert('Settings saved successfully', 'success');
                    // Reload settings to reflect changes
                    setTimeout(() => loadSettings(), 1000);
                } else {
                    showAlert('Error saving settings: ' + responseText, 'error');
                }
            } catch (error) {
                showAlert('Error saving settings: ' + error.message, 'error');
                const container = document.getElementById('settingsSaveResponse');
                const content = document.getElementById('settingsSaveResponseContent');
                if (container && content) {
                    content.textContent = 'Error: ' + error.message;
                    container.style.display = 'block';
                }
            }
        });

        // Load settings when settings tab is shown
        document.getElementById('settings-tab')?.addEventListener('shown.bs.tab', function (e) {
            loadSettings();
        });

        function initializeSwagger() {

            const swaggerUi = SwaggerUIBundle({
                url: '/services/authservice/api/docs/json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                layout: "BaseLayout",
                docExpansion: "none",
                defaultModelsExpandDepth: -1
            });
            window.swaggerUi = swaggerUi;
        }

        // ===== FEATURE 2: USERS TAB =====
        async function loadUsersTab() {
            const tbody = document.getElementById('userManagementTableBody');
            try {
                const response = await fetch('/services/authservice/api/users');
                const result = await response.json();
                if (result.success) {
                    renderUserManagementTable(result.data);
                } else if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">Failed to load users: ${escapeHtml(result.error || 'Unknown error')}</td></tr>`;
                }
            } catch (error) {
                console.error('Error loading users:', error);
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">Error loading users: ${escapeHtml(error.message)}</td></tr>`;
                }
            }
        }

        const userManagementCache = new Map();

        function renderUserManagementTable(users) {
            const tbody = document.getElementById('userManagementTableBody');
            if (!tbody) return;
            userManagementCache.clear();
            if (!users || users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No users found.</td></tr>`;
                return;
            }
            tbody.innerHTML = users.map(user => {
                userManagementCache.set(user.email, user);
                const emailAttr = escapeAttribute(user.email);
                return `
                <tr data-user-row="${emailAttr}">
                    <td>${escapeHtml(user.fullName || '—')}</td>
                    <td>${escapeHtml(user.email || '—')}</td>
                    <td><span class="badge bg-secondary">${escapeHtml(capitalize(user.role))}</span></td>
                    <td><span class="badge ${user.isActive ? 'bg-success' : 'bg-danger'}">${user.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>${formatDate(user.lastLogin)}</td>
                    <td>
                        <button class="btn btn-xs btn-outline-primary me-1" data-onclick="editUser" data-onclick-args="${nooblyArgs(emailAttr)}" title="Edit user"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-xs btn-outline-warning me-1" data-onclick="resetPassword" data-onclick-args="${nooblyArgs(emailAttr)}" title="Reset password"><i class="bi bi-key"></i></button>
                        <button class="btn btn-xs btn-outline-danger" data-onclick="deleteUser" data-onclick-args="${nooblyArgs(emailAttr)}" title="Delete user"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
        }

        function closeUserInlineEditor() {
            const existing = document.querySelector('tr[data-user-editor]');
            if (existing) existing.remove();
        }

        function insertUserInlineEditor(email, editorHtml) {
            const emailAttr = escapeAttribute(email);
            const userRow = document.querySelector(`tr[data-user-row="${emailAttr}"]`);
            if (!userRow) return null;

            const existing = document.querySelector('tr[data-user-editor]');
            if (existing) {
                const wasForSameUser = existing.getAttribute('data-user-editor') === email;
                existing.remove();
                if (wasForSameUser) return null;
            }

            const editorRow = document.createElement('tr');
            editorRow.setAttribute('data-user-editor', email);
            editorRow.className = 'bg-light';
            editorRow.innerHTML = `<td colspan="6" class="p-3">${editorHtml}</td>`;
            userRow.insertAdjacentElement('afterend', editorRow);
            return editorRow;
        }

        function editUser(email) {
            const user = userManagementCache.get(email);
            if (!user) {
                showAlert('User data not loaded yet, refresh and try again.', 'error');
                return;
            }

            const editorHtml = `
                <form class="row g-2 align-items-end" data-edit-user-form="${escapeAttribute(email)}">
                    <div class="col-md-3">
                        <label class="form-label small mb-1">Email</label>
                        <input type="email" class="form-control form-control-sm" value="${escapeAttribute(user.email || '')}" disabled>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small mb-1">Full Name</label>
                        <input type="text" class="form-control form-control-sm" name="fullName" value="${escapeAttribute(user.fullName || '')}" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label small mb-1">Role</label>
                        <select class="form-select form-select-sm" name="role"></select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label small mb-1">Status</label>
                        <select class="form-select form-select-sm" name="isActive">
                            <option value="true"${user.isActive ? ' selected' : ''}>Active</option>
                            <option value="false"${!user.isActive ? ' selected' : ''}>Inactive</option>
                        </select>
                    </div>
                    <div class="col-md-2 d-flex gap-2 justify-content-end">
                        <button type="submit" class="btn btn-sm btn-secondary">Save</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-close-editor>Cancel</button>
                    </div>
                </form>`;

            const editorRow = insertUserInlineEditor(email, editorHtml);
            if (!editorRow) return;

            const form = editorRow.querySelector('form');
            populateRoleOptions(form.querySelector('select[name="role"]'), user.role);
            form.querySelector('[data-close-editor]').addEventListener('click', closeUserInlineEditor);

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                try {
                    const payload = {
                        fullName: form.elements['fullName'].value.trim(),
                        role: form.elements['role'].value,
                        isActive: form.elements['isActive'].value === 'true'
                    };
                    const response = await fetch(`/services/authservice/api/users/${encodeURIComponent(email)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await response.json();
                    if (result.success) {
                        showAlert(`User "${email}" updated successfully`, 'success');
                        closeUserInlineEditor();
                        loadUsersTab();
                    } else {
                        showAlert('Error updating user: ' + (result.error || 'Unknown error'), 'error');
                        submitBtn.disabled = false;
                    }
                } catch (error) {
                    showAlert('Error updating user: ' + error.message, 'error');
                    submitBtn.disabled = false;
                }
            });
        }

        function resetPassword(email) {
            const editorHtml = `
                <form class="row g-2 align-items-end" data-reset-password-form="${escapeAttribute(email)}">
                    <div class="col-md-3">
                        <label class="form-label small mb-1">User</label>
                        <input type="text" class="form-control form-control-sm" value="${escapeAttribute(email)}" disabled>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small mb-1">New Password</label>
                        <input type="text" class="form-control form-control-sm" name="newPassword" autocomplete="new-password" required minlength="8">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small mb-1">Confirm Password</label>
                        <input type="text" class="form-control form-control-sm" name="confirmPassword" autocomplete="new-password" required minlength="8">
                    </div>
                    <div class="col-md-3 d-flex gap-2 justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-generate-password><i class="bi bi-lightning"></i> Generate</button>
                        <button type="submit" class="btn btn-sm btn-warning">Reset</button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-close-editor>Cancel</button>
                    </div>
                    <div class="col-12">
                        <small class="text-muted" data-reset-password-helper></small>
                    </div>
                </form>`;

            const editorRow = insertUserInlineEditor(email, editorHtml);
            if (!editorRow) return;

            const form = editorRow.querySelector('form');
            const newPasswordInput = form.elements['newPassword'];
            const confirmPasswordInput = form.elements['confirmPassword'];
            const helper = form.querySelector('[data-reset-password-helper]');

            form.querySelector('[data-close-editor]').addEventListener('click', closeUserInlineEditor);

            form.querySelector('[data-generate-password]').addEventListener('click', async () => {
                try {
                    const response = await fetch('/services/authservice/api/auth/password/generate');
                    const result = await response.json();
                    const generated = result?.data?.password;
                    if (generated) {
                        newPasswordInput.value = generated;
                        confirmPasswordInput.value = generated;
                        helper.textContent = 'Generated password applied. Copy it before saving — it will not be shown again.';
                    } else {
                        helper.textContent = 'Could not generate password.';
                    }
                } catch (error) {
                    helper.textContent = 'Error generating password: ' + error.message;
                }
            });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPassword = newPasswordInput.value;
                const confirmPassword = confirmPasswordInput.value;
                if (newPassword !== confirmPassword) {
                    helper.textContent = 'Passwords do not match.';
                    return;
                }
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                try {
                    const response = await fetch(`/services/authservice/api/users/${encodeURIComponent(email)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: newPassword })
                    });
                    const result = await response.json();
                    if (result.success) {
                        showAlert(`Password for "${email}" reset successfully`, 'success');
                        closeUserInlineEditor();
                    } else {
                        helper.textContent = 'Error: ' + (result.error || 'Unknown error');
                        submitBtn.disabled = false;
                    }
                } catch (error) {
                    helper.textContent = 'Error: ' + error.message;
                    submitBtn.disabled = false;
                }
            });
        }

        async function deleteUser(email) {
            if (!confirm(`Delete user "${email}"?`)) return;
            try {
                const response = await fetch(`/services/authservice/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
                if (response.ok) {
                    showAlert('User deleted successfully', 'success');
                    loadUsersTab();
                }
            } catch (error) {
                showAlert('Error deleting user: ' + error.message, 'error');
            }
        }

        // Users tab button handlers
        document.getElementById('createUserBtn')?.addEventListener('click', function() {
            document.getElementById('createUserForm').classList.toggle('d-none');
        });

        document.getElementById('cancelCreateUser')?.addEventListener('click', function() {
            document.getElementById('createUserForm').classList.add('d-none');
        });

        document.getElementById('generateNewPassword')?.addEventListener('click', async function() {
            try {
                const response = await fetch('/services/authservice/api/auth/password/generate');
                const result = await response.json();
                const passwordDisplay = document.getElementById('generatedPasswordDisplay');
                document.getElementById('generatedPasswordText').textContent = result.data.password;
                passwordDisplay.classList.remove('d-none');
            } catch (error) {
                alert('Error generating password: ' + error.message);
            }
        });

        document.getElementById('userCreateForm')?.addEventListener('submit', async function(e) {
            e.preventDefault();
            try {
                const response = await fetch('/services/authservice/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fullName: document.getElementById('newFullName').value,
                        email: document.getElementById('newEmail').value,
                        password: document.getElementById('generatedPasswordText').textContent,
                        role: document.getElementById('newRole').value
                    })
                });
                const result = await response.json();
                if (result.success) {
                    showAlert('User created successfully', 'success');
                    this.reset();
                    document.getElementById('createUserForm').classList.add('d-none');
                    document.getElementById('generatedPasswordDisplay').classList.add('d-none');
                    loadUsersTab();
                } else {
                    showAlert('Error: ' + result.error, 'error');
                }
            } catch (error) {
                showAlert('Error creating user: ' + error.message, 'error');
            }
        });

        // ===== FEATURE 2: CSV IMPORT TAB (creates invitations) =====
        document.getElementById('csvFile')?.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(event) {
                try {
                    const csv = event.target.result;
                    const lines = csv.trim().split('\n');
                    const invites = [];

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const parts = line.split(',').map(p => p.trim());
                        if (parts.length >= 2 && parts[0] && parts[1]) {
                            invites.push({ name: parts[0], email: parts[1] });
                        }
                    }

                    const previewBody = document.getElementById('csvPreviewBody');
                    previewBody.innerHTML = invites.map(u => `
                        <tr>
                            <td>${escapeHtml(u.name)}</td>
                            <td>${escapeHtml(u.email)}</td>
                        </tr>
                    `).join('');
                    document.getElementById('csvPreview').classList.remove('d-none');
                    document.getElementById('csvResults').classList.add('d-none');
                    document.getElementById('importCsvBtn').disabled = invites.length === 0;
                    document.getElementById('clearCsvBtn').disabled = false;
                    window.csvInvites = invites;
                } catch (error) {
                    alert('Error parsing CSV: ' + error.message);
                }
            };
            reader.readAsText(file);
        });

        document.getElementById('clearCsvBtn')?.addEventListener('click', function() {
            document.getElementById('csvFile').value = '';
            document.getElementById('csvPreview').classList.add('d-none');
            document.getElementById('csvResults').classList.add('d-none');
            document.getElementById('importCsvBtn').disabled = true;
            document.getElementById('clearCsvBtn').disabled = true;
            window.csvInvites = [];
        });

        document.getElementById('importCsvBtn')?.addEventListener('click', async function() {
            try {
                const btn = this;
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Sending...';

                const response = await fetch('/services/authservice/api/invitations/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ invites: window.csvInvites })
                });
                const result = await response.json();
                const resultsDiv = document.getElementById('csvResults');
                resultsDiv.classList.remove('d-none');

                const { created = [], errors = [] } = result.data || {};

                if (created.length > 0) {
                    document.getElementById('csvSuccess').classList.remove('d-none');
                    document.getElementById('csvSuccessCount').textContent = created.length;

                    const listDiv = document.getElementById('csvInvitationList');
                    listDiv.classList.remove('d-none');
                    listDiv.innerHTML = `
                        <p class="mb-2 small fw-semibold">Copy links to send to each invitee:</p>
                        <table class="table table-hover">
                            <thead><tr><th>Name</th><th>Email</th><th>Invitation Link</th></tr></thead>
                            <tbody>
                                ${created.map(inv => {
                                    const link = `${window.location.origin}/services/authservice/redeem-invitation?code=${encodeURIComponent(inv.code)}`;
                                    return `<tr>
                                        <td>${escapeHtml(inv.name)}</td>
                                        <td>${escapeHtml(inv.email)}</td>
                                        <td>
                                            <div class="input-group input-group-sm">
                                                <input type="text" class="form-control font-monospace" value="${escapeAttribute(link)}" readonly>
                                                <button class="btn btn-outline-secondary" type="button"
                                                    data-onclick="copyToClipboard" data-onclick-args="${nooblyArgs(link, { $this: true }, "Copied!")}">
                                                    <i class="bi bi-clipboard"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>`;
                } else {
                    document.getElementById('csvSuccess').classList.add('d-none');
                    document.getElementById('csvInvitationList').classList.add('d-none');
                }

                if (errors.length > 0) {
                    document.getElementById('csvErrors').classList.remove('d-none');
                    const errorsList = document.getElementById('csvErrorsList');
                    errorsList.innerHTML = errors.map(e => `<li><strong>${escapeHtml(e.email)}:</strong> ${escapeHtml(e.error)}</li>`).join('');
                } else {
                    document.getElementById('csvErrors').classList.add('d-none');
                }

                // Refresh invitations tab so new entries appear there too
                loadInvitationsTab();

                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-envelope-plus"></i> Send Invitations';
            } catch (error) {
                alert('Error creating invitations: ' + error.message);
                this.disabled = false;
                this.innerHTML = '<i class="bi bi-envelope-plus"></i> Send Invitations';
            }
        });

        // ===== FEATURE 2: ROLES TAB =====
        async function loadRolesTab() {
            try {
                const response = await fetch('/services/authservice/api/roles');
                const result = await response.json();
                if (result.success) {
                    renderRoles(result.data);
                }
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        }

        function renderRoles(roles) {
            const container = document.getElementById('rolesContainer');
            container.innerHTML = roles.map(role => `
                <div class="card mb-2">
                    <div class="card-body p-3 d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-0">${escapeHtml(capitalize(role))}</h6>
                            <small class="text-muted">Built-in role</small>
                        </div>
                        <button class="btn btn-xs btn-outline-danger" data-onclick="deleteRole" data-onclick-args="${nooblyArgs(role)}" ${['admin', 'user', 'guest'].includes(role) ? 'disabled' : ''}>
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }

        document.getElementById('createRoleBtn')?.addEventListener('click', function() {
            document.getElementById('createRoleForm').classList.toggle('d-none');
        });

        document.getElementById('cancelCreateRole')?.addEventListener('click', function() {
            document.getElementById('createRoleForm').classList.add('d-none');
        });

        document.getElementById('roleCreateForm')?.addEventListener('submit', async function(e) {
            e.preventDefault();
            try {
                const response = await fetch('/services/authservice/api/roles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roleName: document.getElementById('newRoleName').value })
                });
                const result = await response.json();
                if (result.success) {
                    showAlert('Role created successfully', 'success');
                    this.reset();
                    document.getElementById('createRoleForm').classList.add('d-none');
                    loadRolesTab();
                } else {
                    showAlert('Error: ' + result.error, 'error');
                }
            } catch (error) {
                showAlert('Error creating role: ' + error.message, 'error');
            }
        });

        async function deleteRole(roleName) {
            if (!confirm(`Delete role "${roleName}"?`)) return;
            try {
                const response = await fetch(`/services/authservice/api/roles/${roleName}`, { method: 'DELETE' });
                if (response.ok) {
                    showAlert('Role deleted successfully', 'success');
                    loadRolesTab();
                }
            } catch (error) {
                showAlert('Error deleting role: ' + error.message, 'error');
            }
        }

        // ===== FEATURE 4: INVITATIONS TAB =====
        async function loadInvitationsTab() {
            try {
                const response = await fetch('/services/authservice/api/invitations');
                const result = await response.json();
                if (result.success) {
                    renderInvitations(result.data);
                }
            } catch (error) {
                console.error('Error loading invitations:', error);
            }
        }

        function renderInvitations(invitations) {
            const tbody = document.getElementById('invitationsTableBody');
            if (invitations.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No invitations yet. Create one above.</td></tr>';
                return;
            }

            tbody.innerHTML = invitations.map(inv => {
                const canApprove = inv.status === 'pending';
                const canRecreate = inv.status !== 'used';
                return `
                <tr>
                    <td>${escapeHtml(inv.name)}</td>
                    <td>${escapeHtml(inv.email)}</td>
                    <td>
                        <span class="badge ${
                            inv.status === 'pending' ? 'bg-warning' :
                            inv.status === 'approved' ? 'bg-success' :
                            'bg-secondary'
                        }">
                            ${capitalize(inv.status)}
                        </span>
                    </td>
                    <td class="text-muted small">${inv.status === 'used' ? 'Redeemed' : 'Hidden after issue'}</td>
                    <td>${inv.expiresAt ? formatDate(inv.expiresAt) : '—'}</td>
                    <td>
                        ${canApprove ? `
                            <button class="btn btn-xs btn-outline-success" data-onclick="approveInvitation" data-onclick-args="${nooblyArgs(inv.id)}">
                                <i class="bi bi-check2"></i> Approve
                            </button>
                        ` : ''}
                        ${canRecreate ? `
                            <button class="btn btn-xs btn-outline-warning ms-1" data-onclick="recreateInvitation" data-onclick-args="${nooblyArgs(inv.id)}">
                                <i class="bi bi-arrow-clockwise"></i> ${canApprove ? 'Issue code' : 'Recreate'}
                            </button>
                        ` : ''}
                    </td>
                </tr>`;
            }).join('');
        }

        /**
         * Shows a newly issued code in the result panel. The server returns the
         * plain code once; it is not retrievable afterwards.
         * @param {Object} invitation Invitation with `code`, `email` and `name`
         */
        function showIssuedInvitation(invitation) {
            const link = `${window.location.origin}/services/authservice/redeem-invitation?code=${encodeURIComponent(invitation.code)}`;
            document.getElementById('newInvitationCode').textContent = invitation.code;
            document.getElementById('newInvitationLink').value = link;
            document.getElementById('newInvitationResult').classList.remove('d-none');
            loadInvitationsTab();
        }

        async function approveInvitation(id) {
            if (!confirm('Approve this request? The code will be shown once so you can send it to the invitee.')) return;
            try {
                const response = await fetch(`/services/authservice/api/invitations/${encodeURIComponent(id)}/approve`, { method: 'PUT' });
                const result = await response.json();
                if (result.success) {
                    showIssuedInvitation(result.data);
                } else {
                    showAlert('Error: ' + result.error, 'error');
                }
            } catch (error) {
                showAlert('Error approving invitation: ' + error.message, 'error');
            }
        }

        async function recreateInvitation(id) {
            if (!confirm('Issue a new code for this invitation? The old code will stop working.')) return;
            try {
                const response = await fetch(`/services/authservice/api/invitations/${encodeURIComponent(id)}/recreate`, { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    showIssuedInvitation(result.data);
                } else {
                    showAlert('Error: ' + result.error, 'error');
                }
            } catch (error) {
                showAlert('Error recreating invitation: ' + error.message, 'error');
            }
        }

        function copyToClipboard(text, btn, successMsg) {
            navigator.clipboard.writeText(text).then(() => {
                const icon = btn.querySelector('i');
                const originalClass = icon ? icon.className : '';
                const originalTitle = btn.title;
                if (icon) icon.className = 'bi bi-check-lg';
                btn.title = successMsg || 'Copied!';
                btn.classList.add('btn-success');
                btn.classList.remove('btn-outline-secondary', 'btn-outline-primary');
                setTimeout(() => {
                    if (icon) icon.className = originalClass;
                    btn.title = originalTitle;
                    btn.classList.remove('btn-success');
                    btn.classList.add(originalTitle === 'Copy', 'invitation', 'link' ? 'btn-outline-primary' : 'btn-outline-secondary');
                }, 1500);
            }).catch(() => {
                showAlert('Could not copy to clipboard', 'error');
            });
        }

        // Create invitation form handler
        document.getElementById('createInvitationForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('inviteeName').value.trim();
            const email = document.getElementById('inviteeEmail').value.trim();
            if (!name || !email) return;

            try {
                const response = await fetch('/services/authservice/api/invitations/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ invites: [{ name, email }] })
                });
                const result = await response.json();
                const created = result.data?.created?.[0];
                if (created) {
                    showIssuedInvitation(created);
                    document.getElementById('createInvitationForm').reset();
                } else {
                    showAlert('Error: ' + (result.data?.errors?.[0]?.error || result.error || 'Invitation not created'), 'error');
                }
            } catch (error) {
                showAlert('Error creating invitation: ' + error.message, 'error');
            }
        });

        function copyNewInvitationLink() {
            const input = document.getElementById('newInvitationLink');
            navigator.clipboard.writeText(input.value).then(() => {
                showAlert('Invitation link copied to clipboard!', 'success');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
            });
        }

        // Load tabs on init
        document.getElementById('users-tab')?.addEventListener('shown.bs.tab', loadUsersTab);
        document.getElementById('csv-tab')?.addEventListener('shown.bs.tab', function() {});
        document.getElementById('roles-tab')?.addEventListener('shown.bs.tab', loadRolesTab);
        document.getElementById('invitations-tab')?.addEventListener('shown.bs.tab', loadInvitationsTab);
    

/** Hides the "invitation created" panel (called from the dismiss button). */
function hideNewInvitationResult() {
    document.getElementById('newInvitationResult')?.classList.add('d-none');
}
