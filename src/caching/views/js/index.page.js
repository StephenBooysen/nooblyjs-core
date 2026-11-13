        // Initialize header user profile
        function initializeHeaderUserProfile() {
            const currentUser = localStorage.getItem('currentUser');
            const headerUserAvatar = document.getElementById('headerUserAvatar');
            const headerUserLabel = document.getElementById('headerUserLabel');
            const headerUserName = document.getElementById('headerUserName');
            const headerLogoutBtn = document.getElementById('headerLogoutBtn');

            if (currentUser) {
                try {
                    const user = JSON.parse(currentUser);
                    const userName = user.fullName || user.email || 'User';
                    const initials = userName.substring(0, 1).toUpperCase();

                    if (headerUserAvatar) headerUserAvatar.textContent = initials;
                    if (headerUserLabel) headerUserLabel.textContent = 'User';
                    if (headerUserName) headerUserName.textContent = userName;
                } catch (e) {
                    console.error('Error parsing user data:', e);
                }
            }

            // Setup logout functionality
            if (headerLogoutBtn) {
                headerLogoutBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
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
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('currentUser');
                    window.location.href = '/services/authservice/views/login.html?returnUrl=%2Fapplications%2Fdatasources';
                });
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            initializeHeaderUserProfile();
            if (typeof NooblyJSNavigation !== 'undefined') {
                NooblyJSNavigation.renderNavigation('navigation-sidebar', 'caching');
            }
        });
    
