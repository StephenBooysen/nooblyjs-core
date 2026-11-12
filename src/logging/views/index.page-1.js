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
                    // Feature 23: the session lives in the httpOnly cookie only.
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
                    localStorage.removeItem('currentUser');
                    window.location.href = '/services/authservice/views/login.html?returnUrl=%2Fapplications%2Fdatasources';
                });
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            initializeHeaderUserProfile();
            if (typeof NooblyJSNavigation !== 'undefined') {
                NooblyJSNavigation.renderNavigation('navigation-sidebar', 'logging');
            }
        });

        // Load Swagger spec from external docs.json file
        async function initializeSwaggerUI() {
            try {
                // Fetch the Swagger specification from the external docs.json file
                const response = await fetch('/services/logging/api/swagger/docs.json');
                if (!response.ok) {
                    throw new Error(`Failed to load Swagger docs: ${response.status}`);
                }
                const spec = await response.json();

                // Initialize Swagger UI with the loaded spec
                initializeSwagger(spec);
            } catch (error) {
                console.error('Error loading Swagger documentation:', error);
                document.getElementById('swagger-ui').innerHTML = `
                    <div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;">
                        <strong>Error loading API documentation</strong><br>
                        Failed to load Swagger specification from docs.json<br>
                        Error: ${error.message}<br>
                        <button data-onclick="cspReload" style="margin-top: 10px; padding: 5px 10px;">Reload Page</button>
                    </div>
                `;
            }
        }

        // Initialize Swagger UI with the provided spec
        function initializeSwagger(spec) {
            // Ensure Swagger UI dependencies are loaded
            if (typeof SwaggerUIBundle === 'undefined') {
                console.error('SwaggerUIBundle not loaded');
                document.getElementById('swagger-ui').innerHTML = '<div style="color: red; padding: 20px; text-align: center;">Swagger UI failed to load. Please check your internet connection and refresh the page.</div>';
                return;
            }

            try {
                const container = document.getElementById('swagger-ui');
                container.innerHTML = '';

                const ui = SwaggerUIBundle({
                    spec: spec,
                    dom_id: '#swagger-ui',
                    deepLinking: false,
                    presets: [
                        SwaggerUIBundle.presets.apis
                    ],
                    plugins: [
                        SwaggerUIBundle.plugins.DownloadUrl
                    ],
                    layout: "BaseLayout",
                    validatorUrl: null,
                    tryItOutEnabled: true,
                    displayOperationId: false,
                    showExtensions: false,
                    showCommonExtensions: false,
                    docExpansion: 'list',
                    defaultModelsExpandDepth: 1,
                    defaultModelExpandDepth: 1,
                    filter: false,
                    showRequestHeaders: false,
                    supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch'],
                    onComplete: function() {
                        console.log('Swagger UI initialized successfully');
                        const topbar = document.querySelector('#swagger-ui .topbar');
                        if (topbar) {
                            topbar.style.display = 'none';
                        }
                        const swaggerContainer = document.querySelector('#swagger-ui');
                        if (swaggerContainer) {
                            swaggerContainer.style.fontFamily = 'inherit';
                        }
                    },
                    onFailure: function(error) {
                        console.error('Swagger UI initialization failed:', error);
                        document.getElementById('swagger-ui').innerHTML = '<div style="color: red; padding: 20px;">Failed to initialize API documentation: ' + error.message + '</div>';
                    }
                });

                window.swaggerUI = ui;

                setTimeout(function() {
                    const swaggerContent = document.querySelector('#swagger-ui .swagger-ui');
                    if (!swaggerContent) {
                        console.warn('Swagger UI may not have initialized properly');
                        document.getElementById('swagger-ui').innerHTML = '<div style="color: orange; padding: 20px;">API documentation is loading... If this message persists, please refresh the page.</div>';
                    }
                }, 3000);

            } catch (error) {
                console.error('Critical error initializing Swagger UI:', error);
                document.getElementById('swagger-ui').innerHTML = '<div style="color: red; padding: 20px; border: 1px solid red; border-radius: 4px;"><strong>Error loading API documentation</strong><br>Error: ' + error.message + '<br><button data-onclick="cspReload" style="margin-top: 10px; padding: 5px 10px;">Reload Page</button></div>';
            }
        }

        // Initialize: Load analytics and Swagger docs on page load
        document.addEventListener('DOMContentLoaded', function () {
            initializeSwaggerUI();

            // Load data analytics when tab is shown
            document.getElementById('data-tab').addEventListener('shown.bs.tab', function() {
                // Data analytics loading handled by script.js
            });
        });
    
