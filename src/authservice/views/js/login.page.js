        /**
         * Only same-site paths may be used as a post-login redirect (blocks
         * open redirects via //host, /\\host, https://host, javascript:).
         * @param {?string} value - Raw returnUrl
         * @return {?string} The path, or null if unsafe
         */
        function safeReturnUrl(value) {
            return typeof value === 'string' && /^\/(?![\/\\])/.test(value) ? value : null;
        }

        // Mark page as loading to hide content until branding is applied
        document.body.classList.add('loading');

        // Load and apply branding configuration
        let brandingConfig = null;

        async function loadBranding() {
            try {
                const response = await fetch('/services/authservice/api/branding');
                const result = await response.json();

                if (result.success && result.data) {
                    brandingConfig = result.data;
                    applyBranding();
                }
            } catch (error) {
                console.error('Failed to load branding configuration:', error);
            } finally {
                // Show page (either with branding applied or defaults)
                showPage();
            }
        }

        function applyBranding() {
            if (!brandingConfig) return;

            // Update page title
            if (brandingConfig.appName) {
                document.getElementById('page-title').textContent = `Login - ${brandingConfig.appName}`;
            }

            // Update app name display
            const appNameEl = document.getElementById('app-name');
            if (brandingConfig.appName) {
                appNameEl.textContent = brandingConfig.appName;
            }

            // Add logo if provided (use default NooblyJS logo if not)
            const logoContainer = document.getElementById('logo-container');
            const logoUrl = brandingConfig.logoUrl || '/images/nooblyjs-logo.png';
            logoContainer.innerHTML = `<img src="${logoUrl}" alt="${brandingConfig.appName || 'Logo'}" style="max-height: 80px; width: auto; margin-bottom: 1rem;"><div class="auth-logo" id="app-name">${brandingConfig.appName || 'NooblyJS'}</div>`;

            // Apply custom colors to CSS variables.
            // Note: the primary color is intentionally fixed (the NooblyJS accent) on this
            // shared auth screen for cross-site consistency, so any per-site
            // brandingConfig.primaryColor is deliberately ignored here.
            const root = document.documentElement;
            if (brandingConfig.secondaryColor) {
                root.style.setProperty('--custom-secondary', brandingConfig.secondaryColor);
            }
            if (brandingConfig.warningColor) {
                root.style.setProperty('--custom-warning', brandingConfig.warningColor);
            }

            // Load custom stylesheet if provided
            if (brandingConfig.stylesheetUrl) {
                const stylesheetLink = document.getElementById('custom-stylesheet');
                stylesheetLink.href = brandingConfig.stylesheetUrl;
            }
        }

        function showPage() {
            // Remove loading class to show page with branding applied
            document.body.classList.remove('loading');
        }

        // NOTE: branding + existing-auth handling are kicked off by decideEntry()
        // at the very bottom of this script, but only when we are NOT auto-bouncing
        // to SSO. Don't call loadBranding() here or the form/branding would render
        // for a frame before the SSO redirect.

        const loginForm = document.getElementById('login-form');
        const loginBtn = document.getElementById('login-btn');
        const errorMessage = document.getElementById('error-message');
        const successMessage = document.getElementById('success-message');
        const createAccountBtn = document.querySelector('a[href*="request-invitation"]');

        function showError(message) {
            loginBtn.textContent = message || 'Login failed try again';
            loginBtn.classList.add('btn-error');
            errorMessage.classList.add('d-none');
            successMessage.classList.add('d-none');
            if (createAccountBtn) {
                createAccountBtn.classList.add('btn-highlight');
            }
        }

        function showSuccess(message) {
            successMessage.textContent = message;
            successMessage.classList.remove('d-none');
            errorMessage.classList.add('d-none');
            loginBtn.classList.remove('btn-error');
            if (createAccountBtn) {
                createAccountBtn.classList.remove('btn-highlight');
            }
        }

        function hideMessages() {
            errorMessage.classList.add('d-none');
            successMessage.classList.add('d-none');
            loginBtn.classList.remove('btn-error');
            loginBtn.textContent = 'Sign In';
            if (createAccountBtn) {
                createAccountBtn.classList.remove('btn-highlight');
            }
        }

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideMessages();

            const formData = new FormData(loginForm);
            const urlParams = new URLSearchParams(window.location.search);
            const returnUrl = safeReturnUrl(urlParams.get('returnUrl'));

            const loginData = {
                email: formData.get('email'),
                password: formData.get('password')
            };

            // Include returnUrl in request if available
            if (returnUrl) {
                loginData.returnUrl = returnUrl;
            }

            let isRedirecting = false;
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Signing in...';

            try {
                const response = await fetch('/services/authservice/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(loginData)
                });

                const result = await response.json();

                if (result.success) {
                    // Feature 23: the session cookie is the credential; no token in storage.
                    localStorage.removeItem('authToken');
                    localStorage.setItem('currentUser', JSON.stringify(result.data.user));

                    // Update button to show redirecting status
                    isRedirecting = true;
                    loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Redirecting...';
                    loginBtn.disabled = true;

                    // Use redirectUrl from server response, fallback to returnUrl or default
                    const redirectUrl = result.redirectUrl || returnUrl || brandingConfig?.homeUrl || '/services';

                    setTimeout(() => {
                        window.location.href = redirectUrl;
                    }, 1500);
                } else {
                    showError('Login failed try again');
                }
            } catch (error) {
                showError('Network error - try again');
                console.error('Login error:', error);
            } finally {
                // Only reset button if not redirecting
                if (!isRedirecting) {
                    loginBtn.disabled = false;
                    // Only reset text if button doesn't have error class
                    if (!loginBtn.classList.contains('btn-error')) {
                        loginBtn.textContent = 'Sign In';
                    }
                }
            }
        });

        function checkExistingAuth() {
            const checkingDiv = document.getElementById('checking-auth');
            const loginForm = document.getElementById('login-form');
            const loginActions = document.getElementById('login-actions');
            localStorage.removeItem('authToken'); // legacy key from before feature 23

            // The session cookie decides: a signed-in browser goes straight through.
            checkingDiv.classList.remove('d-none');
            fetch('/services/authservice/api/auth/check', { credentials: 'same-origin' })
                .then(response => response.json())
                .then(result => {
                    if (result.authenticated) {
                        const urlParams = new URLSearchParams(window.location.search);
                        const returnUrl = safeReturnUrl(urlParams.get('returnUrl')) || brandingConfig?.homeUrl || '/services';
                        showSuccess('Already logged in! Redirecting...');
                        setTimeout(() => { window.location.href = returnUrl; }, 1000);
                    } else {
                        showLoginForm();
                    }
                })
                .catch(() => showLoginForm());

            function showLoginForm() {
                checkingDiv.classList.add('d-none');
                loginForm.classList.remove('d-none');
                loginActions.classList.remove('d-none');
            }
        }

        // Decide how to enter this page:
        //   • ?local=1             → always show the credential form (admin escape hatch)
        //   • SSO enabled          → bounce straight to the IdP; no form is ever shown
        //   • otherwise / on error → fall back to the normal local login form
        // Kept at the bottom so every helper and `let`/`const` above is initialized
        // before it runs (avoids a temporal-dead-zone error on the synchronous path).
        (function decideEntry() {
            const params = new URLSearchParams(window.location.search);
            const forceLocal = params.get('local') === '1';
            const returnUrl = safeReturnUrl(params.get('returnUrl')) || '';

            function startLocalLogin() {
                loadBranding();
                checkExistingAuth();
            }

            if (forceLocal) {
                startLocalLogin();
                return;
            }

            // Probe whether a redirect-based SSO provider (Entra) is configured.
            // The page is still hidden (body.loading), so if we redirect there is
            // no visible flash; any failure falls back to the local form.
            fetch('/services/authservice/api/sso-config', { credentials: 'include' })
                .then(r => (r.ok ? r.json() : null))
                .then(cfg => {
                    const data = cfg && cfg.data;
                    if (data && data.enabled && data.initiateUrl) {
                        const q = returnUrl ? ('?returnUrl=' + encodeURIComponent(returnUrl)) : '';
                        window.location.replace(data.initiateUrl + q);
                    } else {
                        startLocalLogin();
                    }
                })
                .catch(startLocalLogin);
        })();
    
