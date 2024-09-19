// Adapted from: https://github.com/directus/directus/blob/main/app/src/interfaces/datetime/index.ts
import { defineInterface } from '@directus/extensions-sdk';
import InterfaceDateTime from './interface.vue';


export default defineInterface({
	id: 'tsdb-hypertable',
	name: 'TimescaleDB Hypertable Time Column',
	description: 'Turn a table into a TimescaleDB hypertable using this time column.',
	icon: 'today',
	component: InterfaceDateTime,
	recommendedDisplays: ['datetime'],
	types: ['timestamp', 'dateTime', 'time'],
	group: 'other',
	options: [
		{
			field: 'includeSeconds',
			name: '$t:interfaces.datetime.include_seconds',
			type: 'boolean',
			meta: {
				width: 'half',
				interface: 'boolean',
			},
			schema: {
				default_value: true,
			},
		},
		{
			field: 'use24',
			name: '$t:interfaces.datetime.use_24',
			type: 'boolean',
			meta: {
				width: 'half',
				interface: 'boolean',
			},
			schema: {
				default_value: true,
			},
		},
	],
});