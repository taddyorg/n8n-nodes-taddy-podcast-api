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
import { EPISODE_FIELDS, SERIES_FIELDS, selection } from '../shared/fragments';
import { getBool, getOption } from '../shared/params';
import { taddyApiRequest } from '../shared/transport';
import { asArray, cleanVariables, toItems } from '../shared/utils';

const RESOURCE = 'chart';
const showGetPopular = { resource: [RESOURCE], operation: ['getPopular'] };
const showGetTopByCountry = { resource: [RESOURCE], operation: ['getTopByCountry'] };
const showGetTopByGenres = { resource: [RESOURCE], operation: ['getTopByGenres'] };
const showTopCharts = { resource: [RESOURCE], operation: ['getTopByCountry', 'getTopByGenres'] };

const CHART_PAGE_NOTE = 'Charts update daily around 9am Pacific Time';

const taddyTypeProperty: INodeProperties = {
	displayName: 'Chart Type',
	name: 'taddyType',
	type: 'options',
	options: [
		{ name: 'Episodes', value: 'PODCASTEPISODE' },
		{ name: 'Podcasts', value: 'PODCASTSERIES' },
	],
	default: 'PODCASTSERIES',
	displayOptions: { show: showTopCharts },
	description: 'Whether to return the podcasts chart or the episodes chart',
};

export const chartDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get Popular Podcasts',
				value: 'getPopular',
				action: 'Get the most popular podcasts',
				description:
					"Taddy's all-time popularity ranking of podcasts (not Apple's daily charts), optionally by genre and language",
			},
			{
				name: 'Get Top Charts by Country',
				value: 'getTopByCountry',
				action: 'Get top charts by country',
				description: "Today's Apple Podcasts top charts for one country, for podcasts or episodes",
			},
			{
				name: 'Get Top Charts by Genres',
				value: 'getTopByGenres',
				action: 'Get top charts by genres',
				description:
					"Today's Apple Podcasts top charts for one or more genres. Podcasts are charted worldwide; episode charts need a country.",
			},
		],
		default: 'getTopByCountry',
	},

	// Get Popular Podcasts
	{
		displayName: 'Genres',
		name: 'filterByGenres',
		type: 'multiOptions',
		options: GENRE_OPTIONS,
		default: [],
		displayOptions: { show: showGetPopular },
		description:
			'Only podcasts in these genres. Genre filters are exact matches and never include sub-genres.',
	},
	{
		displayName: 'Language',
		name: 'filterByLanguage',
		type: 'options',
		options: [{ name: 'Any Language', value: '' }, ...LANGUAGE_OPTIONS],
		default: '',
		displayOptions: { show: showGetPopular },
		description: 'Only podcasts in this language',
	},
	pageProperty(showGetPopular, 8),
	limitPerPageProperty(showGetPopular, { default: 10, maxValue: 25 }),
	splitIntoItemsProperty(showGetPopular, 'podcast'),
	optionsCollection(showGetPopular, [customFieldsOption('podcast', 'uuid')]),

	// Get Top Charts by Country
	{
		displayName: 'Country',
		name: 'country',
		type: 'options',
		options: COUNTRY_OPTIONS,
		default: 'UNITED_STATES_OF_AMERICA',
		required: true,
		displayOptions: { show: showGetTopByCountry },
		description: 'The Apple Podcasts storefront to read the chart from',
	},

	// Get Top Charts by Genres
	{
		displayName: 'Genres',
		name: 'genres',
		type: 'multiOptions',
		options: GENRE_OPTIONS,
		default: [],
		required: true,
		displayOptions: { show: showGetTopByGenres },
		description: 'One or more genres to read charts for',
	},
	{
		displayName: 'Country',
		name: 'filterByCountry',
		type: 'options',
		options: COUNTRY_OPTIONS,
		default: 'UNITED_STATES_OF_AMERICA',
		required: true,
		displayOptions: { show: { ...showGetTopByGenres, taddyType: ['PODCASTEPISODE'] } },
		description:
			'Required for episode charts. Podcast charts by genre are worldwide and ignore the country.',
	},

	// Shared by both top-charts operations
	taddyTypeProperty,
	pageProperty(showTopCharts, 8, CHART_PAGE_NOTE),
	limitPerPageProperty(showTopCharts, { default: 10, maxValue: 25 }),
	splitIntoItemsProperty(showTopCharts, 'podcast or episode'),
	optionsCollection(showTopCharts, [
		customFieldsOption('episode', 'uuid', 'episodeFields', 'Episode Fields'),
		customFieldsOption('podcast', 'uuid', 'podcastFields', 'Podcast Fields'),
	]),
];

function splitTopCharts(
	ctx: IExecuteFunctions,
	itemIndex: number,
	result: IDataObject,
	rankIdKey: string,
): INodeExecutionData[] {
	if (!getBool(ctx, itemIndex, 'splitIntoItems', true)) return toItems([result], itemIndex);
	const rankId = result[rankIdKey];
	const series = asArray(result.podcastSeries).map((entry, index) => ({
		taddyType: 'PODCASTSERIES',
		[rankIdKey]: rankId,
		position: index + 1,
		...entry,
	}));
	const episodes = asArray(result.podcastEpisodes).map((entry, index) => ({
		taddyType: 'PODCASTEPISODE',
		[rankIdKey]: rankId,
		position: index + 1,
		...entry,
	}));
	return toItems([...series, ...episodes], itemIndex);
}

export async function executeChart(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	const page = this.getNodeParameter('page', itemIndex, 1) as number;
	const limitPerPage = this.getNodeParameter('limitPerPage', itemIndex, 10) as number;

	if (operation === 'getPopular') {
		const fields = getOption<string>(this, itemIndex, 'customFields', '');
		const variables = cleanVariables({
			filterByGenres: this.getNodeParameter('filterByGenres', itemIndex, []) as string[],
			filterByLanguage: this.getNodeParameter('filterByLanguage', itemIndex, '') as string,
			page,
			limitPerPage,
		});
		const query = `query GetPopularPodcasts($filterByGenres: [Genre!], $filterByLanguage: Language, $page: Int, $limitPerPage: Int) {
			getPopularContent(taddyType: PODCASTSERIES, filterByGenres: $filterByGenres, filterByLanguage: $filterByLanguage, page: $page, limitPerPage: $limitPerPage) {
				popularityRankId
				podcastSeries { ${selection(fields, SERIES_FIELDS, 'uuid')} }
			}
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		const result = (data.getPopularContent as IDataObject | null) ?? {};
		return splitTopCharts(this, itemIndex, result, 'popularityRankId');
	}

	const podcastFields = getOption<string>(this, itemIndex, 'podcastFields', '');
	const episodeFields = getOption<string>(this, itemIndex, 'episodeFields', '');
	const taddyType = this.getNodeParameter('taddyType', itemIndex, 'PODCASTSERIES') as string;
	const resultSelection = `podcastSeries { ${selection(podcastFields, SERIES_FIELDS, 'uuid')} }
		podcastEpisodes { ${selection(episodeFields, EPISODE_FIELDS, 'uuid')} }`;

	if (operation === 'getTopByCountry') {
		const country = this.getNodeParameter('country', itemIndex) as string;
		const query = `query GetTopChartsByCountry($country: Country!, $taddyType: TaddyType!, $page: Int, $limitPerPage: Int) {
			getTopChartsByCountry(country: $country, taddyType: $taddyType, page: $page, limitPerPage: $limitPerPage) {
				topChartsId
				${resultSelection}
			}
		}`;
		const data = await taddyApiRequest.call(
			this,
			query,
			{ country, taddyType, page, limitPerPage },
			{ itemIndex },
		);
		const result = (data.getTopChartsByCountry as IDataObject | null) ?? {};
		return splitTopCharts(this, itemIndex, result, 'topChartsId');
	}

	if (operation === 'getTopByGenres') {
		const genres = this.getNodeParameter('genres', itemIndex, []) as string[];
		if (genres.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Select at least one genre', { itemIndex });
		}
		const variables: IDataObject = { genres, taddyType, page, limitPerPage };
		if (taddyType === 'PODCASTEPISODE') {
			const filterByCountry = this.getNodeParameter('filterByCountry', itemIndex, '') as string;
			if (!filterByCountry) {
				throw new NodeOperationError(this.getNode(), 'Episode charts by genre require a country', {
					itemIndex,
				});
			}
			variables.filterByCountry = filterByCountry;
		}
		const query = `query GetTopChartsByGenres($genres: [Genre!], $taddyType: TaddyType!, $filterByCountry: Country, $page: Int, $limitPerPage: Int) {
			getTopChartsByGenres(genres: $genres, taddyType: $taddyType, filterByCountry: $filterByCountry, page: $page, limitPerPage: $limitPerPage) {
				topChartsId
				${resultSelection}
			}
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		const result = (data.getTopChartsByGenres as IDataObject | null) ?? {};
		return splitTopCharts(this, itemIndex, result, 'topChartsId');
	}

	throw new NodeOperationError(this.getNode(), `Unknown chart operation "${operation}"`, {
		itemIndex,
	});
}
