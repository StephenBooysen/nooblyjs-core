// Load content from Markdown file
async function loadContent() {
    try {
        const response = await fetch('./index.md');
        if (!response.ok) {
            throw new Error(`Failed to load index.md: ${response.status} ${response.statusText}`);
        }
        const markdown = await response.text();

        // Parse markdown and render it
        const html = parseMarkdown(markdown);

        // Extract header navbar if present
        const headerMatch = html.match(/<nav class="navbar[^>]*>[\s\S]*?<\/nav>/);
        let contentHtml = html;

        if (headerMatch) {
          // Extract and inject header
          const headerHtml = headerMatch[0];
          document.getElementById('header-container').innerHTML = headerHtml;

          // Remove header from content
          contentHtml = html.replace(headerHtml, '');
        }

        // Extract footer if present
        const footerMatch = contentHtml.match(/<footer class="footer[^>]*>[\s\S]*?<\/footer>/);

        if (footerMatch) {
          // Extract and inject footer
          const footerHtml = footerMatch[0];
          document.getElementById('footer-container').innerHTML = footerHtml;

          // Remove footer from content
          contentHtml = contentHtml.replace(footerHtml, '');
        }

        const dynamicSections = document.getElementById('dynamic-sections');
        dynamicSections.innerHTML = contentHtml;

        // Execute any inline scripts (for swagger blocks, etc.)
        const scripts = dynamicSections.querySelectorAll('script');
        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            newScript.textContent = oldScript.textContent;
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });

        // Set page title from first H1 heading
        const firstH1 = markdown.match(/^# (.+)$/m);
        if (firstH1) {
            document.getElementById('page-title').textContent = firstH1[1];
        }

        // Render mermaid diagrams if present
        if (window.mermaid) {
            mermaid.run().catch(error => {
                console.error('Mermaid rendering error:', error);
            });
        }

        hideLoadingOverlay();

        // Auto-populate wiki-link cards with summary content from linked documents
        populateWikiLinkSummaries();
    } catch (error) {
        console.error('Error loading content:', error);
        hideLoadingOverlay();
        document.body.innerHTML += `<div class="inline-f0aea064">Error loading page content: ${error.message}</div>`;
    }
}

// Fetch linked markdown files and populate wiki-link cards with extracted summaries
async function populateWikiLinkSummaries() {
    const cards = document.querySelectorAll('.wiki-link-card[data-wiki-path]');

    for (const card of cards) {
        const contentEl = card.querySelector('.wiki-link-card-content.wiki-link-card-loading');
        if (!contentEl) continue; // Card already has explicit content

        const wikiPath = card.getAttribute('data-wiki-path');
        if (!wikiPath) continue;

        try {
            let fetchPath = wikiPath;
            if (!fetchPath.startsWith('/')) fetchPath = '/' + fetchPath;
            if (!fetchPath.startsWith('/docs') && !fetchPath.startsWith('/documents')) {
                fetchPath = '/docs' + fetchPath;
            }

            const response = await fetch(fetchPath);
            if (!response.ok) continue;

            const markdown = await response.text();
            const summaryText = markdownParser.extractSummary(markdown);

            if (summaryText) {
                contentEl.textContent = summaryText;
                contentEl.classList.remove('wiki-link-card-loading');
            } else {
                // No summary found - remove the loading placeholder
                contentEl.remove();
            }
        } catch (err) {
            // Fetch failed - remove the loading placeholder silently
            contentEl.remove();
        }
    }
}

// Hide loading overlay and show content
function hideLoadingOverlay() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
    document.body.classList.remove('loading');
    document.body.classList.add('loaded');
}

// Close document modal
function closeDocumentModal() {
    document.getElementById('document-modal').style.display = 'none';
    document.body.style.overflow = 'auto'; // Re-enable scrolling
}

// Load and display document content in modal
async function loadDocumentContent(docPath) {
    try {
        const response = await fetch('/docs' + docPath);
        const markdown = await response.text();

        // Render markdown to HTML using custom parser with support for container and hero-banner blocks
        const html = parseMarkdown(markdown);

        const fileName = docPath.split('/').pop().replace('.md', '');
        const displayName = fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/-/g, ' ');

        document.getElementById('doc-viewer-title').textContent = displayName;
        document.getElementById('doc-viewer-content').innerHTML = html;

        // Show the modal
        document.getElementById('document-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent scrolling
    } catch (error) {
        console.error('Error loading document content:', error);
        alert('Error loading document. Please try again.');
    }
}

// Load wiki-link document (supports both /path and docs/path formats)
async function loadWikiLinkDocument(docPath, title) {
    try {
        // Decode the path if it was encoded
        const decodedPath = decodeURIComponent(docPath);

        // Determine the actual path to fetch from
        let fetchPath = decodedPath;
        if (!decodedPath.startsWith('/')) {
            fetchPath = '/' + decodedPath;
        }
        if (!decodedPath.startsWith('/docs') && !decodedPath.startsWith('/documents')) {
            fetchPath = '/docs' + fetchPath;
        }

        const response = await fetch(fetchPath);
        if (!response.ok) {
            throw new Error(`Failed to load: ${response.status} ${response.statusText}`);
        }
        const markdown = await response.text();

        // Render markdown to HTML using custom parser
        const html = parseMarkdown(markdown);

        document.getElementById('doc-viewer-title').textContent = title || 'Document';
        document.getElementById('doc-viewer-content').innerHTML = html;

        // Show the modal
        document.getElementById('document-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent scrolling

        // Re-render any mermaid diagrams in the modal
        if (window.mermaid) {
            mermaid.run().catch(error => {
                console.error('Mermaid rendering error in modal:', error);
            });
        }
    } catch (error) {
        console.error('Error loading wiki-link document:', error);
        alert('Error loading document: ' + error.message);
    }
}


// Load content when page loads
document.addEventListener('DOMContentLoaded', loadContent);

// Set up document modal close button
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('doc-close-btn');
    const modal = document.getElementById('document-modal');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeDocumentModal);
    }

    // Close modal when clicking outside the content
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeDocumentModal();
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            closeDocumentModal();
        }
    });
});
