/**
 * @fileoverview Header User Profile Initialization
 * Manages user authentication display in the page header.
 * Hides/shows the user dropdown based on login status and handles logout functionality.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

/**
 * Initializes the header user profile display and logout functionality.
 * Checks for authenticated user in localStorage and conditionally displays
 * the user dropdown. Sets up logout button to clear auth and redirect to login.
 *
 * @return {void}
 *
 * @example
 * // Call in DOMContentLoaded event
 * document.addEventListener('DOMContentLoaded', () => {
 *   initializeHeaderUserProfile();
 * });
 */
function initializeHeaderUserProfile() {
    const currentUser = localStorage.getItem('currentUser');
    const userDropdown = document.querySelector('.core-user-dropdown');

    if (currentUser) {
        try {
            const user = JSON.parse(currentUser);
            const userName = user.fullName || user.email || 'User';
            const initials = userName.substring(0, 1).toUpperCase();

            const headerUserAvatar = document.getElementById('headerUserAvatar');
            const headerUserLabel = document.getElementById('headerUserLabel');
            const headerUserName = document.getElementById('headerUserName');

            if (headerUserAvatar) headerUserAvatar.textContent = initials;
            if (headerUserLabel) headerUserLabel.textContent = 'User';
            if (headerUserName) headerUserName.textContent = userName;

            // Show user dropdown when user is logged in
            if (userDropdown) userDropdown.style.display = 'block';
        } catch (e) {
            console.error('Error parsing user data:', e);
            // Hide dropdown on error
            if (userDropdown) userDropdown.style.display = 'none';
        }
    } else {
        // Hide user dropdown when no user is logged in
        if (userDropdown) userDropdown.style.display = 'none';
    }

    // Setup logout functionality
    const headerLogoutBtn = document.getElementById('headerLogoutBtn');
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

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHeaderUserProfile);
} else {
    initializeHeaderUserProfile();
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = initializeHeaderUserProfile;
}
