'use strict';
/** Queueing provider options (feature 08). See src/shared/utils/serviceOptions.js. */
const { str, num, obj, apiProvider } = require('../shared/config/schemaTypes');

module.exports = {
  common: { properties: { jobs: obj('Reliable job defaults (feature 06): attempts, backoff, visibilityTimeoutMs, pollMs, dedupeWindowMs, store') } },
  providers: {
    memory: { properties: {} },
    redis: {
      open: true,
      properties: {
        redisurl: str('Redis host'), redisdurl: str('Redis host (old misspelling)'), redisport: num('Redis port'),
        host: str('Redis host (ioredis option)'), port: num('Redis port (ioredis option)'), poolSize: num('Pool size')
      },
      aliases: { redisUrl: 'redisurl', redisPort: 'redisport' }
    },
    rabbitmq: { open: true, properties: { rabbitmqUrl: str('AMQP URL') } },
    activemq: {
      open: true,
      properties: {
        host: str('Broker host'), port: num('STOMP port'), login: str('User'), passcode: str('Password'), stompHost: str('STOMP vhost'),
        brokerName: str('Broker name'), destinationPrefix: str('Destination prefix'), dequeueTimeout: num('Dequeue wait in ms'),
        timeout: num('Timeout in ms'), jolokiaUrl: str('Jolokia URL'), jolokiaUser: str('Jolokia user'),
        jolokiaPassword: str('Jolokia password'), jolokiaOrigin: str('Jolokia origin'), jolokiaTimeout: num('Jolokia timeout in ms')
      }
    },
    aws: {
      open: true,
      properties: {
        region: str('AWS region'), accountId: str('Account id'), accessKeyId: str('Access key id'), secretAccessKey: str('Secret'),
        queueNamePrefix: str('Queue name prefix'), visibilityTimeout: num('Visibility timeout in s'),
        messageRetentionPeriod: num('Retention in s'), receiveMessageWaitTimeSeconds: num('Long-poll wait in s')
      }
    },
    azure: {
      open: true,
      properties: {
        connectionString: str('Storage connection string'), accountName: str('Account name'), accountKey: str('Account key'),
        queueNamePrefix: str('Queue name prefix'), visibilityTimeout: num('Visibility timeout in s'), messageTimeToLive: num('TTL in s')
      }
    },
    gcp: {
      open: true,
      properties: {
        projectId: str('Project id'), region: str('Region'), queue: str('Cloud Tasks queue'), keyFilePath: str('Key file'),
        httpTarget: str('HTTP target'), maxRetries: num('Max retries'), maxBackoffSeconds: num('Max backoff in s')
      }
    },
    api: apiProvider
  }
};
