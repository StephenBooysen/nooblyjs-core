/**
 * @fileoverview Application Service Factory
 * Factory module for creating application structure services.
 * Automatically discovers and mounts routes, views, services, data, and activities
 * from standard directory structure (src/routes, src/views, src/services, src/data, src/activities).
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */
'use strict';

// Imports
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Base classes 
const appViewBase = require('./baseClasses/appViewBase.js');
const appRouteBase = require('./baseClasses/appRouteBase.js');
const appWorkerBase = require('./baseClasses/appWorkerBase.js');
const appServiceBase = require('./baseClasses/appServiceBase.js');
const appDataBase = require('./baseClasses/appDataBase.js');
const { env } = require('process');

/**
 * Creates an application service instance that automatically discovers and mounts
 * application structure from standard directories.
 *
 * @param {string} type - The type of application structure to create
 * @param {Object} options - Configuration options for the application service
 * @param {string} [options.name='Application'] - The name of the application
 * @param {string} [options.baseUrl='/'] - The base URL path for the application (e.g., '/applications/wiki')
 * @param {Express} options['express-app'] - Express application instance for mounting routes
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {Object} Object containing base classes (appViewBase, appRouteBase, appWorkerBase, appServiceBase, appDataBase)
 * @throws {Error} When required dependencies are missing
 * @example
 * const appService = createAppService('default', {
 *   name: 'MyApp',
 *   baseUrl: '/myapp',
 *   'express-app': app,
 *   dependencies: { logging }
 * }, eventEmitter);
 *
 * // Application structure is automatically discovered and mounted:
 * // - src/services/ → Service modules
 * // - src/data/ → Data models
 * // - src/routes/ → Express routes
 * // - src/views/ → View templates or static files
 * // - src/activities/ → Activity handlers
 */
module.exports = function (type, options, eventEmitter) {

    const logprefx = `[APPSERVICE:${type}]`

    // set some defaults for options
    options.name = options.name || 'Application';
    options.baseUrl = options.baseUrl || '/';

    const app = options['express-app'];
    const { dependencies = {}, ...providerOptions } = options;
    const logger = dependencies.logging;

    // Determine where we are working
    logger.info(`${logprefx} Application service ${options.name} current working directory is ${process.cwd()}`);

    // Determine the entry point
    const entryPoint = path.dirname(require.main.filename);

    // Determine if the services folder and index file exists and load it
    if (fs.existsSync('./src/services/')) {
        if (mountFiles(path.resolve('./src/services/'), type, options, eventEmitter)) {
            logger.info(`${logprefx} Application service structure loaded`)
        }
    }

    // Determine if the data folder and index file exists and load it
    if (fs.existsSync('./src/data/')) {
        if (mountFiles(path.resolve('./src/data/'), type, options, eventEmitter)) {
            logger.info(`${logprefx} Application service data structures loaded`)
        }
    }

    // Determine if routes folder and index file exists and load it
    if (fs.existsSync('./src/routes/')) {
        if (mountFiles(path.resolve('./src/routes/'), type, options, eventEmitter)) {
            logger.info(`${logprefx} Application service routes structures loaded`)
        }
    }

    // Determine if views folder and index file exists and load it else if there us a index.html then server the folder statically
    if (fs.existsSync('./src/views/')) {
        if (mountFiles(path.resolve('./src/views/'), type, options, eventEmitter)) {
            logger.info(`${logprefx} Application service views structures loaded`)
        } else if (fs.existsSync('./src/views/index.html')) {
            app.use(options.baseUrl, express.static('./src/views/'));
            logger.info(`${logprefx} Application service static views data loaded on ${options.baseUrl}`)
        }
    }

    // Determine if activites folder and index file exists and load it
    if (fs.existsSync('./src/activities/index.js')) {
        if (mountFiles(path.resolve('./src/activities/'), type, options, eventEmitter)) {
            logger.info(`${logprefx} Application service structures loaded`)
        }
    }

    // if the docs folder exists expose it    
    if (fs.existsSync(path.join(entryPoint, 'docs'))) {
        if (fs.existsSync('./docs')) {
            app.use('/docs', express.static(path.join(entryPoint, 'docs')));
            app.get('/docs/list', (req, res) => {
                let files = [];

                fs.readdirSync(path.join(entryPoint, 'docs')).forEach(file => {
                    const filePath = path.join(entryPoint, 'docs', file);
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
        }
    }

    // If the readme file exists expose it
    if (fs.existsSync('./README.md')) {
        app.use('/readme', express.static(path.join(entryPoint, 'README.md')));
    }

    const baseClasses = {
        appViewBase,
        appRouteBase,
        appWorkerBase,
        appServiceBase,
        appDataBase
    };

    return baseClasses;
};

/**
 * Mount JavaScript files from a directory and pass configuration to them.
 * Scans the specified directory for .js files and requires/executes each one
 * with the provided options and event emitter.
 *
 * @param {string} servicepath - Absolute path to the directory containing files to mount
 * @param {string} type - The type of application being created
 * @param {Object} options - Configuration options to pass to each mounted file
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {boolean} True if any files were mounted, false otherwise
 */
function mountFiles(servicepath, type, options, eventEmitter) {
    let filesMounted = false;
    (fs.readdirSync(servicepath)).forEach(file => {
        if (path.extname(file) === '.js') {
            const MountedFile = require(path.join(servicepath, file));
            MountedFile(type, options, eventEmitter);
            filesMounted = true;
        }
    });
    return filesMounted;
}
