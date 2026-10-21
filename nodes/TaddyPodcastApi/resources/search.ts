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
	optionsCollection,
	pageProperty,
	splitIntoItemsProperty,
} from '../shared/descriptions';
import { COUNTRY_OPTIONS, GENRE_OPTIONS, LANGUAGE_OPTIONS } from '../shared/enums';
import {
	EPISODE_FIELDS,
	SEARCH_RESPONSE_DETAILS,
	SERIES_FIELDS,
	selection,
} from '../shared/fragments';
import { getBool, getOption } from '../shared/params';
import { taddyApiRequest } from '../shared/transport';
import { asArray, parseStringList, toEpochSeconds, toItems } from '../shared/utils';

const RESOURCE = 'search';
const show = { resource: [RESOURCE], operation: ['search'] };

export const searchDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Search',
				value: 'search',
				action: 'Search podcasts and episodes',
				description:
					'Full-text search across the whole directory (about 4M podcasts and 200M episodes) with filters. Matches titles, show notes, podcast names and people names, not transcript text.',
			},
		],
		default: 'search',
	},
	{
		displayName: 'Search Term',
		name: 'term',
		type: 'string',
		default: '',
		displayOptions: { show },
		placeholder: 'true crime -murder',
		description:
			'Up to 8 words (200 characters). Prefix a word with - to exclude it. Leave empty to only apply filters, e.g. the newest episodes in a genre',
	},
	{
		displayName: 'Search For',
		name: 'filterForTypes',
		type: 'multiOptions',
		options: [
			{ name: 'Episodes', value: 'PODCASTEPISODE' },
			{ name: 'Podcasts', value: 'PODCASTSERIES' },
		],
		default: ['PODCASTSERIES'],
		displayOptions: { show },
		description: 'Which content types to search',
	},
	{
		displayName: 'Sort By',
		name: 'sortBy',
		type: 'options',
		options: [
			{ name: 'Exactness', value: 'EXACTNESS', description: 'Ranks by match quality' },
			{
				name: 'Popularity',
				value: 'POPULARITY',
				description: 'Only searches the 5% most popular podcasts',
			},
		],
		default: 'EXACTNESS',
		displayOptions: { show },
		description: 'How to rank results',
	},
	{
		displayName: 'Match By',
		name: 'matchBy',
		type: 'options',
		options: [
			{ name: 'All Terms', value: 'ALL_TERMS', description: 'Every word must match' },
			{ name: 'Exact Phrase', value: 'EXACT_PHRASE', description: 'The exact phrase must match' },
			{ name: 'Most Terms', value: 'MOST_TERMS', description: 'Loosest: most words should match' },
		],
		default: 'MOST_TERMS',
		displayOptions: { show },
		description: 'How strictly the search term has to match',
	},
	{
		displayName: 'Safe Mode',
		name: 'isSafeMode',
		type: 'boolean',
		default: false,
		displayOptions: { show },
		description: 'Whether to exclude explicit content',
	},
	pageProperty(show, 20),
	limitPerPageProperty(show, { default: 10, maxValue: 25 }),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Content Type',
				name: 'filterForPodcastContentType',
				type: 'multiOptions',
				options: [
					{ name: 'Audio', value: 'AUDIO' },
					{ name: 'Video', value: 'VIDEO' },
				],
				default: [],
				description: 'Only audio or only video podcasts',
			},
			{
				displayName: 'Countries',
				name: 'filterForCountries',
				type: 'multiOptions',
				options: COUNTRY_OPTIONS,
				default: [],
				description: 'Only content from podcasts based in these countries (up to 25)',
			},
			{
				displayName: 'Duration Greater Than (Seconds)',
				name: 'filterForDurationGreaterThan',
				type: 'number',
				default: 0,
				description: 'Episodes only: minimum episode length in seconds',
			},
			{
				displayName: 'Duration Less Than (Seconds)',
				name: 'filterForDurationLessThan',
				type: 'number',
				default: 0,
				description: 'Episodes only: maximum episode length in seconds',
			},
			{
				displayName: 'Exclude Podcast UUIDs',
				name: 'filterForNotInSeriesUuids',
				type: 'string',
				default: '',
				description: 'Comma-separated Taddy UUIDs of podcasts to exclude (up to 25)',
			},
			{
				displayName: 'Genres',
				name: 'filterForGenres',
				type: 'multiOptions',
				options: GENRE_OPTIONS,
				default: [],
				description:
					'Only content in these genres (up to 25). Genre filters are exact matches and never include sub-genres, so select the parent and its sub-genres to cover a category.',
			},
			{
				displayName: 'Has Transcript',
				name: 'filterForHasTranscript',
				type: 'boolean',
				default: false,
				description: 'Whether to return only episodes that have a transcript (episodes only)',
			},
			{
				displayName: 'Languages',
				name: 'filterForLanguages',
				type: 'multiOptions',
				options: LANGUAGE_OPTIONS,
				default: [],
				description: 'Only content in these languages (up to 25)',
			},
			{
				displayName: 'Last Updated After',
				name: 'filterForLastUpdatedAfter',
				type: 'dateTime',
				default: '',
				description: 'Podcasts only: feed last updated at or after this time',
			},
			{
				displayName: 'Last Updated Before',
				name: 'filterForLastUpdatedBefore',
				type: 'dateTime',
				default: '',
				description: 'Podcasts only: feed last updated before this time',
			},
			{
				displayName: 'Podcast UUIDs',
				name: 'filterForSeriesUuids',
				type: 'string',
				default: '',
				description: 'Comma-separated Taddy UUIDs: only content from these podcasts (up to 25)',
			},
			{
				displayName: 'Published After',
				name: 'filterForPublishedAfter',
				type: 'dateTime',
				default: '',
				description: 'Only content published at or after this time',
			},
			{
				displayName: 'Published Before',
				name: 'filterForPublishedBefore',
				type: 'dateTime',
				default: '',
				description: 'Only content published before this time',
			},
			{
				displayName: 'Total Episodes Greater Than',
				name: 'filterForTotalEpisodesGreaterThan',
				type: 'number',
				default: 0,
				description: 'Podcasts only: minimum number of episodes',
			},
			{
				displayName: 'Total Episodes Less Than',
				name: 'filterForTotalEpisodesLessThan',
				type: 'number',
				default: 0,
				description: 'Podcasts only: maximum number of episodes',
			},
		],
	},
	splitIntoItemsProperty(show, 'podcast or episode'),
	optionsCollection(show, [
		customFieldsOption('episode', 'uuid', 'episodeFields', 'Episode Fields'),
		customFieldsOption('podcast', 'uuid', 'podcastFields', 'Podcast Fields'),
	]),
];

/** GraphQL variable types for every search argument, as in mcp/tools/search.js. */
const VARIABLE_TYPES: Record<string, string> = {
	term: 'String',
	page: 'Int',
	limitPerPage: 'Int',
	filterForTypes: '[SearchContentType]',
	sortBy: 'SearchSortOrder',
	matchBy: 'SearchMatchType',
	isSafeMode: 'Boolean',
	filterForGenres: '[Genre]',
	filterForLanguages: '[Language]',
	filterForCountries: '[Country]',
	filterForSeriesUuids: '[ID]',
	filterForNotInSeriesUuids: '[ID]',
	filterForPodcastContentType: '[PodcastContentType]',
	filterForPublishedAfter: 'Int',
	filterForPublishedBefore: 'Int',
	filterForLastUpdatedAfter: 'Int',
	filterForLastUpdatedBefore: 'Int',
	filterForTotalEpisodesGreaterThan: 'Int',
	filterForTotalEpisodesLessThan: 'Int',
	filterForDurationGreaterThan: 'Int',
	filterForDurationLessThan: 'Int',
	filterForHasTranscript: 'Boolean',
};

const LIST_FILTERS = ['filterForSeriesUuids', 'filterForNotInSeriesUuids'];
const DATE_FILTERS = [
	'filterForPublishedAfter',
	'filterForPublishedBefore',
	'filterForLastUpdatedAfter',
	'filterForLastUpdatedBefore',
];
const NUMBER_FILTERS = [
	'filterForTotalEpisodesGreaterThan',
	'filterForTotalEpisodesLessThan',
	'filterForDurationGreaterThan',
	'filterForDurationLessThan',
];
const MULTI_FILTERS = [
	'filterForGenres',
	'filterForLanguages',
	'filterForCountries',
	'filterForPodcastContentType',
];

export async function executeSearch(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	if (operation !== 'search') {
		throw new NodeOperationError(this.getNode(), `Unknown search operation "${operation}"`, {
			itemIndex,
		});
	}

	const variables: IDataObject = {};

	const term = (this.getNodeParameter('term', itemIndex, '') as string).trim().replace(/\s+/g, ' ');
	if (term) {
		if (term.length > 200) {
			throw new NodeOperationError(this.getNode(), 'Search term can have at most 200 characters', {
				itemIndex,
			});
		}
		if (term.split(' ').length > 8) {
			throw new NodeOperationError(
				this.getNode(),
				'Search term can have at most 8 words (words excluded with a leading - count too)',
				{ itemIndex },
			);
		}
		variables.term = term;
	}

	const filterForTypes = this.getNodeParameter('filterForTypes', itemIndex, []) as string[];
	if (filterForTypes.length) variables.filterForTypes = filterForTypes;
	variables.sortBy = this.getNodeParameter('sortBy', itemIndex, 'EXACTNESS') as string;
	variables.matchBy = this.getNodeParameter('matchBy', itemIndex, 'MOST_TERMS') as string;
	if (getBool(this, itemIndex, 'isSafeMode', false)) variables.isSafeMode = true;
	variables.page = this.getNodeParameter('page', itemIndex, 1) as number;
	variables.limitPerPage = this.getNodeParameter('limitPerPage', itemIndex, 10) as number;

	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	for (const [key, raw] of Object.entries(filters)) {
		if (!(key in VARIABLE_TYPES)) continue;
		if (raw === undefined || raw === null || raw === '') continue;
		if (MULTI_FILTERS.includes(key)) {
			const list = parseStringList(raw);
			if (list.length === 0) continue;
			if (list.length > 25) {
				throw new NodeOperationError(this.getNode(), `${key} accepts at most 25 values`, {
					itemIndex,
				});
			}
			variables[key] = list;
		} else if (LIST_FILTERS.includes(key)) {
			const list = parseStringList(raw);
			if (list.length === 0) continue;
			if (list.length > 25) {
				throw new NodeOperationError(this.getNode(), `${key} accepts at most 25 UUIDs`, {
					itemIndex,
				});
			}
			variables[key] = list;
		} else if (DATE_FILTERS.includes(key)) {
			const seconds = toEpochSeconds(raw);
			if (seconds !== undefined) variables[key] = seconds;
		} else if (NUMBER_FILTERS.includes(key)) {
			const num = Number(raw);
			if (Number.isFinite(num) && num > 0) variables[key] = Math.floor(num);
		} else if (key === 'filterForHasTranscript') {
			if (raw === true) variables[key] = true;
		}
	}

	const podcastFields = getOption<string>(this, itemIndex, 'podcastFields', '');
	const episodeFields = getOption<string>(this, itemIndex, 'episodeFields', '');
	const names = Object.keys(variables);
	const declarations = names.map((name) => `$${name}: ${VARIABLE_TYPES[name]}`).join(', ');
	const bindings = names.map((name) => `${name}: $${name}`).join(', ');
	const query = `query SearchPodcasts(${declarations}) {
		search(${bindings}) {
			searchId
			responseDetails { ${SEARCH_RESPONSE_DETAILS} }
			podcastSeries { ${selection(podcastFields, SERIES_FIELDS, 'uuid')} }
			podcastEpisodes { ${selection(episodeFields, EPISODE_FIELDS, 'uuid')} }
		}
	}`;

	const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
	const result = (data.search as IDataObject | null) ?? {};
	if (!getBool(this, itemIndex, 'splitIntoItems', true)) return toItems([result], itemIndex);

	const searchId = result.searchId;
	const series = asArray(result.podcastSeries).map((entry) => ({
		taddyType: 'PODCASTSERIES',
		searchId,
		...entry,
	}));
	const episodes = asArray(result.podcastEpisodes).map((entry) => ({
		taddyType: 'PODCASTEPISODE',
		searchId,
		...entry,
	}));
	return toItems([...series, ...episodes], itemIndex);
}
