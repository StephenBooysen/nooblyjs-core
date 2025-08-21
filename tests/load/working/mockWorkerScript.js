/**
 * @fileoverview Mock worker script for load testing worker functionality.
 * 
 * This simple worker script immediately posts a completion status message
 * to the parent thread. Used for load testing worker thread spawning,
 * communication, and lifecycle management without complex processing.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { parentPort } = require('worker_threads');

// Immediately post completion status to parent thread for load testing
parentPort.postMessage({ type: 'status', status: 'completed' });
