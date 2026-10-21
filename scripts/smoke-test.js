#!/usr/bin/env node
// Dev-only smoke test. Drives the compiled action node through a minimal mock of n8n's
// IExecuteFunctions whose HTTP helper performs real requests against api.taddy.org.
// Usage: TADDY_USER_ID=... TADDY_API_KEY=... node scripts/smoke-test.js   (run `npm run build` first)
// Optional: TADDY_API_URL=http://localhost:4000/api/graphql to hit a local Taddy API instead of production.
const path = require('path');
const { TaddyPodcastApi } = require(
	path.join(__dirname, '../dist/nodes/TaddyPodcastApi/TaddyPodcastApi.node.js'),
);

const creds = { userId: process.env.TADDY_USER_ID, apiKey: process.env.TADDY_API_KEY };
if (!creds.userId || !creds.apiKey) {
	console.error('Set TADDY_USER_ID and TADDY_API_KEY');
	process.exit(1);
}

let requestCount = 0;
let makeContext = function (params, overrideCreds = creds) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({
			name: 'Taddy Podcast API',
			type: 'taddyPodcastApi',
			typeVersion: 1,
			id: 'test',
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => false,
		helpers: {
			async httpRequestWithAuthentication(_credName, options) {
				requestCount += 1;
				const res = await fetch(process.env.TADDY_API_URL || options.url, {
					method: options.method,
					headers: {
						...options.headers,
						'X-USER-ID': overrideCreds.userId,
						'X-API-KEY': overrideCreds.apiKey,
					},
					body: JSON.stringify(options.body),
					signal: AbortSignal.timeout(options.timeout ?? 30000),
				});
				const text = await res.text();
				let body;
				try {
					body = JSON.parse(text);
				} catch {
					body = text;
				}
				return options.returnFullResponse
					? { body, statusCode: res.status, statusMessage: res.statusText, headers: {} }
					: body;
			},
		},
	};
};

const node = new TaddyPodcastApi();
let failures = 0;
async function run(title, params, check, overrideCreds) {
	const before = requestCount;
	try {
		const [items] = await node.execute.call(makeContext(params, overrideCreds));
		const result = check({ items, error: null });
		console.log(
			`${result ? 'PASS' : 'FAIL'}  ${title}  (${requestCount - before} req, ${items.length} items)`,
		);
		if (!result) {
			failures += 1;
			console.log('      ', JSON.stringify(items.slice(0, 2)).slice(0, 400));
		}
	} catch (error) {
		const result = check({ items: null, error });
		console.log(
			`${result ? 'PASS' : 'FAIL'}  ${title}  (${requestCount - before} req, error: ${error.message.slice(0, 120)}${error.description ? ' | ' + String(error.description).slice(0, 80) : ''})`,
		);
		if (!result) failures += 1;
	}
}

(async () => {
	const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
	let seriesUuid;
	let transcriptEpisodeUuid;

	await run(
		'Account > Get Usage',
		{ resource: 'account', operation: 'getUsage' },
		({ items }) => items && typeof items[0].json.apiRequestsRemaining === 'number',
	);

	await run(
		'Podcast > Get by name',
		{
			resource: 'podcast',
			operation: 'get',
			lookupBy: 'name',
			name: 'This American Life',
			options: {},
		},
		({ items }) => {
			if (!items || !items[0].json.uuid) return false;
			seriesUuid = items[0].json.uuid;
			return (
				typeof items[0].json.itunesInfo?.publisherName === 'string' &&
				items[0].pairedItem.item === 0
			);
		},
	);

	await run(
		'Podcast > Get, Custom Fields persons',
		{
			resource: 'podcast',
			operation: 'get',
			lookupBy: 'name',
			name: 'This American Life',
			options: { customFields: 'name persons { uuid name role }' },
		},
		({ items }) =>
			items && items[0].json.uuid && 'name' in items[0].json && !('rssUrl' in items[0].json),
	);

	await run(
		'Podcast > Get, unknown uuid -> null item',
		{
			resource: 'podcast',
			operation: 'get',
			lookupBy: 'uuid',
			uuid: '00000000-0000-0000-0000-000000000000',
			options: {},
		},
		({ items }) => items && items.length === 1 && items[0].json.getPodcastSeries === null,
	);

	await run(
		'Podcast > Get Episodes (limit 1)',
		{
			resource: 'podcast',
			operation: 'getEpisodes',
			lookupBy: 'uuid',
			uuid: () => seriesUuid,
			sortOrder: 'LATEST',
			searchTerm: '',
			page: 1,
			limitPerPage: 1,
			includeRemovedEpisodes: false,
			splitIntoItems: true,
			options: {},
		},
		({ items }) => items && items.length === 1 && items[0].json.audioUrl,
	);

	await run(
		'Podcast > Get Many, 26 uuids -> validation error, no request',
		{
			resource: 'podcast',
			operation: 'getMany',
			uuids: Array.from({ length: 26 }, (_, i) => `u${i}`).join(','),
			splitIntoItems: true,
			options: {},
		},
		({ error }) => error && /At most 25/.test(error.message) && requestCount === lastCount,
	);

	await run(
		'Search > episodes about Shopify, last 7 days',
		{
			resource: 'search',
			operation: 'search',
			term: '  Shopify  ',
			filterForTypes: ['PODCASTEPISODE'],
			sortBy: 'EXACTNESS',
			matchBy: 'MOST_TERMS',
			isSafeMode: false,
			page: 1,
			limitPerPage: 5,
			filters: { filterForPublishedAfter: weekAgo, filterForHasTranscript: true },
			splitIntoItems: true,
			options: {},
		},
		({ items }) => {
			if (!items || items.length === 0) return false;
			transcriptEpisodeUuid = items[0].json.uuid;
			return items.every((it) => it.json.taddyType === 'PODCASTEPISODE' && it.json.searchId);
		},
	);

	await run(
		'Search > raw response (no split)',
		{
			resource: 'search',
			operation: 'search',
			term: 'true crime',
			filterForTypes: ['PODCASTSERIES'],
			sortBy: 'POPULARITY',
			matchBy: 'MOST_TERMS',
			isSafeMode: true,
			page: 1,
			limitPerPage: 3,
			filters: { filterForGenres: ['PODCASTSERIES_TRUE_CRIME'], filterForLanguages: ['ENGLISH'] },
			splitIntoItems: false,
			options: {},
		},
		({ items }) =>
			items &&
			items.length === 1 &&
			Array.isArray(items[0].json.responseDetails) &&
			items[0].json.podcastSeries.length === 3,
	);

	await run(
		'Search > 9-word term -> validation error',
		{
			resource: 'search',
			operation: 'search',
			term: 'a b c d e f g h i',
			filterForTypes: [],
			sortBy: 'EXACTNESS',
			matchBy: 'MOST_TERMS',
			isSafeMode: false,
			page: 1,
			limitPerPage: 5,
			filters: {},
			splitIntoItems: true,
			options: {},
		},
		({ error }) => error && /8 words/.test(error.message),
	);

	await run(
		'Chart > Top Charts by Country CANADA (5)',
		{
			resource: 'chart',
			operation: 'getTopByCountry',
			country: 'CANADA',
			taddyType: 'PODCASTSERIES',
			page: 1,
			limitPerPage: 5,
			splitIntoItems: true,
			options: {},
		},
		({ items }) =>
			items && items.length === 5 && items[0].json.position === 1 && items[0].json.topChartsId,
	);

	await run(
		'Chart > Top Charts by Genres, episodes without country -> error',
		{
			resource: 'chart',
			operation: 'getTopByGenres',
			genres: ['PODCASTSERIES_TRUE_CRIME'],
			taddyType: 'PODCASTEPISODE',
			filterByCountry: '',
			page: 1,
			limitPerPage: 5,
			splitIntoItems: true,
			options: {},
		},
		({ error }) => error && /require a country/.test(error.message),
	);

	await run(
		'Chart > Popular, genre + language',
		{
			resource: 'chart',
			operation: 'getPopular',
			filterByGenres: ['PODCASTSERIES_TECHNOLOGY'],
			filterByLanguage: 'ENGLISH',
			page: 1,
			limitPerPage: 3,
			splitIntoItems: true,
			options: {},
		},
		({ items }) => items && items.length === 3 && items[0].json.popularityRankId,
	);

	await run(
		'Episode > Get Transcript (podcast-provided only, single item)',
		{
			resource: 'episode',
			operation: 'getTranscript',
			uuid: () => transcriptEpisodeUuid,
			style: 'PARAGRAPH',
			useOnDemandCreditsIfNeeded: true,
			useOnlyPodcastProvidedTranscript: true,
			output: 'single',
			options: {},
		},
		({ items }) =>
			items &&
			items.length === 1 &&
			Array.isArray(items[0].json.transcript) &&
			typeof items[0].json.text === 'string' &&
			items[0].json.text.length > 0,
	);

	await run(
		'Episode > Get Chapters',
		{
			resource: 'episode',
			operation: 'getChapters',
			uuid: () => transcriptEpisodeUuid,
			splitIntoItems: true,
			options: {},
		},
		({ items }) => items && items.length >= 1,
	);

	await run(
		'GraphQL > Execute Query',
		{
			resource: 'graphql',
			operation: 'execute',
			query: 'query ($name: String) { getPodcastSeries(name: $name) { uuid name } }',
			variables: '{"name":"Hard Fork"}',
		},
		({ items }) => items && items[0].json.getPodcastSeries?.uuid,
	);

	await run(
		'GraphQL > invalid field -> INVALID_QUERY_OR_SYNTAX with hint',
		{
			resource: 'graphql',
			operation: 'execute',
			query: '{ getPodcastSeries(name: "x") { uuid nope } }',
			variables: '{}',
		},
		({ error }) =>
			error &&
			/INVALID_QUERY_OR_SYNTAX|GRAPHQL_ERROR|BAD_USER_INPUT/.test(error.message) &&
			error.description,
	);

	await run(
		'Bad credentials -> API_KEY_INVALID',
		{ resource: 'account', operation: 'getUsage' },
		({ error }) =>
			error && /API_KEY_INVALID/.test(error.message) && /credential/.test(error.description || ''),
		{ userId: '1', apiKey: 'nope' },
	);

	await run(
		'Webhook > Get Many (plan-gated; either list or ACCESS_NOT_ALLOWED)',
		{ resource: 'webhook', operation: 'getMany', splitIntoItems: true, options: {} },
		({ items, error }) =>
			items !== null || (error && /ACCESS_NOT_ALLOWED|REQUIRES/.test(error.message)),
	);

	console.log(
		`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} · ${requestCount} API requests`,
	);
	process.exit(failures ? 1 : 0);
})();

// Lazily resolved params (functions) so later tests can use earlier results.
let lastCount = 0;
const origMake = makeContext;
makeContext = function (params, overrideCreds) {
	lastCount = requestCount;
	const resolved = Object.fromEntries(
		Object.entries(params).map(([k, v]) => [k, typeof v === 'function' ? v() : v]),
	);
	return origMake(resolved, overrideCreds);
};
