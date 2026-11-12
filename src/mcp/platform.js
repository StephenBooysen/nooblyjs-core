/**
 * @fileoverview Platform-level MCP content (feature 03): the app's service
 * inventory, its OpenAPI document, the system snapshot, and two prompts that
 * guide an agent through diagnosis.
 *
 * @module mcp/platform
 */

'use strict';

const { buildOpenApiDocument, listApiRoutes, loadServiceDocs } = require('../shared/utils/openapi');

/**
 * Builds the platform tools, resources and prompts.
 *
 * @param {Object} input
 * @param {Object=} input.registry Service registry (for its version)
 * @param {Object=} input.app Express app (for the OpenAPI resource)
 * @param {!Map<string, Object>} input.services Registry instances
 * @return {{tools: !Array<Object>, resources: !Array<Object>, prompts: !Array<Object>}}
 */
function build({ app, services }) {
  const inventory = () => Array.from(services.keys()).sort().map((key) => {
    const [service, provider, instance] = key.split(':');
    return { service, provider, instance };
  });

  const tools = [
    {
      name: 'platform_snapshot',
      description: 'System health snapshot: CPU, memory, event loop and process figures.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => require('../views/modules/monitoring').getCurrentSnapshot()
    },
    {
      name: 'platform_services',
      description: 'The services and provider instances this app is running.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ instances: inventory() })
    }
  ];

  const resources = [
    {
      uri: 'nooblyjs://services',
      name: 'Running services',
      description: 'Every service and provider instance in this app.',
      mimeType: 'application/json',
      read: async () => ({ instances: inventory() })
    },
    {
      uri: 'nooblyjs://openapi',
      name: 'OpenAPI document',
      description: 'The OpenAPI 3.1 document for every mounted API route.',
      mimeType: 'application/json',
      read: async () => {
        if (!app) return { error: 'No Express app is attached' };
        return buildOpenApiDocument({ routes: listApiRoutes(app), docs: loadServiceDocs() }).document;
      }
    }
  ];

  const prompts = [
    {
      name: 'diagnose-failed-run',
      description: 'Find out why a workflow run failed, using the workflow tools.',
      arguments: [{ name: 'workflowName', description: 'Workflow name', required: true }],
      text: (args) => [
        `Diagnose the most recent failed run of the workflow "${args.workflowName}".`,
        '1. Call workflow_runs with that workflowName and look for the latest run with status "error" or "failed".',
        '2. Call workflow_run_get with its executionId and read the failing step and its error.',
        '3. If the error mentions a queue, call queue_size or queue_list. If it mentions data, call data_find on the container it names.',
        '4. Report the cause in two sentences, then the smallest fix. Do not run a workflow or change any state.'
      ].join('\n')
    },
    {
      name: 'explain-service-config',
      description: 'Explain how one service is configured in this app.',
      arguments: [{ name: 'service', description: 'Service name, for example caching or queueing', required: true }],
      text: (args) => [
        `Explain how the ${args.service} service is set up in this app.`,
        '1. Call platform_services to see its provider and instances.',
        '2. Read nooblyjs://openapi for its routes, and use the service tools for live state.',
        '3. Do not read or print settings values, which are secret. Name the settings keys only.'
      ].join('\n')
    }
  ];

  return { tools, resources, prompts };
}

module.exports = { build };
