/**
 * @fileoverview NooblyJS Core Filing UI Client Library
 * A client-side JavaScript library for interacting with the NooblyJS Core filing service.
 * Provides a complete file browser UI with navigation, folder browsing, and file previews.
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.15
 *
 * @example
 * const fileBrowser = new FilingUIManager({
 *   navigationContainerId: 'fileTreeContainer',
 *   contentContainerId: 'fileContentArea'
 * });
 * fileBrowser.initialize();
 */

(function(global) {
  'use strict';

  /**
   * FilingUIManager - Main class for managing the filing UI
   * @class
   * @param {Object} options - Configuration options
   * @param {string} options.navigationContainerId - ID of the element for file tree navigation
   * @param {string} options.contentContainerId - ID of the element for content display
   * @param {string} [options.breadcrumbId] - ID of the breadcrumb element
   * @param {string} [options.refreshButtonId] - ID of the refresh button
   */
  class FilingUIManager {
    constructor(options = {}) {
      this.navigationContainerId = options.navigationContainerId;
      this.contentContainerId = options.contentContainerId;
      this.breadcrumbId = options.breadcrumbId;
      this.refreshButtonId = options.refreshButtonId;
      this.instance = options.instance || 'default'; // Store instance name from options

      // Validate required containers
      if (!this.navigationContainerId || !this.contentContainerId) {
        throw new Error('FilingUIManager requires navigationContainerId and contentContainerId');
      }

      this.currentPath = '';
      this.fileTree = null;
      this.apiBaseUrl = '/services/filing/api';
      this.currentViewMode = 'grid'; // Default view mode
      this.previewTimeout = null;
      this.currentPreviewCard = null;

      // Cache elements
      this.navContainer = null;
      this.contentContainer = null;
      this.breadcrumb = null;
      this.refreshButton = null;

      this.initializeElements();
      this.injectContentStyles();
      this.initFilePreview();
    }

    /**
     * Inject the content-panel stylesheet, once per page.
     *
     * The content panel used to be styled entirely by assigning `style.cssText`
     * on every element it created. That is why it looked wrong: inline styles
     * cannot express a hover state, cannot respond to container width, and —
     * being the last word in the cascade — cannot be corrected by a host either.
     * The navigation tree beside it renders through CLASSES and consequently
     * picks up the host's palette, which is why the two panes disagreed: teal
     * folders in the tree, solid black ones in the content area.
     *
     * Everything below is self-contained (no Bootstrap utility classes — hosts
     * are not required to load Bootstrap's CSS, and the component already
     * depends on Bootstrap Icons for glyphs only) and every colour comes from a
     * custom property with a fallback, so a host can theme the panel by setting
     * `--core-filer-*` anywhere above it.
     */
    injectContentStyles() {
      if (document.getElementById('core-filer-content-styles')) return;

      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/services/css/filer-ui.css';
      style.id = 'core-filer-content-styles';
      document.head.appendChild(style);
    }

    /**
     * The Bootstrap Icons glyph for a file, chosen by extension.
     * @param {string} name - The file name
     * @returns {string} A `bi-*` class name
     */
    fileIconClass(name) {
      const ext = String(name || '').split('.').pop().toLowerCase();
      const iconMap = {
        pdf: 'bi-file-earmark-pdf',
        doc: 'bi-file-earmark-word', docx: 'bi-file-earmark-word',
        xls: 'bi-file-earmark-excel', xlsx: 'bi-file-earmark-excel', csv: 'bi-file-earmark-spreadsheet',
        ppt: 'bi-file-earmark-ppt', pptx: 'bi-file-earmark-ppt',
        zip: 'bi-file-earmark-zip', gz: 'bi-file-earmark-zip', tar: 'bi-file-earmark-zip',
        jpg: 'bi-file-earmark-image', jpeg: 'bi-file-earmark-image', png: 'bi-file-earmark-image',
        gif: 'bi-file-earmark-image', svg: 'bi-file-earmark-image', webp: 'bi-file-earmark-image',
        mp3: 'bi-file-earmark-music', wav: 'bi-file-earmark-music',
        mp4: 'bi-file-earmark-play', mov: 'bi-file-earmark-play',
        txt: 'bi-file-earmark-text', md: 'bi-file-earmark-text',
        json: 'bi-file-earmark-code', js: 'bi-file-earmark-code', css: 'bi-file-earmark-code',
        html: 'bi-file-earmark-code', xml: 'bi-file-earmark-code', yml: 'bi-file-earmark-code',
        yaml: 'bi-file-earmark-code',
      };
      return iconMap[ext] || 'bi-file-earmark';
    }

    /**
     * Initialize DOM element references
     */
    initializeElements() {
      this.navContainer = document.getElementById(this.navigationContainerId);
      this.contentContainer = document.getElementById(this.contentContainerId);

      if (!this.navContainer || !this.contentContainer) {
        throw new Error('Could not find required containers in DOM');
      }

      if (this.breadcrumbId) {
        this.breadcrumb = document.getElementById(this.breadcrumbId);
      }

      if (this.refreshButtonId) {
        this.refreshButton = document.getElementById(this.refreshButtonId);
      }
    }

    /**
     * Initialize the file browser
     */
    async initialize() {
      this.setupEventListeners();
      await this.loadFileTree();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
      if (this.refreshButton) {
        this.refreshButton.addEventListener('click', () => this.loadFileTree());
      }

      // Breadcrumb root click handler
      if (this.breadcrumb) {
        this.breadcrumb.addEventListener('click', (e) => {
          const rootLink = e.target.closest('.breadcrumb-root');
          if (rootLink) {
            e.preventDefault();
            this.currentPath = '';
            this.displayFolderContents('');
            this.updateBreadcrumb('');
            this.expandAndHighlight('');
          }
        });
      }

      // View mode toggle buttons - scoped to this instance's parent content area.
      const contentArea = this.contentContainer.closest('.core-file-browser-content') || this.contentContainer.parentElement;
      const viewModeButtons = contentArea.querySelectorAll('.core-view-mode-btn');
      viewModeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
          const viewMode = e.currentTarget.dataset.view;
          this.setViewMode(viewMode);
        });
      });
    }

    /**
     * Set the current view mode and update button states
     */
    setViewMode(viewMode) {
      // The card button carries data-view="core-card"; normalise it to the
      // 'card' value that the render logic switches on.
      this.currentViewMode = viewMode === 'core-card' ? 'card' : viewMode;

      // Update button states - scoped to this instance's parent content area only
      const contentArea = this.contentContainer.closest('.core-file-browser-content') || this.contentContainer.parentElement;
      if (contentArea) {
        contentArea.querySelectorAll('.core-view-mode-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.view === viewMode);
        });
      }

      // Re-render current folder with new view mode
      if (this.currentPath !== undefined) {
        this.displayFolderContents(this.currentPath);
      }
    }

    /**
     * Load the file tree from the API
     * Uses the browse endpoint to respect baseDir configuration
     */
    async loadFileTree() {
      this.showLoading(this.navContainer, 'Loading files...');

      try {
        // First try to load from browse endpoint (respects baseDir)
        const response = await this.fetchApi('/browse/');
        const data = await response.json();

        if (!data.items || data.items.length === 0) {
          this.navContainer.innerHTML = '<div class="p-3 text-center text-muted"><i class="bi bi-inbox"></i><p>No files</p></div>';
          return;
        }

        // Build a simple tree structure from items
        const tree = {
          name: 'root',
          type: 'folder',
          children: data.items.map(item => ({
            name: item.name,
            path: item.path,
            type: item.type,
            children: item.type === 'folder' ? [] : undefined
          }))
        };

        this.fileTree = tree;
        this.renderFileTree(tree);
      } catch (error) {
        console.error('Error loading file tree:', error);
        this.showError(this.navContainer, 'Error loading files');
      }
    }

    /**
     * Render the file tree in the navigation container
     */
    renderFileTree(tree) {
      this.navContainer.innerHTML = '';

      if (!tree || !tree.children || tree.children.length === 0) {
        this.navContainer.innerHTML = '<div class="p-3 text-center text-muted"><i class="bi bi-inbox"></i><p>No files</p></div>';
        return;
      }

      // Sort children: folders first (alphabetically), then files (alphabetically)
      const sortedChildren = this.sortFileTreeItems(tree.children);

      const ul = document.createElement('ul');
      ul.className = 'core-file-tree';
      sortedChildren.forEach(child => {
        ul.appendChild(this.createFileTreeItem(child));
      });
      this.navContainer.appendChild(ul);
    }

    /**
     * Sort file tree items: folders first, then files, both alphabetically
     */
    sortFileTreeItems(items) {
      return items.sort((a, b) => {
        // Folders first
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        // Then alphabetically within the same type
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
    }

    /**
     * Create a file tree item element
     */
    createFileTreeItem(node, level = 0) {
      const li = document.createElement('li');
      li.className = 'core-file-tree-item';
      li.dataset.path = node.path;
      li.dataset.type = node.type;
      // Children are fetched lazily the first time a folder is expanded.
      li.dataset.loaded = 'false';

      const isFolder = node.type === 'folder';

      const content = document.createElement('div');
      content.className = 'core-file-tree-item-content';

      // Toggle button. Folders are always expandable because their children are
      // loaded on demand - we cannot know up front whether they are empty.
      const toggle = document.createElement('span');
      toggle.className = `core-file-tree-toggle ${isFolder ? 'core-has-children' : 'core-no-children'}`;
      toggle.innerHTML = isFolder ? '▶' : '';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFolder) {
          this.toggleTreeFolder(node, li, toggle);
        }
      });
      content.appendChild(toggle);

      // Icon
      const icon = document.createElement('span');
      icon.className = 'core-file-tree-item-icon';
      icon.innerHTML = isFolder ? '<i class="bi bi-folder-fill"></i>' : '<i class="bi bi-file-earmark"></i>';
      content.appendChild(icon);

      // Name
      const name = document.createElement('span');
      name.className = 'core-file-tree-item-name';
      name.textContent = node.name;
      content.appendChild(name);

      content.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleFileTreeItemClick(node);
      });

      li.appendChild(content);

      // Empty nested container, populated lazily on first expand.
      if (isFolder) {
        const nested = document.createElement('ul');
        nested.className = 'core-file-tree-item-nested';
        li.appendChild(nested);
      }

      return li;
    }

    /**
     * Lazily loads a folder's children into its nested list (once), then
     * expands or collapses it.
     * @param {Object} node - The folder node ({ name, path, type }).
     * @param {HTMLElement} li - The folder's <li> element.
     * @param {HTMLElement} toggle - The folder's toggle arrow element.
     * @param {boolean} [forceExpand=false] - When true, always expand (never collapse).
     */
    async toggleTreeFolder(node, li, toggle, forceExpand = false) {
      const nested = li.querySelector(':scope > .core-file-tree-item-nested');
      if (!nested) return;

      if (li.dataset.loaded === 'false') {
        await this.loadNodeChildren(node.path, li, nested);
      }

      const shouldShow = forceExpand || !nested.classList.contains('show');
      nested.classList.toggle('show', shouldShow);
      if (toggle) toggle.classList.toggle('core-expanded', shouldShow);
    }

    /**
     * Fetches the children of a folder path and renders them into a nested list.
     * @param {string} folderPath - The folder path to browse.
     * @param {HTMLElement} li - The folder's <li> element (its loaded flag is set).
     * @param {HTMLElement} nested - The nested <ul> to populate.
     */
    async loadNodeChildren(folderPath, li, nested) {
      try {
        const encodedPath = folderPath ? encodeURIComponent(folderPath) : '';
        const response = await this.fetchApi(`/browse/${encodedPath}`);
        const data = await response.json();

        nested.innerHTML = '';
        const items = this.sortFileTreeItems(data.items || []);
        items.forEach(item => {
          nested.appendChild(this.createFileTreeItem({
            name: item.name,
            path: item.path,
            type: item.type
          }));
        });
        li.dataset.loaded = 'true';
      } catch (error) {
        console.error('Error loading folder children:', error);
      }
    }

    /**
     * Expands the navigation tree along the given path (lazy-loading each
     * intermediate folder) and highlights the matching node, so the left nav
     * always reflects the current location.
     * @param {string} path - The path to reveal and highlight.
     */
    async expandAndHighlight(path) {
      // Clear any existing highlight.
      this.navContainer.querySelectorAll('.core-file-tree-item.active').forEach(el => {
        el.classList.remove('active');
      });

      if (!path) return;

      const parts = path.split('/');
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        currentPath += (i ? '/' : '') + parts[i];
        const li = this.navContainer.querySelector(
          `.core-file-tree-item[data-path="${this.escapeSelector(currentPath)}"]`
        );
        if (!li) return; // Ancestor not present (e.g. tree not loaded yet).

        const isLast = i === parts.length - 1;
        if (isLast) {
          li.classList.add('active');
          li.scrollIntoView({ block: 'nearest' });
        } else if (li.dataset.type === 'folder') {
          // Expand (and lazily load) intermediate folders so the next segment
          // exists in the DOM for the following iteration.
          const toggle = li.querySelector(':scope > .core-file-tree-item-content > .core-file-tree-toggle');
          const nested = li.querySelector(':scope > .core-file-tree-item-nested');
          if (nested && li.dataset.loaded === 'false') {
            await this.loadNodeChildren(currentPath, li, nested);
          }
          if (nested) nested.classList.add('show');
          if (toggle) toggle.classList.add('core-expanded');
        }
      }
    }

    /**
     * Handle file tree item click
     */
    handleFileTreeItemClick(node) {
      this.currentPath = node.path;

      if (node.type === 'folder') {
        this.displayFolderContents(node.path);
        // Expand the folder in place so its children are revealed.
        const li = this.navContainer.querySelector(
          `.core-file-tree-item[data-path="${this.escapeSelector(node.path)}"]`
        );
        if (li) {
          const toggle = li.querySelector(':scope > .core-file-tree-item-content > .core-file-tree-toggle');
          this.toggleTreeFolder(node, li, toggle, true);
        }
      } else {
        this.displayFilePreview(node.path);
      }

      this.updateBreadcrumb(node.path);
      this.expandAndHighlight(node.path);
    }

    /**
     * Display folder contents
     */
    async displayFolderContents(path) {
      this.showLoading(this.contentContainer, 'Loading folder contents...');

      try {
        const encodedPath = path ? encodeURIComponent(path) : '';
        const response = await this.fetchApi(`/browse/${encodedPath}`);
        const data = await response.json();

        if (!data.items || data.items.length === 0) {
          // Self-contained: `display-4`/`text-muted`/`mt-3` are Bootstrap
          // utilities, and a host is not obliged to load Bootstrap's CSS — where
          // it does not, this rendered as an oversized unstyled glyph.
          this.contentContainer.innerHTML = `
            <div class="core-filer-empty">
              <i class="bi bi-folder2-open"></i>
              <div class="core-filer-empty-title">This folder is empty</div>
              <div class="core-filer-empty-hint">Nothing has been added here yet.</div>
            </div>`;
          return;
        }

        const container = document.createElement('div');
        container.className = `core-folder-contents core-${this.currentViewMode}-view`;

        // Sort items: folders first, then files, both alphabetically
        const sortedItems = this.sortFileTreeItems(data.items);

        if (this.currentViewMode === 'card') {
          // Create card view with previews
          this.renderCardView(container, sortedItems, path);
        } else if (this.currentViewMode === 'list') {
          // Create list view
          const listTable = document.createElement('div');
          listTable.className = 'core-filer-items core-filer-list';

          // Column header. Sticky, so it survives a long folder.
          const headerRow = document.createElement('div');
          headerRow.className = 'core-filer-row core-filer-row-head';
          headerRow.innerHTML = `
            <div class="core-filer-row-icon"></div>
            <div class="core-filer-row-name">Name</div>
            <div class="core-filer-row-date">Modified</div>
          `;
          listTable.appendChild(headerRow);

          sortedItems.forEach(item => {
            const isFolder = item.type === 'folder';

            const itemEl = document.createElement('div');
            itemEl.className = 'core-filer-row';
            itemEl.tabIndex = 0;
            itemEl.setAttribute('role', 'button');

            const iconDiv = document.createElement('div');
            iconDiv.className = `core-filer-row-icon ${isFolder ? 'core-is-folder' : 'core-is-file'}`;
            iconDiv.innerHTML = isFolder
              ? '<i class="bi bi-folder-fill"></i>'
              : `<i class="bi ${this.fileIconClass(item.name)}"></i>`;

            const nameDiv = document.createElement('div');
            nameDiv.className = 'core-filer-row-name';
            nameDiv.title = item.name;
            nameDiv.textContent = item.name;

            const dateDiv = document.createElement('div');
            dateDiv.className = 'core-filer-row-date';
            dateDiv.textContent = item.modified ? new Date(item.modified).toLocaleDateString() : '—';

            itemEl.appendChild(iconDiv);
            itemEl.appendChild(nameDiv);
            itemEl.appendChild(dateDiv);

            const activate = () => {
              if (isFolder) {
                this.handleFolderItemClick(item);
              } else {
                this.handleFileItemClick(item);
              }
            };
            itemEl.addEventListener('click', activate);
            itemEl.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
              }
            });

            // Add hover preview for files
            if (item.type === 'file') {
              itemEl.addEventListener('mouseenter', () => {
                const filePath = item.path || `${this.currentPath}/${item.name}`;
                this.previewTimeout = setTimeout(() => {
                  this.currentPreviewCard = itemEl;
                  this.showFilePreview(itemEl, filePath, item.name);
                }, 500); // 500ms delay
              });

              itemEl.addEventListener('mouseleave', () => {
                if (this.previewTimeout) {
                  clearTimeout(this.previewTimeout);
                  this.previewTimeout = null;
                }
                this.hideFilePreview();
              });
            }

            listTable.appendChild(itemEl);
          });

          container.appendChild(listTable);
        } else {
          // Create grid view with 6 columns - icon and name only (NO PREVIEWS)
          this.renderGridView(container, sortedItems, path);
        }

        this.contentContainer.innerHTML = '';
        this.contentContainer.appendChild(container);
      } catch (error) {
        console.error('Error loading folder contents:', error);
        this.showError(this.contentContainer, 'Error loading folder contents');
      }
    }

    /**
     * Handle folder item click
     */
    handleFolderItemClick(item) {
      this.currentPath = item.path;
      this.displayFolderContents(item.path);
      this.updateBreadcrumb(item.path);
      this.expandAndHighlight(item.path);
    }

    /**
     * Handle file item click
     */
    handleFileItemClick(item) {
      this.currentPath = item.path;
      this.displayFilePreview(item.path);
      this.updateBreadcrumb(item.path);
      this.expandAndHighlight(item.path);
    }

    /**
     * Determine MIME type for a file
     */
    getMimeType(filePath) {
      const mimeTypes = {
        // Text files
        'txt': 'text/plain',
        'md': 'text/markdown',
        'log': 'text/plain',
        'json': 'application/json',
        'js': 'application/javascript',
        'ts': 'application/typescript',
        'jsx': 'application/jsx',
        'tsx': 'application/typescript',
        'css': 'text/css',
        'scss': 'text/x-scss',
        'sass': 'text/x-sass',
        'html': 'text/html',
        'htm': 'text/html',
        'xml': 'application/xml',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',
        'csv': 'text/csv',
        'tsv': 'text/tab-separated-values',
        'sql': 'application/sql',
        'sh': 'text/x-shellscript',
        'py': 'text/x-python',
        'rb': 'text/x-ruby',
        'java': 'text/x-java',
        'c': 'text/x-c',
        'cpp': 'text/x-c++',
        'go': 'text/x-go',
        'rs': 'text/x-rust',

        // Images
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'tiff': 'image/tiff',
        'bmp': 'image/bmp',

        // Documents
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'odt': 'application/vnd.oasis.opendocument.text',
        'ods': 'application/vnd.oasis.opendocument.spreadsheet',
        'odp': 'application/vnd.oasis.opendocument.presentation',

        // Archive
        'zip': 'application/zip',
        'tar': 'application/x-tar',
        'gz': 'application/gzip',
        'rar': 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',

        // Media
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mkv': 'video/x-matroska',
        'avi': 'video/x-msvideo',
        'mov': 'video/quicktime',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'flac': 'audio/flac',
        'aac': 'audio/aac',
        'm4a': 'audio/mp4',
        'ogg': 'audio/ogg'
      };

      const ext = filePath.split('.').pop().toLowerCase();
      return mimeTypes[ext] || 'application/octet-stream';
    }

    /**
     * Check if file type is text-based
     */
    isTextFile(filePath) {
      const textExtensions = [
        'txt', 'md', 'log', 'json', 'js', 'ts', 'jsx', 'tsx',
        'css', 'scss', 'sass', 'html', 'htm', 'xml', 'yaml', 'yml',
        'csv', 'tsv', 'sql', 'sh', 'py', 'rb', 'java', 'c', 'cpp',
        'go', 'rs', 'env', 'conf', 'config', 'ini', 'toml'
      ];
      const ext = filePath.split('.').pop().toLowerCase();
      return textExtensions.includes(ext);
    }

    /**
     * Check if file type is an image
     */
    isImageFile(filePath) {
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'tiff', 'bmp'];
      const ext = filePath.split('.').pop().toLowerCase();
      return imageExtensions.includes(ext);
    }

    /**
     * Check if file type is a PDF
     */
    isPdfFile(filePath) {
      const ext = filePath.split('.').pop().toLowerCase();
      return ext === 'pdf';
    }

    /**
     * Render grid view — auto-sizing tiles with an icon and a name.
     *
     * Tracks size themselves (`auto-fill` + a `minmax` floor) rather than the
     * fixed six columns this used to force: six columns is unreadably narrow in
     * a side panel and stranded on a wide one, and it was six columns of a
     * single 200px cell once a host styled the content container as a grid.
     */
    renderGridView(container, sortedItems, path) {
      container.classList.add('core-filer-items', 'core-filer-grid');

      sortedItems.forEach(item => {
        const isFolder = item.type === 'folder';

        const itemEl = document.createElement('div');
        itemEl.className = 'core-filer-tile';
        // Reachable and activatable without a mouse — the tile is the control.
        itemEl.tabIndex = 0;
        itemEl.setAttribute('role', 'button');
        itemEl.title = item.name;

        const iconEl = document.createElement('div');
        iconEl.className = `core-filer-tile-icon ${isFolder ? 'core-is-folder' : 'core-is-file'}`;
        iconEl.innerHTML = isFolder
          ? '<i class="bi bi-folder-fill"></i>'
          : `<i class="bi ${this.fileIconClass(item.name)}"></i>`;

        const nameEl = document.createElement('div');
        nameEl.className = 'core-filer-tile-name';
        nameEl.textContent = item.name;

        itemEl.appendChild(iconEl);
        itemEl.appendChild(nameEl);

        const activate = () => {
          if (isFolder) {
            this.handleFolderItemClick(item);
          } else {
            this.handleFileItemClick(item);
          }
        };

        itemEl.addEventListener('click', activate);
        itemEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        });

        // Add hover preview tooltip for files
        if (item.type === 'file') {
          itemEl.addEventListener('mouseenter', () => {
            const filePath = item.path || `${this.currentPath}/${item.name}`;
            this.previewTimeout = setTimeout(() => {
              this.currentPreviewCard = itemEl;
              this.showFilePreview(itemEl, filePath, item.name);
            }, 500); // 500ms delay
          });

          itemEl.addEventListener('mouseleave', () => {
            if (this.previewTimeout) {
              clearTimeout(this.previewTimeout);
              this.previewTimeout = null;
            }
            this.hideFilePreview();
          });
        }

        container.appendChild(itemEl);
      });
    }

    /**
     * Render card view - Shows file previews with icon/preview and name
     */
    renderCardView(container, sortedItems, path) {
      // core-filer-items carries the grid-column/width reset that keeps the
      // listing full-width when the host styles its content container as a grid.
      container.classList.add('core-filer-items');
      container.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.5rem; padding: 1.5rem; grid-column: 1 / -1; width: 100%; box-sizing: border-box;';

      sortedItems.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.style.cssText = 'display: flex; flex-direction: column; cursor: pointer; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: box-shadow 0.2s, transform 0.2s;';

        // Add hover effect
        itemEl.addEventListener('mouseenter', () => {
          itemEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
          itemEl.style.transform = 'translateY(-2px)';
        });
        itemEl.addEventListener('mouseleave', () => {
          itemEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
          itemEl.style.transform = 'translateY(0)';
        });

        const previewContainer = document.createElement('div');
        previewContainer.style.cssText = 'position: relative; overflow: hidden; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 150px;';

        // For folders, show folder icon. Themed like every other folder glyph
        // in the panel rather than solid black, which read as a rendering fault
        // beside the teal folders in the navigation tree.
        if (item.type === 'folder') {
          previewContainer.innerHTML = '<i class="inline-95e2af91 bi bi-folder-fill"></i>';
        } else {
          // For files, load preview
          const fileName = item.name.toLowerCase();
          const filePath = item.path || `${this.currentPath}/${item.name}`;

          // Show loading spinner while preview loads
          previewContainer.innerHTML = '<div class="inline-ffe5b19c"><i class="inline-39456bb3 bi bi-file-earmark"></i>Loading...</div>';

          // Load preview asynchronously
          this.loadGridItemPreview(previewContainer, filePath, fileName);
        }

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'padding: 1rem; text-align: center; font-size: 0.9rem; color: #333; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; background: white;';
        nameEl.title = item.name;
        nameEl.textContent = item.name;

        itemEl.appendChild(previewContainer);
        itemEl.appendChild(nameEl);

        itemEl.addEventListener('click', () => {
          if (item.type === 'folder') {
            this.handleFolderItemClick(item);
          } else {
            this.handleFileItemClick(item);
          }
        });

        // Add hover preview tooltip for files
        if (item.type === 'file') {
          itemEl.addEventListener('mouseenter', () => {
            const filePath = item.path || `${this.currentPath}/${item.name}`;
            this.previewTimeout = setTimeout(() => {
              this.currentPreviewCard = itemEl;
              this.showFilePreview(itemEl, filePath, item.name);
            }, 500); // 500ms delay
          });

          itemEl.addEventListener('mouseleave', () => {
            if (this.previewTimeout) {
              clearTimeout(this.previewTimeout);
              this.previewTimeout = null;
            }
            this.hideFilePreview();
          });
        }

        container.appendChild(itemEl);
      });
    }

    /**
     * Load preview for grid item card
     */
    async loadGridItemPreview(container, filePath, fileName) {
      try {
        const ext = fileName.split('.').pop().toLowerCase();

        // Handle image files
        if (this.isImageFile(filePath)) {
          const img = document.createElement('img');
          img.src = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}`;
          img.alt = fileName;
          img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';

          img.onload = () => {
            container.innerHTML = '';
            container.appendChild(img);
          };

          img.onerror = () => {
            container.innerHTML = '<div class="inline-ffe5b19c"><i class="inline-39456bb3 bi bi-image"></i>Image</div>';
          };

          return;
        }

        // Handle PDF files
        if (this.isPdfFile(filePath)) {
          container.innerHTML = '<div class="inline-ffe5b19c"><i class="inline-00a6b0ea bi bi-file-pdf"></i>PDF</div>';
          return;
        }

        // Handle text files - fetch preview
        if (this.isTextFile(filePath)) {
          const response = await this.fetchApi(`/download/${encodeURIComponent(filePath)}?encoding=utf8`);
          const data = await response.json();
          const content = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);

          // Show first 200 characters as text preview
          const preview = content.substring(0, 200).replace(/\n/g, ' ');
          container.innerHTML = `<div class="inline-2e38a0e9">${this.escapeHtml(preview)}</div>`;
          return;
        }

        // Default: show file type icon
        const iconMap = {
          'zip': 'bi-file-zip',
          'pdf': 'bi-file-pdf',
          'doc': 'bi-file-word',
          'docx': 'bi-file-word',
          'xls': 'bi-file-excel',
          'xlsx': 'bi-file-excel',
          'ppt': 'bi-file-powerpoint',
          'pptx': 'bi-file-powerpoint',
          'mp3': 'bi-file-earmark-music',
          'mp4': 'bi-file-earmark-play',
          'jpg': 'bi-file-image',
          'png': 'bi-file-image',
          'gif': 'bi-file-image'
        };

        const icon = iconMap[ext] || 'bi-file-earmark';
        container.innerHTML = `<div class="inline-ffe5b19c"><i class="inline-39456bb3 bi ${icon}"></i>${ext.toUpperCase()}</div>`;

      } catch (error) {
        console.warn(`Failed to load grid preview for ${fileName}:`, error);
        // Fallback to file type icon
        const ext = fileName.split('.').pop().toLowerCase();
        container.innerHTML = `<div class="inline-ffe5b19c"><i class="inline-39456bb3 bi bi-file-earmark"></i>${ext.toUpperCase()}</div>`;
      }
    }

    /**
     * Display file preview - detects file type and renders appropriately
     */
    async displayFilePreview(filePath) {
      this.showLoading(this.contentContainer, 'Loading file...');

      try {
        const fileExtension = filePath.split('.').pop().toLowerCase();

        // Handle PDFs and other binary files differently
        if (this.isPdfFile(filePath)) {
          await this.displayPdfFile(filePath);
          return;
        }

        if (this.isImageFile(filePath)) {
          this.displayImageFile(filePath);
          return;
        }

        // For text files, fetch with UTF-8 encoding
        if (this.isTextFile(filePath)) {
          const response = await this.fetchApi(`/download/${encodeURIComponent(filePath)}?encoding=utf8`);
          const data = await response.json();
          const fileContent = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);

          // Detect text file type and render accordingly
          if (fileExtension === 'md') {
            this.displayMarkdownDocument(filePath, fileContent);
          } else {
            this.displayFormattedTextDocument(filePath, fileContent, fileExtension);
          }
          return;
        }

        // For other files, try to fetch as binary and display as needed
        this.displayBinaryFile(filePath);
      } catch (error) {
        console.error('Error loading file:', error);
        this.displayBinaryFileNotice(filePath);
      }
    }

    /**
     * Display PDF file using embed viewer
     */
    async displayPdfFile(filePath) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview pdf-document';

      const header = this.createFilePreviewHeader(filePath, 'pdf');
      preview.appendChild(header);

      const content = document.createElement('div');
      content.className = 'core-file-preview-content pdf-content';

      const pdfUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}`;
      const fileName = filePath.split('/').pop();

      // Display PDF in embed viewer directly
      content.innerHTML = `
        <div class="inline-03430957 pdf-viewer-container">
          <div class="inline-5e563cd4">
            <embed
              src="${pdfUrl}"
              type="application/pdf"
              class="inline-06d5b19a pdf-embed"
             
              title="${this.escapeHtml(fileName)}"
            />
          </div>
        </div>
      `;

      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);

      // Add toolbar below
      const toolbar = document.createElement('div');
      toolbar.className = 'core-pdf-toolbar-bottom';
      toolbar.innerHTML = `
        <button class="btn btn-sm btn-outline-secondary" title="Download PDF">
          <i class="bi bi-download"></i> Download
        </button>
        <button class="btn btn-sm btn-outline-secondary" title="Open in new window">
          <i class="bi bi-box-arrow-up-right"></i> Open Full
        </button>
      `;

      toolbar.querySelector('button:nth-child(1)').addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = `${pdfUrl}?attachment=true`;
        link.download = fileName;
        link.click();
      });

      toolbar.querySelector('button:nth-child(2)').addEventListener('click', () => {
        window.open(pdfUrl, '_blank');
      });

      content.appendChild(toolbar);
      preview.appendChild(content);
    }

    /**
     * Display image file inline
     */
    displayImageFile(filePath) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview image-document';

      const header = this.createFilePreviewHeader(filePath, 'image');
      preview.appendChild(header);

      const content = document.createElement('div');
      content.className = 'core-file-preview-content core-image-content';
      content.innerHTML = '<div class="image-loader"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading image...</span></div><p>Loading image...</p></div>';

      preview.appendChild(content);
      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);

      try {
        const img = document.createElement('img');
        img.src = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}`;
        img.alt = filePath.split('/').pop();
        img.className = 'core-image-preview-img';

        img.onload = () => {
          content.innerHTML = '';

          const imgContainer = document.createElement('div');
          imgContainer.className = 'core-image-container';
          imgContainer.appendChild(img);
          content.appendChild(imgContainer);

          // Add zoom controls
          const controls = document.createElement('div');
          controls.className = 'core-image-controls';
          controls.innerHTML = `
            <button class="btn btn-sm btn-outline-secondary" id="zoomInBtn" title="Zoom in">
              <i class="bi bi-zoom-in"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" id="zoomOutBtn" title="Zoom out">
              <i class="bi bi-zoom-out"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" id="resetZoomBtn" title="Reset zoom">
              <i class="bi bi-arrow-counterclockwise"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" id="downloadImgBtn" title="Download image">
              <i class="bi bi-download"></i>
            </button>
          `;

          imgContainer.appendChild(controls);

          let zoom = 1;
          const updateZoom = () => {
            img.style.transform = `scale(${zoom})`;
          };

          document.getElementById('zoomInBtn').addEventListener('click', () => {
            zoom += 0.2;
            updateZoom();
          });

          document.getElementById('zoomOutBtn').addEventListener('click', () => {
            if (zoom > 0.2) zoom -= 0.2;
            updateZoom();
          });

          document.getElementById('resetZoomBtn').addEventListener('click', () => {
            zoom = 1;
            updateZoom();
          });

          document.getElementById('downloadImgBtn').addEventListener('click', () => {
            const link = document.createElement('a');
            link.href = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}?attachment=true`;
            link.download = filePath.split('/').pop();
            link.click();
          });
        };

        img.onerror = () => {
          const downloadUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}?attachment=true`;
          content.innerHTML = `
            <div class="alert alert-danger m-3">
              <i class="bi bi-exclamation-triangle"></i> Error loading image
              <button class="btn btn-sm btn-outline-danger ms-2" id="errorDownloadBtn">
                Download instead
              </button>
            </div>
          `;
          document.getElementById('errorDownloadBtn').addEventListener('click', () => {
            window.open(downloadUrl, '_blank');
          });
        };
      } catch (error) {
        console.error('Error loading image:', error);
        content.innerHTML = `
          <div class="alert alert-danger m-3">
            <i class="bi bi-exclamation-triangle"></i> Error loading image
          </div>
        `;
      }
    }

    /**
     * Display generic binary file with download option
     */
    displayBinaryFile(filePath) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview binary-document';

      const header = this.createFilePreviewHeader(filePath, 'binary');
      preview.appendChild(header);

      const fileExt = filePath.split('.').pop().toLowerCase();
      const mimeType = this.getMimeType(filePath);
      const fileName = filePath.split('/').pop();

      const content = document.createElement('div');
      content.className = 'core-file-preview-content core-binary-content';
      content.innerHTML = `
        <div class="inline-8985a0e5">
          <i class="inline-274661bf bi bi-file"></i>
          <p><strong>${this.escapeHtml(fileName)}</strong></p>
          <p class="inline-082c9fbc">Type: <code>${fileExt.toUpperCase()}</code></p>
          <p class="inline-b32853bf">This file cannot be previewed in the browser</p>
          <button class="btn btn-primary" id="binaryDownloadBtn">
            <i class="bi bi-download"></i> Download File
          </button>
        </div>
      `;

      const downloadUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}?attachment=true`;
      setTimeout(() => {
        const btn = document.getElementById('binaryDownloadBtn');
        if (btn) {
          btn.addEventListener('click', () => window.open(downloadUrl, '_blank'));
        }
      }, 0);

      preview.appendChild(content);
      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);
    }

    /**
     * Display markdown document with formatting
     */
    displayMarkdownDocument(filePath, markdown) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview markdown-document';

      const header = this.createFilePreviewHeader(filePath, 'markdown');
      preview.appendChild(header);

      const content = document.createElement('div');
      content.className = 'core-file-preview-content core-markdown-content';
      content.innerHTML = this.parseMarkdown(markdown);

      preview.appendChild(content);
      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);
    }

    /**
     * Display formatted text document (JSON, code, etc.)
     */
    displayFormattedTextDocument(filePath, content, fileExtension) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview formatted-document';

      const header = this.createFilePreviewHeader(filePath, fileExtension);
      preview.appendChild(header);

      const contentDiv = document.createElement('div');
      contentDiv.className = 'core-file-preview-content formatted-text';

      const preEl = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.className = `language-${fileExtension}`;
      codeEl.textContent = content;
      preEl.appendChild(codeEl);
      contentDiv.appendChild(preEl);

      preview.appendChild(contentDiv);
      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);
    }

    /**
     * Display plain text preview
     */
    displayPlainTextPreview(filePath, content) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview';

      const header = this.createFilePreviewHeader(filePath, 'text');
      preview.appendChild(header);

      const contentDiv = document.createElement('div');
      contentDiv.className = 'core-file-preview-content';
      contentDiv.textContent = content;

      preview.appendChild(contentDiv);
      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);
    }

    /**
     * Display binary file notice
     */
    displayBinaryFileNotice(filePath) {
      const preview = document.createElement('div');
      preview.className = 'core-file-preview';
      const downloadUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}?attachment=true`;
      preview.innerHTML = `
        <div class="binary-file-notice">
          <i class="bi bi-file-binary"></i>
          <div>
            <strong>Binary File</strong>
            <p class="mb-0">This file cannot be previewed as text. <a href="${downloadUrl}" class="alert-link">Download it</a> instead.</p>
          </div>
        </div>
      `;
      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(preview);
    }

    /**
     * Create file preview header with title and actions
     */
    createFilePreviewHeader(filePath, fileType) {
      const header = document.createElement('div');
      header.className = 'core-file-preview-header';

      const iconMap = {
        'markdown': 'bi-file-earmark-text',
        'json': 'bi-file-earmark-code',
        'js': 'bi-file-earmark-code',
        'css': 'bi-file-earmark-code',
        'html': 'bi-file-earmark-code',
        'xml': 'bi-file-earmark-code',
        'yml': 'bi-file-earmark-code',
        'yaml': 'bi-file-earmark-code',
        'text': 'bi-file-earmark-text',
        'txt': 'bi-file-earmark-text',
        'log': 'bi-file-earmark-text',
        'pdf': 'bi-file-pdf',
        'image': 'bi-file-image',
        'binary': 'bi-file-earmark'
      };

      const icon = iconMap[fileType] || 'bi-file-earmark';
      const fileName = filePath.split('/').pop();

      const title = document.createElement('div');
      title.className = 'core-file-preview-title';
      title.innerHTML = `<i class="bi ${icon}"></i> ${this.escapeHtml(fileName)}`;

      const actions = document.createElement('div');
      actions.className = 'core-file-preview-actions';

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'btn btn-sm btn-outline-secondary';
      downloadBtn.title = 'Download file';
      downloadBtn.innerHTML = '<i class="bi bi-download"></i>';
      downloadBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}?attachment=true`;
        link.download = fileName;
        link.click();
      });
      actions.appendChild(downloadBtn);

      const viewFullBtn = document.createElement('button');
      viewFullBtn.className = 'btn btn-sm btn-primary';
      viewFullBtn.title = 'View in fullscreen modal';
      viewFullBtn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
      viewFullBtn.addEventListener('click', () => {
        this.showDocumentModal(filePath, fileType);
      });
      actions.appendChild(viewFullBtn);

      header.appendChild(title);
      header.appendChild(actions);

      return header;
    }

    /**
     * Show document in fullscreen modal
     */
    async showDocumentModal(filePath, fileType) {
      try {
        const fileName = filePath.split('/').pop();
        const fileExtension = filePath.split('.').pop().toLowerCase();

        // Create modal elements
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'core-document-modal-overlay';
        modalOverlay.id = 'documentModal';

        const modal = document.createElement('div');
        modal.className = 'core-document-modal';

        const header = document.createElement('div');
        header.className = 'core-document-modal-header';

        const title = document.createElement('h2');
        title.className = 'core-document-modal-title';
        title.textContent = fileName;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'core-document-modal-close';
        closeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
        closeBtn.addEventListener('click', () => this.closeDocumentModal());

        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const content = document.createElement('div');
        content.className = 'core-document-modal-content';

        // Handle PDFs with embed viewer
        if (this.isPdfFile(filePath)) {
          const pdfUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}`;
          content.innerHTML = `
            <div class="inline-f691a62b pdf-viewer-container">
              <embed
                src="${pdfUrl}"
                type="application/pdf"
                class="inline-559371d6 pdf-embed"
               
                title="${this.escapeHtml(fileName)}"
              />
            </div>
          `;
        }
        // Handle images
        else if (this.isImageFile(filePath)) {
          const imgUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}`;
          content.innerHTML = `
            <div class="inline-4a9941d3">
              <img src="${imgUrl}" alt="${this.escapeHtml(fileName)}" class="inline-8e813ce7" />
            </div>
          `;
        }
        // Handle text files
        else if (this.isTextFile(filePath)) {
          const response = await this.fetchApi(`/download/${encodeURIComponent(filePath)}?encoding=utf8`);
          const data = await response.json();
          const fileContent = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);

          if (fileExtension === 'md') {
            content.innerHTML = this.parseMarkdown(fileContent);
            content.classList.add('core-markdown-content');
          } else {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = `language-${fileExtension}`;
            code.textContent = fileContent;
            pre.appendChild(code);
            content.appendChild(pre);
          }
        }
        // Handle binary/unsupported files
        else {
          const fileExt = filePath.split('.').pop().toLowerCase();
          const downloadUrl = `${this.buildInstanceUrl('/download')}/${encodeURIComponent(filePath)}?attachment=true`;
          content.innerHTML = `
            <div class="inline-3f69855c">
              <i class="inline-a9420062 bi bi-file"></i>
              <p><strong>${this.escapeHtml(fileName)}</strong></p>
              <p class="inline-082c9fbc">Type: <code>${fileExt.toUpperCase()}</code></p>
              <p class="inline-b32853bf">This file cannot be previewed in the browser</p>
              <button class="btn btn-primary" id="modalDownloadBtn">
                <i class="bi bi-download"></i> Download File
              </button>
            </div>
          `;
          setTimeout(() => {
            const btn = document.getElementById('modalDownloadBtn');
            if (btn) {
              btn.addEventListener('click', () => window.open(downloadUrl, '_blank'));
            }
          }, 0);
        }

        modal.appendChild(content);
        modalOverlay.appendChild(modal);

        document.body.appendChild(modalOverlay);

        // Add event listeners for closing modal
        modalOverlay.addEventListener('click', (e) => {
          if (e.target === modalOverlay) {
            this.closeDocumentModal();
          }
        });

        // Handle Escape key
        const handleEscape = (e) => {
          if (e.key === 'Escape') {
            this.closeDocumentModal();
            document.removeEventListener('keydown', handleEscape);
          }
        };
        document.addEventListener('keydown', handleEscape);
      } catch (error) {
        console.error('Error opening document modal:', error);
        alert('Error opening document');
      }
    }

    /**
     * Close document modal
     */
    closeDocumentModal() {
      const modal = document.getElementById('documentModal');
      if (modal) {
        modal.classList.add('core-fade-out');
        setTimeout(() => {
          modal.remove();
        }, 300);
      }
    }

    /**
     * Parse markdown to HTML
     */
    parseMarkdown(markdown) {
      let html = markdown;

      // Escape HTML in code blocks first to prevent processing
      const codeBlocks = [];
      html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        codeBlocks.push(code);
        return `__CODEBLOCK_${codeBlocks.length - 1}__`;
      });

      // Headers (must be done in reverse order to prevent conflicts)
      html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

      // Inline code
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

      // Bold
      html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

      // Italic
      html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');

      // Links
      html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

      // Horizontal rule
      html = html.replace(/^---$/gim, '<hr>');

      // Blockquotes
      html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');

      // Lists - handle line by line
      const lines = html.split('\n');
      const processedLines = [];
      let inList = false;
      let listType = null;

      // Matches a GFM table separator row, e.g. "| --- | :--: |" or "--|--".
      const isTableSeparator = (s) =>
        /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(s);
      // Splits a "| a | b |" row into trimmed cell values.
      const parseTableRow = (row) => {
        let r = row.trim();
        if (r.startsWith('|')) r = r.slice(1);
        if (r.endsWith('|')) r = r.slice(0, -1);
        return r.split('|').map((c) => c.trim());
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // GFM table: a header row immediately followed by a separator row.
        if (
          trimmed.includes('|') &&
          i + 1 < lines.length &&
          isTableSeparator(lines[i + 1].trim())
        ) {
          if (inList) {
            processedLines.push(`</${listType}>`);
            inList = false;
            listType = null;
          }

          const headers = parseTableRow(trimmed);
          let table = '<table><thead><tr>' +
            headers.map((h) => `<th>${h}</th>`).join('') +
            '</tr></thead><tbody>';

          let j = i + 2;
          while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
            const cells = parseTableRow(lines[j]);
            table += '<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>';
            j++;
          }
          table += '</tbody></table>';

          processedLines.push(table);
          i = j - 1; // resume after the consumed table rows
          continue;
        }

        // Unordered list
        if (trimmed.match(/^[\*\-] /)) {
          if (!inList || listType !== 'ul') {
            if (inList) processedLines.push(`</${listType}>`);
            processedLines.push('<ul>');
            inList = true;
            listType = 'ul';
          }
          processedLines.push('<li>' + trimmed.substring(2) + '</li>');
        }
        // Ordered list
        else if (trimmed.match(/^\d+\. /)) {
          if (!inList || listType !== 'ol') {
            if (inList) processedLines.push(`</${listType}>`);
            processedLines.push('<ol>');
            inList = true;
            listType = 'ol';
          }
          processedLines.push('<li>' + trimmed.replace(/^\d+\. /, '') + '</li>');
        }
        else {
          if (inList) {
            processedLines.push(`</${listType}>`);
            inList = false;
            listType = null;
          }

          // Don't wrap special elements in paragraphs
          if (trimmed &&
              !trimmed.startsWith('<h') &&
              !trimmed.startsWith('<hr') &&
              !trimmed.startsWith('<blockquote') &&
              !trimmed.includes('__CODEBLOCK_')) {
            processedLines.push('<p>' + line + '</p>');
          } else {
            processedLines.push(line);
          }
        }
      }

      if (inList) {
        processedLines.push(`</${listType}>`);
      }

      html = processedLines.join('\n');

      // Restore code blocks
      codeBlocks.forEach((code, index) => {
        html = html.replace(`__CODEBLOCK_${index}__`, `<pre><code>${this.escapeHtml(code)}</code></pre>`);
      });

      return html;
    }

    /**
     * Update breadcrumb navigation
     */
    updateBreadcrumb(path) {
      if (!this.breadcrumb) return;

      this.breadcrumb.innerHTML = '<li class="breadcrumb-item"><a href="#" class="breadcrumb-root"><i class="bi bi-house-fill"></i> Root</a></li>';

      if (path) {
        const parts = path.split('/');
        let currentPath = '';

        parts.forEach((part, index) => {
          currentPath += (currentPath ? '/' : '') + part;
          const li = document.createElement('li');
          li.className = 'breadcrumb-item';

          if (index === parts.length - 1) {
            li.classList.add('active');
            li.textContent = part;
          } else {
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = part;
            const pathSnapshot = currentPath;
            link.addEventListener('click', (e) => {
              e.preventDefault();
              this.currentPath = pathSnapshot;
              this.displayFolderContents(pathSnapshot);
              this.updateBreadcrumb(pathSnapshot);
              this.expandAndHighlight(pathSnapshot);
            });
            li.appendChild(link);
          }

          this.breadcrumb.appendChild(li);
        });
      }

      // Re-attach root click handler
      this.breadcrumb.addEventListener('click', (e) => {
        const rootLink = e.target.closest('.breadcrumb-root');
        if (rootLink) {
          e.preventDefault();
          this.currentPath = '';
          this.displayFolderContents('');
          this.updateBreadcrumb('');
          this.expandAndHighlight('');
        }
      });
    }

    /**
     * Build instance-aware URL by inserting instance name after /api/
     * Uses the instance option provided to the constructor
     * @param {string} endpoint - API endpoint (e.g., /browse/path)
     * @returns {string} Instance-aware URL
     */
    buildInstanceUrl(endpoint) {
      // Use instance from constructor options (stored in this.instance)
      if (this.instance && this.instance !== 'default') {
        return `${this.apiBaseUrl}/${this.instance}${endpoint}`;
      }
      return `${this.apiBaseUrl}${endpoint}`;
    }

    /**
     * Fetch from the filing API
     */
    async fetchApi(endpoint) {
      const url = this.buildInstanceUrl(endpoint);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      return response;
    }

    /**
     * Show loading state
     */
    showLoading(container, message = 'Loading...') {
      container.innerHTML = `<div class="p-3"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div><span class="ms-2">${message}</span></div>`;
    }

    /**
     * Show error state
     */
    showError(container, message = 'Error loading data') {
      container.innerHTML = `<div class="alert alert-danger mb-0 mx-2 mt-2"><i class="bi bi-exclamation-triangle me-2"></i>${message}</div>`;
    }

    /**
     * Escape HTML special characters
     */
    escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Escape CSS selector special characters
     */
    escapeSelector(str) {
      return str.replace(/([!"#$%&'()*+,.\/:;?@[\\\]^`{|}~])/g, '\\$1');
    }

    /**
     * Initialize file preview tooltip
     */
    initFilePreview() {
      // Create preview tooltip element if it doesn't exist
      if (!document.getElementById('filePreviewTooltip')) {
        const tooltip = document.createElement('div');
        tooltip.id = 'filePreviewTooltip';
        tooltip.className = 'core-file-preview-tooltip';
        tooltip.innerHTML = '<div class="file-preview-content"></div>';
        document.body.appendChild(tooltip);
      }
    }

    /**
     * Show preview for a file on hover
     */
    async showFilePreview(element, filePath, fileName) {
      const tooltip = document.getElementById('filePreviewTooltip');
      if (!tooltip) return;

      const content = tooltip.querySelector('.core-file-preview-content');

      // Show loading state
      content.innerHTML = '<div class="file-preview-loading"><span class="spinner-border spinner-border-sm me-2"></span>Loading preview...</div>';

      // Position tooltip near the element
      this.positionPreviewTooltip(tooltip, element);

      // Show tooltip
      tooltip.classList.add('show');

      try {
        // Determine file type from extension
        const ext = fileName.split('.').pop().toLowerCase();
        const fileType = this.getFileType(ext);

        // Get file content based on type
        let previewHtml = '';

        if (fileType === 'image') {
          const encodedPath = encodeURIComponent(filePath);
          previewHtml = `<img src="${this.buildInstanceUrl('/download')}/${encodedPath}" alt="Preview" />`;
        } else if (fileType === 'text' || fileType === 'code') {
          // Fetch file preview using download endpoint with UTF-8 encoding
          const response = await this.fetchApi(`/download/${encodeURIComponent(filePath)}?encoding=utf8`);
          const data = await response.json();
          const content = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
          const preview = content.substring(0, 1000) + (content.length > 1000 ? '\n...' : '');
          previewHtml = `<pre>${this.escapeHtml(preview)}</pre>`;
        } else {
          // Default file icon
          previewHtml = `
            <div class="file-icon-preview">
              <i class="bi bi-file-earmark"></i>
              <p>${fileName}</p>
              <small>No preview available</small>
            </div>
          `;
        }

        content.innerHTML = previewHtml;

      } catch (error) {
        console.error('Error loading preview:', error);
        content.innerHTML = '<div class="preview-error">Failed to load preview</div>';
      }
    }

    /**
     * Hide file preview tooltip
     */
    hideFilePreview() {
      const tooltip = document.getElementById('filePreviewTooltip');
      if (tooltip) {
        tooltip.classList.remove('show');
      }

      if (this.previewTimeout) {
        clearTimeout(this.previewTimeout);
        this.previewTimeout = null;
      }
    }

    /**
     * Position preview tooltip near element
     */
    positionPreviewTooltip(tooltip, element) {
      const elementRect = element.getBoundingClientRect();

      // Position to the right of the element
      let left = elementRect.right + 10;
      let top = elementRect.top;

      // If tooltip would go off screen to the right, show on left
      if (left + 350 > window.innerWidth) {
        left = elementRect.left - 350 - 10;
      }

      // Ensure we have minimum space
      if (left < 10) {
        left = 10;
      }

      // If tooltip would go off screen at bottom, adjust top position
      if (top + 400 > window.innerHeight) {
        top = window.innerHeight - 400 - 10;
      }

      // Ensure tooltip doesn't go off top of screen
      if (top < 10) {
        top = 10;
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    /**
     * Determine file type from extension
     */
    getFileType(ext) {
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'];
      const codeExts = ['js', 'ts', 'jsx', 'tsx', 'css', 'html', 'json', 'xml', 'yml', 'yaml', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'rb', 'php'];
      const textExts = ['txt', 'md', 'csv', 'log', 'sh', 'bash', 'sql'];

      if (imageExts.includes(ext)) return 'image';
      if (codeExts.includes(ext)) return 'code';
      if (textExts.includes(ext)) return 'text';
      return 'unknown';
    }
  }

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FilingUIManager;
  } else {
    global.FilingUIManager = FilingUIManager;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
