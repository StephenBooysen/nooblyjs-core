/**
 * @fileoverview Custom Markdown Parser
 * Extends marked.js with support for custom block types:
 * - container (left/right sections)
 * - hero-banner (title, subtitle, hero-image, hero-image-align properties)
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

class MarkdownParser {
  constructor() {
    this.customBlockTypes = ['header', 'footer', 'swagger', 'mermaid', 'three-column', 'two-col-3-1', 'two-col-1-3', 'container', 'hero-banner', 'cards', 'wiki-link', 'wiki-links'];
  }

  /**
   * Parse markdown text with custom blocks and standard markdown
   * @param {string} markdown - Raw markdown text
   * @returns {string} - Rendered HTML
   */
  parse(markdown) {
    if (!markdown) return '';

    // Split content into blocks
    const blocks = this.splitIntoBlocks(markdown);

    // Process each block
    let html = '';
    blocks.forEach(block => {
      if (block.type === 'custom') {
        html += this.processCustomBlock(block.content, block.blockType);
      } else if (block.type === 'markdown') {
        // Use marked.js for standard markdown
        html += marked.parse(block.content);
      }
    });

    return html;
  }

  /**
   * Split markdown into blocks (custom and standard markdown)
   * Supports both indentation-based syntax and code fence syntax (```blockType)
   * @param {string} markdown - Raw markdown text
   * @returns {Array} - Array of block objects {type, content, blockType}
   */
  splitIntoBlocks(markdown) {
    const blocks = [];
    const lines = markdown.split('\n');
    let currentBlock = '';
    let blockType = null;
    let isCustomBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check if line starts a code fence with a custom block type
      const codeFenceMatch = this.isCodeFenceStart(trimmedLine);
      if (codeFenceMatch) {
        // Save previous markdown block if exists
        if (currentBlock.trim()) {
          blocks.push({
            type: 'markdown',
            content: currentBlock.trim()
          });
          currentBlock = '';
        }

        // Extract code fence block
        const codeFenceContent = this.extractCodeFenceBlock(lines, i);

        if (codeFenceContent.isCustomBlock) {
          // This is a custom block
          blocks.push({
            type: 'custom',
            content: codeFenceContent.content,
            blockType: codeFenceContent.blockType
          });
        } else {
          // Regular code block - include the fence in markdown
          currentBlock += line + '\n';
          // Add content until closing fence
          for (let j = i + 1; j <= codeFenceContent.endLine; j++) {
            currentBlock += lines[j] + '\n';
          }
        }

        // Skip lines that were part of code fence
        i = codeFenceContent.endLine;
        continue;
      }

      // Check if line starts an indentation-based custom block
      const customBlockMatch = this.isCustomBlockStart(trimmedLine);
      if (customBlockMatch) {
        // Save previous markdown block if exists
        if (currentBlock.trim()) {
          blocks.push({
            type: 'markdown',
            content: currentBlock.trim()
          });
          currentBlock = '';
        }

        // Start custom block
        isCustomBlock = true;
        blockType = customBlockMatch;
        const customContent = this.extractCustomBlock(lines, i);

        blocks.push({
          type: 'custom',
          content: customContent.content,
          blockType: blockType
        });

        // Skip lines that were part of custom block
        i = customContent.endLine;
      } else {
        // Regular markdown line
        currentBlock += line + '\n';
      }
    }

    // Save remaining markdown block
    if (currentBlock.trim()) {
      blocks.push({
        type: 'markdown',
        content: currentBlock.trim()
      });
    }

    return blocks;
  }

  /**
   * Check if a line starts a code fence (``` or ~~~)
   * Returns the language identifier if it's a known custom block type
   * @param {string} line - Line to check
   * @returns {string|null} - Language identifier or null
   */
  isCodeFenceStart(line) {
    const codeFenceRegex = /^(`{3,}|~{3,})([a-zA-Z0-9\-_]*)$/;
    const match = line.match(codeFenceRegex);
    if (match) {
      return match[2] || ''; // Return the language identifier
    }
    return null;
  }

  /**
   * Extract content from a code fence block
   * @param {Array} lines - All lines
   * @param {number} startLine - Starting line index
   * @returns {Object} - {content, endLine, blockType, isCustomBlock}
   */
  extractCodeFenceBlock(lines, startLine) {
    const fenceLine = lines[startLine].trim();
    const fenceChar = fenceLine[0]; // ` or ~
    const fenceLength = fenceLine.match(/^(`+|~+)/)[0].length;
    const languageId = fenceLine.substring(fenceLength).trim();

    const isCustomBlock = this.customBlockTypes.includes(languageId.toLowerCase());

    const blockLines = [];
    let endLine = startLine;

    // Extract lines until closing fence
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for closing fence
      if (trimmed.match(new RegExp(`^${fenceChar}{${fenceLength},}$`))) {
        endLine = i;
        break;
      }

      blockLines.push(line);
    }

    const content = blockLines.join('\n');

    return {
      content: content,
      endLine: endLine,
      blockType: languageId.toLowerCase(),
      isCustomBlock: isCustomBlock
    };
  }

  /**
   * Check if a line starts a custom block
   * @param {string} line - Line to check
   * @returns {string|null} - Block type or null
   */
  isCustomBlockStart(line) {
    for (const blockType of this.customBlockTypes) {
      if (line.toLowerCase().startsWith(blockType)) {
        return blockType;
      }
    }
    return null;
  }

  /**
   * Extract custom block content from lines
   * @param {Array} lines - All lines
   * @param {number} startLine - Starting line index
   * @returns {Object} - {content, endLine}
   */
  extractCustomBlock(lines, startLine) {
    const blockLines = [lines[startLine].trim()];
    let endLine = startLine;

    // Extract indented content following the block type
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];

      // Stop if we hit a line that's not indented and not empty
      if (line.trim() === '') {
        // Empty line might be part of block or separator
        if (i + 1 < lines.length && !lines[i + 1].match(/^\s+/)) {
          endLine = i;
          break;
        }
        blockLines.push('');
      } else if (line.match(/^\s+/)) {
        // Indented line - part of the block
        blockLines.push(line);
        endLine = i;
      } else {
        // Non-indented, non-empty line - end of block
        endLine = i - 1;
        break;
      }
    }

    return {
      content: blockLines.join('\n'),
      endLine: endLine
    };
  }

  /**
   * Process custom block types
   * @param {string} content - Block content
   * @param {string} blockType - Type of block
   * @returns {string} - Rendered HTML
   */
  processCustomBlock(content, blockType) {
    if (blockType === 'header') {
      return this.renderHeader(content);
    } else if (blockType === 'footer') {
      return this.renderFooter(content);
    } else if (blockType === 'swagger') {
      return this.renderSwagger(content);
    } else if (blockType === 'mermaid') {
      return this.renderMermaid(content);
    } else if (blockType === 'three-column') {
      return this.renderThreeColumn(content);
    } else if (blockType === 'two-col-3-1') {
      return this.renderTwoCol3_1(content);
    } else if (blockType === 'two-col-1-3') {
      return this.renderTwoCol1_3(content);
    } else if (blockType === 'container') {
      return this.renderContainer(content);
    } else if (blockType === 'hero-banner') {
      return this.renderHeroBanner(content);
    } else if (blockType === 'cards') {
      return this.renderCards(content);
    } else if (blockType === 'wiki-link' || blockType === 'wiki-links') {
      return this.renderWikiLink(content);
    }
    return '';
  }

  /**
   * Render header/navbar block
   * @param {string} content - Block content
   * @returns {string} - Rendered HTML
   */
  renderHeader(content) {
    const properties = this.parseBlockProperties(content);

    const icon = properties.icon || '';
    const title = properties.title || 'NooblyJs Platform';
    const linksStr = properties.links || '';

    // Parse links in markdown format [text](url)
    const links = this.parseMarkdownLinks(linksStr);

    // Build navbar HTML
    let html = '<nav class="navbar navbar-expand-lg navbar-light bg-light sticky-top" id="header">\n';
    html += '  <div class="container">\n';

    // Navbar brand with icon and title
    html += '    <a class="navbar-brand d-flex align-items-center" href="index.html">\n';
    if (icon) {
      html += `      <img src="${this.escapeHtml(icon)}" alt="Logo" width="32" class="rounded me-2">\n`;
    }
    html += `      <span class="fw-semibold">${this.escapeHtml(title)}</span>\n`;
    html += '    </a>\n';

    // Navbar toggler for mobile
    html += '    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">\n';
    html += '      <span class="navbar-toggler-icon"></span>\n';
    html += '    </button>\n';

    // Navbar links
    html += '    <div class="collapse navbar-collapse" id="navbarNav">\n';
    html += '      <ul class="navbar-nav ms-auto">\n';

    // Add links from header
    if (links.length > 0) {
      links.forEach(link => {
        html += '        <li class="nav-item">\n';
        html += `          <a class="nav-link" href="${this.escapeHtml(link.url)}">${this.escapeHtml(link.text)}</a>\n`;
        html += '        </li>\n';
      });
    }

    html += '      </ul>\n';
    html += '    </div>\n';
    html += '  </div>\n';
    html += '</nav>\n';

    return html;
  }

  /**
   * Render swagger/OpenAPI documentation block
   * @param {string} content - Block content (contains url property OR inline JSON)
   * @returns {string} - Rendered HTML
   */
  renderSwagger(content) {
    const properties = this.parseBlockProperties(content);
    const url = properties.url || '';
    const title = properties.title || 'API Documentation';

    // Generate a unique ID for the swagger container
    const swaggerId = 'swagger-' + Math.random().toString(36).substr(2, 9);

    // Build HTML with swagger container
    let html = '<div class="swagger-documentation my-4">\n';
    html += `  <div id="${swaggerId}" class="swagger-ui"></div>\n`;
    html += '</div>\n';

    // Add inline script to initialize Swagger UI for this specific container
    html += '<script>\n';
    html += `  (function() {\n`;
    html += `    console.log('Initializing Swagger UI for container: ${swaggerId}');\n`;
    html += `    if (window.SwaggerUIBundle) {\n`;
    html += `      console.log('SwaggerUIBundle is available');\n`;
    html += `      const swaggerConfig = {\n`;
    html += `        dom_id: '#${swaggerId}',\n`;
    html += `        presets: [\n`;
    html += `          SwaggerUIBundle.presets.apis,\n`;
    html += `          SwaggerUIBundle.SwaggerUIStandalonePreset\n`;
    html += `        ],\n`;
    html += `        layout: "BaseLayout",\n`;
    html += `        requestInterceptor: (request) => {\n`;
    html += `          request.headers['X-Requested-With'] = 'XMLHttpRequest';\n`;
    html += `          return request;\n`;
    html += `        }\n`;
    html += `      };\n`;

    if (url) {
      // Use URL if provided
      html += `      console.log('Loading Swagger from URL:', "${this.escapeHtml(url)}");\n`;
      html += `      swaggerConfig.url = "${this.escapeHtml(url)}";\n`;
    } else {
      // Use inline YAML spec
      const specContent = this.extractYamlFromContent(content);
      if (specContent) {
        html += `      console.log('Loading inline Swagger spec');\n`;
        html += `      if (!window.jsyaml) {\n`;
        html += `        console.error('jsyaml library not loaded');\n`;
        html += `        return;\n`;
        html += `      }\n`;
        html += `      try {\n`;
        html += `        const spec = jsyaml.load(\`${specContent.replace(/`/g, '\\`')}\`);\n`;
        html += `        console.log('Parsed YAML spec:', spec);\n`;
        html += `        swaggerConfig.spec = spec;\n`;
        html += `      } catch (e) {\n`;
        html += `        console.error('Failed to parse YAML in swagger block:', e);\n`;
        html += `        console.error('YAML content was:', \`${specContent.replace(/`/g, '\\`')}\`);\n`;
        html += `        return;\n`;
        html += `      }\n`;
      } else {
        html += `      console.error('Swagger block: No url or YAML spec provided');\n`;
        html += `      return;\n`;
      }
    }

    html += `      try {\n`;
    html += `        const ui = SwaggerUIBundle(swaggerConfig);\n`;
    html += `        console.log('Swagger UI initialized successfully');\n`;
    html += `      } catch (e) {\n`;
    html += `        console.error('Error initializing Swagger UI:', e);\n`;
    html += `      }\n`;
    html += `    } else {\n`;
    html += `      console.error('SwaggerUIBundle not available');\n`;
    html += `    }\n`;
    html += `  })();\n`;
    html += '</script>\n';

    return html;
  }

  /**
   * Extract YAML from swagger block content
   * Extracts all lines that are not the "swagger" keyword or block properties
   * @param {string} content - Block content
   * @returns {string|null} - YAML content or null
   */
  extractYamlFromContent(content) {
    const lines = content.split('\n');
    const yamlLines = [];
    let minIndent = Infinity;
    let foundContent = false;

    // First pass: find minimum indentation and identify YAML content
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "swagger" keyword
      if (trimmed.toLowerCase() === 'swagger') continue;

      // Skip empty lines before content starts
      if (!foundContent && !trimmed) continue;

      // Skip property lines that look like metadata (like "url: /path" or "title: MyAPI")
      // But NOT YAML content (which may have colons in values)
      if (!foundContent && trimmed && trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIndex).trim();

        // Check if this is a known property keyword
        if (['url', 'title'].includes(key.toLowerCase())) {
          continue; // Skip property lines
        }
      }

      // This line is part of the YAML spec
      if (trimmed) {
        foundContent = true;
        const leadingSpaces = line.match(/^\s*/)[0].length;
        if (leadingSpaces > 0) {
          minIndent = Math.min(minIndent, leadingSpaces);
        }
        yamlLines.push(line);
      }
    }

    if (yamlLines.length === 0 || minIndent === Infinity) {
      return null;
    }

    // Second pass: remove the minimum indentation and return YAML
    const processedLines = yamlLines.map(line => {
      if (line.trim()) {
        return line.substring(minIndent);
      }
      return line.substring(minIndent);
    });

    let yamlContent = processedLines.join('\n').trim();

    // Validate that it looks like YAML
    if (!yamlContent) {
      return null;
    }

    // Remove trailing markdown block separators (---)
    yamlContent = yamlContent.replace(/\s*---\s*$/, '').trim();

    console.log('Extracted YAML for swagger block:', yamlContent);
    return yamlContent;
  }

  /**
   * Parse markdown links from text
   * Extracts links in format [text](url) or [text](url) [text](url)
   * @param {string} text - Text containing markdown links
   * @returns {Array} - Array of {text, url} objects
   */
  parseMarkdownLinks(text) {
    const links = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      links.push({
        text: match[1],
        url: match[2]
      });
    }

    return links;
  }

  /**
   * Render footer block
   * @param {string} content - Block content
   * @returns {string} - Rendered HTML
   */
  renderFooter(content) {
    const properties = this.parseBlockProperties(content);

    const icon = properties.icon || '';
    const title = properties.title || 'NooblyJS Platform';
    const subtitle = properties.subtitle || '';
    const linksStr = properties.links || '';

    // Parse links in markdown format [text](url)
    const links = this.parseMarkdownLinks(linksStr);

    // Build footer HTML
    let html = '<footer class="footer py-5">\n';
    html += '  <div class="container">\n';
    html += '    <div class="row align-items-center">\n';

    // Left column: logo and subtitle
    html += '      <div class="col-md-6">\n';
    html += '        <div class="d-flex align-items-center gap-3">\n';
    html += '          <a href="index.html" class="text-decoration-none d-flex align-items-center">\n';

    if (icon) {
      html += `            <img src="${this.escapeHtml(icon)}" alt="Logo" width="24" height="24" class="rounded me-2">\n`;
    }

    html += `            <span class="fw-semibold text-dark">${this.escapeHtml(title)}</span>\n`;
    html += '          </a>\n';
    html += '        </div>\n';

    if (subtitle) {
      html += `        <p class="text-muted small mt-2">${this.escapeHtml(subtitle)}</p>\n`;
    }

    html += '      </div>\n';

    // Right column: links
    html += '      <div class="col-md-6 text-md-end">\n';
    html += '        <div class="d-flex gap-3 justify-content-md-end">\n';

    // Add links from footer
    if (links.length > 0) {
      links.forEach(link => {
        html += `          <a href="${this.escapeHtml(link.url)}" class="text-decoration-none text-muted small">${this.escapeHtml(link.text)}</a>\n`;
      });
    }

    html += '        </div>\n';
    html += '      </div>\n';
    html += '    </div>\n';
    html += '  </div>\n';
    html += '</footer>\n';

    return html;
  }

  /**
   * Render mermaid diagram block
   * Wraps mermaid diagram syntax in a div that mermaidjs will process.
   * Mermaid syntax can contain "---" which won't conflict with block separators.
   * @param {string} content - Block content (mermaid diagram syntax)
   * @returns {string} - Rendered HTML
   */
  renderMermaid(content) {
    // Extract the diagram content, removing the 'mermaid' keyword and any properties
    const lines = content.split('\n');
    const diagramLines = [];
    let minIndent = Infinity;

    // First pass: collect lines and find minimum indentation
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "mermaid" keyword itself
      if (trimmed.toLowerCase() === 'mermaid') continue;

      // Skip empty lines
      if (!trimmed) continue;

      // Track minimum indentation for non-empty lines
      const leadingSpaces = line.match(/^\s*/)[0].length;
      if (leadingSpaces > 0) {
        minIndent = Math.min(minIndent, leadingSpaces);
      }
    }

    // Reset minIndent if no indented lines found
    if (minIndent === Infinity) {
      minIndent = 0;
    }

    // Second pass: collect lines while preserving relative indentation
    let startCapturing = false;
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "mermaid" keyword itself
      if (trimmed.toLowerCase() === 'mermaid') continue;

      // Start capturing after we skip the keyword
      if (!startCapturing && trimmed) {
        startCapturing = true;
      }

      if (!startCapturing) continue;

      // For empty lines, just add them as empty
      if (!trimmed) {
        diagramLines.push('');
      } else {
        // Remove only the minimum indentation, preserving relative indentation
        const processed = line.substring(minIndent);
        diagramLines.push(processed);
      }
    }

    let diagramContent = diagramLines.join('\n').trim();

    if (!diagramContent) {
      return '';
    }

    // Remove any trailing markdown block separators (---)
    // These are block separators in our markdown format, not mermaid syntax
    // Match --- at the very end with optional whitespace before/after
    diagramContent = diagramContent.replace(/\s*---\s*$/, '').trim();

    // Generate a unique ID for the diagram
    const diagramId = 'mermaid-' + Math.random().toString(36).substr(2, 9);

    // Build HTML with mermaid div
    // Note: Do NOT escape the content - mermaidjs needs the raw diagram syntax
    let html = '<div class="mermaid-diagram my-4">\n';
    html += '<div class="mermaid" id="' + diagramId + '">\n';
    html += diagramContent + '\n';
    html += '</div>\n';
    html += '</div>\n';

    return html;
  }

  /**
   * Render three-column layout (equal width columns)
   * @param {string} content - Block content with left, middle, right sections
   * @returns {string} - Rendered HTML
   */
  renderThreeColumn(content) {
    const lines = content.split('\n');
    const sections = {
      left: [],
      middle: [],
      right: []
    };

    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "three-column" keyword itself
      if (trimmed.toLowerCase() === 'three-column') continue;

      // Check for section markers (with or without colon)
      if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
        currentSection = 'left';
        continue;
      } else if (trimmed.toLowerCase() === 'middle' || trimmed.toLowerCase() === 'middle:') {
        currentSection = 'middle';
        continue;
      } else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
        currentSection = 'right';
        continue;
      }

      // Add content to current section
      if (currentSection && trimmed) {
        sections[currentSection].push(line);
      }
    }

    // Build HTML with 3 equal columns
    let html = '<div class="row g-4 plain-text-columns">\n';

    if (sections.left.length > 0) {
      const leftContent = sections.left.join('\n');
      const leftMarkdown = marked.parse(leftContent);
      html += '<div class="col-lg-4">\n' + leftMarkdown + '\n</div>\n';
    }

    if (sections.middle.length > 0) {
      const middleContent = sections.middle.join('\n');
      const middleMarkdown = marked.parse(middleContent);
      html += '<div class="col-lg-4">\n' + middleMarkdown + '\n</div>\n';
    }

    if (sections.right.length > 0) {
      const rightContent = sections.right.join('\n');
      const rightMarkdown = marked.parse(rightContent);
      html += '<div class="col-lg-4">\n' + rightMarkdown + '\n</div>\n';
    }

    html += '</div>\n';
    return html;
  }

  /**
   * Render two-column layout (75% / 25% split)
   * @param {string} content - Block content with left and right sections
   * @returns {string} - Rendered HTML
   */
  renderTwoCol3_1(content) {
    const lines = content.split('\n');
    const sections = {
      left: [],
      right: []
    };

    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.toLowerCase() === 'two-col-3-1') continue;

      if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
        currentSection = 'left';
        continue;
      } else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
        currentSection = 'right';
        continue;
      }

      if (currentSection && trimmed) {
        sections[currentSection].push(line);
      }
    }

    // Build HTML with 75/25 split
    let html = '<div class="row g-4 plain-text-columns">\n';

    if (sections.left.length > 0) {
      const leftContent = sections.left.join('\n');
      const leftMarkdown = marked.parse(leftContent);
      html += '<div class="col-lg-9">\n' + leftMarkdown + '\n</div>\n';
    }

    if (sections.right.length > 0) {
      const rightContent = sections.right.join('\n');
      const rightMarkdown = marked.parse(rightContent);
      html += '<div class="col-lg-3">\n' + rightMarkdown + '\n</div>\n';
    }

    html += '</div>\n';
    return html;
  }

  /**
   * Render two-column layout (25% / 75% split)
   * @param {string} content - Block content with left and right sections
   * @returns {string} - Rendered HTML
   */
  renderTwoCol1_3(content) {
    const lines = content.split('\n');
    const sections = {
      left: [],
      right: []
    };

    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.toLowerCase() === 'two-col-1-3') continue;

      if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
        currentSection = 'left';
        continue;
      } else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
        currentSection = 'right';
        continue;
      }

      if (currentSection && trimmed) {
        sections[currentSection].push(line);
      }
    }

    // Build HTML with 25/75 split
    let html = '<div class="row g-4 plain-text-columns">\n';

    if (sections.left.length > 0) {
      const leftContent = sections.left.join('\n');
      const leftMarkdown = marked.parse(leftContent);
      html += '<div class="col-lg-3">\n' + leftMarkdown + '\n</div>\n';
    }

    if (sections.right.length > 0) {
      const rightContent = sections.right.join('\n');
      const rightMarkdown = marked.parse(rightContent);
      html += '<div class="col-lg-9">\n' + rightMarkdown + '\n</div>\n';
    }

    html += '</div>\n';
    return html;
  }

  /**
   * Render container block (left/right columns - 50/50 split)
   * @param {string} content - Block content
   * @returns {string} - Rendered HTML
   */
  renderContainer(content) {
    const lines = content.split('\n');
    const sections = {
      left: [],
      right: []
    };

    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "container" keyword itself
      if (trimmed.toLowerCase() === 'container') continue;

      // Check for section markers (with or without colon)
      if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
        currentSection = 'left';
        continue;
      } else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
        currentSection = 'right';
        continue;
      }

      // Add content to current section
      if (currentSection && trimmed) {
        sections[currentSection].push(line);
      }
    }

    // Build HTML
    let html = '<div class="row g-4 plain-text-columns">\n';

    if (sections.left.length > 0) {
      const leftContent = sections.left.join('\n');
      const leftMarkdown = marked.parse(leftContent);
      html += '<div class="col-lg-6">\n' + leftMarkdown + '\n</div>\n';
    }

    if (sections.right.length > 0) {
      const rightContent = sections.right.join('\n');
      const rightMarkdown = marked.parse(rightContent);
      html += '<div class="col-lg-6">\n' + rightMarkdown + '\n</div>\n';
    }

    html += '</div>\n';

    return html;
  }

  /**
   * Render hero-banner block
   * @param {string} content - Block content
   * @returns {string} - Rendered HTML
   */
  renderHeroBanner(content) {
    const properties = this.parseBlockProperties(content);

    const title = properties.title || '';
    const subtitle = properties.subtitle || '';
    const heroImage = properties['hero-image'] || properties['hero_image'] || '';
    const heroImageAlign = properties['hero-image-align'] || properties['hero_image_align'] || 'right';

    // Build HTML based on image alignment
    let html = '<section class="inline-77fe124b hero-banner-section py-4">\n';
    html += '<div class="container">\n';
    html += '<div class="row align-items-center g-4">\n';

    // Left side content
    html += '<div class="col-lg-6">\n';
    if (title) {
      html += `<h2 class="inline-30f46876 display-5 fw-bold mb-3">${this.escapeHtml(title)}</h2>\n`;
    }
    if (subtitle) {
      html += `<p class="lead text-muted mb-4">${this.escapeHtml(subtitle)}</p>\n`;
    }
    html += '</div>\n';

    // Right side image
    if (heroImage) {
      html += '<div class="col-lg-6 text-center">\n';
      html += `<img src="${this.escapeHtml(heroImage)}" alt="Hero Image" class="inline-aafea9a8 img-fluid robot-hero-img">\n`;
      html += '</div>\n';
    }

    html += '</div>\n';
    html += '</div>\n';
    html += '</section>\n';

    return html;
  }

  /**
   * Render cards block with Bootstrap grid
   * @param {string} content - Block content
   * @returns {string} - Rendered HTML
   */
  renderCards(content) {
    const properties = this.parseBlockProperties(content);
    const across = parseInt(properties.across) || 3;

    // Calculate Bootstrap column class based on 'across' value
    const colClassMap = {
      1: 'col-lg-12',
      2: 'col-lg-6',
      3: 'col-lg-4',
      4: 'col-lg-3',
      6: 'col-lg-2'
    };
    const colClass = colClassMap[across] || 'col-lg-4';

    // Extract list items from content
    const lines = content.split('\n');
    const cards = [];
    let currentCard = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "cards" keyword and properties
      if (trimmed.toLowerCase() === 'cards' || trimmed.startsWith('across:')) continue;

      // Check if this is a list item (starts with -)
      if (trimmed.startsWith('-')) {
        // Save previous card if it exists
        if (currentCard.trim()) {
          cards.push(currentCard.trim());
        }
        // Start new card (remove the - and leading space)
        currentCard = trimmed.substring(1).trim();
      } else if (trimmed && currentCard) {
        // Add to current card
        currentCard += '\n' + line;
      } else if (trimmed && !currentCard && !trimmed.startsWith('across:')) {
        // Handle case where content doesn't start with -
        currentCard = trimmed;
      }
    }

    // Save last card
    if (currentCard.trim()) {
      cards.push(currentCard.trim());
    }

    // Build HTML
    let html = '<div class="cards-section row g-4 my-4">\n';

    cards.forEach(cardContent => {
      // Extract heading and description
      const { heading, description } = this.extractHeadingAndDescription(cardContent);

      html += `<div class="${colClass} col-md-6 mb-4">\n`;
      html += '<div class="card h-100 shadow-sm">\n';

      // Add card header if heading exists
      if (heading) {
        html += `<div class="card-header border-0 bg-white">\n`;
        html += `<h5 class="mb-0">${this.escapeHtml(heading)}</h5>\n`;
        html += '</div>\n';
      }

      html += '<div class="card-body">\n';

      // Parse the description content (markdown)
      if (description) {
        const descMarkdown = marked.parse(description);
        html += descMarkdown;
      }

      html += '</div>\n';
      html += '</div>\n';
      html += '</div>\n';
    });

    html += '</div>\n';

    return html;
  }

  /**
   * Render wiki-link block - clickable cards that load markdown in a modal
   * Supports both single and multiple wiki-links
   * @param {string} content - Block content with path, title, subtitle, content properties
   * @returns {string} - Rendered HTML
   */
  renderWikiLink(content) {
    // Parse the content to extract individual wiki-links
    const lines = content.split('\n');
    const wikiLinks = [];
    let currentLink = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the "wiki-link" or "wiki-links" keyword and empty lines at start
      if (trimmed.toLowerCase() === 'wiki-link' || trimmed.toLowerCase() === 'wiki-links' || trimmed === '') {
        if (currentLink && trimmed !== '') {
          continue;
        }
        // Save previous wiki-link if it exists and we're starting a new one
        if (currentLink && trimmed === '') {
          wikiLinks.push(this.parseWikiLinkProperties(currentLink));
          currentLink = '';
        }
        continue;
      }

      // Accumulate lines for current wiki-link
      currentLink += line + '\n';

      // Check if we're at a separator (---) or end of content - marks end of a wiki-link
      if (trimmed === '---') {
        wikiLinks.push(this.parseWikiLinkProperties(currentLink.replace('---', '')));
        currentLink = '';
      }
    }

    // Save last wiki-link if exists
    if (currentLink.trim()) {
      wikiLinks.push(this.parseWikiLinkProperties(currentLink));
    }

    // Build HTML
    let html = '<div class="wiki-links-section row g-4 my-4">\n';

    wikiLinks.forEach((link, index) => {
      if (!link.path || !link.title) return; // Skip invalid entries

      const linkId = 'wiki-link-' + Math.random().toString(36).substr(2, 9);
      const encodedPath = encodeURIComponent(link.path);

      html += '<div class="col-lg-4 col-md-6 mb-4">\n';
      html += '<div class="inline-8410c989 wiki-link-card h-100" onclick="loadWikiLinkDocument(\'' + encodedPath.replace(/'/g, "\\'") + '\', \'' + link.title.replace(/'/g, "\\'") + '\')">\n';

      html += '<div class="wiki-link-card-header">\n';
      html += `<h5 class="wiki-link-card-title">${this.escapeHtml(link.title)}</h5>\n`;
      if (link.subtitle) {
        html += `<p class="wiki-link-card-subtitle">${this.escapeHtml(link.subtitle)}</p>\n`;
      }
      html += '</div>\n';

      if (link.content) {
        html += '<div class="wiki-link-card-body">\n';
        html += `<p class="wiki-link-card-content">${this.escapeHtml(link.content)}</p>\n`;
        html += '</div>\n';
      }

      html += '<div class="wiki-link-card-footer">\n';
      html += '<span class="wiki-link-read-more">Read More <i class="bi bi-arrow-right"></i></span>\n';
      html += '</div>\n';

      html += '</div>\n';
      html += '</div>\n';
    });

    html += '</div>\n';

    return html;
  }

  /**
   * Parse wiki-link properties from content
   * @param {string} content - Wiki-link content
   * @returns {Object} - {path, title, subtitle, content}
   */
  parseWikiLinkProperties(content) {
    const properties = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Parse key: value format
      if (trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();

        if (key && value) {
          properties[key.toLowerCase()] = value;
        }
      }
    }

    return properties;
  }

  /**
   * Extract heading and description from card content
   * @param {string} content - Card content
   * @returns {Object} - {heading, description}
   */
  extractHeadingAndDescription(content) {
    const lines = content.split('\n');
    let heading = '';
    let descriptionLines = [];
    let foundHeading = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a heading (###, ##, #)
      if (!foundHeading && trimmed.match(/^#+\s+/)) {
        // Extract heading text (remove # symbols)
        heading = trimmed.replace(/^#+\s+/, '').trim();
        foundHeading = true;
      } else if (foundHeading || !trimmed.match(/^#+\s+/)) {
        // Add all other lines to description
        if (trimmed) {
          descriptionLines.push(line);
        }
      }
    }

    return {
      heading: heading,
      description: descriptionLines.join('\n').trim()
    };
  }

  /**
   * Parse key-value properties from block content
   * @param {string} content - Block content
   * @returns {Object} - Properties object
   */
  parseBlockProperties(content) {
    const properties = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and block type line
      if (!trimmed || trimmed.toLowerCase() === 'hero-banner') continue;

      // Parse key: value format
      if (trimmed.includes(':')) {
        const [key, ...valueParts] = trimmed.split(':');
        const keyTrimmed = key.trim();
        const valueTrimmed = valueParts.join(':').trim();

        if (keyTrimmed && valueTrimmed) {
          properties[keyTrimmed] = valueTrimmed;
        }
      }
    }

    return properties;
  }

  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// Create global instance
const markdownParser = new MarkdownParser();

/**
 * Parse markdown with custom blocks
 * @param {string} markdown - Raw markdown text
 * @returns {string} - Rendered HTML
 */
function parseMarkdown(markdown) {
  return markdownParser.parse(markdown);
}
