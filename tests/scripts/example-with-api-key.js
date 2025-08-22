/**
 * @fileoverview Example usage of NooblyJS Core with API Key authentication
 * This example demonstrates how to initialize and use NooblyJS services with API key security.
 */

const express = require('express');
const serviceRegistry = require('../../index.js');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Generate API keys for demonstration
const apiKey1 = serviceRegistry.generateApiKey(32);
const apiKey2 = serviceRegistry.generateApiKey(32);

console.log('Generated API Keys:');
console.log('API Key 1:', apiKey1);
console.log('API Key 2:', apiKey2);

// Initialize ServiceRegistry with API key authentication
serviceRegistry.initialize(app, {
  // API Keys configuration
  apiKeys: [apiKey1, apiKey2],
  requireApiKey: true, // Set to false to disable API key requirement
  excludePaths: [
    '/services/*/status',     // Status endpoints don't require API keys
    '/services/',             // Main services page
    '/services/*/views/*'     // HTML views don't require API keys
  ]
});

// Get services - these will automatically have API key protection on their /api/* routes
const cache = serviceRegistry.cache('memory');
const logger = serviceRegistry.logger('console');
const dataServe = serviceRegistry.dataServe('memory');

// Example API usage with curl commands:
console.log('\n=== API Usage Examples ===');
console.log('After starting the server, you can test the API with these curl commands:\n');

console.log('1. Test without API key (should fail):');
console.log(`curl -X POST http://localhost:${port}/services/caching/api/put/test \\`);
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{"message": "Hello World"}\'\n');

console.log('2. Test with API key in header (should succeed):');
console.log(`curl -X POST http://localhost:${port}/services/caching/api/put/test \\`);
console.log('  -H "Content-Type: application/json" \\');
console.log(`  -H "x-api-key: ${apiKey1}" \\`);
console.log('  -d \'{"message": "Hello World"}\'\n');

console.log('3. Test with Bearer token (should succeed):');
console.log(`curl -X POST http://localhost:${port}/services/caching/api/put/test2 \\`);
console.log('  -H "Content-Type: application/json" \\');
console.log(`  -H "Authorization: Bearer ${apiKey1}" \\`);
console.log('  -d \'{"message": "Hello World"}\'\n');

console.log('4. Test with query parameter (should succeed):');
console.log(`curl -X POST "http://localhost:${port}/services/caching/api/put/test3?api_key=${apiKey1}" \\`);
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d \'{"message": "Hello World"}\'\n');

console.log('5. Test status endpoint (no API key required):');
console.log(`curl http://localhost:${port}/services/caching/api/status\n`);

console.log('6. Test retrieve with API key:');
console.log(`curl -H "x-api-key: ${apiKey1}" http://localhost:${port}/services/caching/api/get/test\n`);

// Event listeners for API authentication
serviceRegistry.getEventEmitter().on('api-auth-setup', (data) => {
  console.log('🔐 API Key authentication enabled:', data);
});

serviceRegistry.getEventEmitter().on('api-auth-success', (data) => {
  console.log('✅ API authentication successful:', {
    ip: data.ip,
    path: data.path,
    method: data.method
  });
});

serviceRegistry.getEventEmitter().on('api-auth-failure', (data) => {
  console.log('❌ API authentication failed:', {
    reason: data.reason,
    ip: data.ip,
    path: data.path,
    method: data.method
  });
});

// Start server
app.listen(port, () => {
  console.log(`\n🚀 NooblyJS Core server with API key authentication running on port ${port}`);
  console.log(`📋 Services available at: http://localhost:${port}/services/`);
  console.log(`📚 API Documentation: http://localhost:${port}/services/caching/`);
  console.log('\n💡 Remember to include your API key when making requests to /services/*/api/* endpoints!');
});

// Export for potential testing
module.exports = { app, serviceRegistry };