/**
 * UIService - A comprehensive Bootstrap 5 UI component library
 * Provides methods to create common UI components and layouts
 */
class UIService {
  constructor(options = {}) {
    this.options = options;
    this.containerId = options.containerId || 'App';
    this.theme = options.theme || 'light';
  }

  /**
   * Create a header/navbar component
   * @param {Object} config - Header configuration
   * @returns {HTMLElement}
   */
  createHeader(config = {}) {
    const {
      brandText = 'NooblyJS',
      brandSubtext = '',
      brandIcon = '/images/nooblyjs-logo.png',
      showSearch = true,
      searchPlaceholder = 'Search…',
      showCreateBtn = true,
      showAIChat = true,
      showUserProfile = true,
      userProfile = { name: 'Admin User', role: 'Administrator', initials: 'AD' },
      onProfileClick = null,
      onSettingsClick = null,
      onLogoutClick = null
    } = config;

    // App shell (core.css) — keeps the legacy classes (.core-app-header / .navbar-nav)
    // so callers that still query them continue to work.
    const header = document.createElement('header');
    header.className = 'navbar navbar-expand-lg core-app-header core-topbar';

    // Brand block (logo + title + optional subtitle)
    const brand = document.createElement('div');
    brand.className = 'core-brand navbar-brand d-flex align-items-center';
    brand.style.cssText = 'border-right: 0; white-space: nowrap; color: #FFF';

    if (brandIcon) {
      const img = document.createElement('img');
      img.src = brandIcon;
      img.alt = brandText;
      img.style.cssText = 'width: 32px; height: 32px; border-radius: 7px; object-fit: contain; background: #fff; padding: 2px; flex-shrink: 0;';
      brand.appendChild(img);
    }

    const brandTextWrap = document.createElement('div');
    brandTextWrap.className = 'name';
    brandTextWrap.style.whiteSpace = 'nowrap';
    brandTextWrap.textContent = brandText;
    if (brandSubtext) {
      const small = document.createElement('small');
      small.textContent = brandSubtext;
      brandTextWrap.appendChild(small);
    }
    brand.appendChild(brandTextWrap);
    header.appendChild(brand);

    // Search bar (core-search slot)
    if (showSearch) {
      const searchDiv = document.createElement('div');
      searchDiv.className = 'core-search';

      const wrap = document.createElement('div');
      wrap.className = 'wrap';
      wrap.style.maxWidth = 'none';
      wrap.innerHTML = '<i class="bi bi-search"></i>';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'core-search-input';
      searchInput.placeholder = searchPlaceholder;
      wrap.appendChild(searchInput);

      const kbd = document.createElement('span');
      kbd.className = 'kbd';
      kbd.textContent = '⌘K';
      wrap.appendChild(kbd);

      searchDiv.appendChild(wrap);
      header.appendChild(searchDiv);
    } else {
      // Empty 1fr spacer so the topbar grid still has three columns
      const spacer = document.createElement('div');
      header.appendChild(spacer);
    }

    // Right-hand actions
    const navDiv = document.createElement('div');
    navDiv.className = 'navbar-nav core-topbar-actions';

    // Create dropdown
    if (showCreateBtn) {
      const createDropdown = document.createElement('div');
      createDropdown.className = 'dropdown';

      const createBtn = document.createElement('button');
      createBtn.className = 'core-btn-create dropdown-toggle';
      createBtn.type = 'button';
      createBtn.setAttribute('data-bs-toggle', 'dropdown');
      createBtn.innerHTML = '<i class="bi bi-plus-lg"></i> Create';

      const createMenu = document.createElement('ul');
      createMenu.className = 'dropdown-menu';

      const createItem1 = document.createElement('li');
      createItem1.innerHTML = '<a class="dropdown-item" href="#"><i class="bi bi-folder-plus me-2"></i>New Folder</a>';
      createMenu.appendChild(createItem1);

      const createItem2 = document.createElement('li');
      createItem2.innerHTML = '<a class="dropdown-item" href="#"><i class="bi bi-file-earmark-plus me-2"></i>New Item</a>';
      createMenu.appendChild(createItem2);

      createDropdown.appendChild(createBtn);
      createDropdown.appendChild(createMenu);
      navDiv.appendChild(createDropdown);
    }

    // AI Chat toggle
    if (showAIChat) {
      const aiBtn = document.createElement('button');
      aiBtn.className = 'core-icon-btn';
      aiBtn.title = 'Toggle AI Assistant';
      aiBtn.innerHTML = '<i class="bi bi-robot"></i>';
      navDiv.appendChild(aiBtn);
    }

    // User profile (core-user)
    if (showUserProfile) {
      const profileDiv = document.createElement('div');
      profileDiv.className = 'nav-item dropdown';

      const pill = document.createElement('a');
      pill.className = 'core-user dropdown-toggle';
      pill.href = '#';
      pill.style.textDecoration = 'none';
      pill.setAttribute('data-bs-toggle', 'dropdown');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = userProfile.name || 'User';
      pill.appendChild(nameSpan);

      const av = document.createElement('div');
      av.className = 'av';
      av.textContent = userProfile.initials || 'U';
      pill.appendChild(av);

      const profileMenu = document.createElement('ul');
      profileMenu.className = 'dropdown-menu dropdown-menu-end';

      const menuItem1 = document.createElement('li');
      menuItem1.innerHTML = '<a class="dropdown-item" href="#"><i class="bi bi-person me-2"></i>Profile</a>';
      if (onProfileClick) menuItem1.querySelector('a').addEventListener('click', onProfileClick);
      profileMenu.appendChild(menuItem1);

      const menuItem2 = document.createElement('li');
      menuItem2.innerHTML = '<a class="dropdown-item" href="#"><i class="bi bi-gear me-2"></i>Settings</a>';
      if (onSettingsClick) menuItem2.querySelector('a').addEventListener('click', onSettingsClick);
      profileMenu.appendChild(menuItem2);

      const divider = document.createElement('li');
      divider.innerHTML = '<hr class="dropdown-divider">';
      profileMenu.appendChild(divider);

      const menuItem3 = document.createElement('li');
      menuItem3.innerHTML = '<a class="dropdown-item" href="#"><i class="bi bi-box-arrow-right me-2"></i>Logout</a>';
      if (onLogoutClick) menuItem3.querySelector('a').addEventListener('click', onLogoutClick);
      profileMenu.appendChild(menuItem3);

      profileDiv.appendChild(pill);
      profileDiv.appendChild(profileMenu);
      navDiv.appendChild(profileDiv);
    }

    header.appendChild(navDiv);
    return header;
  }

  /**
   * Create a left sidebar with navigation
   * @param {Object} config - Sidebar configuration
   * @returns {HTMLElement}
   */
  createLeftSidebar(config = {}) {
    const {
      sections = [],
      resizable = true
    } = config;

    const aside = document.createElement('aside');
    aside.id = 'leftSidebar';
    aside.className = 'core-app-sidebar core-sidebar';

    sections.forEach(section => {
      const sectionDiv = document.createElement('div');
      sectionDiv.className = 'core-sidebar-section';

      // Section header (core-sidebar-title — small uppercase label)
      if (section.title) {
        const headDiv = document.createElement('div');
        headDiv.className = 'core-sidebar-title';
        if (section.collapsible) {
          headDiv.setAttribute('data-bs-toggle', 'collapse');
          headDiv.setAttribute('data-bs-target', `#${section.id}-content`);
          headDiv.setAttribute('role', 'button');
          headDiv.style.cursor = 'pointer';
        }

        const titleSpan = document.createElement('span');
        titleSpan.textContent = section.title;
        headDiv.appendChild(titleSpan);

        if (section.collapsible) {
          const chev = document.createElement('i');
          chev.className = 'bi bi-chevron-down';
          chev.style.cssText = 'font-size: 9px; color: var(--neutral-dot, #8F837C);';
          headDiv.appendChild(chev);
        }

        sectionDiv.appendChild(headDiv);
      }

      // Section content (core-sidebar-item rows)
      if (section.items) {
        const contentDiv = document.createElement('div');
        contentDiv.id = `${section.id}-content`;
        if (section.collapsible) {
          contentDiv.className = 'collapse show';
        }

        section.items.forEach(item => {
          const link = document.createElement('a');
          link.className = 'core-sidebar-item nav-link';
          if (item.active) link.classList.add('active');
          link.href = item.href || '#';

          if (item.icon) {
            const iconEl = document.createElement('i');
            iconEl.className = `bi ${item.icon}`;
            link.appendChild(iconEl);
          }

          const text = document.createTextNode(' ' + item.text);
          link.appendChild(text);

          if (item.count != null) {
            const countSpan = document.createElement('span');
            countSpan.className = 'count';
            countSpan.textContent = item.count;
            link.appendChild(countSpan);
          }

          if (item.onClick) {
            link.addEventListener('click', item.onClick);
          }

          contentDiv.appendChild(link);
        });

        sectionDiv.appendChild(contentDiv);
      }

      aside.appendChild(sectionDiv);
    });

    if (resizable) {
      const handle = document.createElement('div');
      handle.id = 'sidebarResizeHandle';
      handle.className = 'core-sidebar-resize-handle core-sidebar-resize';
      aside.appendChild(handle);
    }

    return aside;
  }

  /**
   * Create main content area
   * @param {Object} config - Content configuration
   * @returns {HTMLElement}
   */
  createMainContent(config = {}) {
    const {
      title = 'Welcome',
      subtitle = '',
      content = '',
      cards = [],
      showRefresh = false,
      onRefresh = null
    } = config;

    const main = document.createElement('main');
    main.id = 'mainContent';
    main.className = 'core-app-main core-main';

    // Header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'mb-4';

    if (title) {
      const h1 = document.createElement('h1');
      h1.className = 'h2 mb-1';
      h1.textContent = title;
      headerDiv.appendChild(h1);
    }

    if (subtitle) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = subtitle;
      headerDiv.appendChild(p);
    }

    main.appendChild(headerDiv);

    // Cards
    if (cards.length > 0) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'row g-3 mb-4';

      cards.forEach(card => {
        const colDiv = document.createElement('div');
        colDiv.className = `col-12 col-sm-6 col-lg-${card.width || 3}`;

        const cardEl = document.createElement('div');
        cardEl.className = 'card h-100';
        if (card.borderColor) {
          cardEl.style.borderTop = `3px solid ${card.borderColor}`;
        }

        const cardBody = document.createElement('div');
        cardBody.className = 'card-body d-flex align-items-center justify-content-between';

        const contentDiv = document.createElement('div');
        if (card.label) {
          const label = document.createElement('p');
          label.className = 'text-muted mb-1';
          label.style.fontSize = '0.875rem';
          label.textContent = card.label;
          contentDiv.appendChild(label);
        }

        if (card.value) {
          const value = document.createElement('h3');
          value.className = 'mb-0';
          value.textContent = card.value;
          contentDiv.appendChild(value);
        }

        cardBody.appendChild(contentDiv);

        if (card.icon) {
          const icon = document.createElement('i');
          icon.className = `bi ${card.icon}`;
          icon.style.cssText = `font-size: 2rem; color: ${card.iconColor || 'var(--muted, #6B605A)'}; opacity: 0.3;`;
          cardBody.appendChild(icon);
        }

        cardEl.appendChild(cardBody);
        colDiv.appendChild(cardEl);
        rowDiv.appendChild(colDiv);
      });

      main.appendChild(rowDiv);
    }

    // Content
    if (content) {
      if (typeof content === 'string') {
        const div = document.createElement('div');
        div.innerHTML = content;
        main.appendChild(div);
      } else {
        main.appendChild(content);
      }
    }

    return main;
  }

  /**
   * Create a data table
   * @param {Object} config - Table configuration
   * @returns {HTMLElement}
   */
  createTable(config = {}) {
    const {
      title = 'Data Table',
      columns = [],
      rows = [],
      onRowClick = null,
      showRefresh = false,
      onRefresh = null
    } = config;

    const card = document.createElement('div');
    card.className = 'card h-100';

    // Card Header (card-header)
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';

    const headerContent = document.createElement('h3');
    headerContent.style.cssText = 'font-size: 13px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px;';

    if (config.icon) {
      const icon = document.createElement('i');
      icon.className = `bi ${config.icon}`;
      icon.style.color = 'var(--accent, #C2471F)';
      headerContent.appendChild(icon);
    }

    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    headerContent.appendChild(titleEl);

    cardHeader.appendChild(headerContent);

    if (showRefresh) {
      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'core-icon-btn';
      refreshBtn.style.cssText = 'color: var(--muted, #6B605A); border: 1px solid var(--border, #E6DED8);';
      refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
      if (onRefresh) refreshBtn.addEventListener('click', onRefresh);
      cardHeader.appendChild(refreshBtn);
    }

    card.appendChild(cardHeader);

    // Card Body (card-body)
    const cardBody = document.createElement('div');
    cardBody.className = 'card-body p-0';

    const tableDiv = document.createElement('div');
    tableDiv.className = 'table-responsive';

    const table = document.createElement('table');
    table.className = 'table table-hover mb-0';

    // Table Head
    const thead = document.createElement('thead');
    thead.className = 'table-light';

    const headerRow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label || col.key;
      if (col.width) th.style.width = col.width;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Table Body
    const tbody = document.createElement('tbody');
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      if (onRowClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => onRowClick(row, rowIndex));
      }

      columns.forEach(col => {
        const td = document.createElement('td');
        const value = row[col.key];

        if (col.render) {
          td.appendChild(col.render(value, row, rowIndex));
        } else if (col.type === 'badge') {
          const badge = document.createElement('span');
          badge.className = `badge ${col.badgeClass || 'bg-secondary'}`;
          badge.textContent = value;
          td.appendChild(badge);
        } else {
          td.textContent = value;
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableDiv.appendChild(table);
    cardBody.appendChild(tableDiv);
    card.appendChild(cardBody);

    return card;
  }

  /**
   * Create a card component
   * @param {Object} config - Card configuration
   * @returns {HTMLElement}
   */
  createCard(config = {}) {
    const {
      title = '',
      subtitle = '',
      content = '',
      footer = '',
      icon = '',
      className = '',
      style = {}
    } = config;

    const card = document.createElement('div');
    card.className = `card ${className}`;
    Object.assign(card.style, style);

    if (title || icon) {
      const header = document.createElement('div');
      header.className = 'card-header';

      const titleWrap = document.createElement('h3');
      titleWrap.className = 'card-title';
      titleWrap.style.cssText = 'font-size: 13px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px;';

      if (icon) {
        const iconEl = document.createElement('i');
        iconEl.className = `bi ${icon}`;
        iconEl.style.color = 'var(--accent, #C2471F)';
        titleWrap.appendChild(iconEl);
      }

      if (title) {
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        titleWrap.appendChild(titleSpan);
      }

      header.appendChild(titleWrap);
      card.appendChild(header);
    }

    if (content || subtitle) {
      const body = document.createElement('div');
      body.className = 'card-body';

      if (subtitle) {
        const sub = document.createElement('p');
        sub.className = 'text-muted';
        sub.textContent = subtitle;
        body.appendChild(sub);
      }

      if (content) {
        if (typeof content === 'string') {
          body.innerHTML += content;
        } else {
          body.appendChild(content);
        }
      }

      card.appendChild(body);
    }

    if (footer) {
      const footerEl = document.createElement('div');
      footerEl.className = 'card-footer';
      if (typeof footer === 'string') {
        footerEl.innerHTML = footer;
      } else {
        footerEl.appendChild(footer);
      }
      card.appendChild(footerEl);
    }

    return card;
  }

  /**
   * Create a modal/dialog
   * @param {Object} config - Modal configuration
   * @returns {HTMLElement}
   */
  createModal(config = {}) {
    const {
      id = 'modal-' + Math.random().toString(36).substr(2, 9),
      title = '',
      body = '',
      footer = '',
      size = 'lg',
      onClose = null
    } = config;

    const div = document.createElement('div');
    div.className = 'modal fade';
    div.id = id;
    div.setAttribute('tabindex', '-1');

    const dialog = document.createElement('div');
    dialog.className = `modal-dialog modal-${size}`;

    const content = document.createElement('div');
    content.className = 'modal-content';

    if (title) {
      const header = document.createElement('div');
      header.className = 'modal-header';

      const titleEl = document.createElement('h5');
      titleEl.className = 'modal-title';
      titleEl.textContent = title;
      header.appendChild(titleEl);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-close';
      closeBtn.setAttribute('data-bs-dismiss', 'modal');
      header.appendChild(closeBtn);

      content.appendChild(header);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'modal-body';
    if (typeof body === 'string') {
      bodyEl.innerHTML = body;
    } else {
      bodyEl.appendChild(body);
    }
    content.appendChild(bodyEl);

    if (footer) {
      const footerEl = document.createElement('div');
      footerEl.className = 'modal-footer';
      if (typeof footer === 'string') {
        footerEl.innerHTML = footer;
      } else {
        footerEl.appendChild(footer);
      }
      content.appendChild(footerEl);
    }

    dialog.appendChild(content);
    div.appendChild(dialog);

    return div;
  }

  /**
   * Create an alert component
   * @param {Object} config - Alert configuration
   * @returns {HTMLElement}
   */
  createAlert(config = {}) {
    const {
      message = '',
      type = 'info',
      dismissible = true,
      icon = true
    } = config;

    const alert = document.createElement('div');
    alert.className = `alert alert-${type} ${dismissible ? 'alert-dismissible fade show' : ''}`;
    alert.setAttribute('role', 'alert');

    if (icon) {
      const iconMap = {
        'info': 'info-circle',
        'success': 'check-circle',
        'warning': 'exclamation-circle',
        'danger': 'x-circle'
      };
      const iconEl = document.createElement('i');
      iconEl.className = `bi bi-${iconMap[type] || 'info-circle'} me-2`;
      alert.appendChild(iconEl);
    }

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    alert.appendChild(messageSpan);

    if (dismissible) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-close';
      closeBtn.setAttribute('data-bs-dismiss', 'alert');
      alert.appendChild(closeBtn);
    }

    return alert;
  }

  /**
   * Create a form
   * @param {Object} config - Form configuration
   * @returns {HTMLElement}
   */
  createForm(config = {}) {
    const {
      fields = [],
      submitText = 'Submit',
      cancelText = 'Cancel',
      onSubmit = null,
      onCancel = null
    } = config;

    const form = document.createElement('form');
    form.className = 'form';

    const rowDiv = document.createElement('div');
    rowDiv.className = 'row g-3';

    fields.forEach(field => {
      const colDiv = document.createElement('div');
      colDiv.className = `col-${field.colSize || '12'}`;

      const label = document.createElement('label');
      label.className = 'form-label';
      label.htmlFor = field.id;
      label.textContent = field.label;
      colDiv.appendChild(label);

      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'form-control';
        input.rows = field.rows || 3;
      } else if (field.type === 'select') {
        input = document.createElement('select');
        input.className = 'form-select';
        field.options?.forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          input.appendChild(option);
        });
      } else if (field.type === 'checkbox') {
        const div = document.createElement('div');
        div.className = 'form-check';
        input = document.createElement('input');
        input.className = 'form-check-input';
        input.type = 'checkbox';
        div.appendChild(input);
        const checkLabel = document.createElement('label');
        checkLabel.className = 'form-check-label';
        checkLabel.htmlFor = field.id;
        checkLabel.textContent = field.label;
        div.appendChild(checkLabel);
        colDiv.innerHTML = '';
        colDiv.appendChild(div);
        rowDiv.appendChild(colDiv);
        return;
      } else {
        input = document.createElement('input');
        input.type = field.type || 'text';
        input.className = 'form-control';
      }

      input.id = field.id;
      input.name = field.name || field.id;
      input.placeholder = field.placeholder || '';
      if (field.required) input.required = true;

      colDiv.appendChild(input);
      rowDiv.appendChild(colDiv);
    });

    form.appendChild(rowDiv);

    // Buttons
    const btnDiv = document.createElement('div');
    btnDiv.className = 'mt-3 d-flex gap-2';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-secondary';
    submitBtn.textContent = submitText;
    if (onSubmit) form.addEventListener('submit', onSubmit);
    btnDiv.appendChild(submitBtn);

    if (cancelText) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-outline-secondary';
      cancelBtn.textContent = cancelText;
      if (onCancel) cancelBtn.addEventListener('click', onCancel);
      btnDiv.appendChild(cancelBtn);
    }

    form.appendChild(btnDiv);

    return form;
  }

  /**
   * Create a layout with header, sidebar, and main content
   * @param {Object} config - Layout configuration
   * @returns {void} - Renders directly to container
   */
  createLayout(config = {}) {
    const {
      header = {},
      sidebar = {},
      content = {}
    } = config;

    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container with id '${this.containerId}' not found`);
      return;
    }

    container.innerHTML = '';
    // KR app shell: 100vh grid (topbar + body row), no AI panel by default.
    // Apps that need an AI panel can append it as a third grid item with
    // class core-ai. Each region scrolls its own content (core-main, core-sidebar).
    container.classList.add('core-app', 'no-ai');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'auto 1fr';
    container.style.gridTemplateRows = '60px 1fr';
    container.style.height = '100vh';
    container.style.overflow = 'hidden';

    // Topbar — spans both columns of the body row, sits in row 1
    const headerEl = this.createHeader(header);
    headerEl.style.gridColumn = '1 / -1';
    headerEl.style.gridRow = '1';
    container.appendChild(headerEl);

    // Sidebar — column 1, row 2
    const sidebarEl = this.createLeftSidebar(sidebar);
    sidebarEl.style.gridColumn = '1';
    sidebarEl.style.gridRow = '2';
    sidebarEl.style.height = '100%';
    sidebarEl.style.minHeight = '0';
    sidebarEl.style.overflowY = 'auto';
    container.appendChild(sidebarEl);

    // Main content — column 2, row 2
    const mainEl = this.createMainContent(content);
    mainEl.style.gridColumn = '2';
    mainEl.style.gridRow = '2';
    mainEl.style.height = '100%';
    mainEl.style.minHeight = '0';
    mainEl.style.overflowY = 'auto';
    container.appendChild(mainEl);
  }

  /**
   * Show a toast notification
   * @param {Object} config - Toast configuration
   */
  showToast(config = {}) {
    const {
      message = '',
      type = 'info',
      duration = 3000
    } = config;

    const toastContainer = document.getElementById('toast-container') || this._createToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.setAttribute('role', 'alert');

    const body = document.createElement('div');
    body.className = 'd-flex';

    const messageSpan = document.createElement('div');
    messageSpan.className = 'toast-body';
    messageSpan.textContent = message;
    body.appendChild(messageSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close btn-close-white me-2 m-auto';
    closeBtn.setAttribute('data-bs-dismiss', 'toast');
    body.appendChild(closeBtn);

    toast.appendChild(body);
    toastContainer.appendChild(toast);

    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();

    setTimeout(() => toast.remove(), duration);
  }

  /**
   * Create toast container if it doesn't exist
   * @private
   */
  _createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(container);
    return container;
  }

  /**
   * Create a workflow dashboard stat card
   * @param {Object} config - Stat card configuration
   * @returns {HTMLElement}
   */
  createStatCard(config = {}) {
    const {
      label = 'Stat',
      value = '0',
      change = '',
      changeType = 'neutral',
      icon = 'bi-graph-up',
      iconVariant = 't'  // t (teal) | b (blue/info) | o (orange) | g (green/success)
    } = config;

    const card = document.createElement('div');
    card.className = 'stat-card core-stat-card';

    // .top — icon + delta
    const top = document.createElement('div');
    top.className = 'top';

    const iconWrap = document.createElement('div');
    iconWrap.className = `ico ${iconVariant}`;
    iconWrap.innerHTML = `<i class="bi ${icon}"></i>`;
    top.appendChild(iconWrap);

    if (change) {
      const delta = document.createElement('span');
      delta.className = 'delta';
      // Re-tint delta for negative trend
      if (changeType === 'decrease') {
        delta.style.cssText = 'background: var(--danger-soft, #FADDE2); color: var(--danger, #B42335);';
      }
      delta.textContent = change;
      top.appendChild(delta);
    }

    card.appendChild(top);

    // .num — big value
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = value;
    card.appendChild(num);

    // .lbl — small label
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = label;
    card.appendChild(lbl);

    return card;
  }

  /**
   * Create a workflow status badge
   * @param {Object} config - Badge configuration
   * @returns {HTMLElement}
   */
  createStatusBadge(config = {}) {
    const {
      status = 'pending',
      size = 'sm'
    } = config;

    const statusConfig = {
      running:   { variant: 'info',  text: 'Running',   icon: 'bi-arrow-repeat' },
      completed: { variant: 'ok',    text: 'Completed', icon: 'bi-check-circle-fill' },
      failed:    { variant: 'danger', text: 'Failed',   icon: 'bi-x-circle-fill' },
      queued:    { variant: 'warn',  text: 'Queued',    icon: 'bi-hourglass-split' },
      pending:   { variant: 'muted', text: 'Pending',   icon: 'bi-circle' }
    };

    const conf = statusConfig[status] || statusConfig.pending;
    const badge = document.createElement('span');
    badge.className = `core-chip ${conf.variant}`;
    badge.innerHTML = `<i class="bi ${conf.icon}"></i>${conf.text}`;

    return badge;
  }

  /**
   * Create a workflow job card
   * @param {Object} config - Job card configuration
   * @returns {HTMLElement}
   */
  createWorkflowJobCard(config = {}) {
    const {
      id = 'job-1',
      name = 'Workflow Job',
      status = 'running',
      progress = 0,
      lastRun = 'Never',
      nextRun = 'N/A',
      recordsProcessed = 0,
      hasError = false,
      errorMessage = '',
      onExecute = null,
      onSettings = null
    } = config;

    const card = document.createElement('div');
    card.className = 'workflow-job-card card mb-3 border-0 shadow-sm';
    card.id = id;

    const cardBody = document.createElement('div');
    cardBody.className = 'card-body';

    // Header with name and status
    const header = document.createElement('div');
    header.className = 'd-flex justify-content-between align-items-start mb-3';

    const nameEl = document.createElement('h5');
    nameEl.className = 'card-title mb-0';
    nameEl.textContent = name;

    const statusBadge = this.createStatusBadge({ status });

    header.appendChild(nameEl);
    header.appendChild(statusBadge);
    cardBody.appendChild(header);

    // Progress bar
    const progressDiv = document.createElement('div');
    progressDiv.className = 'mb-3';

    const progressBar = document.createElement('div');
    progressBar.className = 'progress';
    progressBar.style.height = '6px';

    const progressBarInner = document.createElement('div');
    progressBarInner.className = `progress-bar ${status === 'failed' ? 'bg-danger' : 'bg-primary'}`;
    progressBarInner.style.width = `${progress}%`;
    progressBarInner.setAttribute('role', 'progressbar');

    progressBar.appendChild(progressBarInner);
    progressDiv.appendChild(progressBar);
    cardBody.appendChild(progressDiv);

    // Job details
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'row g-3 mb-3 small';

    const lastRunCol = document.createElement('div');
    lastRunCol.className = 'col-6';
    lastRunCol.innerHTML = `<span class="text-muted">Last run: <strong>${lastRun}</strong></span>`;

    const nextRunCol = document.createElement('div');
    nextRunCol.className = 'col-6';
    nextRunCol.innerHTML = `<span class="text-muted">Next: <strong>${nextRun}</strong></span>`;

    const recordsCol = document.createElement('div');
    recordsCol.className = 'col-12';
    recordsCol.innerHTML = `<span class="text-muted">${recordsProcessed.toLocaleString()} records</span>`;

    detailsDiv.appendChild(lastRunCol);
    detailsDiv.appendChild(nextRunCol);
    detailsDiv.appendChild(recordsCol);
    cardBody.appendChild(detailsDiv);

    // Error message
    if (hasError && errorMessage) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'alert alert-danger py-2 px-3 mb-3 small';
      errorDiv.innerHTML = `<i class="bi bi-exclamation-circle me-2"></i>${errorMessage}`;
      cardBody.appendChild(errorDiv);
    }

    // Action buttons
    const actionDiv = document.createElement('div');
    actionDiv.className = 'd-flex gap-2';

    const executeBtn = document.createElement('button');
    executeBtn.className = 'btn btn-sm btn-outline-primary';
    executeBtn.innerHTML = '<i class="bi bi-play-fill me-1"></i>';
    executeBtn.title = 'Execute workflow';
    if (onExecute) executeBtn.addEventListener('click', onExecute);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn btn-sm btn-outline-secondary';
    settingsBtn.innerHTML = '<i class="bi bi-gear me-1"></i>';
    settingsBtn.title = 'Workflow settings';
    if (onSettings) settingsBtn.addEventListener('click', onSettings);

    actionDiv.appendChild(executeBtn);
    actionDiv.appendChild(settingsBtn);
    cardBody.appendChild(actionDiv);

    card.appendChild(cardBody);
    return card;
  }

  /**
   * Create a workflow dashboard
   * @param {Object} config - Dashboard configuration
   * @returns {HTMLElement}
   */
  createWorkflowDashboard(config = {}) {
    const {
      title = 'Workflow Dashboard',
      subtitle = 'Monitor your data import pipelines and agent processing jobs',
      stats = [],
      workflows = [],
      recentActivity = [],
      onNewWorkflow = null,
      onWorkflowExecute = null
    } = config;

    const dashboard = document.createElement('div');
    dashboard.className = 'workflow-dashboard';

    // Title section
    const headerDiv = document.createElement('div');
    headerDiv.className = 'mb-4 d-flex justify-content-between align-items-center';

    const titleDiv = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.className = 'h2 mb-1';
    h1.textContent = title;
    titleDiv.appendChild(h1);

    if (subtitle) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = subtitle;
      titleDiv.appendChild(p);
    }

    headerDiv.appendChild(titleDiv);

    // New Workflow Button
    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-warning btn-sm';
    newBtn.innerHTML = '<i class="bi bi-plus-lg me-2"></i>New Workflow';
    if (onNewWorkflow) newBtn.addEventListener('click', onNewWorkflow);
    headerDiv.appendChild(newBtn);

    dashboard.appendChild(headerDiv);

    // Stats Cards Row
    if (stats.length > 0) {
      const statsRow = document.createElement('div');
      statsRow.className = 'row g-3 mb-4';

      stats.forEach(stat => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-3';

        const statCard = this.createStatCard(stat);
        col.appendChild(statCard);
        statsRow.appendChild(col);
      });

      dashboard.appendChild(statsRow);
    }

    // Main Content Row
    const contentRow = document.createElement('div');
    contentRow.className = 'row g-4';

    // Workflows Column
    const workflowsCol = document.createElement('div');
    workflowsCol.className = 'col-lg-8';

    const workflowsTitle = document.createElement('h3');
    workflowsTitle.className = 'h5 mb-3';
    workflowsTitle.textContent = 'Your Workflow Jobs';
    workflowsCol.appendChild(workflowsTitle);

    const workflowsContainer = document.createElement('div');
    workflowsContainer.className = 'workflow-jobs-container';

    workflows.forEach(workflow => {
      const jobCard = this.createWorkflowJobCard({
        ...workflow,
        onExecute: () => {
          if (onWorkflowExecute) onWorkflowExecute(workflow.id);
        }
      });
      workflowsContainer.appendChild(jobCard);
    });

    workflowsCol.appendChild(workflowsContainer);
    contentRow.appendChild(workflowsCol);

    // Recent Activity Column
    const activityCol = document.createElement('div');
    activityCol.className = 'col-lg-4';

    const activityTitle = document.createElement('h3');
    activityTitle.className = 'h5 mb-3';
    activityTitle.textContent = 'Recent Activity';
    activityCol.appendChild(activityTitle);

    const activityContainer = document.createElement('div');
    activityContainer.className = 'activity-feed';

    recentActivity.forEach(activity => {
      const activityItem = document.createElement('div');
      activityItem.className = 'activity-item mb-3 pb-3 border-bottom';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'd-flex';

      const iconDiv = document.createElement('div');
      iconDiv.className = 'me-3 flex-shrink-0';
      iconDiv.innerHTML = `<i class="bi ${activity.icon || 'bi-info-circle'} ${activity.type === 'success' ? 'text-success' : 'text-info'}"></i>`;

      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'flex-grow-1 small';

      const titleEl = document.createElement('p');
      titleEl.className = 'mb-1 fw-semibold';
      titleEl.textContent = activity.title;

      const descEl = document.createElement('p');
      descEl.className = 'text-muted mb-1';
      descEl.textContent = activity.description;

      const timeEl = document.createElement('p');
      timeEl.className = 'text-muted';
      timeEl.style.fontSize = '0.75rem';
      timeEl.textContent = activity.timeAgo;

      detailsDiv.appendChild(titleEl);
      detailsDiv.appendChild(descEl);
      detailsDiv.appendChild(timeEl);

      contentDiv.appendChild(iconDiv);
      contentDiv.appendChild(detailsDiv);

      activityItem.appendChild(contentDiv);
      activityContainer.appendChild(activityItem);
    });

    activityCol.appendChild(activityContainer);
    contentRow.appendChild(activityCol);

    dashboard.appendChild(contentRow);
    return dashboard;
  }

  /**
   * Create a source card component
   * @param {Object} config - Source card configuration
   * @returns {HTMLElement}
   */
  createSourceCard(config = {}) {
    const {
      id = 'src-1',
      name = 'Source Name',
      path = '/data/source/',
      status = 'active',
      files = 0,
      consumers = 0,
      updated = 'Unknown',
      onBrowse = null,
      onConfigure = null,
      onCopyUrl = null
    } = config;

    const card = document.createElement('div');
    card.className = 'source-card card h-100 border-0 shadow-sm';
    card.id = id;

    const cardBody = document.createElement('div');
    cardBody.className = 'card-body';

    // Header with name and status
    const header = document.createElement('div');
    header.className = 'd-flex justify-content-between align-items-start mb-3';

    const nameEl = document.createElement('h5');
    nameEl.className = 'card-title mb-0 text-truncate';
    nameEl.textContent = name;

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${status === 'active' ? 'bg-success' : 'bg-warning'}`;
    statusBadge.textContent = status.toUpperCase();

    header.appendChild(nameEl);
    header.appendChild(statusBadge);
    cardBody.appendChild(header);

    // Path
    const pathEl = document.createElement('p');
    pathEl.className = 'text-muted small mb-3 text-truncate';
    pathEl.textContent = path;
    pathEl.title = path;
    cardBody.appendChild(pathEl);

    // Stats grid
    const statsDiv = document.createElement('div');
    statsDiv.className = 'row g-2 mb-3 small';

    const filesCol = document.createElement('div');
    filesCol.className = 'col-6';
    filesCol.innerHTML = `<div><strong>${files.toLocaleString()}</strong><br><span class="text-muted">files</span></div>`;

    const consumersCol = document.createElement('div');
    consumersCol.className = 'col-6';
    consumersCol.innerHTML = `<div><strong>${consumers}</strong><br><span class="text-muted">consumers</span></div>`;

    statsDiv.appendChild(filesCol);
    statsDiv.appendChild(consumersCol);
    cardBody.appendChild(statsDiv);

    // Update timestamp
    const updateEl = document.createElement('p');
    updateEl.className = 'text-muted small mb-3';
    updateEl.textContent = `Updated ${updated}`;
    cardBody.appendChild(updateEl);

    // Action buttons
    const actionDiv = document.createElement('div');
    actionDiv.className = 'd-flex gap-2 flex-wrap';

    const browseBtn = document.createElement('button');
    browseBtn.className = 'btn btn-sm btn-outline-primary flex-grow-1';
    browseBtn.innerHTML = '<i class="bi bi-eye me-1"></i>Browse';
    if (onBrowse) browseBtn.addEventListener('click', onBrowse);

    const configBtn = document.createElement('button');
    configBtn.className = 'btn btn-sm btn-outline-secondary flex-grow-1';
    configBtn.innerHTML = '<i class="bi bi-gear me-1"></i>Configure';
    if (onConfigure) configBtn.addEventListener('click', onConfigure);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm btn-outline-secondary flex-grow-1';
    copyBtn.innerHTML = '<i class="bi bi-files me-1"></i>Copy URL';
    if (onCopyUrl) copyBtn.addEventListener('click', onCopyUrl);

    actionDiv.appendChild(browseBtn);
    actionDiv.appendChild(configBtn);
    actionDiv.appendChild(copyBtn);
    cardBody.appendChild(actionDiv);

    card.appendChild(cardBody);
    return card;
  }

  /**
   * Create a prompt item component
   * @param {Object} config - Prompt configuration
   * @returns {HTMLElement}
   */
  createPromptItem(config = {}) {
    const {
      id = 'prompt-1',
      name = 'Prompt Name',
      status = 'published',
      version = 'v1.0',
      description = 'Prompt description',
      author = 'Unknown',
      uses = 0,
      modified = 'Unknown',
      output = 'Output type',
      onClone = null,
      onEdit = null
    } = config;

    const item = document.createElement('div');
    item.className = 'prompt-item card mb-3 border-0 shadow-sm';
    item.id = id;

    const cardBody = document.createElement('div');
    cardBody.className = 'card-body';

    // Header with icon, name, and badges
    const header = document.createElement('div');
    header.className = 'd-flex justify-content-between align-items-start mb-3';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'd-flex align-items-start gap-3 flex-grow-1';

    const iconEl = document.createElement('i');
    iconEl.className = 'bi bi-sparkles text-primary';
    iconEl.style.fontSize = '1.5rem';

    const textDiv = document.createElement('div');

    const nameEl = document.createElement('h5');
    nameEl.className = 'mb-0';
    nameEl.textContent = name;

    const badgesDiv = document.createElement('div');
    badgesDiv.className = 'mt-2 d-flex gap-2';

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${status === 'published' ? 'bg-success' : 'bg-warning'}`;
    statusBadge.textContent = status.toUpperCase();

    const versionBadge = document.createElement('span');
    versionBadge.className = 'badge bg-secondary';
    versionBadge.textContent = version;

    badgesDiv.appendChild(statusBadge);
    badgesDiv.appendChild(versionBadge);

    textDiv.appendChild(nameEl);
    textDiv.appendChild(badgesDiv);
    titleDiv.appendChild(iconEl);
    titleDiv.appendChild(textDiv);
    header.appendChild(titleDiv);

    // Action buttons
    const actionDiv = document.createElement('div');
    actionDiv.className = 'd-flex gap-2';

    const cloneBtn = document.createElement('button');
    cloneBtn.className = 'btn btn-sm btn-outline-secondary';
    cloneBtn.innerHTML = '<i class="bi bi-files me-1"></i>Clone';
    if (onClone) cloneBtn.addEventListener('click', onClone);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-outline-primary';
    editBtn.innerHTML = '<i class="bi bi-pencil me-1"></i>Edit';
    if (onEdit) editBtn.addEventListener('click', onEdit);

    actionDiv.appendChild(cloneBtn);
    actionDiv.appendChild(editBtn);
    header.appendChild(actionDiv);
    cardBody.appendChild(header);

    // Description
    const descEl = document.createElement('p');
    descEl.className = 'text-muted mb-3';
    descEl.textContent = description;
    cardBody.appendChild(descEl);

    // Metadata row
    const metaDiv = document.createElement('div');
    metaDiv.className = 'row g-3 small text-muted mb-3';

    const authorCol = document.createElement('div');
    authorCol.className = 'col-auto';
    authorCol.innerHTML = `<strong>By</strong> ${author}`;

    const usesCol = document.createElement('div');
    usesCol.className = 'col-auto';
    usesCol.innerHTML = `<strong>${uses.toLocaleString()}</strong> uses`;

    const modifiedCol = document.createElement('div');
    modifiedCol.className = 'col-auto';
    modifiedCol.innerHTML = `<strong>Modified</strong> ${modified}`;

    metaDiv.appendChild(authorCol);
    metaDiv.appendChild(usesCol);
    metaDiv.appendChild(modifiedCol);
    cardBody.appendChild(metaDiv);

    // Output
    const outputEl = document.createElement('p');
    outputEl.className = 'small';
    outputEl.innerHTML = `<span class="badge bg-light text-dark">${output}</span>`;
    cardBody.appendChild(outputEl);

    item.appendChild(cardBody);
    return item;
  }

  /**
   * Create a settings panel component
   * @param {Object} config - Settings panel configuration
   * @returns {HTMLElement}
   */
  createSettingsPanel(config = {}) {
    const {
      title = 'Settings',
      tabs = [],
      onTabChange = null
    } = config;

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    // Title
    const titleEl = document.createElement('h1');
    titleEl.className = 'h2 mb-4';
    titleEl.textContent = title;
    panel.appendChild(titleEl);

    // Create row for tabs and content
    const contentRow = document.createElement('div');
    contentRow.className = 'row g-4';

    // Left sidebar with tabs
    const tabCol = document.createElement('div');
    tabCol.className = 'col-lg-3';

    const tabNav = document.createElement('nav');
    tabNav.className = 'flex-column nav settings-tabs';

    tabs.forEach((tab, index) => {
      const tabLink = document.createElement('a');
      tabLink.className = `nav-link ${index === 0 ? 'active' : ''}`;
      tabLink.href = `#${tab.id}`;
      tabLink.setAttribute('data-tab', tab.id);
      tabLink.innerHTML = `<i class="bi ${tab.icon} me-2"></i>${tab.label}`;

      tabLink.addEventListener('click', (e) => {
        e.preventDefault();

        // Remove active from all tabs and contents
        document.querySelectorAll('.settings-tabs .nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('d-none'));

        // Add active to clicked tab
        tabLink.classList.add('active');
        const content = document.querySelector(`[data-content="${tab.id}"]`);
        if (content) content.classList.remove('d-none');

        if (onTabChange) onTabChange(tab.id);
      });

      tabNav.appendChild(tabLink);
    });

    tabCol.appendChild(tabNav);
    contentRow.appendChild(tabCol);

    // Right sidebar with content
    const contentCol = document.createElement('div');
    contentCol.className = 'col-lg-9';

    tabs.forEach((tab, index) => {
      const contentDiv = document.createElement('div');
      contentDiv.className = `tab-content ${index === 0 ? '' : 'd-none'}`;
      contentDiv.setAttribute('data-content', tab.id);

      if (typeof tab.content === 'string') {
        contentDiv.innerHTML = tab.content;
      } else {
        contentDiv.appendChild(tab.content);
      }

      contentCol.appendChild(contentDiv);
    });

    contentRow.appendChild(contentCol);
    panel.appendChild(contentRow);

    return panel;
  }

  /**
   * Create markdown sources dashboard
   * @param {Object} config - Dashboard configuration
   * @returns {HTMLElement}
   */
  createSourcesDashboard(config = {}) {
    const {
      title = 'Markdown Sources',
      subtitle = 'Define and publish markdown locations for other applications and workflows to consume',
      sources = [],
      onNewSource = null,
      onSourceBrowse = null
    } = config;

    const dashboard = document.createElement('div');
    dashboard.className = 'sources-dashboard';

    // Header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'mb-4 d-flex justify-content-between align-items-center';

    const titleDiv = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.className = 'h2 mb-1';
    h1.textContent = title;
    titleDiv.appendChild(h1);

    if (subtitle) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = subtitle;
      titleDiv.appendChild(p);
    }

    headerDiv.appendChild(titleDiv);

    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-warning btn-sm';
    newBtn.innerHTML = '<i class="bi bi-plus-lg me-2"></i>New Source';
    if (onNewSource) newBtn.addEventListener('click', onNewSource);
    headerDiv.appendChild(newBtn);

    dashboard.appendChild(headerDiv);

    // Sources grid
    const sourcesGrid = document.createElement('div');
    sourcesGrid.className = 'row g-4';

    sources.forEach(source => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4';

      const sourceCard = this.createSourceCard({
        ...source,
        onBrowse: () => {
          if (onSourceBrowse) onSourceBrowse(source.id);
        }
      });

      col.appendChild(sourceCard);
      sourcesGrid.appendChild(col);
    });

    dashboard.appendChild(sourcesGrid);
    return dashboard;
  }

  /**
   * Create prompt library dashboard
   * @param {Object} config - Dashboard configuration
   * @returns {HTMLElement}
   */
  createPromptLibraryDashboard(config = {}) {
    const {
      title = 'Prompt Library',
      subtitle = 'Curated prompts for data transformation, classification, and enrichment',
      stats = {},
      categories = [],
      prompts = [],
      onNewPrompt = null,
      onPromptEdit = null,
      onCategorySelect = null
    } = config;

    const dashboard = document.createElement('div');
    dashboard.className = 'prompt-library-dashboard';

    // Header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'mb-4 d-flex justify-content-between align-items-center';

    const titleDiv = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.className = 'h2 mb-1';
    h1.textContent = title;
    titleDiv.appendChild(h1);

    if (subtitle) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = subtitle;
      titleDiv.appendChild(p);
    }

    headerDiv.appendChild(titleDiv);

    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-warning btn-sm';
    newBtn.innerHTML = '<i class="bi bi-plus-lg me-2"></i>Create Prompt';
    if (onNewPrompt) newBtn.addEventListener('click', onNewPrompt);
    headerDiv.appendChild(newBtn);

    dashboard.appendChild(headerDiv);

    // Content row with sidebar and main
    const contentRow = document.createElement('div');
    contentRow.className = 'row g-4';

    // Left sidebar with categories and stats
    const sidebarCol = document.createElement('div');
    sidebarCol.className = 'col-lg-3';

    // Categories section
    const categoriesCard = document.createElement('div');
    categoriesCard.className = 'card border-0 shadow-sm mb-4';

    const categoriesBody = document.createElement('div');
    categoriesBody.className = 'card-body';

    const categoriesTitle = document.createElement('p');
    categoriesTitle.className = 'text-uppercase small text-muted fw-semibold mb-3';
    categoriesTitle.textContent = 'Categories';
    categoriesBody.appendChild(categoriesTitle);

    const categoriesNav = document.createElement('nav');
    categoriesNav.className = 'nav flex-column';

    categories.forEach(cat => {
      const link = document.createElement('a');
      link.className = 'nav-link text-dark d-flex justify-content-between align-items-center';
      link.href = '#';
      link.innerHTML = `<span>${cat.name}</span><span class="badge bg-secondary">${cat.count}</span>`;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (onCategorySelect) onCategorySelect(cat.id);
      });

      categoriesNav.appendChild(link);
    });

    categoriesBody.appendChild(categoriesNav);
    categoriesCard.appendChild(categoriesBody);
    sidebarCol.appendChild(categoriesCard);

    // Stats section
    const statsCard = document.createElement('div');
    statsCard.className = 'card border-0 shadow-sm';

    const statsBody = document.createElement('div');
    statsBody.className = 'card-body';

    const statsTitle = document.createElement('p');
    statsTitle.className = 'text-uppercase small text-muted fw-semibold mb-3';
    statsTitle.textContent = 'Library Stats';
    statsBody.appendChild(statsTitle);

    const statItems = [
      { label: 'Total Prompts', value: stats.totalPrompts, icon: '' },
      { label: 'Published', value: stats.published, icon: '' },
      { label: 'Drafts', value: stats.drafts, icon: '' },
      { label: 'Total Executions', value: stats.totalExecutions, icon: '' }
    ];

    statItems.forEach(stat => {
      const statDiv = document.createElement('div');
      statDiv.className = 'd-flex justify-content-between mb-2';
      statDiv.innerHTML = `<span class="text-muted">${stat.label}</span><strong>${stat.value}</strong>`;
      statsBody.appendChild(statDiv);
    });

    statsCard.appendChild(statsBody);
    sidebarCol.appendChild(statsCard);
    contentRow.appendChild(sidebarCol);

    // Main content with prompts
    const mainCol = document.createElement('div');
    mainCol.className = 'col-lg-9';

    const promptsList = document.createElement('div');
    promptsList.className = 'prompts-list';

    if (prompts.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center py-5';
      emptyDiv.innerHTML = '<p class="text-muted">No prompts found</p>';
      promptsList.appendChild(emptyDiv);
    } else {
      prompts.forEach(prompt => {
        const promptItem = this.createPromptItem({
          ...prompt,
          onEdit: () => {
            if (onPromptEdit) onPromptEdit(prompt.id);
          }
        });
        promptsList.appendChild(promptItem);
      });
    }

    mainCol.appendChild(promptsList);
    contentRow.appendChild(mainCol);
    dashboard.appendChild(contentRow);

    return dashboard;
  }

  /**
   * Create a workflow table component
   * @param {Object} config - Table configuration
   * @returns {HTMLElement}
   */
  createWorkflowTable(config = {}) {
    const {
      workflows = [],
      onRowClick = null,
      onEdit = null,
      onDelete = null,
      onExecute = null
    } = config;

    const tableContainer = document.createElement('div');
    tableContainer.className = 'workflow-table-container';

    const table = document.createElement('table');
    table.className = 'table table-hover workflow-table';

    // Table header
    const thead = document.createElement('thead');
    thead.className = 'table-light';

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `
      <th class="inline-38382c5f">Workflow Name</th>
      <th class="inline-a659372d">Status</th>
      <th class="inline-df576810">Last Run</th>
      <th class="inline-df576810">Next Run</th>
      <th class="inline-873f2980">Executions</th>
      <th class="inline-873f2980">Progress</th>
      <th class="inline-fa011c12">Actions</th>
    `;

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement('tbody');

    workflows.forEach(workflow => {
      const row = document.createElement('tr');
      row.className = 'workflow-row';

      const statusColor = workflow.status === 'active' ? 'bg-success' : workflow.status === 'error' ? 'bg-danger' : 'bg-secondary';
      const statusText = workflow.status.toUpperCase();

      row.innerHTML = `
        <td class="fw-semibold">${workflow.name}</td>
        <td><span class="badge ${statusColor}">${statusText}</span></td>
        <td>${workflow.lastRun}</td>
        <td>${workflow.nextRun}</td>
        <td>${workflow.executions}</td>
        <td>
          <div class="inline-924c100b progress">
            <div class="progress-bar core-width-${Math.min(100, Math.max(0, Math.round(Number(workflow.progress) || 0)))}"></div>
          </div>
        </td>
        <td>
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn btn-outline-primary" title="Execute workflow">
              <i class="bi bi-play-fill"></i>
            </button>
            <button class="btn btn-outline-secondary" title="Edit workflow">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-outline-danger" title="Delete workflow">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      `;

      // Add event listeners
      const buttons = row.querySelectorAll('.btn');
      if (buttons[0] && onExecute) {
        buttons[0].addEventListener('click', () => onExecute(workflow.id));
      }
      if (buttons[1] && onEdit) {
        buttons[1].addEventListener('click', () => onEdit(workflow.id));
      }
      if (buttons[2] && onDelete) {
        buttons[2].addEventListener('click', () => onDelete(workflow.id));
      }

      if (onRowClick) {
        row.addEventListener('click', (e) => {
          if (!e.target.closest('.btn')) {
            onRowClick(workflow.id);
          }
        });
      }

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);

    return tableContainer;
  }

  /**
   * Create a workflow wizard/form component
   * @param {Object} config - Wizard configuration
   * @returns {HTMLElement}
   */
  createWorkflowWizard(config = {}) {
    const {
      workflowId = null,
      isEditing = false,
      initialData = {},
      onStepChange = null,
      onSave = null,
      onCancel = null
    } = config;

    const wizard = document.createElement('div');
    wizard.className = 'workflow-wizard';

    // Back button
    const backDiv = document.createElement('div');
    backDiv.className = 'mb-4';
    const backBtn = document.createElement('a');
    backBtn.href = '#';
    backBtn.className = 'text-decoration-none';
    backBtn.innerHTML = '<i class="bi bi-arrow-left me-2"></i>Back to Dashboard';
    if (onCancel) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        onCancel();
      });
    }
    backDiv.appendChild(backBtn);
    wizard.appendChild(backDiv);

    // Title and subtitle
    const titleDiv = document.createElement('div');
    titleDiv.className = 'mb-4';
    const h1 = document.createElement('h1');
    h1.className = 'h2';
    h1.textContent = isEditing ? 'Edit Workflow' : 'Create Workflow';
    const subtitle = document.createElement('p');
    subtitle.className = 'text-muted';
    subtitle.textContent = 'Define data sources, configure agent prompts, and set output destinations';
    titleDiv.appendChild(h1);
    titleDiv.appendChild(subtitle);
    wizard.appendChild(titleDiv);

    // Step tabs
    const tabsDiv = document.createElement('div');
    tabsDiv.className = 'workflow-wizard-tabs mb-4';

    const steps = [
      { id: 'source', label: 'Source', icon: 'bi-download' },
      { id: 'prompts', label: 'Agent Prompts', icon: 'bi-sparkles' },
      { id: 'output', label: 'Output', icon: 'bi-box-arrow-up' },
      { id: 'schedule', label: 'Schedule', icon: 'bi-clock' }
    ];

    let currentStep = 'source';

    steps.forEach((step, index) => {
      const tabBtn = document.createElement('button');
      tabBtn.className = `workflow-wizard-tab ${step.id === currentStep ? 'active' : ''}`;
      tabBtn.innerHTML = `
        <span class="step-number">${index + 1}</span>
        <i class="bi ${step.icon}"></i>
        <span>${step.label}</span>
      `;

      tabBtn.addEventListener('click', () => {
        document.querySelectorAll('.workflow-wizard-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.step-content').forEach(c => c.classList.add('d-none'));

        tabBtn.classList.add('active');
        const content = document.querySelector(`[data-step="${step.id}"]`);
        if (content) content.classList.remove('d-none');

        currentStep = step.id;
        if (onStepChange) onStepChange(step.id);
      });

      tabsDiv.appendChild(tabBtn);
    });

    wizard.appendChild(tabsDiv);

    // Step contents
    const contentDiv = document.createElement('div');
    contentDiv.className = 'workflow-wizard-content';

    // Source step
    const sourceContent = document.createElement('div');
    sourceContent.className = 'step-content card border-0 shadow-sm p-4';
    sourceContent.setAttribute('data-step', 'source');
    sourceContent.innerHTML = `
      <h4 class="mb-4">Configure Data Source</h4>
      <div class="mb-3">
        <label class="form-label">Source Type</label>
        <select class="form-select">
          <option>Folder Watch</option>
          <option>API Endpoint</option>
          <option>Database</option>
          <option>S3 Bucket</option>
        </select>
      </div>
      <div class="mb-3">
        <label class="form-label">Folder Path</label>
        <div class="input-group">
          <input type="text" class="form-control" value="/data/imports/applications/" placeholder="Enter folder path">
          <button class="btn btn-outline-secondary" type="button">
            <i class="bi bi-folder"></i>
          </button>
        </div>
      </div>
      <div class="mb-3">
        <h5>Sample Source Files</h5>
        <div class="list-group">
          <div class="list-group-item d-flex justify-content-between align-items-center">
            <span><i class="bi bi-file-earmark me-2"></i>app-crm-001.md</span>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary"><i class="bi bi-eye"></i></button>
              <button class="btn btn-outline-danger"><i class="bi bi-trash"></i></button>
            </div>
          </div>
          <div class="list-group-item d-flex justify-content-between align-items-center">
            <span><i class="bi bi-file-earmark me-2"></i>app-erp-002.md</span>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary"><i class="bi bi-eye"></i></button>
              <button class="btn btn-outline-danger"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-warning mt-3">
          <i class="bi bi-plus-lg me-1"></i>Add Sample File
        </button>
      </div>
    `;
    contentDiv.appendChild(sourceContent);

    // Prompts step
    const promptsContent = document.createElement('div');
    promptsContent.className = 'step-content card border-0 shadow-sm p-4 d-none';
    promptsContent.setAttribute('data-step', 'prompts');
    promptsContent.innerHTML = `
      <h4 class="mb-4">Configure Agent Prompts</h4>
      <p class="text-muted mb-3">Add prompts that agents will use to process, clean, and link your data</p>
      <div class="mb-4">
        <div class="prompt-selection">
          <div class="prompt-item d-flex justify-content-between align-items-center mb-3 p-3 border rounded bg-light">
            <div>
              <strong><i class="bi bi-sparkles me-2"></i>Technology Normalizer</strong>
              <p class="text-muted small mb-0">Standardize technology names and versions</p>
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary">Test</button>
              <button class="btn btn-outline-secondary"><i class="bi bi-pencil"></i></button>
            </div>
          </div>
          <div class="prompt-item d-flex justify-content-between align-items-center mb-3 p-3 border rounded bg-light">
            <div>
              <strong><i class="bi bi-sparkles me-2"></i>Business Capability Classifier</strong>
              <p class="text-muted small mb-0">Classify applications by business capability</p>
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary">Test</button>
              <button class="btn btn-outline-secondary"><i class="bi bi-pencil"></i></button>
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-warning">
          <i class="bi bi-plus-lg me-1"></i>Add Prompt
        </button>
      </div>
    `;
    contentDiv.appendChild(promptsContent);

    // Output step
    const outputContent = document.createElement('div');
    outputContent.className = 'step-content card border-0 shadow-sm p-4 d-none';
    outputContent.setAttribute('data-step', 'output');
    outputContent.innerHTML = `
      <h4 class="mb-4">Configure Output</h4>
      <div class="mb-3">
        <label class="form-label">Output Location</label>
        <input type="text" class="form-control" value="/data/applications/" placeholder="Enter output folder path">
      </div>
      <div class="mb-3">
        <label class="form-label">File Naming Pattern</label>
        <input type="text" class="form-control" value="[[app_id]]-[[timestamp]].md" placeholder="Use [[variable]] for placeholders">
        <small class="text-muted">Available: [[app_id]], [[timestamp]], [[date]], [[id]]</small>
      </div>
      <div class="form-check mb-3">
        <input class="form-check-input" type="checkbox" id="publishSource" checked>
        <label class="form-check-label" for="publishSource">
          Publish as Markdown Source for other workflows
        </label>
      </div>
    `;
    contentDiv.appendChild(outputContent);

    // Schedule step
    const scheduleContent = document.createElement('div');
    scheduleContent.className = 'step-content card border-0 shadow-sm p-4 d-none';
    scheduleContent.setAttribute('data-step', 'schedule');
    scheduleContent.innerHTML = `
      <h4 class="mb-4">Schedule Configuration</h4>
      <div class="mb-4">
        <p class="text-muted">How should this workflow be triggered?</p>
        <div class="row g-3">
          <div class="col-md-6">
            <div class="form-check p-3 border rounded schedule-option">
              <input class="form-check-input" type="radio" name="trigger" id="manual" value="manual" checked>
              <label class="form-check-label" for="manual">
                <strong>Manual Only</strong>
                <small class="text-muted d-block">Trigger workflow manually</small>
              </label>
            </div>
          </div>
          <div class="col-md-6">
            <div class="form-check p-3 border rounded schedule-option">
              <input class="form-check-input" type="radio" name="trigger" id="filechange" value="filechange">
              <label class="form-check-label" for="filechange">
                <strong>On File Change</strong>
                <small class="text-muted d-block">Run when source files change</small>
              </label>
            </div>
          </div>
          <div class="col-md-6">
            <div class="inline-bfe5a6ec form-check p-3 border rounded schedule-option">
              <input class="form-check-input" type="radio" name="trigger" id="scheduled" value="scheduled">
              <label class="form-check-label" for="scheduled">
                <strong>Scheduled</strong>
                <small class="text-muted d-block">Run on a recurring schedule</small>
              </label>
            </div>
          </div>
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label">CRON Expression</label>
        <input type="text" class="form-control" value="0 2 * * *" placeholder="0 2 * * *">
        <small class="text-muted">→ Every day at 2:00 AM</small>
      </div>
    `;
    contentDiv.appendChild(scheduleContent);

    wizard.appendChild(contentDiv);

    // Footer buttons
    const footerDiv = document.createElement('div');
    footerDiv.className = 'd-flex justify-content-between mt-5 pt-4 border-top';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-outline-secondary';
    prevBtn.textContent = 'Previous';
    prevBtn.addEventListener('click', () => {
      const currentIndex = steps.findIndex(s => s.id === currentStep);
      if (currentIndex > 0) {
        document.querySelectorAll('.workflow-wizard-tab')[currentIndex - 1].click();
      }
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-light me-2';
    saveBtn.textContent = 'Save Draft';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-warning';
    const nextIndex = steps.findIndex(s => s.id === currentStep);
    if (nextIndex < steps.length - 1) {
      nextBtn.textContent = 'Next';
      nextBtn.addEventListener('click', () => {
        document.querySelectorAll('.workflow-wizard-tab')[nextIndex + 1].click();
      });
    } else {
      nextBtn.textContent = isEditing ? 'Save Changes' : 'Create Workflow';
      nextBtn.addEventListener('click', () => {
        if (onSave) onSave();
      });
    }

    footerDiv.appendChild(prevBtn);
    const rightDiv = document.createElement('div');
    rightDiv.appendChild(saveBtn);
    rightDiv.appendChild(nextBtn);
    footerDiv.appendChild(rightDiv);

    wizard.appendChild(footerDiv);

    return wizard;
  }
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.UIService = UIService;
}

// Export for use in Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIService;
}
