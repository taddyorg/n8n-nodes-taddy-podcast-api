import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	customFieldsOption,
	limitPerPageProperty,
	listProperty,
	lookupProperties,
	optionsCollection,
	pageProperty,
	splitIntoItemsProperty,
} from '../shared/descriptions';
import { EPISODE_FIELDS, ITUNES_FIELDS, SERIES_FIELDS, selection } from '../shared/fragments';
import { getBool, getListParam, getLookupVariables, getOption } from '../shared/params';
import { taddyApiRequest } from '../shared/transport';
import { asArray, cleanVariables, toItems } from '../shared/utils';

const RESOURCE = 'podcast';
const showGet = { resource: [RESOURCE], operation: ['get'] };
const showGetEpisodes = { resource: [RESOURCE], operation: ['getEpisodes'] };
const showGetItunesInfo = { resource: [RESOURCE], operation: ['getItunesInfo'] };
const showGetLatestEpisodes = { resource: [RESOURCE], operation: ['getLatestEpisodes'] };
const showGetMany = { resource: [RESOURCE], operation: ['getMany'] };

export const podcastDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a podcast',
				description: 'Look up one podcast by UUID, iTunes ID, RSS URL or name',
			},
			{
				name: 'Get Episodes',
				value: 'getEpisodes',
				action: 'Get episodes of a podcast',
				description: 'Page through the episodes of one podcast, newest first by default',
			},
			{
				name: 'Get iTunes Info',
				value: 'getItunesInfo',
				action: 'Get apple podcasts details for a podcast',
				description:
					'Apple Podcasts details (publisher, artwork, country, summary) for a podcast. Empty for podcasts not on Apple Podcasts.',
			},
			{
				name: 'Get Latest Episodes',
				value: 'getLatestEpisodes',
				action: 'Get the latest episodes across several podcasts',
				description:
					'The newest episodes across up to 1000 podcasts, newest first: a "what is new in these shows" feed',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many podcasts',
				description: 'Fetch up to 25 podcasts by UUID in one request',
			},
		],
		default: 'get',
	},

	// Get
	...lookupProperties(showGet, ['uuid', 'itunesId', 'rssUrl', 'name'], 'podcast'),
	optionsCollection(showGet, [customFieldsOption('podcast', 'uuid')]),

	// Get Episodes
	...lookupProperties(showGetEpisodes, ['uuid', 'itunesId', 'rssUrl', 'name'], 'podcast'),
	{
		displayName: 'Sort Order',
		name: 'sortOrder',
		type: 'options',
		options: [
			{ name: 'Latest First', value: 'LATEST' },
			{ name: 'Oldest First', value: 'OLDEST' },
			{ name: 'Search Relevance', value: 'SEARCH', description: 'Requires a search term' },
		],
		default: 'LATEST',
		displayOptions: { show: showGetEpisodes },
		description: 'Order of the episodes. Setting a search term switches to search relevance.',
	},
	{
		displayName: 'Search Term',
		name: 'searchTerm',
		type: 'string',
		default: '',
		displayOptions: { show: showGetEpisodes },
		description:
			"Search within this podcast's episodes. When set, results are ordered by relevance.",
	},
	pageProperty(showGetEpisodes, 1000),
	limitPerPageProperty(showGetEpisodes, { default: 10, maxValue: 25 }),
	{
		displayName: 'Include Removed Episodes',
		name: 'includeRemovedEpisodes',
		type: 'boolean',
		default: false,
		displayOptions: { show: showGetEpisodes },
		description: 'Whether to include episodes that were removed from the RSS feed',
	},
	splitIntoItemsProperty(showGetEpisodes, 'episode'),
	optionsCollection(showGetEpisodes, [customFieldsOption('episode', 'uuid')]),

	// Get iTunes Info
	...lookupProperties(showGetItunesInfo, ['uuid', 'itunesId'], 'podcast'),
	optionsCollection(showGetItunesInfo, [customFieldsOption('iTunes info record', 'uuid')]),

	// Get Latest Episodes
	listProperty(
		'uuids',
		'Podcast UUIDs',
		showGetLatestEpisodes,
		'Comma-separated Taddy UUIDs of the podcasts (up to 1000 across UUIDs and RSS URLs). Also accepts an array via an expression',
	),
	listProperty(
		'rssUrls',
		'Podcast RSS URLs',
		showGetLatestEpisodes,
		'Comma-separated RSS feed URLs of the podcasts (up to 1000 across UUIDs and RSS URLs). Also accepts an array via an expression',
	),
	pageProperty(showGetLatestEpisodes, 20, 'Free plan: page 1 only'),
	limitPerPageProperty(showGetLatestEpisodes, {
		default: 25,
		maxValue: 50,
		note: 'Free plan: up to 25',
	}),
	splitIntoItemsProperty(showGetLatestEpisodes, 'episode'),
	optionsCollection(showGetLatestEpisodes, [customFieldsOption('episode', 'uuid')]),

	// Get Many
	listProperty(
		'uuids',
		'Podcast UUIDs',
		showGetMany,
		'Comma-separated Taddy UUIDs of the podcasts (up to 25). Also accepts an array via an expression. Unknown UUIDs are silently left out',
		true,
	),
	splitIntoItemsProperty(showGetMany, 'podcast'),
	optionsCollection(showGetMany, [customFieldsOption('podcast', 'uuid')]),
];

const SERIES_LOOKUP_VARS = '$uuid: ID, $itunesId: Float, $rssUrl: String, $name: String';
const SERIES_LOOKUP_ARGS = 'uuid: $uuid, itunesId: $itunesId, rssUrl: $rssUrl, name: $name';

export async function executePodcast(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	const fields = getOption<string>(this, itemIndex, 'customFields', '');

	if (operation === 'get') {
		const variables = getLookupVariables(this, itemIndex);
		const query = `query GetPodcastSeries(${SERIES_LOOKUP_VARS}) {
			getPodcastSeries(${SERIES_LOOKUP_ARGS}) { ${selection(fields, SERIES_FIELDS, 'uuid')} }
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		const series = data.getPodcastSeries as IDataObject | null;
		return toItems([series ?? { getPodcastSeries: null }], itemIndex);
	}

	if (operation === 'getEpisodes') {
		const lookup = getLookupVariables(this, itemIndex);
		const searchTerm = (this.getNodeParameter('searchTerm', itemIndex, '') as string).trim();
		let sortOrder = this.getNodeParameter('sortOrder', itemIndex, 'LATEST') as string;
		if (searchTerm) sortOrder = 'SEARCH';
		if (sortOrder === 'SEARCH' && !searchTerm) sortOrder = 'LATEST';
		const includeRemovedEpisodes = getBool(this, itemIndex, 'includeRemovedEpisodes', false);
		const variables = cleanVariables({
			...lookup,
			sortOrder,
			searchTerm: searchTerm || undefined,
			page: this.getNodeParameter('page', itemIndex, 1) as number,
			limitPerPage: this.getNodeParameter('limitPerPage', itemIndex, 10) as number,
		});
		variables.includeRemovedEpisodes = includeRemovedEpisodes;
		const query = `query GetPodcastSeriesEpisodes(${SERIES_LOOKUP_VARS}, $sortOrder: SortOrder, $searchTerm: String, $page: Int, $limitPerPage: Int, $includeRemovedEpisodes: Boolean) {
			getPodcastSeries(${SERIES_LOOKUP_ARGS}) {
				uuid name totalEpisodesCount(includeRemovedEpisodes: $includeRemovedEpisodes)
				episodes(sortOrder: $sortOrder, searchTerm: $searchTerm, page: $page, limitPerPage: $limitPerPage, includeRemovedEpisodes: $includeRemovedEpisodes) {
					${selection(fields, EPISODE_FIELDS, 'uuid')}
				}
			}
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		const series = data.getPodcastSeries as IDataObject | null;
		if (!getBool(this, itemIndex, 'splitIntoItems', true)) {
			return toItems([series ?? { getPodcastSeries: null }], itemIndex);
		}
		return toItems(asArray(series?.episodes), itemIndex);
	}

	if (operation === 'getItunesInfo') {
		const variables = getLookupVariables(this, itemIndex);
		const query = `query GetItunesInfo($uuid: ID, $itunesId: Float) {
			getItunesInfo(uuid: $uuid, itunesId: $itunesId) { ${selection(fields, ITUNES_FIELDS, 'uuid')} }
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		const info = data.getItunesInfo as IDataObject | null;
		return toItems([info ?? { getItunesInfo: null }], itemIndex);
	}

	if (operation === 'getLatestEpisodes') {
		const uuids = getListParam(this, itemIndex, 'uuids', { label: 'podcast UUID' });
		const rssUrls = getListParam(this, itemIndex, 'rssUrls', { label: 'RSS URL' });
		if (uuids.length + rssUrls.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Enter at least one podcast UUID or RSS URL', {
				itemIndex,
			});
		}
		if (uuids.length + rssUrls.length > 1000) {
			throw new NodeOperationError(
				this.getNode(),
				`At most 1000 podcasts can be sent per request (got ${uuids.length + rssUrls.length})`,
				{ itemIndex },
			);
		}
		const variables = cleanVariables({
			uuids,
			rssUrls,
			page: this.getNodeParameter('page', itemIndex, 1) as number,
			limitPerPage: this.getNodeParameter('limitPerPage', itemIndex, 25) as number,
		});
		const query = `query GetLatestPodcastEpisodes($uuids: [ID], $rssUrls: [String], $page: Int, $limitPerPage: Int) {
			getLatestPodcastEpisodes(uuids: $uuids, rssUrls: $rssUrls, page: $page, limitPerPage: $limitPerPage) {
				${selection(fields, EPISODE_FIELDS, 'uuid')}
			}
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		if (!getBool(this, itemIndex, 'splitIntoItems', true)) return toItems([data], itemIndex);
		return toItems(asArray(data.getLatestPodcastEpisodes), itemIndex);
	}

	if (operation === 'getMany') {
		const uuids = getListParam(this, itemIndex, 'uuids', {
			label: 'podcast UUID',
			max: 25,
			required: true,
		});
		const query = `query GetMultiplePodcastSeries($uuids: [ID]) {
			getMultiplePodcastSeries(uuids: $uuids) { ${selection(fields, SERIES_FIELDS, 'uuid')} }
		}`;
		const data = await taddyApiRequest.call(this, query, { uuids }, { itemIndex });
		if (!getBool(this, itemIndex, 'splitIntoItems', true)) return toItems([data], itemIndex);
		return toItems(asArray(data.getMultiplePodcastSeries), itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unknown podcast operation "${operation}"`, {
		itemIndex,
	});
}
