import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

export type Show = IDisplayOptions['show'];

const DOCS_URL = 'https://taddy.org/developers/podcast-api';

/** Page number field. Each page is one API request against the monthly quota. */
export function pageProperty(show: Show, maxValue: number, note = ''): INodeProperties {
	const description = `Page of results to return (1 to ${maxValue}). Each page is one API request${note ? `. ${note}` : ''}.`;
	return {
		displayName: 'Page',
		name: 'page',
		type: 'number',
		default: 1,
		typeOptions: { minValue: 1, maxValue },
		displayOptions: { show },
		description,
	};
}

/** Results per page. Named limitPerPage (not limit) because Taddy caps pages at 25-50 items. */
export function limitPerPageProperty(
	show: Show,
	options: { default: number; maxValue: number; note?: string },
): INodeProperties {
	const description = `Number of results per page (1 to ${options.maxValue})${options.note ? `. ${options.note}.` : ''}`;
	const property: INodeProperties = {
		displayName: 'Limit Per Page',
		name: 'limitPerPage',
		type: 'number',
		default: 10,
		typeOptions: { minValue: 1, maxValue: options.maxValue },
		displayOptions: { show },
		description,
	};
	return { ...property, default: options.default };
}

/** Whether list results come back as one n8n item each (default) or as one raw response item. */
export function splitIntoItemsProperty(show: Show, what: string): INodeProperties {
	const description = `Whether to output one item per ${what}. Turn off to output the raw API response as a single item.`;
	return {
		displayName: 'Split Into Items',
		name: 'splitIntoItems',
		type: 'boolean',
		default: true,
		displayOptions: { show },
		description,
	};
}

/** The Custom Fields option: a GraphQL selection replacing the default field set. */
export function customFieldsOption(
	typeName: string,
	keyField: string,
	name = 'customFields',
	displayName = 'Custom Fields',
): INodeProperties {
	const description = `GraphQL selection to return for each ${typeName} instead of the default fields. The key field (${keyField}) is added automatically; every nested object you select must include its own key field (uuid, ID or URL). See the <a href="${DOCS_URL}">Taddy API docs</a>.`;
	return {
		displayName,
		name,
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		placeholder: 'name description persons { uuid name role }',
		description,
	};
}

/** Wraps option properties into an "Options" collection shown for the given resource/operation. */
export function optionsCollection(show: Show, options: INodeProperties[]): INodeProperties {
	return {
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show },
		options,
	};
}

/**
 * "Look Up By" selector plus one value field per mode. Used by Podcast > Get / Get Episodes
 * (uuid, itunesId, rssUrl, name), Podcast > Get iTunes Info (uuid, itunesId) and Episode > Get
 * (uuid, guid, name).
 */
export type LookupMode = 'uuid' | 'itunesId' | 'rssUrl' | 'name' | 'guid';

const LOOKUP_OPTIONS: Record<LookupMode, { name: string; description: string }> = {
	uuid: { name: 'UUID', description: 'The Taddy UUID' },
	itunesId: { name: 'iTunes ID', description: 'The Apple Podcasts ID' },
	rssUrl: { name: 'RSS URL', description: 'The RSS feed URL' },
	name: {
		name: 'Name',
		description: 'Returns the top search hit, which can be a different or partial match',
	},
	guid: { name: 'GUID', description: 'The episode GUID from the RSS feed' },
};

const LOOKUP_VALUE_FIELDS: Record<LookupMode, Omit<INodeProperties, 'displayOptions'>> = {
	uuid: {
		displayName: 'UUID',
		name: 'uuid',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'cb8d858a-3ef4-4645-8942-67e55c0927f2',
		description: 'The Taddy UUID',
	},
	itunesId: {
		displayName: 'iTunes ID',
		name: 'itunesId',
		type: 'number',
		default: 0,
		required: true,
		placeholder: '201671138',
		description: 'The Apple Podcasts ID',
	},
	rssUrl: {
		displayName: 'RSS URL',
		name: 'rssUrl',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://feeds.simplecast.com/54nAGcIl',
		description: 'The RSS feed URL of the podcast',
	},
	name: {
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'This American Life',
		description:
			'Returns the top search hit, which can be a different or partial match. Check the returned name; prefer UUID or RSS URL once known.',
	},
	guid: {
		displayName: 'GUID',
		name: 'guid',
		type: 'string',
		default: '',
		required: true,
		description: 'The episode GUID from the RSS feed',
	},
};

export function lookupProperties(
	show: Show,
	modes: LookupMode[],
	subject: string,
): INodeProperties[] {
	const options = modes
		.map((mode) => ({
			name: LOOKUP_OPTIONS[mode].name,
			value: mode,
			description: LOOKUP_OPTIONS[mode].description,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
	const selector: INodeProperties = {
		displayName: 'Look Up By',
		name: 'lookupBy',
		type: 'options',
		noDataExpression: true,
		options,
		default: 'uuid',
		displayOptions: { show },
		description: `Which identifier to use to find the ${subject}`,
	};
	const fields: INodeProperties[] = modes.map((mode) => ({
		...LOOKUP_VALUE_FIELDS[mode],
		displayOptions: { show: { ...show, lookupBy: [mode] } },
	}));
	return [selector, ...fields];
}

/** A comma-separated list field (also accepts an array via expression). */
export function listProperty(
	name: string,
	displayName: string,
	show: Show,
	description: string,
	required = false,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'string',
		default: '',
		required,
		displayOptions: { show },
		placeholder: 'uuid1, uuid2',
		description,
	};
}
