/**
 * @fileoverview Centralized Navigation System for NooblyJS Services
 * Dynamically generates navigation sidebar with online/offline status indicators.
 * Manages service discovery, status monitoring, and user-driven classification grouping
 * for all core, business, application, and advanced services.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

/**
 * @typedef {Object} ServiceConfig
 * @property {string} name - Unique service identifier (e.g., 'caching', 'workflow')
 * @property {string} icon - Bootstrap icon class (e.g., 'bi-server')
 * @property {string} title - Display title for the service
 * @property {string} path - URL path for the service (e.g., '/services/caching')
 * @property {string} classification - Service tier ('foundation', 'business', 'application', 'advanced')
 */

/**
 * @typedef {Object} ServiceStatus
 * @property {string} name - Service name identifier
 * @property {boolean} online - Whether the service is currently online
 */

/**
 * @typedef {Object} ClassificationConfig
 * @property {string} label - Display label for the classification
 * @property {string} icon - Bootstrap icon class for the classification group
 * @property {string} description - Human-readable description of the classification
 */

/**
 * NooblyJS Navigation System
 * Provides service discovery, status monitoring, and interactive navigation UI generation.
 * Manages grouped service navigation with dynamic online/offline status indicators.
 *
 * @namespace NooblyJSNavigation
 * @type {Object}
 */
const NooblyJSNavigation = {
    /**
     * Array of all available services with configuration and metadata
     * Organized into 4 classifications: foundation, business, application, advanced
     * Each service includes display properties (title, icon) and routing path
     *
     * @type {Array<ServiceConfig>}
     */
    services: [
        // Foundation (Infrastructure) Services
        { name: 'logging', icon: 'bi-journal-text', title: 'Logging', path: 'logging', classification: 'foundation' },
        { name: 'caching', icon: 'bi-server', title: 'Caching', path: 'caching', classification: 'foundation' },
        { name: 'queueing', icon: 'bi-list-task', title: 'Queueing', path: 'queueing', classification: 'foundation' },
        { name: 'fetching', icon: 'bi-globe', title: 'Fetching', path: 'fetching', classification: 'foundation' },
        { name: 'settings', icon: 'bi-sliders', title: 'Settings', path: 'settings', classification: 'foundation' },

        // Business Services
        { name: 'notifying', icon: 'bi-bell-fill', title: 'Notifications', path: 'notifying', classification: 'business' },
        { name: 'dataservice', icon: 'bi-database', title: 'Data Service', path: 'dataservice', classification: 'business' },
        { name: 'working', icon: 'bi-gear-fill', title: 'Working', path: 'working', classification: 'business' },
        { name: 'measuring', icon: 'bi-graph-up', title: 'Measuring', path: 'measuring', classification: 'business' },

        // Application Services
        { name: 'scheduling', icon: 'bi-alarm-fill', title: 'Scheduling', path: 'scheduling', classification: 'application' },
        { name: 'searching', icon: 'bi-search', title: 'Searching', path: 'searching', classification: 'application' },
        { name: 'workflow', icon: 'bi-diagram-3-fill', title: 'Workflows', path: 'workflow', classification: 'application' },
        { name: 'filing', icon: 'bi-folder-fill', title: 'Filing', path: 'filing', classification: 'application' },

        // Advanced Application Services
        { name: 'authservice', icon: 'bi-lock-fill', title: 'Authentication', path: 'authservice', classification: 'advanced' },
        { name: 'ai', icon: 'bi-robot', title: 'AI Service', path: 'ai', classification: 'advanced' },
        { name: 'knowledge', icon: 'bi-book', title: 'Knowledge', path: 'knowledge', classification: 'advanced' }
    ],

    /**
     * Current online/offline status for each service
     * Keyed by service name, values are boolean (true = online, false = offline)
     * Populated by checkAllStatuses() method
     *
     * @type {Object<string, boolean>}
     * @private
     */
    serviceStatus: {},

    /**
     * Classification configuration for grouping and displaying services in navigation
     * Defines labels, icons, and descriptions for each service tier
     *
     * @type {Object<string, ClassificationConfig>}
     * @private
     */
    classifications: {
        foundation: {
            label: 'Infrastructure',
            icon: 'bi-puzzle-fill',
            description: 'Core foundational services'
        },
        business: {
            label: 'Business',
            icon: 'bi-briefcase-fill',
            description: 'Business logic services'
        },
        application: {
            label: 'Application',
            icon: 'bi-layers-fill',
            description: 'Application services'
        },
        advanced: {
            label: 'Advanced',
            icon: 'bi-star-fill',
            description: 'Advanced services'
        }
    },

    /**
     * Checks the online/offline status of all services by querying their status endpoints.
     * Populates the serviceStatus object with boolean values for each service.
     * Services that fail to respond are marked as offline.
     *
     * @return {Promise<Object<string, boolean>>} Promise that resolves to service status map
     *         with service names as keys and online status (boolean) as values
     * @throws Does not throw - catches all errors and marks services as offline
     *
     * @example
     * // Check all service statuses
     * const status = await NooblyJSNavigation.checkAllStatuses();
     * console.log(status); // { logging: true, caching: false, workflow: true, ... }
     *
     * @example
     * // Use in navigation rendering
     * await NooblyJSNavigation.checkAllStatuses();
     * const onlineServices = NooblyJSNavigation.getOnlineServices();
     */
    async checkAllStatuses() {
        const statusPromises = this.services.map(async (service) => {
            try {
                const response = await fetch(`/services/${service.path}/api/status`);
                this.serviceStatus[service.name] = response.ok;
                return { name: service.name, online: response.ok };
            } catch (error) {
                this.serviceStatus[service.name] = false;
                return { name: service.name, online: false };
            }
        });

        await Promise.all(statusPromises);
        return this.serviceStatus;
    },

    /**
     * Retrieves all services that are currently online.
     * Filters the services array based on the current serviceStatus.
     * Must call checkAllStatuses() first to populate serviceStatus.
     *
     * @return {Array<ServiceConfig>} Array of online service configurations
     *
     * @example
     * // Get online services after status check
     * await NooblyJSNavigation.checkAllStatuses();
     * const onlineServices = NooblyJSNavigation.getOnlineServices();
     * console.log(`${onlineServices.length} services online`);
     */
    getOnlineServices() {
        return this.services.filter(service => this.serviceStatus[service.name] === true);
    },

    /**
     * Retrieves all services that are currently offline.
     * Filters the services array based on the current serviceStatus.
     * Must call checkAllStatuses() first to populate serviceStatus.
     *
     * @return {Array<ServiceConfig>} Array of offline service configurations
     *
     * @example
     * // Check for offline services
     * const offlineServices = NooblyJSNavigation.getOfflineServices();
     * if (offlineServices.length > 0) {
     *   console.warn(`${offlineServices.length} services offline:`, offlineServices);
     * }
     */
    getOfflineServices() {
        return this.services.filter(service => this.serviceStatus[service.name] === false);
    },

    /**
     * Renders the navigation sidebar into the specified DOM container.
     * Checks all service statuses, groups services by classification, and generates
     * interactive HTML with status indicators and expandable sections.
     * The rendered navigation includes Home link and service sections grouped by
     * classification (Infrastructure, Business, Application, Advanced).
     *
     * @param {string} containerId - ID of the DOM element to render navigation into
     * @param {string} [activeService='home'] - Name of the currently active service
     *                 to highlight. Use 'home' for the dashboard or service name (e.g., 'caching')
     * @return {Promise<void>} Promise that resolves when navigation is fully rendered
     * @throws Does not throw - handles errors gracefully and continues rendering
     *
     * @example
     * // Render navigation for the home/dashboard page
     * await NooblyJSNavigation.renderNavigation('nav-container');
     *
     * @example
     * // Render navigation highlighting active service
     * await NooblyJSNavigation.renderNavigation('nav-container', 'caching');
     */
    async renderNavigation(containerId, activeService = 'home') {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Check all service statuses first
        await this.checkAllStatuses();

        // Build navigation HTML (core-sidebar-* classes from /services/css/core.css)
        let navHTML = `
            <div class="core-sidebar-section">
                <a href="/services" class="core-sidebar-item ${activeService === 'home' ? 'active' : ''}">
                    <i class="bi bi-house-door"></i> Home
                </a>
            </div>
        `;

        // Group services by classification
        const servicesByClassification = {};
        this.services.forEach(service => {
            const classification = service.classification || 'foundation';
            if (!servicesByClassification[classification]) {
                servicesByClassification[classification] = [];
            }
            servicesByClassification[classification].push(service);
        });

        // Render each classification
        const classificationOrder = ['foundation', 'business', 'application', 'advanced'];
        classificationOrder.forEach(classification => {
            const services = servicesByClassification[classification] || [];
            if (services.length === 0) return;

            const classConfig = this.classifications[classification];
            const onlineCount = services.filter(s => this.serviceStatus[s.name] === true).length;

            navHTML += `
                <div class="core-sidebar-section">
                    <div class="core-sidebar-title" role="button" style="cursor: pointer;" data-onclick="NooblyJSNavigation.toggleClassificationNav" data-onclick-args="${nooblyArgs(classification)}">
                        <span><i class="bi ${classConfig.icon}"></i> ${classConfig.label}</span>
                        <span class="toggle" id="toggle-icon-${classification}">▼</span>
                    </div>
                    <div id="nav-services-${classification}" style="display: block;">
            `;

            services.forEach(service => {
                const isOnline = this.serviceStatus[service.name] === true;
                const isActive = activeService === service.name ? 'active' : '';

                navHTML += `
                    <a href="/services/${service.path}/" class="core-sidebar-item ${isActive}">
                        <i class="bi ${service.icon}"></i> ${service.title}
                        <span class="core-status-indicator ${isOnline ? '' : 'offline'}" title="${isOnline ? 'Online' : 'Offline'}"></span>
                    </a>
                `;
            });

            navHTML += `</div></div>`;
        });

        container.innerHTML = navHTML;

        // Initialize auth display
        this.initializeAuth();
    },

    /**
     * Toggles the visibility of a service classification section in the navigation sidebar.
     * Opens closed sections and closes open sections. Updates the toggle indicator icon
     * (▼ for collapsed, ▲ for expanded). Called by section header onclick handlers.
     *
     * @param {string} classification - The classification key to toggle
     *                 ('foundation', 'business', 'application', or 'advanced')
     * @return {void}
     * @throws Does not throw - safely handles missing DOM elements
     *
     * @example
     * // Toggle the 'foundation' services section
     * NooblyJSNavigation.toggleClassificationNav('foundation');
     *
     * @example
     * // Used as onclick handler in navigation
     * data-onclick="NooblyJSNavigation.toggleClassificationNav" data-onclick-args="[&quot;business&quot;]"
     */
    toggleClassificationNav(classification) {
        const section = document.getElementById(`nav-services-${classification}`);
        const toggleIcon = document.getElementById(`toggle-icon-${classification}`);

        if (section && toggleIcon) {
            if (section.style.display === 'none') {
                section.style.display = 'block';
                toggleIcon.textContent = '▲';
            } else {
                section.style.display = 'none';
                toggleIcon.textContent = '▼';
            }
        }
    },

    /**
     * Legacy method for toggling offline services visibility.
     * Deprecated in favor of toggleClassificationNav() which provides a more flexible
     * classification-based grouping system.
     * Kept for backward compatibility but no longer actively used.
     *
     * @deprecated Use {@link toggleClassificationNav} instead
     * @return {void}
     *
     * @example
     * // This method is legacy and should not be used in new code
     * NooblyJSNavigation.toggleOfflineNav(); // No effect
     */
    toggleOfflineNav() {
        // Legacy method - now using toggleClassificationNav
    },

    /**
     * Initializes authentication display in the navigation.
     * This method is kept for backward compatibility but authentication initialization
     * has been moved to the main header rendering via renderHeaderUserProfile() function.
     * No-op implementation that maintains the existing API.
     *
     * @deprecated Authentication is now handled in header rendering
     * @return {void}
     *
     * @example
     * // Called internally during navigation initialization
     * NooblyJSNavigation.initializeAuth();
     */
    initializeAuth() {
        // Auth is now handled in header via renderHeaderUserProfile()
        // This method kept for compatibility but auth init happens in header
    }
};

/**
 * Export the navigation system to global scope for use in HTML onclick handlers
 * and dynamic script interactions.
 *
 * @type {Object}
 * @global
 */
window.NooblyJSNavigation = NooblyJSNavigation;
