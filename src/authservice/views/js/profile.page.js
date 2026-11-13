        let currentEmail = '';
        let generateTokenModal = null;
        let tokenDisplayModal = null;

        // Initialize modals
        document.addEventListener('DOMContentLoaded', function() {
            generateTokenModal = new bootstrap.Modal(document.getElementById('generateTokenModal'));
            tokenDisplayModal = new bootstrap.Modal(document.getElementById('tokenDisplayModal'));
            loadProfile();
        });

        function showAlert(message, type) {
            const alertDiv = type === 'success' ?
                document.getElementById('successAlert') :
                document.getElementById('errorAlert');
            const messageSpan = type === 'success' ?
                document.getElementById('successMessage') :
                document.getElementById('errorMessage');

            messageSpan.textContent = message;
            alertDiv.classList.remove('d-none');

            setTimeout(() => alertDiv.classList.add('d-none'), 5000);
        }

        async function loadProfile() {
            try {
                const response = await fetch('/services/authservice/api/auth/check');
                const result = await response.json();
                if (result.success && result.user) {
                    currentEmail = result.user.email;
                    document.getElementById('userFullName').textContent = result.user.fullName || result.user.email;
                    document.getElementById('userEmail').textContent = result.user.email || '';
                    loadApiTokens();
                } else {
                    window.location.href = '/services/authservice/views/login.html';
                }
            } catch (error) {
                showAlert('Error loading profile: ' + error.message, 'error');
            }
        }

        // Password strength indicator
        document.getElementById('newPassword')?.addEventListener('input', async function() {
            const password = this.value;
            const strengthBar = document.getElementById('strengthBar');
            const strengthText = document.getElementById('strengthText');

            if (!password) {
                strengthBar.style.width = '0%';
                strengthBar.className = 'password-strength-bar';
                strengthText.textContent = '';
                return;
            }

            try {
                const response = await fetch('/services/authservice/api/auth/password/validate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const result = await response.json();
                const { valid, errors } = result.data;

                if (valid) {
                    strengthBar.style.width = '100%';
                    strengthBar.className = 'password-strength-bar strong';
                    strengthText.textContent = '✓ Strong password';
                    strengthText.style.color = '#28a745';
                } else {
                    const errorCount = errors.length;
                    const width = Math.max(25, 100 - (errorCount * 20));
                    strengthBar.style.width = width + '%';
                    strengthBar.className = 'password-strength-bar';
                    strengthText.textContent = errors.slice(0, 2).join('; ');
                    strengthText.style.color = '#dc3545';
                }
            } catch (error) {
                console.error('Error validating password:', error);
            }
        });

        // Change password form
        document.getElementById('changePasswordForm')?.addEventListener('submit', async function(e) {
            e.preventDefault();
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (newPassword !== confirmPassword) {
                showAlert('Passwords do not match', 'error');
                return;
            }

            try {
                const response = await fetch('/services/authservice/api/profile/password', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPassword, newPassword })
                });
                const result = await response.json();
                if (result.success) {
                    showAlert('Password changed successfully', 'success');
                    this.reset();
                } else {
                    showAlert(result.error || 'Failed to change password', 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        });

        // Generate token button
        document.getElementById('generateTokenBtn')?.addEventListener('click', function() {
            document.getElementById('generateTokenForm').reset();
            generateTokenModal.show();
        });

        // Generate token form
        document.getElementById('generateTokenForm')?.addEventListener('submit', async function(e) {
            e.preventDefault();
            const name = document.getElementById('tokenName').value;
            const expiryVal = document.getElementById('tokenExpiry').value;
            const body = { name };
            if (expiryVal) body.expiresInDays = Number(expiryVal);

            try {
                const response = await fetch('/services/authservice/api/profile/tokens', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const result = await response.json();
                if (result.success) {
                    generateTokenModal.hide();
                    document.getElementById('tokenValue').value = result.data.token;
                    const exp = result.data.expiresAt;
                    document.getElementById('tokenExpiryNote').textContent = exp
                        ? 'Expires: ' + new Date(exp).toLocaleString()
                        : 'This token never expires.';
                    tokenDisplayModal.show();
                    loadApiTokens();
                } else {
                    showAlert(result.error || 'Failed to generate token', 'error');
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        });

        // Copy token to clipboard
        document.getElementById('copyTokenBtn')?.addEventListener('click', function() {
            const tokenValue = document.getElementById('tokenValue');
            tokenValue.select();
            document.execCommand('copy');
            showAlert('Token copied to clipboard', 'success');
        });

        // Load API tokens
        async function loadApiTokens() {
            try {
                const response = await fetch('/services/authservice/api/profile/tokens');
                const result = await response.json();
                if (result.success) {
                    renderTokens(result.data);
                }
            } catch (error) {
                console.error('Error loading tokens:', error);
            }
        }

        // Render tokens
        function renderTokens(tokens) {
            const tokensList = document.getElementById('tokensList');
            const noTokensMessage = document.getElementById('noTokensMessage');

            if (tokens.length === 0) {
                tokensList.innerHTML = '';
                noTokensMessage.classList.remove('d-none');
                return;
            }

            noTokensMessage.classList.add('d-none');
            const now = Date.now();
            tokensList.innerHTML = tokens.map(token => {
                const expMs = token.expiresAt ? new Date(token.expiresAt).getTime() : null;
                const isExpired = expMs !== null && expMs < now;
                const expiryLine = expMs === null
                    ? '<div class="token-date">Never expires</div>'
                    : (isExpired
                        ? `<div class="token-date"><span class="badge bg-danger">Expired</span> ${new Date(token.expiresAt).toLocaleDateString()}</div>`
                        : `<div class="token-date">Expires: ${new Date(token.expiresAt).toLocaleDateString()}</div>`);
                return `
                <div class="token-item">
                    <div class="token-info">
                        <div class="token-name">${escapeHtml(token.name)}</div>
                        <div class="token-prefix"><code>${escapeHtml(token.tokenPrefix)}</code></div>
                        <div class="token-date">Created: ${new Date(token.createdAt).toLocaleDateString()}</div>
                        ${token.lastUsed ? `<div class="token-date">Last used: ${new Date(token.lastUsed).toLocaleDateString()}</div>` : ''}
                        ${expiryLine}
                    </div>
                    <div class="token-actions">
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteToken('${escapeAttribute(token.id)}')">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>`;
            }).join('');
        }

        // Delete token
        async function deleteToken(tokenId) {
            if (!confirm('Delete this token? It cannot be undone.')) return;

            try {
                const response = await fetch(`/services/authservice/api/profile/tokens/${tokenId}`, {
                    method: 'DELETE'
                });
                if (response.ok) {
                    showAlert('Token deleted successfully', 'success');
                    loadApiTokens();
                }
            } catch (error) {
                showAlert('Error: ' + error.message, 'error');
            }
        }

        // Logout button — invalidate the bearer token server-side, then clear
        // local state and return to login. The API endpoint also tears down the
        // Passport / Express session and clears the session cookie.
        document.getElementById('logoutBtn')?.addEventListener('click', async function() {
            try {
                await fetch('/services/authservice/api/logout', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}'
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
            localStorage.removeItem('authToken'); // legacy key
            localStorage.removeItem('currentUser');
            window.location.href = '/services/authservice/views/login.html';
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function escapeAttribute(text) {
            return String(text ?? '').replace(/"/g, '&quot;');
        }
    
