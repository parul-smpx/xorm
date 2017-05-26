'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _objection = require('objection');

var _query_builder = require('./query_builder');

var _query_builder2 = _interopRequireDefault(_query_builder);

var _utils = require('./utils');

var _user_error = require('./user_error');

var _user_error2 = _interopRequireDefault(_user_error);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/* eslint-disable import/no-dynamic-require, global-require */
const httpUrlPattern = new RegExp('^(https?:\\/\\/)?' + // protocol
'((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.?)+[a-z]{2,}|' + // domain name
'((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
'(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
'(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
'(\\#[-a-z\\d_]*)?$', 'i' // fragment locator
);

/**
* Base class that all of our models will extend
* This has few extra utilities over the Objection Model
* 1. Automatic table names
* 2. Automatic timestamps
* 3. Soft Deletes
* 4. scopes (define as static scopes = {default(builder) {}, something(builder) {}, ...})
*/
class BaseModel extends _objection.Model {

	static createValidator() {
		return new _objection.AjvValidator({
			onCreateAjv: ajv => {
				// Here you can modify the `Ajv` instance.
				ajv.addFormat('url', httpUrlPattern);
			},
			options: {
				allErrors: true,
				validateSchema: false,
				ownProperties: true,
				v5: true
			}
		});
	}

	// base path for requiring models in relations
	static setBasePath(basePath) {
		this.basePath = basePath;
	}

	static get softDeleteColumn() {
		if (_lodash2.default.isString(this.softDelete)) {
			return this.softDelete;
		}

		return 'deletedAt';
	}

	static get systemColumns() {
		const columns = [];
		if (this.timestamps) {
			columns.push('createdAt');
			columns.push('updatedAt');
		}

		if (this.softDelete) {
			columns.push(this.softDeleteColumn);
		}

		return columns;
	}

	static get tableName() {
		this._tableName = this._tableName || this.name;
		return this._tableName;
	}

	static set tableName(table) {
		this._tableName = table;
	}

	static get relationMappings() {
		if (this._relationMappings) return this._relationMappings;

		// generate relation mappings
		this._relationMappings = {};
		this.$relations();
		return this._relationMappings;
	}

	static set relationMappings(mappings) {
		this._relationMappings = mappings;
	}

	static $relations() {}

	static where(...args) {
		return this.query().where(...args);
	}

	static find(...args) {
		return this.query().find(...args);
	}

	static getFindByIdSubResolver(propName) {
		if (!propName) propName = `${_lodash2.default.camelCase(this.name)}Id`;

		return obj => this.query().findById(obj[propName]);
	}

	static getDeleteByIdResolver() {
		return (root, obj) => this.query().deleteById(obj[this.idColumn]).then(() => ({ id: obj[this.idColumn] }));
	}

	$beforeInsert(context) {
		super.$beforeInsert(context);
		if (this.constructor.timestamps && !context.dontTouch) {
			this.createdAt = new Date().toISOString();
			this.updatedAt = new Date().toISOString();
		}
	}

	$beforeUpdate(opt, context) {
		super.$beforeUpdate(opt, context);
		if (this.constructor.timestamps && !context.dontTouch) {
			this.updatedAt = new Date().toISOString();
		}
	}

	$beforeDelete(context) {
		super.$beforeDelete(context);
	}

	static getJsonSchema() {
		// Memoize the jsonSchema but only for this class. The hasOwnProperty check
		// will fail for subclasses and the value gets recreated.
		if (!this.hasOwnProperty('$$jsonSchema')) {
			// this.jsonSchema is often a getter that returns a new object each time. We need
			// memoize it to make sure we get the same instance each time.
			const jsonSchema = this.jsonSchema;

			if (jsonSchema && jsonSchema.properties) {
				const columns = this.systemColumns || [];
				columns.forEach(column => {
					jsonSchema.properties[column] = { type: ['datetime', 'string', 'int', 'null'] };
				});
			}

			Object.defineProperty(this, '$$jsonSchema', {
				enumerable: false,
				writable: true,
				configurable: true,
				value: jsonSchema
			});
		}

		return this.$$jsonSchema;
	}

	static _getModelClass(model) {
		if (!_lodash2.default.isString(model)) return model;
		const modelClass = require(_path2.default.resolve(this.basePath, model));
		return modelClass.default || modelClass;
	}

	static belongsTo(model, options = {}) {
		const modelClass = this._getModelClass(model);

		// this.BelongsTo(Person) (this = Pet)
		// Pet Belongs To Person
		// This Means => Pet.id = Person.petId
		// will be accessible through Pet.person

		// Pet.person
		const name = options.name || _lodash2.default.camelCase(modelClass.name);
		// Person.petId
		const joinFrom = options.joinFrom || `${modelClass.tableName}.${_lodash2.default.camelCase(this.name)}${_lodash2.default.upperFirst(this.idColumn)}`;
		// Pet.id
		const joinTo = options.joinTo || `${this.tableName}.${this.idColumn}`;
		const filter = options.filter || null;

		this._relationMappings[name] = {
			relation: _objection.Model.BelongsToOneRelation,
			modelClass,
			filter,
			join: {
				from: joinFrom,
				to: joinTo
			}
		};
	}

	static hasOne(model, options = {}) {
		const modelClass = this._getModelClass(model);

		// this.HasOne(Pet) (this = Person)
		// Person Has One Pet
		// This Means => Person.petId = Pet.id
		// will be accessible through Person.pet

		// Person.pet
		const name = options.name || _lodash2.default.camelCase(modelClass.name);
		// Person.petId
		const joinFrom = options.joinFrom || `${this.tableName}.${_lodash2.default.camelCase(modelClass.name)}${_lodash2.default.upperFirst(modelClass.idColumn)}`;
		// Pet.id
		const joinTo = options.joinTo || `${modelClass.tableName}.${modelClass.idColumn}`;
		const filter = options.filter || null;

		this._relationMappings[name] = {
			relation: _objection.Model.HasOneRelation,
			modelClass,
			filter,
			join: {
				from: joinFrom,
				to: joinTo
			}
		};
	}

	static hasMany(model, options = {}) {
		const modelClass = this._getModelClass(model);

		// this.HasMany(Pet) (this = Person)
		// Person Has Many Pets
		// This Means => Pet.personId = Person.id
		// will be accessible through Person.pets

		// Person.pets
		const name = options.name || (0, _utils.plural)(_lodash2.default.camelCase(modelClass.name));
		// Pet.personId
		const joinFrom = options.joinFrom || `${modelClass.tableName}.${_lodash2.default.camelCase(this.name)}${_lodash2.default.upperFirst(this.idColumn)}`;
		// Person.id
		const joinTo = options.joinTo || `${this.tableName}.${this.idColumn}`;
		const filter = options.filter || null;

		this._relationMappings[name] = {
			relation: _objection.Model.HasManyRelation,
			modelClass,
			filter,
			join: {
				from: joinFrom,
				to: joinTo
			}
		};
	}

	static hasManyThrough(model, options = {}) {
		const modelClass = this._getModelClass(model);

		// this.HasManyThrough(Pet) (this = Person)
		// Person Has Many Pets Through Some Other Table (Let's Say Pet_Person)
		// This Means => Pet_Person.personId = Person.id
		// will be accessible through Person.pets

		// Person.pets
		const name = options.name || (0, _utils.plural)(_lodash2.default.camelCase(modelClass.name));
		// Person.id
		const joinFrom = options.joinFrom || `${this.tableName}.${this.idColumn}`;
		// Pet.id
		const joinTo = options.joinTo || `${modelClass.tableName}.${modelClass.idColumn}`;
		const filter = options.filter || null;

		options.through = options.through || {};

		let throughClass;
		let throughTable;

		if (options.through.model) {
			throughClass = this._getModelClass(options.through.model);
			throughTable = options.through.table || throughClass.tableName;
		} else {
			// Person_Pet
			throughTable = options.through.table || `${this.name}_${modelClass.name}`;
		}

		// Person_Pet.personId
		const throughFrom = options.through.from || `${throughTable}.${_lodash2.default.camelCase(this.name)}${_lodash2.default.upperFirst(this.idColumn)}`;
		// Person_Pet.petId
		const throughTo = options.through.to || `${throughTable}.${_lodash2.default.camelCase(modelClass.name)}${_lodash2.default.upperFirst(modelClass.idColumn)}`;

		const throughExtra = options.through.extra || null;
		const throughFilter = options.through.filter || null;

		this._relationMappings[name] = {
			relation: _objection.Model.ManyToManyRelation,
			modelClass,
			filter,
			join: {
				from: joinFrom,
				to: joinTo,
				through: {
					from: throughFrom,
					to: throughTo,
					modelClass: throughClass,
					extra: throughExtra,
					filter: throughFilter
				}
			}
		};
	}
}

BaseModel.timestamps = true;
BaseModel.softDelete = false;
BaseModel.Error = _user_error2.default;
BaseModel.basePath = '';
BaseModel.QueryBuilder = _query_builder2.default;
BaseModel.RelatedQueryBuilder = _query_builder2.default;

exports.default = BaseModel;