/**
 * @fileoverview Simple test script for API Key authentication
 * This script tests the API key middleware functionality
 */

const express = require('express');
const request = require('http');
const serviceRegistry = require('../../index.js');

// Create test app
const app = express();
app.use(express.json());

// Generate test API key
const validApiKey = serviceRegistry.generateApiKey(32);
const invalidApiKey = 'invalid-key-123';

console.log('🔑 Test API Key:', validApiKey);

// Initialize with API key authentication
serviceRegistry.initialize(app, {
  apiKeys: [validApiKey],
  requireApiKey: true,
  excludePaths: ['/services/*/status', '/services/', '/services/*/views/*']
});

// Get cache service
const cache = serviceRegistry.cache('memory');

// Test server
const server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`📡 Test server running on port ${port}\n`);

  // Test cases
  const tests = [
    {
      name: '❌ Request without API key should fail',
      path: '/services/caching/api/put/test',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
      expectedStatus: 401
    },
    {
      name: '❌ Request with invalid API key should fail',
      path: '/services/caching/api/put/test',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': invalidApiKey
      },
      body: JSON.stringify({ message: 'test' }),
      expectedStatus: 401
    },
    {
      name: '✅ Request with valid API key in header should succeed',
      path: '/services/caching/api/put/test',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': validApiKey
      },
      body: JSON.stringify({ message: 'test' }),
      expectedStatus: 200
    },
    {
      name: '✅ Request with Bearer token should succeed',
      path: '/services/caching/api/put/test2',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validApiKey}`
      },
      body: JSON.stringify({ message: 'test' }),
      expectedStatus: 200
    },
    {
      name: '✅ Status endpoint should work without API key',
      path: '/services/caching/api/status',
      method: 'GET',
      headers: {},
      expectedStatus: 200
    },
    {
      name: '✅ Retrieve with valid API key should work',
      path: '/services/caching/api/get/test',
      method: 'GET',
      headers: { 'x-api-key': validApiKey },
      expectedStatus: 200
    }
  ];

  // Run tests
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await makeRequest(port, test);
      if (result.statusCode === test.expectedStatus) {
        console.log(`${test.name}: PASSED (${result.statusCode})`);
        passed++;
      } else {
        console.log(`${test.name}: FAILED (Expected ${test.expectedStatus}, got ${result.statusCode})`);
        failed++;
      }
    } catch (error) {
      console.log(`${test.name}: ERROR - ${error.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! API key authentication is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please check the implementation.');
  }

  server.close();
});

// Helper function to make HTTP requests
function makeRequest(port, test) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: test.path,
      method: test.method,
      headers: test.headers
    };

    const req = request.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    
    if (test.body) {
      req.write(test.body);
    }
    
    req.end();
  });
}

// Event listeners
serviceRegistry.getEventEmitter().on('api-auth-success', () => {
  // Success events (no console output during testing)
});

serviceRegistry.getEventEmitter().on('api-auth-failure', () => {
  // Failure events (no console output during testing)
});

serviceRegistry.getEventEmitter().on('debug', (message) => {
  console.log('🐛 DEBUG:', message);
});