'use strict';

const _ = require('lodash');
const Utils = require('../../utils');
const DataTypes = require('../../data-types');
const TableHints = require('../../table-hints');
const AbstractQueryGenerator = require('../abstract/query-generator');
const randomBytes = require('crypto').randomBytes;
const semver = require('semver');

const Op = require('../../operators');

/* istanbul ignore next */
const throwMethodUndefined = function(methodName) {
  throw new Error('The method "' + methodName + '" is not defined! Please add it to your sql dialect.');
};

class SybaseQueryGenerator extends AbstractQueryGenerator {
  wrapIdentityInsert(query, table) {
    return [
      "SET TEMPORARY OPTION IDENTITY_INSERT = '';;",
      'SET TEMPORARY OPTION IDENTITY_INSERT = ',
      table,
      ';',
      query,
      "SET TEMPORARY OPTION IDENTITY_INSERT = '';;"
    ].join(' ');
  }
  createSchema(schema) {
    //table lists
    return this.showTablesQuery();
  }

  dropSchema(schema) {
    return this.showTablesQuery();
  }

  showSchemasQuery() {
    return this.showTablesQuery();
  }

  versionQuery() {
    // Uses string manipulation to convert the MS Maj.Min.Patch.Build to semver Maj.Min.Patch
    return ["SELECT '12.0.2000' AS 'version'"].join(' ');
  }

  createTableQuery(tableName, attributes, options) {
    //const query = "IF OBJECT_ID('<%= table %>', 'U') IS NULL CREATE TABLE <%= table %> (<%= attributes %>)",
    const query =
        "if not exists(select '' from systable where table_name = '<%= table_raw %>' and creator = user_id()) then CREATE TABLE <%= table %> (<%= attributes %>) end if",
      primaryKeys = [],
      foreignKeys = {},
      attrStr = [];

    for (const attr in attributes) {
      if (attributes.hasOwnProperty(attr)) {
        const dataType = attributes[attr];
        let match;

        if (_.includes(dataType, 'PRIMARY KEY')) {
          primaryKeys.push(attr);

          if (_.includes(dataType, 'REFERENCES')) {
            // MSSQL doesn't support inline REFERENCES declarations: move to the end
            match = dataType.match(/^(.+) (REFERENCES.*)$/);
            attrStr.push(this.quoteIdentifier(attr) + ' ' + match[1].replace(/PRIMARY KEY/, ''));
            foreignKeys[attr] = match[2];
          } else {
            attrStr.push(this.quoteIdentifier(attr) + ' ' + dataType.replace(/PRIMARY KEY/, ''));
          }
        } else if (_.includes(dataType, 'REFERENCES')) {
          // MSSQL doesn't support inline REFERENCES declarations: move to the end
          match = dataType.match(/^(.+) (REFERENCES.*)$/);
          attrStr.push(this.quoteIdentifier(attr) + ' ' + match[1]);
          foreignKeys[attr] = match[2];
        } else {
          attrStr.push(this.quoteIdentifier(attr) + ' ' + dataType);
        }
      }
    }

    const values = {
        table: this.quoteTable(tableName),
        table_raw: this.rawTable(tableName),

        attributes: attrStr.join(', ')
      },
      pkString = primaryKeys
        .map(pk => {
          return this.quoteIdentifier(pk);
        })
        .join(', ');

    if (options.uniqueKeys) {
      _.each(options.uniqueKeys, (columns, indexName) => {
        if (columns.customIndex && !_.isEqual(columns.fields, primaryKeys)) {
          if (!_.isString(indexName)) {
            indexName = 'uniq_' + tableName + '_' + columns.fields.join('_');
          }
          //sybase does not allow to create unique and primary keys on the same columns
          values.attributes += `,  UNIQUE (${columns.fields.map(field => this.quoteIdentifier(field)).join(', ')})`;
        }
      });
    }

    if (pkString.length > 0) {
      values.attributes += `, PRIMARY KEY (${pkString})`;
    }

    for (const fkey in foreignKeys) {
      if (foreignKeys.hasOwnProperty(fkey)) {
        values.attributes += ', FOREIGN KEY (' + this.quoteIdentifier(fkey) + ') ' + foreignKeys[fkey];
      }
    }

    return _.template(query, this._templateSettings)(values).trim() + ';';
  }

  describeTableQuery(tableName, schema) {
    let sql = [
      'select ',
      'b.column_name as "Name",d.domain_name as "Type",b.width as "Length",b.nulls "isNull",b."default" as "Default",',
      'case when b."default"=\'autoincrement\' then \'PRIMARY KEY\' else NULL end as "Constraint",',
      'case when b."default"=\'autoincrement\' then 1 else 0 end as IsIdentity',
      'from SYS.SYSTAB a ',
      '  inner join SYS.SYSCOLUMN b on (a.table_id          = b.table_id)',
      '  inner join SYS.SYSDOMAIN d on (b.domain_id         = d.domain_id)',
      'where  a.creator = user_id()',
      'and a.table_name = ' + wrapSingleQuote(tableName)
    ].join(' ');
    /*
        if (schema) {
          sql += 'AND t.TABLE_SCHEMA =' + wrapSingleQuote(schema);
        }
    */
    return sql;
  }

  renameTableQuery(before, after) {
    const query = 'EXEC sp_rename <%= before %>, <%= after %>;';
    return _.template(query, this._templateSettings)({
      before: this.quoteTable(before),
      after: this.quoteTable(after)
    });
  }

  showTablesQuery() {
    return 'select table_name as "TABLE_NAME" from sys.systable st inner join sys.sysuser u on ( st.creator = u.user_id) where creator = user_id();';
  }

  rawTable(tableName) {
    if (tableName.tableName) return tableName.tableName;
    return tableName;
  }
  dropTableQuery(tableName) {
    //    const query = "IF OBJECT_ID('<%= table %>', 'U') IS NOT NULL DROP TABLE <%= table %>";
    const query =
      "if exists(select * from systable where table_name = '<%= table_raw %>' and creator = user_id()) then SET TEMPORARY OPTION IDENTITY_INSERT = ''; drop table <%= table %> ; end if";
    const values = {
      table: this.quoteTable(tableName),
      table_raw: this.rawTable(tableName)
    };

    return _.template(query, this._templateSettings)(values).trim() + ';';
  }

  addColumnQuery(table, key, dataType) {
    // FIXME: attributeToSQL SHOULD be using attributes in addColumnQuery
    //        but instead we need to pass the key along as the field here
    dataType.field = key;

    const query = 'ALTER TABLE <%= table %> ADD <%= attribute %>;',
      attribute = _.template('<%= key %> <%= definition %>', this._templateSettings)({
        key: this.quoteIdentifier(key),
        definition: this.attributeToSQL(dataType, {
          context: 'addColumn'
        })
      });

    return _.template(query, this._templateSettings)({
      table: this.quoteTable(table),
      attribute
    });
  }

  removeColumnQuery(tableName, attributeName) {
    const query = 'ALTER TABLE <%= tableName %> DROP COLUMN <%= attributeName %>;';
    return _.template(query, this._templateSettings)({
      tableName: this.quoteTable(tableName),
      attributeName: this.quoteIdentifier(attributeName)
    });
  }

  changeColumnQuery(tableName, attributes) {
    const query = 'ALTER TABLE <%= tableName %> <%= query %>;';
    const attrString = [],
      constraintString = [];

    for (const attributeName in attributes) {
      const definition = attributes[attributeName];
      if (definition.match(/REFERENCES/)) {
        constraintString.push(
          _.template('<%= fkName %> FOREIGN KEY (<%= attrName %>) <%= definition %>', this._templateSettings)({
            fkName: this.quoteIdentifier(attributeName + '_foreign_idx'),
            attrName: this.quoteIdentifier(attributeName),
            definition: definition.replace(/.+?(?=REFERENCES)/, '')
          })
        );
      } else {
        attrString.push(
          _.template('<%= attrName %> <%= definition %>', this._templateSettings)({
            attrName: this.quoteIdentifier(attributeName),
            definition
          })
        );
      }
    }

    let finalQuery = '';
    if (attrString.length) {
      finalQuery += 'ALTER COLUMN ' + attrString.join(', ');
      finalQuery += constraintString.length ? ' ' : '';
    }
    if (constraintString.length) {
      finalQuery += 'ADD CONSTRAINT ' + constraintString.join(', ');
    }

    return _.template(query, this._templateSettings)({
      tableName: this.quoteTable(tableName),
      query: finalQuery
    });
  }

  renameColumnQuery(tableName, attrBefore, attributes) {
    const query = "EXEC sp_rename '<%= tableName %>.<%= before %>', '<%= after %>', 'COLUMN';",
      newName = Object.keys(attributes)[0];

    return _.template(query, this._templateSettings)({
      tableName: this.quoteTable(tableName),
      before: attrBefore,
      after: newName
    });
  }

  bulkInsertQuery(tableName, attrValueHashes, options, attributes) {
    console.log(tableName);
    console.log(attrValueHashes);
    console.log(options);
    console.log(attributes);
    options = options || {};
    attributes = attributes || {};
    const query = 'INSERT INTO <%= table %> (<%= attributes %>) VALUES <%= tuples %>;',
      emptyQuery = 'INSERT INTO <%= table %> DEFAULT VALUES',
      tuples = [],
      allAttributes = [],
      allQueries = [];

    let needIdentityInsertWrapper = false,
      outputFragment;

    if (options.returning) {
      outputFragment = ' OUTPUT INSERTED.*';
    }

    _.forEach(attrValueHashes, attrValueHash => {
      // special case for empty objects with primary keys
      const fields = Object.keys(attrValueHash);
      const firstAttr = attributes[fields[0]];
      if (fields.length === 1 && firstAttr && firstAttr.autoIncrement && attrValueHash[fields[0]] === null) {
        allQueries.push(emptyQuery);
        return;
      }

      // normal case
      _.forOwn(attrValueHash, (value, key) => {
        if (value !== null && attributes[key] && attributes[key].autoIncrement) {
          needIdentityInsertWrapper = true;
        }

        if (allAttributes.indexOf(key) === -1) {
          if (value === null && attributes[key] && attributes[key].autoIncrement) return;

          allAttributes.push(key);
        }
      });
    });

    if (allAttributes.length > 0) {
      _.forEach(attrValueHashes, attrValueHash => {
        tuples.push('(' + allAttributes.map(key => this.escape(attrValueHash[key], attributes[key])).join(',') + ')');
      });

      allQueries.push(query);
    }
    const commands = [];
    let offset = 0;
    const batch = Math.floor(250 / (allAttributes.length + 1)) + 1;
    while (offset < Math.max(tuples.length, 1)) {
      const replacements = {
        table: this.quoteTable(tableName),
        attributes: allAttributes.map(attr => this.quoteIdentifier(attr)).join(','),
        tuples: tuples.slice(offset, Math.min(tuples.length, offset + batch)),
        output: outputFragment
      };

      let generatedQuery = _.template(allQueries.join(';'), this._templateSettings)(replacements);
      if (needIdentityInsertWrapper) {
        generatedQuery = [
          'SET TEMPORARY OPTION IDENTITY_INSERT = ',
          this.quoteTable(tableName),
          ';',
          generatedQuery,
          "SET TEMPORARY OPTION IDENTITY_INSERT = '';commit;"
        ].join(' ');
      }
      commands.push(generatedQuery);
      offset += batch;
    }
    return commands.join(';');
  }

  updateQuery(tableName, attrValueHash, where, options, attributes) {
    const sql = super.updateQuery(tableName, attrValueHash, where, options, attributes);
    /* not suported in sybase */
    /*
        if (options.limit) {
          const updateArgs = `UPDATE TOP(${this.escape(options.limit)})`;
          sql = sql.replace('UPDATE', updateArgs);
        }
        */
    return sql;
  }

  upsertQuery(tableName, insertValues, updateValues, where, model) {
    const targetTableAlias = this.quoteTable(`${tableName}_target`);
    const sourceTableAlias = this.quoteTable(`${tableName}_source`);
    const primaryKeysAttrs = [];
    const identityAttrs = [];
    const uniqueAttrs = [];
    const tableNameQuoted = this.quoteTable(tableName);
    let needIdentityInsertWrapper = false;

    //Obtain primaryKeys, uniquekeys and identity attrs from rawAttributes as model is not passed
    for (const key in model.rawAttributes) {
      if (model.rawAttributes[key].primaryKey) {
        primaryKeysAttrs.push(model.rawAttributes[key].field || key);
      }
      if (model.rawAttributes[key].unique) {
        uniqueAttrs.push(model.rawAttributes[key].field || key);
      }
      if (model.rawAttributes[key].autoIncrement) {
        identityAttrs.push(model.rawAttributes[key].field || key);
      }
    }

    //Add unique indexes defined by indexes option to uniqueAttrs
    for (const index of model.options.indexes) {
      if (index.unique && index.fields) {
        for (const field of index.fields) {
          const fieldName = typeof field === 'string' ? field : field.name || field.attribute;
          if (uniqueAttrs.indexOf(fieldName) === -1 && model.rawAttributes[fieldName]) {
            uniqueAttrs.push(fieldName);
          }
        }
      }
    }

    const updateKeys = Object.keys(updateValues);
    const insertKeys = Object.keys(insertValues);
    const insertKeysQuoted = insertKeys.map(key => this.quoteIdentifier(key)).join(', ');
    const insertValuesEscaped = insertKeys.map(key => this.escape(insertValues[key])).join(', ');
    const sourceTableQuery = `VALUES(${insertValuesEscaped})`; //Virtual Table
    let joinCondition;

    //IDENTITY_INSERT Condition
    identityAttrs.forEach(key => {
      if (updateValues[key] && updateValues[key] !== null) {
        needIdentityInsertWrapper = true;
        /*
         * IDENTITY_INSERT Column Cannot be updated, only inserted
         * http://stackoverflow.com/a/30176254/2254360
         */
      }
    });

    //Filter NULL Clauses
    const clauses = where[Op.or].filter(clause => {
      let valid = true;
      /*
       * Exclude NULL Composite PK/UK. Partial Composite clauses should also be excluded as it doesn't guarantee a single row
       */
      for (const key in clause) {
        if (!clause[key]) {
          valid = false;
          break;
        }
      }
      return valid;
    });

    /*
     * Generate ON condition using PK(s).
     * If not, generate using UK(s). Else throw error
     */
    const getJoinSnippet = array => {
      return array.map(key => {
        key = this.quoteIdentifier(key);
        return `${targetTableAlias}.${key} = ${sourceTableAlias}.${key}`;
      });
    };

    if (clauses.length === 0) {
      throw new Error('Primary Key or Unique key should be passed to upsert query');
    } else {
      // Search for primary key attribute in clauses -- Model can have two separate unique keys
      for (const key in clauses) {
        const keys = Object.keys(clauses[key]);
        if (primaryKeysAttrs.indexOf(keys[0]) !== -1) {
          joinCondition = getJoinSnippet(primaryKeysAttrs).join(' AND ');
          break;
        }
      }
      if (!joinCondition) {
        joinCondition = getJoinSnippet(uniqueAttrs).join(' AND ');
      }
    }

    // Remove the IDENTITY_INSERT Column from update
    const updateSnippet = updateKeys
      .filter(key => {
        if (identityAttrs.indexOf(key) === -1) {
          return true;
        } else {
          return false;
        }
      })
      .map(key => {
        const value = this.escape(updateValues[key]);
        key = this.quoteIdentifier(key);
        return `${targetTableAlias}.${key} = ${value}`;
      })
      .join(', ');

    const insertSnippet = `(${insertKeysQuoted}) VALUES(${insertValuesEscaped})`;
    let query = `MERGE INTO ${tableNameQuoted} WITH(HOLDLOCK) AS ${targetTableAlias} USING (${sourceTableQuery}) AS ${sourceTableAlias}(${insertKeysQuoted}) ON ${joinCondition}`;
    query += ` WHEN MATCHED THEN UPDATE SET ${updateSnippet} WHEN NOT MATCHED THEN INSERT ${insertSnippet} OUTPUT $action, INSERTED.*;`;
    if (needIdentityInsertWrapper) {
      query = `SET TEMPORARY OPTION IDENTITY_INSERT ='';SET TEMPORARY OPTION IDENTITY_INSERT = ${tableNameQuoted} ; ${query} SET TEMPORARY OPTION IDENTITY_INSERT =''`;
    }
    return query;
  }

  deleteQuery(tableName, where, options, model) {
    options = options || {};

    const table = this.quoteTable(tableName);
    if (options.truncate === true) {
      // Truncate does not allow LIMIT and WHERE
      return 'TRUNCATE TABLE ' + table;
    }

    where = this.getWhereConditions(where, tableName, model, options);
    let limit = '';
    const query = 'DELETE  FROM <%= table %><%= where %>; ' + 'SELECT @@ROWCOUNT AS AFFECTEDROWS;';

    if (_.isUndefined(options.limit)) {
      options.limit = 1;
    }

    if (options.limit) {
      limit = ' TOP(' + this.escape(options.limit) + ')';
    }

    const replacements = {
      limit,
      table,
      where
    };

    if (replacements.where) {
      replacements.where = ' WHERE ' + replacements.where;
    }

    return _.template(query, this._templateSettings)(replacements);
  }

  showIndexesQuery(tableName) {
    //const sql = "EXEC sys.sp_helpindex @objname = N'<%= tableName %>';";
    const sql = `
select
sx.index_name, sx.index_type , si.colnames
from
sys.sysindex as sx join sys.systable as st on(sx.table_id = st.table_id)
join sys.sysuser as su on(sx.creator = su.user_id)
join sys.sysindexes as si on(si.iname = sx.index_name and si.creator = su.user_name and si.tname = st.table_name)
where st.table_name = '<%= table_raw %>' and st.creator = user_id()
`;

    return _.template(sql, this._templateSettings)({
      tableName: this.quoteTable(tableName),
      table_raw: this.rawTable(tableName)
    });
  }

  showConstraintsQuery(tableName) {
    return `EXEC sp_helpconstraint @objname = ${this.escape(this.quoteTable(tableName))};`;
  }

  removeIndexQuery(tableName, indexNameOrAttributes) {
    const sql = 'DROP INDEX <%= indexName %> ON <%= tableName %>';
    let indexName = indexNameOrAttributes;

    if (typeof indexName !== 'string') {
      indexName = Utils.underscore(tableName + '_' + indexNameOrAttributes.join('_'));
    }

    const values = {
      tableName: this.quoteIdentifiers(tableName),
      indexName: this.quoteIdentifiers(indexName)
    };

    return _.template(sql, this._templateSettings)(values);
  }

  //create table part
  attributeToSQL(attribute) {
    if (!_.isPlainObject(attribute)) {
      attribute = {
        type: attribute
      };
    }

    // handle self referential constraints
    if (attribute.references) {
      if (attribute.Model && attribute.Model.tableName === attribute.references.model) {
        this.sequelize.log(
          'MSSQL does not support self referencial constraints, ' +
            'we will remove it but we recommend restructuring your query'
        );
        attribute.onDelete = '';
        attribute.onUpdate = '';
      }
    }

    let template;

    if (attribute.type instanceof DataTypes.ENUM) {
      if (attribute.type.values && !attribute.values) attribute.values = attribute.type.values;

      // enums are a special case
      template = attribute.type.toSql();
      template +=
        ' CHECK (' +
        this.quoteIdentifier(attribute.field) +
        ' IN(' +
        _.map(attribute.values, value => {
          return this.escape(value);
        }).join(', ') +
        '))';
      return template;
    } else {
      template = attribute.type.toString();
    }

    if (attribute.allowNull === false) {
      template += ' NOT NULL';
    } else if (!attribute.primaryKey && !Utils.defaultValueSchemable(attribute.defaultValue)) {
      template += ' NULL';
    }

    if (attribute.autoIncrement) {
      template += ' IDENTITY';
    }

    // Blobs/texts cannot have a defaultValue
    if (
      attribute.type !== 'TEXT' &&
      attribute.type._binary !== true &&
      Utils.defaultValueSchemable(attribute.defaultValue)
    ) {
      template += ' DEFAULT ' + this.escape(attribute.defaultValue, attribute);
    }

    if (attribute.unique === true) {
      template += ' UNIQUE';
    }

    if (attribute.primaryKey) {
      template += ' PRIMARY KEY';
    }

    return template;
  }

  attributesToSQL(attributes, options) {
    const result = {},
      existingConstraints = [];
    let key, attribute;

    for (key in attributes) {
      attribute = attributes[key];

      if (attribute.references) {
        if (existingConstraints.indexOf(attribute.references.model.toString()) !== -1) {
          // no cascading constraints to a table more than once
          attribute.onDelete = '';
          attribute.onUpdate = '';
        } else {
          existingConstraints.push(attribute.references.model.toString());

          // NOTE: this really just disables cascading updates for all
          //       definitions. Can be made more robust to support the
          //       few cases where MSSQL actually supports them
          attribute.onUpdate = '';
        }
      }

      if (key && !attribute.field) attribute.field = key;
      result[attribute.field || key] = this.attributeToSQL(attribute, options);
    }

    return result;
  }

  createTrigger() {
    throwMethodUndefined('createTrigger');
  }

  dropTrigger() {
    throwMethodUndefined('dropTrigger');
  }

  renameTrigger() {
    throwMethodUndefined('renameTrigger');
  }

  createFunction() {
    throwMethodUndefined('createFunction');
  }

  dropFunction() {
    throwMethodUndefined('dropFunction');
  }

  renameFunction() {
    throwMethodUndefined('renameFunction');
  }

  quoteIdentifier(identifier) {
    if (identifier === '*') return identifier;
    //    return '[' + identifier.replace(/[\[\]']+/g, '') + ']';
    return '"' + identifier.replace(/[\"\[\]']+/g, '') + '"';
  }

  /**
   * Generate common SQL prefix for ForeignKeysQuery.
   * @returns {String}
   */

  /**
   * Generates an SQL query that returns all foreign keys details of a table.
   * @param {Stirng|Object} table
   * @param {String} catalogName database name
   * @returns {String}
   */
  getForeignKeysQuery(table, catalogName) {
    /*sybase does not support foreign keys */
    const tableName = table.tableName || table;
    let sql = 'select getdate() as dt where 1=0';

    return sql;
  }

  getForeignKeyQuery(table, attributeName) {
    const tableName = table.tableName || table;
    let sql =
      this._getForeignKeysQueryPrefix() +
      ' WHERE TB.NAME =' +
      wrapSingleQuote(tableName) +
      ' AND COL.NAME =' +
      wrapSingleQuote(attributeName);

    if (table.schema) {
      sql += ' AND SCHEMA_NAME(TB.SCHEMA_ID) =' + wrapSingleQuote(table.schema);
    }

    return sql;
  }

  getPrimaryKeyConstraintQuery(table, attributeName) {
    const tableName = wrapSingleQuote(table.tableName || table);
    return [
      'SELECT K.TABLE_NAME AS tableName,',
      'K.COLUMN_NAME AS columnName,',
      'K.CONSTRAINT_NAME AS constraintName',
      'FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS C',
      'JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS K',
      'ON C.TABLE_NAME = K.TABLE_NAME',
      'AND C.CONSTRAINT_CATALOG = K.CONSTRAINT_CATALOG',
      'AND C.CONSTRAINT_SCHEMA = K.CONSTRAINT_SCHEMA',
      'AND C.CONSTRAINT_NAME = K.CONSTRAINT_NAME',
      "WHERE C.CONSTRAINT_TYPE = 'PRIMARY KEY'",
      `AND K.COLUMN_NAME = ${wrapSingleQuote(attributeName)}`,
      `AND K.TABLE_NAME = ${tableName};`
    ].join(' ');
  }

  dropForeignKeyQuery(tableName, foreignKey) {
    return _.template('ALTER TABLE <%= table %> DROP <%= key %>', this._templateSettings)({
      table: this.quoteTable(tableName),
      key: this.quoteIdentifier(foreignKey)
    });
  }

  getDefaultConstraintQuery(tableName, attributeName) {
    const sql =
      'SELECT name FROM SYS.DEFAULT_CONSTRAINTS ' +
      "WHERE PARENT_OBJECT_ID = OBJECT_ID('<%= table %>', 'U') " +
      "AND PARENT_COLUMN_ID = (SELECT column_id FROM sys.columns WHERE NAME = ('<%= column %>') " +
      "AND object_id = OBJECT_ID('<%= table %>', 'U'));";
    return _.template(sql, this._templateSettings)({
      table: this.quoteTable(tableName),
      column: attributeName
    });
  }

  dropConstraintQuery(tableName, constraintName) {
    const sql = 'ALTER TABLE <%= table %> DROP CONSTRAINT <%= constraint %>;';
    return _.template(sql, this._templateSettings)({
      table: this.quoteTable(tableName),
      constraint: this.quoteIdentifier(constraintName)
    });
  }

  setAutocommitQuery() {
    return '';
  }

  generateTransactionId() {
    return randomBytes(10).toString('hex');
  }

  startTransactionQuery(transaction) {
    if (transaction.parent) {
      return 'SAVE TRANSACTION ' + this.quoteIdentifier(transaction.name) + ';';
    }

    return 'BEGIN TRANSACTION;';
  }

  commitTransactionQuery(transaction) {
    if (transaction.parent) {
      return;
    }

    return 'COMMIT TRANSACTION;';
  }

  rollbackTransactionQuery(transaction) {
    if (transaction.parent) {
      return 'ROLLBACK TRANSACTION ' + this.quoteIdentifier(transaction.name) + ';';
    }

    return 'ROLLBACK TRANSACTION;';
  }

  selectFromTableFragment(options, model, attributes, tables, mainTableAs, where) {
    let topFragment = '';
    let mainFragment = 'SELECT ' + attributes.join(', ') + ' FROM ' + tables;

    // Handle SQL Server 2008 with TOP instead of LIMIT
    if (options.limit) {
      topFragment = 'TOP ' + options.limit + ' ';
    }
    if (options.offset) {
      const offset = options.offset || 0,
        isSubQuery = options.hasIncludeWhere || options.hasIncludeRequired || options.hasMultiAssociation;
      let orders = {
        mainQueryOrder: []
      };
      if (options.order) {
        orders = this.getQueryOrders(options, model, isSubQuery);
      }

      if (!orders.mainQueryOrder.length) {
        orders.mainQueryOrder.push(this.quoteIdentifier(model.primaryKeyField));
      }

      const tmpTable = mainTableAs ? mainTableAs : 'OffsetTable';
      const whereFragment = where ? ' WHERE ' + where : '';

      //roman 27.08.2018
      const fragment =
        'SELECT ' +
        topFragment +
        attributes.join(', ') +
        ' from (SELECT * ' +
        ' FROM (SELECT ROW_NUMBER() OVER (ORDER BY ' +
        orders.mainQueryOrder.join(', ') +
        ') as row_num,  ' +
        tmpTable +
        '.*' +
        ' FROM ' +
        tables +
        ' AS ' +
        tmpTable +
        options.mainJoinQueries.join(' ') +
        whereFragment +
        ')' +
        ' AS ' +
        tmpTable +
        ' WHERE row_num > ' +
        offset +
        ') AS ' +
        tmpTable;

      //      console.log(fragment);

      return fragment;
    } else {
      mainFragment = 'SELECT ' + topFragment + attributes.join(', ') + ' FROM ' + tables;
    }

    if (mainTableAs) {
      mainFragment += ' AS ' + mainTableAs;
    }

    return mainFragment;
  }

  addLimitAndOffset(options, model) {
    return '';
    let fragment = '';
    const offset = options.offset || 0,
      isSubQuery = options.hasIncludeWhere || options.hasIncludeRequired || options.hasMultiAssociation;

    let orders = {};
    if (options.order) {
      orders = this.getQueryOrders(options, model, isSubQuery);
    }

    if (options.limit || options.offset) {
      if (!options.order || (options.include && !orders.subQueryOrder.length)) {
        fragment += options.order && !isSubQuery ? ', ' : ' ORDER BY ';
        fragment += this.quoteTable(options.tableAs || model.name) + '.' + this.quoteIdentifier(model.primaryKeyField);
      }

      /* roman 10.08.2018

      fragment += ' limit  ' + this.escape(options.limit) + ' offset ' + this.escape(offset);
      if (options.offset || options.limit) {
      }
*/
    }

    return fragment;
  }

  booleanValue(value) {
    return value ? 1 : 0;
  }
}

// private methods
function wrapSingleQuote(identifier) {
  return Utils.addTicks(Utils.removeTicks(identifier, "'"), "'");
}

module.exports = SybaseQueryGenerator;
