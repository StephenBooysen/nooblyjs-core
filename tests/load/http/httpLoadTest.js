/**
 * @fileoverview HTTP Load Testing Framework for NooblyJS Core APIs
 * 
 * This module provides comprehensive HTTP-based load testing for all NooblyJS
 * service endpoints with API key authentication support. Tests simulate real-world
 * usage patterns and measure API performance under various load scenarios.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.2.1
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * HTTP Load Test Runner
 * 
 * Executes concurrent HTTP requests against NooblyJS service endpoints
 * with configurable concurrency, iterations, and authentication.
 * 
 * @param {Object} config - Load test configuration
 * @param {string} config.baseUrl - Base URL for API endpoints
 * @param {string} [config.apiKey] - API key for authentication
 * @param {number} [config.iterations=500] - Total number of requests per service
 * @param {number} [config.concurrency=10] - Number of concurrent requests
 * @returns {Promise<Array>} Array of test results for each service
 */
async function runHttpLoadTest(config) {
  const {
    baseUrl,
    apiKey,
    iterations = 500,
    concurrency = 10
  } = config;

  console.log(`🚀 Starting HTTP Load Tests`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   API Key: ${apiKey ? '✅ Provided' : '❌ Not provided (public endpoints only)'}`);
  console.log(`   Iterations: ${iterations} per service`);
  console.log(`   Concurrency: ${concurrency} concurrent requests`);

  const results = [];

  // Test services sequentially to avoid overwhelming the server
  const services = getServiceTestConfigurations(apiKey);
  
  for (const service of services) {
    console.log(`\n📊 Testing ${service.name} service...`);
    
    try {
      const serviceResult = await runServiceLoadTest(baseUrl, service, iterations, concurrency);
      results.push(serviceResult);
      
      // Brief pause between services
      await sleep(100);
    } catch (error) {
      console.error(`❌ ${service.name} service test failed:`, error.message);
      results.push({
        service: service.name,
        error: error.message,
        duration: 0,
        iterations: 0,
        successRate: 0
      });
    }
  }

  return results;
}

/**
 * Runs load test for a specific service
 */
async function runServiceLoadTest(baseUrl, serviceConfig, iterations, concurrency) {
  const requests = [];
  const results = {
    service: serviceConfig.name,
    type: 'http-api',
    iterations,
    successCount: 0,
    errorCount: 0,
    totalDuration: 0,
    minLatency: Infinity,
    maxLatency: 0,
    latencies: []
  };

  // Prepare test scenarios for this service
  const testScenarios = prepareTestScenarios(baseUrl, serviceConfig, iterations);
  
  const startTime = Date.now();

  // Execute requests with controlled concurrency
  const batches = [];
  for (let i = 0; i < testScenarios.length; i += concurrency) {
    batches.push(testScenarios.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    const batchPromises = batch.map(scenario => 
      executeHttpRequest(scenario)
        .then(result => {
          results.successCount++;
          results.latencies.push(result.duration);
          results.minLatency = Math.min(results.minLatency, result.duration);
          results.maxLatency = Math.max(results.maxLatency, result.duration);
          return result;
        })
        .catch(error => {
          results.errorCount++;
          console.error(`Request failed: ${error.message}`);
          return { error: error.message, duration: 0 };
        })
    );

    await Promise.all(batchPromises);
  }

  const endTime = Date.now();
  results.totalDuration = endTime - startTime;
  results.successRate = results.successCount / (results.successCount + results.errorCount);
  results.avgLatency = results.latencies.length > 0 
    ? results.latencies.reduce((sum, lat) => sum + lat, 0) / results.latencies.length 
    : 0;

  // Format for consistent reporting
  results.duration = results.totalDuration;
  results.iterations = results.successCount; // Only count successful iterations

  console.log(`   ✅ ${results.successCount} successful, ❌ ${results.errorCount} failed`);
  console.log(`   📈 Success rate: ${(results.successRate * 100).toFixed(1)}%`);
  console.log(`   ⚡ Avg latency: ${results.avgLatency.toFixed(2)}ms`);
  
  return results;
}

/**
 * Prepares test scenarios for a service
 */
function prepareTestScenarios(baseUrl, serviceConfig, totalIterations) {
  const scenarios = [];
  const iterationsPerEndpoint = Math.ceil(totalIterations / serviceConfig.endpoints.length);

  serviceConfig.endpoints.forEach(endpoint => {
    for (let i = 0; i < iterationsPerEndpoint; i++) {
      scenarios.push({
        url: `${baseUrl}${endpoint.path}`,
        method: endpoint.method,
        headers: endpoint.headers || {},
        body: endpoint.generateBody ? endpoint.generateBody(i) : endpoint.body,
        expectedStatus: endpoint.expectedStatus || 200
      });
    }
  });

  // Shuffle scenarios to distribute load across endpoints
  return shuffleArray(scenarios).slice(0, totalIterations);
}

/**
 * Executes a single HTTP request and measures performance
 */
function executeHttpRequest(scenario) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const url = new URL(scenario.url);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: scenario.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NooblyJS-LoadTest/1.2.1',
        ...scenario.headers
      }
    };

    if (scenario.body) {
      const bodyStr = typeof scenario.body === 'string' ? scenario.body : JSON.stringify(scenario.body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = httpModule.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (res.statusCode === scenario.expectedStatus) {
          resolve({
            statusCode: res.statusCode,
            duration,
            responseSize: data.length
          });
        } else {
          reject(new Error(`Unexpected status code: ${res.statusCode}, expected: ${scenario.expectedStatus}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    // Set timeout
    req.setTimeout(30000, () => {
      req.abort();
      reject(new Error('Request timeout'));
    });

    if (scenario.body) {
      const bodyStr = typeof scenario.body === 'string' ? scenario.body : JSON.stringify(scenario.body);
      req.write(bodyStr);
    }

    req.end();
  });
}

/**
 * Generates service test configurations
 */
function getServiceTestConfigurations(apiKey) {
  const authHeaders = apiKey ? { 'x-api-key': apiKey } : {};
  
  const services = [
    {
      name: 'caching',
      endpoints: [
        {
          path: '/services/caching/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/caching/api/put/loadtest-key',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              loadTestData: `cache-value-${i}`,
              timestamp: new Date().toISOString(),
              iteration: i
            }),
            expectedStatus: 200
          },
          {
            path: '/services/caching/api/get/loadtest-key',
            method: 'GET',
            headers: authHeaders,
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'dataserve',
      endpoints: [
        {
          path: '/services/dataserve/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/dataserve/api/put/loadtest-key',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              loadTestData: `dataserve-value-${i}`,
              timestamp: new Date().toISOString(),
              iteration: i
            }),
            expectedStatus: 200
          },
          {
            path: '/services/dataserve/api/get/loadtest-key',
            method: 'GET',
            headers: authHeaders,
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'logging',
      endpoints: [
        {
          path: '/services/logging/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/logging/api/info',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              message: `Load test log entry ${i}`,
              level: 'info',
              timestamp: new Date().toISOString(),
              metadata: {
                iteration: i,
                test: 'http-load-test'
              }
            }),
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'measuring',
      endpoints: [
        {
          path: '/services/measuring/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/measuring/api/add',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              metric: 'load-test-metric',
              value: Math.floor(Math.random() * 1000),
              timestamp: new Date().toISOString(),
              metadata: {
                iteration: i,
                test: 'http-load-test'
              }
            }),
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'notifying',
      endpoints: [
        {
          path: '/services/notifying/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/notifying/api/topic',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              topic: `load-test-topic-${i % 10}`, // Reuse topics
              description: `Load test topic ${i}`
            }),
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'queueing',
      endpoints: [
        {
          path: '/services/queueing/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/queueing/api/push',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              message: `Load test queue message ${i}`,
              type: 'load-test',
              payload: {
                iteration: i,
                timestamp: new Date().toISOString()
              },
              priority: Math.floor(Math.random() * 5) + 1
            }),
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'scheduling',
      endpoints: [
        {
          path: '/services/scheduling/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/scheduling/api/schedule',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              task: {
                name: `load-test-task-${i}`,
                description: `Load test scheduled task ${i}`,
                data: {
                  iteration: i,
                  timestamp: new Date().toISOString()
                }
              },
              cron: '0 0 * * *', // Daily at midnight
              enabled: false, // Don't actually run these tasks
              metadata: {
                test: 'http-load-test',
                temporary: true
              }
            }),
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'filing',
      endpoints: [
        {
          path: '/services/filing/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/filing/api/upload',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              filename: `load-test-file-${i}.txt`,
              content: `This is load test file content ${i} generated at ${new Date().toISOString()}`,
              contentType: 'text/plain',
              metadata: {
                iteration: i,
                test: 'http-load-test'
              }
            }),
            expectedStatus: 200
          },
          {
            path: `/services/filing/api/list`,
            method: 'GET',
            headers: authHeaders,
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'searching',
      endpoints: [
        {
          path: '/services/searching/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/searching/api/add',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              id: `load-test-doc-${i}`,
              title: `Load Test Document ${i}`,
              content: `This is load test document content for iteration ${i}. It contains searchable text for testing purposes.`,
              tags: ['load-test', 'automation', `iteration-${i % 10}`],
              metadata: {
                iteration: i,
                timestamp: new Date().toISOString(),
                test: 'http-load-test'
              }
            }),
            expectedStatus: 200
          },
          {
            path: '/services/searching/api/search',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              query: `load test ${i % 10}`, // Vary search terms
              limit: 10,
              offset: 0
            }),
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'workflow',
      endpoints: [
        {
          path: '/services/workflow/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/workflow/api/create',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              name: `load-test-workflow-${i}`,
              description: `Load test workflow ${i}`,
              steps: [
                {
                  name: 'start',
                  type: 'start',
                  next: 'process'
                },
                {
                  name: 'process',
                  type: 'task',
                  task: 'process-data',
                  next: 'end'
                },
                {
                  name: 'end',
                  type: 'end'
                }
              ],
              metadata: {
                iteration: i,
                test: 'http-load-test',
                temporary: true
              }
            }),
            expectedStatus: 200
          },
          {
            path: '/services/workflow/api/list',
            method: 'GET',
            headers: authHeaders,
            expectedStatus: 200
          }
        ] : [])
      ]
    },
    {
      name: 'working',
      endpoints: [
        {
          path: '/services/working/api/status',
          method: 'GET',
          expectedStatus: 200
        },
        ...(apiKey ? [
          {
            path: '/services/working/api/add',
            method: 'POST',
            headers: authHeaders,
            generateBody: (i) => ({
              type: 'load-test-job',
              data: {
                iteration: i,
                message: `Load test job ${i}`,
                timestamp: new Date().toISOString(),
                processTime: Math.floor(Math.random() * 1000) + 100 // Random process time
              },
              priority: Math.floor(Math.random() * 5) + 1,
              metadata: {
                test: 'http-load-test',
                temporary: true
              }
            }),
            expectedStatus: 200
          },
          {
            path: '/services/working/api/status',
            method: 'GET',
            headers: authHeaders,
            expectedStatus: 200
          }
        ] : [])
      ]
    }
  ];

  // Filter out services with no endpoints
  return services.filter(service => service.endpoints.length > 0);
}

/**
 * Utility functions
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = runHttpLoadTest;