import type { EventContext } from '@directus/types';
import { defineHook } from '@directus/extensions-sdk';


const reconcileHypertable = async (meta, context: EventContext) => {
	const schemaName = 'public';  // FIXME
	const { database, schema } = context;
	const { event, collection, payload } = meta;
	const { field: fieldName, meta: fieldMeta } = payload;
	console.log('meta', event, collection, payload);
	console.log('schema', schema?.collections[collection]);

	/* -------------------- Was the field a hypertable field? ------------------- */

	if(fieldMeta?.interface && fieldMeta.interface !== 'tsdb-hypertable') {
		return;
	}
	const [field] = (
		await database
			.select('*').from('directus_fields')
			.where('collection', collection)
			.where('field', fieldName)
			.where('interface', 'tsdb-hypertable')  // TODO: FieldsService?
	) || [];
	if(!field) {
		return;
	}
	console.log('field', field);

	/* ---------------- What is the current state of this table? ---------------- */
	
	const [ hypertable ] = (
		await database
			.select('*')
			.from(database.ref('hypertables').withSchema('timescaledb_information'))
			.where('hypertable_name', collection)
	) || [];
	console.log('hypertable', hypertable);

	/* ----------------- Create, Update, or Delete the hypertable ----------------- */

	if(event === 'fields.create') {
		if(hypertable) {
			console.log("Already a hypertable", hypertable);
			return;
		}

		/* -------------- Make sure we are ready to create a hypertable ------------- */
		// Must meet the following requirements:
		//  - Collection must have a non-composite primary key
		//  - Collection time field must be non-null
		//  - Unique constraints must include time column: https://docs.timescale.com/use-timescale/latest/hypertables/hypertables-and-unique-indexes/

		// Get the current primary key
		// 		Source: https://github.com/directus/directus/blob/46611e67512279127216ddeec99a810cfb450dce/packages/schema/src/dialects/postgres.ts#L129
		const [primaryKey] = (await database.raw(
			`
			SELECT kcu.column_name, tc.constraint_name
			FROM information_schema.table_constraints AS tc
			JOIN information_schema.key_column_usage AS kcu
				ON tc.constraint_name = kcu.constraint_name
				AND tc.table_schema = kcu.table_schema
				AND tc.table_name = kcu.table_name
			WHERE tc.table_name = ? AND tc.table_schema = ? AND tc.constraint_type = 'PRIMARY KEY'
			`,
		[collection, schemaName])).rows;
		console.log('Primary key', primaryKey);

		// Drop any existing primary key and add the time field as the primary key instead
		await database.schema.alterTable(collection, async (t) => {
			if(primaryKey) {
				console.log('Dropping primary key', primaryKey.constraint_name);
				await t.dropPrimary(primaryKey.constraint_name);
			}
		});
		await database.schema.alterTable(collection, async (t) => {
			// Error that shows up if we don't set a primary key: 
			//   Collection "${collection}" doesn't have a primary key column and will be ignored
			//   https://github.com/directus/directus/blob/46611e67512279127216ddeec99a810cfb450dce/api/src/utils/get-schema.ts#L137
			// Error if any constraint does not include the partitioning field (time):
			//   ERROR:  cannot create a unique index without the column "time" (used in partitioning)
			console.log('Updating primary key to include time partitioning key', primaryKey.column_name, field.field);
			t.primary(field.field);
			// make sure the time field is required
			if(!field.required) {
				t.dropNullable(field.field);
			}
		});
		// make sure the time field is required (updated below too)
		if(!field.required) {
			// FIXME: can we force/hide this in the interface?
			await database('directus_fields').update({ required: true }).where('id', field.id);
		}

		// Check if there are any unique indexes on this table
		const uniqueIndexes = (await database.raw(`
			SELECT i.relname as name, json_agg(a.attname) AS cols
			FROM pg_class t, pg_class i, pg_index ix, pg_attribute a
			WHERE t.oid = ix.indrelid AND i.oid = ix.indexrelid AND a.attrelid = t.oid
				AND a.attnum = ANY(ix.indkey) AND t.relkind = 'r' AND t.relname = ?
				AND ix.indisunique = true AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = ?)
			GROUP BY i.relname`, [collection, schemaName])).rows;
		// find ones that don't include the partitioning field
		const incompatibleIndexes = uniqueIndexes.filter((row) => !row.cols.includes(field.field));

		console.log('Unique indexes', uniqueIndexes);
		console.log('Incompatible indexes', incompatibleIndexes);

		// Drop unique indexes that don't include the partitioning field
		if(incompatibleIndexes.length) {
			await database.schema.alterTable(collection, async (t) => {
				for(const index of incompatibleIndexes) {
					console.log('Dropping unique index', collection, index);
					await t.dropUnique(index.cols, index.name);
				}
			})
		}

		/* --------------------------- Create the hypertable ------------------------- */

		// https://docs.timescale.com/api/latest/hypertable/create_hypertable/
		console.log('Creating hypertable', collection, field.field, meta);
		const result = (await database.raw(`
			SELECT * from create_hypertable(?, by_range(?), if_not_exists => TRUE, migrate_data => TRUE)`, 
		[collection, field.field])).rows;
		console.log('Result', result);
	}
}

export default defineHook(({ action }) => {	
	action('fields.create', async (meta, context) => {
		console.log('action', meta);
		try {
			await reconcileHypertable(meta, context);
		} catch (error) {
			console.error('Error reconciling hypertable', error);
		}
	});


	// [
	// 	'fields.create', 
	// 	// 'fields.update', 
	// 	// 'fields.delete',
	// 	// 'collections.create', 
	// 	// 'collections.update', 
	// 	// 'collections.delete',
	// ].forEach((eventName) => {
	// 	console.log('Registering hook', eventName);
	// 	action(eventName, async (meta, context) => {
	// 		console.log('action', eventName, meta);

	// 		// console.log('context', context);
	// 		try {
	// 			await reconcileHypertable(meta, context);
	// 		} catch (error) {
	// 			console.error('Error reconciling hypertable', error);
	// 		}

	// 	});
	// });
});


/*

Example event meta:

fields.create: {
  event: 'fields.create',
  payload: {
    type: 'timestamp',
    meta: { interface: 'tsdb-hypertable', special: [Array] },
    field: 'time'
  },
  key: 'time',
  collection: 'asdf'
}

fields.update: {
  event: 'fields.update',
  payload: { meta: { hidden: true }, field: 'time' },
  keys: [ 'time' ],
  collection: 'asdf'
}

fields.delete: { 
	event: 'fields.delete', 
	payload: [ 'time' ], 
	collection: 'asdf' 
}
	
*/