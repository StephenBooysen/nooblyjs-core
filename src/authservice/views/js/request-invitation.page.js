        const invitationForm = document.getElementById('invitationForm');
        const submitBtn = document.getElementById('submitBtn');
        const errorAlert = document.getElementById('errorAlert');
        const formSection = document.getElementById('formSection');
        const successSection = document.getElementById('successSection');
        const invitationCode = document.getElementById('invitationCode');
        const copyCodeBtn = document.getElementById('copyCodeBtn');
        const redeemLink = document.getElementById('redeemLink');
        const redeemPageLink = document.getElementById('redeemPageLink');
        const redeemNowBtn = document.getElementById('redeemNowBtn');

        // Set redeem links
        redeemLink.href = '/services/authservice/redeem-invitation';
        redeemPageLink.href = '/services/authservice/redeem-invitation';

        function showError(message) {
            errorAlert.textContent = message;
            errorAlert.classList.remove('d-none');
            window.scrollTo(0, 0);
        }

        function hideError() {
            errorAlert.classList.add('d-none');
        }

        invitationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideError();

            const formData = new FormData(invitationForm);
            const invitationData = {
                name: formData.get('fullName'),
                email: formData.get('email'),
                mobile: formData.get('mobile') || undefined
            };

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Submitting...';

            try {
                const response = await fetch('/services/authservice/api/invitations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(invitationData)
                });

                const result = await response.json();

                if (result.success) {
                    const code = result.data.code;
                    formSection.classList.add('d-none');
                    successSection.classList.remove('d-none');
                    if (code) {
                        // Open mode only: the code is issued immediately.
                        invitationCode.textContent = code;
                        // Pre-fill the code on the redeem page so the user doesn't have to re-type it
                        const redeemUrl = `/services/authservice/redeem-invitation?code=${encodeURIComponent(code)}`;
                        redeemNowBtn.href = redeemUrl;
                        redeemPageLink.href = redeemUrl;
                    } else {
                        // Default: an administrator reviews the request and sends the code.
                        invitationCode.closest('.invitation-code')?.classList.add('d-none');
                        redeemNowBtn.classList.add('d-none');
                        redeemPageLink.classList.add('d-none');
                        const notice = document.createElement('p');
                        notice.className = 'mb-0';
                        notice.textContent = 'Thanks. Your request is with an administrator, who will send you an invitation code once it is approved.';
                        successSection.prepend(notice);
                    }
                } else {
                    showError(result.error || 'Failed to request invitation');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Request Invitation';
                }
            } catch (error) {
                showError('Network error: ' + error.message);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Request Invitation';
            }
        });

        copyCodeBtn.addEventListener('click', function() {
            const code = invitationCode.textContent;
            navigator.clipboard.writeText(code).then(() => {
                const originalText = copyCodeBtn.innerHTML;
                copyCodeBtn.innerHTML = '<i class="bi bi-check"></i> Copied!';
                setTimeout(() => {
                    copyCodeBtn.innerHTML = originalText;
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy:', err);
            });
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
                        document.getElementById('page-title').textContent = `Request Invitation - ${brandingConfig.appName}`;
                    }
                }
            } catch (error) {
                console.error('Failed to load branding:', error);
            }
        }

        loadBranding();
    
