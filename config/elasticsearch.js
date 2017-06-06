const _             = require('lodash');
const Promise       = require('bluebird');
const elasticsearch = require('elasticsearch');
const sr            = require('sync-request');
const bunyan        = require('bunyan');
const PrettyStream  = require('bunyan-prettystream');
const semver        = require('semver');
const config        = require('../config');

const prettyStdOut = new PrettyStream({mode: 'dev'});
prettyStdOut.pipe(process.stdout);

const LogToBunyan = function () {
  const self = this;
  const bun  = bunyan.createLogger({
    name:   `${config.FRAMEWORK_NAME}-es`,
    type:   'raw',
    level:  config.elasticsearch.logLevel,
    stream: prettyStdOut
  });

  self.error = bun.error.bind(bun);
  self.warning = bun.warn.bind(bun);
  self.info = bun.info.bind(bun);
  self.debug = bun.debug.bind(bun);
  self.trace = (method, requestUrl, body, responseBody, responseStatus) => {
    bun.trace({
      method:         method,
      requestUrl:     requestUrl,
      body:           body,
      responseBody:   responseBody,
      responseStatus: responseStatus
    });
  };
  self.close = () => {
  };
};

const DEFAULT_ELASTICSEARCH_PORT = 9200;
const SUPPORTED_API_VERSION      = _.keys(elasticsearch.Client.apis);

const createEsClient = (hostConfig) => {
  const host = hostConfig.host || 'localhost';
  const port = hostConfig.port || DEFAULT_ELASTICSEARCH_PORT;

  let path = hostConfig.path || '/';
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  let uri = `${host}:${port}${path}`;
  if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
    uri = `http://${uri}`;
  }

  /**
   *  NOTE: The below section should be removed and replaced with an async implementation.
   *        This is blocking the main thread while it waits for the result of the API check, meaning nothing else
   *        can run.
   */

  let apiVersion = null;
  try {
    const results      = sr('GET', uri, {
      maxRetries: 5,
      retry:      true,
      timeout:    100
    });
    const version      = JSON.parse(results.getBody('utf8')).version.number;
    const majorVersion = semver.major(version);
    let minorVersion   = semver.minor(version);
    while (true) { // eslint-disable-line no-constant-condition
      apiVersion = `${majorVersion}.${minorVersion}`;
      if (SUPPORTED_API_VERSION.includes(apiVersion)) {
        config.log.info(`${apiVersion} supported`);
        break;
      } else {
        config.log.info(`${apiVersion} is not supported version for this ES client, incrementing minor version`);
        minorVersion++;
      }
    }
  } catch (e) {
    config.log.debug(e);
  }

  if (!apiVersion) {
    throw new Error(`unable to connect to '${uri}' to get es version`);
  }

  return new elasticsearch.Client({
    host:               {host, port},
    apiVersion:         apiVersion,
    suggestCompression: true,
    log:                LogToBunyan,
    defer:              function () {
      let resolve = null;
      let reject  = null;

      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return {
        resolve: resolve,
        reject:  reject,
        promise: promise
      };
    },
    maxRetries:     3,
    requestTimeout: 60000,
    deadTimeout:    120000,
    pingTimeout:    60000
  });
};

module.exports = createEsClient;