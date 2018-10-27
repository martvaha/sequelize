'use strict';

const AbstractConnectionManager = require('../abstract/connection-manager');
const ResourceLock = require('./resource-lock');
const Promise = require('../../promise');
const logger = require('../../utils/logger');
const DataTypes = require('../../data-types').sybase;
const debug = logger.getLogger().debugContext('connection:sybase');
const sequelizeErrors = require('../../errors');
const parserStore = require('../parserStore')('sybase');

class ConnectionManager extends AbstractConnectionManager {
  constructor(dialect, sequelize) {
    super(dialect, sequelize);

    this.sequelize.config.port = this.sequelize.config.port || 2638;
    this.lib = this._loadDialectModule('sqlanywhere');
    this.refreshTypeParser(DataTypes);
    this.sequelize.options.databaseVersion = 12;

    // try {
    //   if (sequelize.config.dialectModulePath) {
    //     this.lib = require(sequelize.config.dialectModulePath);
    //   } else {
    //     this.lib = require('sqlanywhere');
    //   }
    // } catch (err) {
    //   if (err.code === 'MODULE_NOT_FOUND') {
    //     throw new Error('Please install sqlanywhere package manually');
    //   }
    //   throw err;
    // }
  }

  // Expose this as a method so that the parsing may be updated when the user has added additional, custom types
  _refreshTypeParser(dataType) {
    parserStore.refresh(dataType);
  }

  _clearTypeParser() {
    parserStore.clear();
  }

  connect(config) {
    const connectionConfig = {
      UserId: config.username,
      Password: config.password,
      Host: config.host
    };

    if (config.dialectOptions) {
      // only set port if no instance name was provided
      if (config.dialectOptions.instanceName) {
        delete connectionConfig.options.port;
      }

      // The 'tedious' driver needs domain property to be in the main Connection config object
      if (config.dialectOptions.domain) {
        connectionConfig.domain = config.dialectOptions.domain;
      }

      for (const key of Object.keys(config.dialectOptions)) {
        connectionConfig.options[key] = config.dialectOptions[key];
      }
    }

    return new Promise((resolve, reject) => {
      const connection = this.lib.createConnection();
      const self = this;

      connection.connect(
        connectionConfig,
        err => {
          if (err) return reject(new sequelizeErrors.ConnectionError(err));

          connection.lib = self.lib;
          const resourceLock = new ResourceLock(connection);

          return resolve(resourceLock);
        }
      );
    });
  }

  disconnect(connectionLock) {
    /**
     * Abstract connection may try to disconnect raw connection used for fetching version
     */
    const connection = connectionLock.unwrap ? connectionLock.unwrap() : connectionLock;

    // Don't disconnect a connection that is already disconnected
    if (connection.closed) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      //connection.on('end', resolve);
      connection.disconnect();
      debug('connection closed');
    });
  }

  validate(connectionLock) {
    /**
     * Abstract connection may try to validate raw connection used for fetching version
     */
    const connection = connectionLock.unwrap ? connectionLock.unwrap() : connectionLock;

    return connection && connection.loggedIn;
  }
}

module.exports = ConnectionManager;
module.exports.ConnectionManager = ConnectionManager;
module.exports.default = ConnectionManager;
