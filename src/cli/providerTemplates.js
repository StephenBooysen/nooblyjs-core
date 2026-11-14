/**
 * @fileoverview Templates for `nooblyjs add provider` (feature 09). For each
 * service with a provider contract suite: where provider files live, the
 * methods the contract calls, how its contract runner is called, and how the
 * factory's result exposes the provider. Used only in a nooblyjs-core checkout.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

/**
 * @typedef {Object} ProviderTemplate
 * @property {string} prefix File and class prefix (`cachingValkey.js`, `CachingValkey`)
 * @property {string} contract Contract file under tests/contract/
 * @property {string} runner Exported contract function
 * @property {string} construct The factory's construction line, `{cls}` for the class
 * @property {string[]} methods `name(args)` signatures the contract calls
 * @property {string} [base] A provider class to extend instead of writing stubs
 * @property {boolean} [extraFactoryArg] The factory takes a fourth `dependencies` argument
 */

/** @type {Object<string, ProviderTemplate>} */
const PROVIDER_TEMPLATES = Object.freeze({
  caching: {
    prefix: 'caching',
    contract: 'cache.contract.js',
    runner: 'runCacheContract',
    construct: 'cache = new {cls}(providerOptions, eventEmitter);',
    methods: ['put(key, value, ttlSeconds)', 'get(key)', 'delete(key)']
  },
  queueing: {
    prefix: 'queueing',
    contract: 'queue.contract.js',
    runner: 'runQueueContract',
    construct: 'queue = new {cls}(providerOptions, eventEmitter);',
    methods: ['enqueue(queueName, item)', 'dequeue(queueName)', 'size(queueName)', 'purge(queueName)', 'listQueues()']
  },
  filing: {
    prefix: 'filing',
    contract: 'filing.contract.js',
    runner: 'runFilingContract',
    construct: 'provider = new {cls}(options, eventEmitter);',
    methods: ['create(filePath, content)', 'read(filePath, encoding)', 'update(filePath, content)', 'delete(filePath)', 'list(dirPath)']
  },
  dataservice: {
    prefix: 'dataservice',
    contract: 'dataservice.contract.js',
    runner: 'runDataserviceContract',
    construct: 'provider = new {cls}(providerOptions, eventEmitter);',
    methods: [
      'createContainer(containerName)', 'add(containerName, jsonObject)', 'getByUuid(containerName, objectKey)',
      'update(containerName, objectKey, jsonObject)', 'remove(containerName, objectKey)', 'find(containerName, searchTerm)',
      'listAll(containerName)', 'count(containerName)'
    ]
  },
  searching: {
    prefix: 'searching',
    contract: 'searching.contract.js',
    runner: 'runSearchingContract',
    construct: 'searching = new {cls}(providerOptions, eventEmitter, dependencies);',
    methods: [
      'add(key, jsonObject, containerName)', 'addAll(documents, containerName)', 'replace(document, containerName)',
      'remove(key, containerName)', 'removeAll(idsOrDocuments, containerName)', 'search(query, options)'
    ],
    extraFactoryArg: true
  },
  authservice: {
    prefix: 'auth',
    contract: 'authservice.contract.js',
    runner: 'runAuthContract',
    construct: 'auth = new {cls}(options, eventEmitter);',
    methods: [],
    base: 'authBase'
  }
});

const pascal = (name) => name.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

/**
 * Builds the provider class and its contract runner.
 *
 * @param {{service: string, name: string}} input Service and provider name (lowercase, dashes)
 * @return {{files: Object<string, string>, className: string, providerFile: string, caseLines: string}}
 * @throws {Error} When the service has no contract suite
 */
function providerFiles({ service, name }) {
  const t = PROVIDER_TEMPLATES[service];
  if (!t) throw new Error(`no provider contract for "${service}"; supported: ${Object.keys(PROVIDER_TEMPLATES).join(', ')}`);
  const className = `${pascal(t.prefix)}${pascal(name)}`;
  const fileBase = `${t.prefix}${pascal(name)}`;
  const providerFile = `src/${service}/providers/${fileBase}.js`;
  const factoryVar = `create${pascal(service)}`;

  const stubs = t.methods.map((signature) => {
    const method = signature.slice(0, signature.indexOf('('));
    return `  /**
   * TODO: implement against the backend. The contract in tests/contract/${t.contract} says what it must do.
   */
  async ${signature} {
    throw new Error('${className}.${method} is not implemented yet');
  }
`;
  }).join('\n');

  const providerClass = t.base
    ? `'use strict';

const ${pascal(t.base)} = require('./${t.base}');

/**
 * ${className}: ${service} provider "${name}". ${pascal(t.base)} keeps users, sessions, roles
 * and tokens in memory; override the methods whose state belongs in your backend,
 * call super, then save (see authFile.js for a provider that persists to files).
 */
class ${className} extends ${pascal(t.base)} {
  /**
   * @param {Object} [options] Provider options
   * @param {import('events').EventEmitter} [eventEmitter] Shared emitter
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);
  }
}

module.exports = ${className};
`
    : `'use strict';

/**
 * ${className}: ${service} provider "${name}". Each method below is called by the
 * ${service} contract (tests/contract/${t.contract}); run
 *   npx jest tests/contract/${service}.${name}.test.js
 * and implement until it passes. Log through this.logger with optional chaining.
 */
class ${className} {
  /**
   * @param {Object} [options] Provider options
   * @param {import('events').EventEmitter} [eventEmitter] Shared emitter
   */
  constructor(options = {}, eventEmitter) {
    this.options = options;
    this.eventEmitter_ = eventEmitter;
    this.logger = options.dependencies?.logging;
    this.settings = { description: 'Settings for the ${name} ${service} provider', list: [] };
  }

${stubs}
  /** @return {Promise<Object>} Provider settings */
  async getSettings() {
    return this.settings;
  }

  /** @param {Object} settings New values for the settings in this.settings.list */
  async saveSettings(settings) {
    for (const { setting } of this.settings.list) {
      if (settings[setting] != null) this.settings[setting] = settings[setting];
    }
  }
}

module.exports = ${className};
`;

  const factoryArgs = t.extraFactoryArg ? '{ dependencies: {} }, new EventEmitter(), {}' : '{ dependencies: {} }, new EventEmitter()';
  const runner = `'use strict';

/**
 * Runs the ${service} contract against the "${name}" provider. Add options the
 * provider needs (a URL, a temp folder under .temp/tests/data/ via testDataDir)
 * to make(); if it needs a live backend, skip unless an environment variable is
 * set, as tests/contract/cache.redis.test.js does.
 */
const { EventEmitter } = require('events');
const { ${t.runner} } = require('./${t.contract.replace(/\.js$/, '')}');
const ${factoryVar} = require('../../src/${service}');
const ${className} = require('../../${providerFile.replace(/\.js$/, '')}');

// Fails every test until the factory builds this class: an unknown provider
// name falls back to another provider, and the contract would test that instead.
const make = () => {
  const service = ${factoryVar}('${name}', ${factoryArgs});
  if (!((service.provider || service) instanceof ${className})) {
    throw new Error("src/${service}/index.js does not create ${className} for '${name}' yet: add its case to the factory's switch");
  }
  return service;
};

${t.runner}('${name}', make);
`;

  const caseLines = `    case '${name}': {
      const ${className} = require('./providers/${fileBase}');
      ${t.construct.replace('{cls}', className)}
      break;
    }`;

  return {
    files: { [providerFile]: providerClass, [`tests/contract/${service}.${name}.test.js`]: runner },
    className,
    providerFile,
    caseLines
  };
}

module.exports = { PROVIDER_TEMPLATES, providerFiles };
