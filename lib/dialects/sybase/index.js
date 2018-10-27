'use strict';

const _ = require('lodash');
const AbstractDialect = require('../abstract');
const ConnectionManager = require('./connection-manager');
const Query = require('./query');
const QueryGenerator = require('./query-generator');
const DataTypes = require('../../data-types').sybase;

class SybaseDialect extends AbstractDialect {
  constructor(sequelize) {
    super();
    this.sequelize = sequelize;
    this.connectionManager = new ConnectionManager(this, sequelize);
    this.QueryGenerator = new QueryGenerator({ _dialect: this, sequelize });
  }
}

SybaseDialect.prototype.supports = _.merge(_.cloneDeep(AbstractDialect.prototype.supports), {
  DEFAULT: true,
  'DEFAULT VALUES': true,
  'LIMIT ON UPDATE': true,
  'ORDER NULLS': false,
  lock: false,
  transactions: false, // proovime pärast lisada
  migrations: false,
  upserts: false,
  schemas: false, //?
  offset: true,
  autoIncrement: {
    identityInsert: true,
    defaultValue: false,
    update: false,
    returning: true
  },
  constraints: {
    restrict: false,
    default: true
  },
  index: {
    collate: false,
    length: false,
    parser: false,
    type: true,
    using: false,
    where: true
  },
  NUMERIC: true,
  subQueryLimit: false,
  tmpTableTrigger: true
});

ConnectionManager.prototype.defaultVersion = '12.0.2000'; // SQL Server 2014 Express
SybaseDialect.prototype.Query = Query;
SybaseDialect.prototype.name = 'sybase';
SybaseDialect.prototype.TICK_CHAR = '"';
SybaseDialect.prototype.TICK_CHAR_LEFT = '[';
SybaseDialect.prototype.TICK_CHAR_RIGHT = ']';
SybaseDialect.prototype.DataTypes = DataTypes;

module.exports = SybaseDialect;
