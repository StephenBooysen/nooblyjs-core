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
                document.getElementById('page-title').textContent = `Register - ${brandingConfig.appName}`;
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

        // Load branding on page load
        loadBranding();

        // Wire up signin and redeem links with returnUrl passthrough
        {
            const urlParams = new URLSearchParams(window.location.search);
            const returnUrl = urlParams.get('returnUrl');

            const signinLink = document.getElementById('signin-link');
            const redeemLink = document.getElementById('redeem-link');

            signinLink.href = returnUrl
                ? '/services/authservice/views/login.html?returnUrl=' + encodeURIComponent(returnUrl)
                : '/services/authservice/views/login.html';

            redeemLink.href = '/services/authservice/redeem-invitation';
        }

        // Redirect already-authenticated users
        {
            fetch('/services/authservice/api/session', { credentials: 'same-origin' })
                .then(r => r.json())
                .then(result => { if (result.authenticated) window.location.href = '/services'; })
                .catch(() => {});
        }

    
