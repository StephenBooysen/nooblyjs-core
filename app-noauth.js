/**
 * @fileoverview Application demonstrating NooblyJS Core services.
 * This file serves as a comprehensive example of how to use all available
 * services in the NooblyJS Core framework.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const config = require('dotenv').config({quiet: true });

// P2-9: This entrypoint disables ALL authentication and is for local testing
// only. Refuse to start in production, and require an explicit opt-in flag
// everywhere else so it cannot be deployed by accident.
if (process.env.NODE_ENV === 'production') {
  console.error('FATAL: app-noauth.js disables all authentication and must not run in production.');
  process.exit(1);
}
if (process.env.ALLOW_NOAUTH !== '1') {
  console.error('Refusing to start: app-noauth.js runs with ALL authentication disabled.');
  console.error('This entrypoint is for local testing only. Set ALLOW_NOAUTH=1 to proceed.');
  process.exit(1);
}

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
require('express-async-errors');
const helmet = require('helmet');
const { helmetCspOption } = require('./src/shared/utils/contentSecurityPolicy');
const bodyParser = require('body-parser');
const { EventEmitter } = require('events');

const BODY_LIMIT = process.env.BODY_LIMIT || '1mb';

const serviceRegistry = require('.');

const app = express();
app.use(helmet({ contentSecurityPolicy: helmetCspOption() }));
app.use(bodyParser.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Configure MIME types for static files
app.set('default type', 'text/plain');
app.use((req, res, next) => {
  if (req.path.endsWith('.css')) {
    res.type('text/css');
  }
  next();
});

// Serve public static files with proper MIME types
app.use('/', express.static(__dirname + '/public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// Redirect to services
app.get('/', (req, res) => {
  res.redirect('/services');
});

const eventEmitter = new EventEmitter();
serviceRegistry.initialize(app, eventEmitter, {
  logDir: path.join(__dirname, './.application/', 'logs'),
  dataDir: path.join(__dirname, './.application/', 'data'),
  security: {
    apiKeyAuth: {
      requireApiKey: false,
      apiKeys: []
    },
    servicesAuth: {
      requireLogin: false
    }
  }
});

const log = serviceRegistry.logger('memory');
const defaultCache = serviceRegistry.cache('memory');
const cacheSessions = serviceRegistry.getService('caching', 'memory', { instanceName: 'sessions' });
const cacheMetrics = serviceRegistry.getService('caching', 'memory', { instanceName: 'metrics' });
const fetching = serviceRegistry.fetching('node');
const dataservice = serviceRegistry.dataService('file');
// Keep uploads out of the app root (N-15); see app.js.
const filingBaseDir = process.env.FILING_BASE_DIR || path.join(__dirname, '.application', 'files');
require('node:fs').mkdirSync(filingBaseDir, { recursive: true });
const filing = serviceRegistry.filing('local', { baseDir: filingBaseDir });
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const worker = serviceRegistry.working('memory');
const workflow = serviceRegistry.workflow('memory');
const settings = serviceRegistry.settings('file');
const aiservice = serviceRegistry.aiservice('ollama', {});
// Feature 05: ask your documents. Sync a folder of the filing root from the
// Knowledge dashboard; sync state and ratings are kept as hidden files there.
const knowledge = serviceRegistry.knowledge('default', { dependencies: { filing, aiservice }, restore: true });

const authservice = serviceRegistry.authservice('file', {
  'express-app': app
});

// Launch the application docs folder to show the docs on the public site
// /docs retrieves the document
// /docs/list retrieves the list of documents
app.use('/docs', express.static(path.join(__dirname, 'docs')));
app.get('/docs/list', (req, res) => {
    let files = [];
    fs.readdirSync(path.join(__dirname, 'docs')).forEach(file => {
      const filePath = path.join(__dirname, 'docs', file);
      const stat = fs.lstatSync(filePath);

      if (stat.isDirectory()) {
        fs.readdirSync(filePath).forEach(subfile => {
          if (subfile.endsWith('.md')) {
            const subFilePath = path.join(filePath, subfile);
            const content = fs.readFileSync(subFilePath, 'utf-8');
            const docData = extractDocumentMetadata(content);
            files.push({
              path: '/' + file + '/' + subfile,
              title: docData.title,
              description: docData.description
            });
          }
        });
      } else if (file.endsWith('.md')) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const docData = extractDocumentMetadata(content);
        files.push({
          path: '/' + file,
          title: docData.title,
          description: docData.description
        });
      }
    });

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(files));
});

// Helper function to extract title and description from markdown
function extractDocumentMetadata(content) {
  const lines = content.split('\n');
  let title = '';
  let description = '';
  let collectingDescription = false;
  let descriptionLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Extract title from first h1
    if (!title && line.startsWith('#') && !line.startsWith('##')) {
      title = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    // Collect description until we hit a table of contents or another heading
    if (title && !collectingDescription && line.trim() && !line.startsWith('#')) {
      collectingDescription = true;
    }

    if (collectingDescription) {
      // Stop collecting if we hit a heading or table of contents
      if (line.startsWith('#') || line.toLowerCase().includes('table of contents') ||
          line.toLowerCase().includes('documentation') || line.toLowerCase().includes('---')) {
        break;
      }
      // Skip empty lines at the start
      if (line.trim() || descriptionLines.length > 0) {
        descriptionLines.push(line);
      }
    }
  }

  // Clean up description (remove trailing empty lines and join)
  description = descriptionLines
    .join('\n')
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .slice(0, 3) // Take first 3 lines max
    .join(' ')
    .replace(/\[.*?\]\(.*?\)/g, '') // Remove markdown links
    .substring(0, 200) // Limit to 200 characters
    .trim();

  return {
    title: title || 'Untitled Document',
    description: description || 'No description available'
  };
}

// Launch the application readme file to be shown on the docs readme area
app.use('/readme', express.static(path.join(__dirname, 'README.md')));

const PORT = process.env.PORT || 9000;
app.listen(PORT, () => {
  log.info(`Server is running on port ${PORT}`);
  log.info(cacheMetrics.get('Startup Time'));
  log.info(defaultCache.get('running status'));
});

// Process-level safety nets (P0-5).
process.on('unhandledRejection', (reason) => {
  (log?.error || console.error)('Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (error) => {
  (log?.error || console.error)('Uncaught exception:', error?.stack || error?.message || error);
  process.exit(1);
});
