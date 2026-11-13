        const redeemForm = document.getElementById('redeemForm');
        const invitationCode = document.getElementById('invitationCode');
        const checkCodeBtn = document.getElementById('checkCodeBtn');
        const errorAlert = document.getElementById('errorAlert');
        const statusAlert = document.getElementById('statusAlert');
        const codeStatusSection = document.getElementById('codeStatusSection');
        const codeStatus = document.getElementById('codeStatus');
        const passwordSection = document.getElementById('passwordSection');
        const formSection = document.getElementById('formSection');
        const successSection = document.getElementById('successSection');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        const strengthBar = document.getElementById('strengthBar');
        const strengthText = document.getElementById('strengthText');

        function showError(message) {
            errorAlert.textContent = message;
            errorAlert.classList.remove('d-none');
            statusAlert.classList.add('d-none');
            codeStatusSection.classList.add('d-none');
        }

        function hideError() {
            errorAlert.classList.add('d-none');
        }

        // Check invitation code status
        checkCodeBtn.addEventListener('click', async function() {
            hideError();
            const code = invitationCode.value.trim();

            if (!code) {
                showError('Please enter an invitation code');
                return;
            }

            checkCodeBtn.disabled = true;
            checkCodeBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Checking...';

            try {
                const response = await fetch(`/services/authservice/api/invitations/${code}`);
                const result = await response.json();

                if (result.success) {
                    const invitation = result.data;
                    codeStatusSection.classList.remove('d-none');

                    const statusLabel = document.getElementById('statusLabel');
                    const statusDetail = document.getElementById('statusDetail');

                    if (invitation.status === 'approved') {
                        codeStatus.className = 'invitation-status approved';
                        statusLabel.textContent = '✓ Approved';
                        statusDetail.textContent = `Your invitation is active. Expires: ${new Date(invitation.expiresAt).toLocaleDateString()}`;
                        passwordSection.classList.remove('d-none');
                    } else if (invitation.status === 'pending') {
                        codeStatus.className = 'invitation-status pending';
                        statusLabel.textContent = '⏳ Pending';
                        statusDetail.textContent = 'Your invitation is pending admin approval. Please wait.';
                        passwordSection.classList.add('d-none');
                    } else if (invitation.status === 'used') {
                        codeStatus.className = 'invitation-status expired';
                        statusLabel.textContent = '✗ Already Used';
                        statusDetail.textContent = 'This invitation has already been redeemed.';
                        passwordSection.classList.add('d-none');
                    } else {
                        codeStatus.className = 'invitation-status expired';
                        statusLabel.textContent = '✗ Invalid';
                        statusDetail.textContent = 'This invitation is no longer valid.';
                        passwordSection.classList.add('d-none');
                    }
                } else {
                    showError(result.error || 'Invitation code not found');
                    codeStatusSection.classList.add('d-none');
                }
            } catch (error) {
                showError('Error checking invitation: ' + error.message);
                codeStatusSection.classList.add('d-none');
            } finally {
                checkCodeBtn.disabled = false;
                checkCodeBtn.textContent = 'Check Code Status';
            }
        });

        // Password strength indicator
        passwordInput?.addEventListener('input', async function() {
            const password = this.value;

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

        // Form submission
        redeemForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            hideError();

            const code = invitationCode.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            if (password !== confirmPassword) {
                showError('Passwords do not match');
                return;
            }

            const submitBtn = redeemForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Creating Account...';

            try {
                const response = await fetch(`/services/authservice/api/invitations/${code}/redeem`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });

                const result = await response.json();

                if (result.success) {
                    formSection.classList.add('d-none');
                    successSection.classList.remove('d-none');
                } else {
                    showError(result.error || 'Failed to create account');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Create Account';
                }
            } catch (error) {
                showError('Network error: ' + error.message);
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Create Account';
            }
        });

        // Load branding if available
        async function loadBranding() {
            try {
                const response = await fetch('/services/authservice/api/branding');
                const result = await response.json();
                if (result.success && result.data) {
                    const brandingConfig = result.data;
                    if (brandingConfig.appName) {
                        document.getElementById('app-name').textContent = brandingConfig.appName;
                        document.getElementById('page-title').textContent = `Redeem Invitation - ${brandingConfig.appName}`;
                    }
                }
            } catch (error) {
                console.error('Failed to load branding:', error);
            }
        }

        loadBranding();

        // Auto-prefill the code from ?code=... and check it
        const urlParams = new URLSearchParams(window.location.search);
        const codeFromUrl = urlParams.get('code');
        if (codeFromUrl) {
            invitationCode.value = codeFromUrl;
            checkCodeBtn.click();
        }
    
