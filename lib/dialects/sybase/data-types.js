'use strict';

const _ = require('lodash');
const moment = require('moment');
const inherits = require('../../utils/inherits');

module.exports = BaseTypes => {
  const warn = null; // BaseTypes.ABSTRACT.warn.bind(undefined, 'https://msdn.microsoft.com/en-us/library/ms187752%28v=sql.110%29.aspx');

  /**
   * types: [hex, ...]
   * @see hex here https://github.com/tediousjs/tedious/blob/master/src/data-type.js
   */

  BaseTypes.DATE.types.sybase = ['DATETIME'];
  BaseTypes.STRING.types.sybase = ['VARCHAR'];
  BaseTypes.CHAR.types.sybase = ['CHAR'];
  BaseTypes.TEXT.types.sybase = ['VARCHAR'];
  BaseTypes.SMALLINT.types.sybase = ['SMALLINT'];
  BaseTypes.MEDIUMINT.types.sybase = false;
  BaseTypes.INTEGER.types.sybase = ['INTEGER'];
  BaseTypes.BIGINT.types.sybase = ['BIGINT'];
  BaseTypes.FLOAT.types.sybase = ['NUMERIC'];
  BaseTypes.TIME.types.sybase = ['TIME'];
  BaseTypes.DATEONLY.types.sybase = ['DATE'];
  BaseTypes.BOOLEAN.types.sybase = ['TINYINT'];
  BaseTypes.BLOB.types.sybase = false;
  BaseTypes.DECIMAL.types.sybase = ['NUMERIC'];
  BaseTypes.UUID.types.sybase = ['VARCHAR'];
  BaseTypes.ENUM.types.sybase = false;
  BaseTypes.REAL.types.sybase = ['NUMERIC'];
  BaseTypes.DOUBLE.types.sybase = ['NUMERIC'];
  BaseTypes.GEOMETRY.types.sybase = false;

  function STRING(length, binary) {
    if (!(this instanceof STRING)) return new STRING(length, binary);
    BaseTypes.STRING.apply(this, arguments);
  }
  inherits(STRING, BaseTypes.STRING);

  function BOOLEAN() {
    if (!(this instanceof BOOLEAN)) return new BOOLEAN();
    BaseTypes.BOOLEAN.apply(this, arguments);
  }
  inherits(BOOLEAN, BaseTypes.BOOLEAN);

  BOOLEAN.prototype.toSql = function toSql() {
    return 'TINYINT';
  };
  BOOLEAN.prototype._stringify = function _stringify(value) {
    if (value) return 1;
    else return 0;
  };

  function UUID() {
    if (!(this instanceof UUID)) return new UUID();
    BaseTypes.UUID.apply(this, arguments);
  }
  inherits(UUID, BaseTypes.UUID);

  UUID.prototype.toSql = function toSql() {
    return 'VARCHAR(255)';
  };

  function TEXT() {
    if (!(this instanceof TEXT)) return new TEXT();
    BaseTypes.TEXT.apply(this, arguments);
  }
  inherits(TEXT, BaseTypes.TEXT);

  TEXT.prototype.toSql = function toSql() {
    return 'VARCHAR(8000)';
  };

  function NOW() {
    if (!(this instanceof NOW)) return new NOW();
    BaseTypes.NOW.apply(this, arguments);
  }
  inherits(NOW, BaseTypes.NOW);

  NOW.prototype.toSql = function toSql() {
    return 'GETDATE()';
  };

  function DATE(length) {
    if (!(this instanceof DATE)) return new DATE(length);
    BaseTypes.DATE.apply(this, arguments);
  }
  inherits(DATE, BaseTypes.DATE);

  DATE.prototype.toSql = function toSql() {
    return 'DATETIME';
  };

  DATE.prototype._stringify = function _stringify(date, options) {
    date = BaseTypes.DATE.prototype._applyTimezone(date, options);

    return date.format('YYYY-MM-DD HH:mm:ss');
  };

  function DATEONLY() {
    if (!(this instanceof DATEONLY)) return new DATEONLY();
    BaseTypes.DATEONLY.apply(this, arguments);
  }
  inherits(DATEONLY, BaseTypes.DATEONLY);

  DATEONLY.parse = function(value) {
    return moment(value).format('YYYY-MM-DD');
  };

  function INTEGER(length) {
    if (!(this instanceof INTEGER)) return new INTEGER(length);
    BaseTypes.INTEGER.apply(this, arguments);
    // SYBASE does not support any options for integer
    if (this._length || this.options.length || this._unsigned || this._zerofill) {
      warn('MSSQL does not support INTEGER with options. Plain `INTEGER` will be used instead.');
      this._length = undefined;
      this.options.length = undefined;
      this._unsigned = undefined;
      this._zerofill = undefined;
    }
  }
  inherits(INTEGER, BaseTypes.INTEGER);
  INTEGER.prototype.escape = false;

  function TINYINT(length) {
    if (!(this instanceof TINYINT)) return new TINYINT(length);
    BaseTypes.TINYINT.apply(this, arguments);

    // SYBASE does not support any options for tinyint
    if (this._length || this.options.length || this._unsigned || this._zerofill) {
      warn('MSSQL does not support TINYINT with options. Plain `TINYINT` will be used instead.');
      this._length = undefined;
      this.options.length = undefined;
      this._unsigned = undefined;
      this._zerofill = undefined;
    }
  }
  inherits(TINYINT, BaseTypes.TINYINT);
  TINYINT.prototype.escape = false;

  function SMALLINT(length) {
    if (!(this instanceof SMALLINT)) return new SMALLINT(length);
    BaseTypes.SMALLINT.apply(this, arguments);

    // SYBASE does not support any options for smallint
    if (this._length || this.options.length || this._unsigned || this._zerofill) {
      warn('MSSQL does not support SMALLINT with options. Plain `SMALLINT` will be used instead.');
      this._length = undefined;
      this.options.length = undefined;
      this._unsigned = undefined;
      this._zerofill = undefined;
    }
  }
  inherits(SMALLINT, BaseTypes.SMALLINT);
  SMALLINT.prototype.escape = false;

  function BIGINT(length) {
    if (!(this instanceof BIGINT)) return new BIGINT(length);
    BaseTypes.BIGINT.apply(this, arguments);

    // SYBASE does not support any options for bigint
    if (this._length || this.options.length || this._unsigned || this._zerofill) {
      warn('MSSQL does not support BIGINT with options. Plain `BIGINT` will be used instead.');
      this._length = undefined;
      this.options.length = undefined;
      this._unsigned = undefined;
      this._zerofill = undefined;
    }
  }
  inherits(BIGINT, BaseTypes.BIGINT);
  BIGINT.prototype.escape = false;

  function FLOAT(length, decimals) {
    if (!(this instanceof FLOAT)) return new FLOAT(length, decimals);
    BaseTypes.FLOAT.apply(this, arguments);

    // MSSQL does only support lengths as option.
    // Values between 1-24 result in 7 digits precision (4 bytes storage size)
    // Values between 25-53 result in 15 digits precision (8 bytes storage size)
    // If decimals are provided remove these and print a warning
    if (this._decimals) {
      warn('MSSQL does not support Float with decimals. Plain `FLOAT` will be used instead.');
      this._length = undefined;
      this.options.length = undefined;
    }
    if (this._unsigned) {
      warn('MSSQL does not support Float unsigned. `UNSIGNED` was removed.');
      this._unsigned = undefined;
    }
    if (this._zerofill) {
      warn('MSSQL does not support Float zerofill. `ZEROFILL` was removed.');
      this._zerofill = undefined;
    }
  }
  inherits(FLOAT, BaseTypes.FLOAT);
  FLOAT.prototype.escape = false;

  const exports = {
    STRING,
    DATE,
    DATEONLY,
    TEXT,
    NOW,
    TINYINT,
    SMALLINT,
    INTEGER,
    BIGINT,
    FLOAT,
    UUID,
    BOOLEAN
  };

  _.forIn(exports, (DataType, key) => {
    if (!DataType.key) DataType.key = key;
    if (!DataType.extend) {
      DataType.extend = function extend(oldType) {
        return new DataType(oldType.options);
      };
    }
  });

  return exports;
};
