#!/usr/bin/env node
// Dev-only: runs every operation of the compiled nodes against a mocked transport that captures the
// GraphQL document and variables, then validates both against the published Taddy schema.
// Usage: node scripts/validate-queries.js [path/to/schema.graphql]   (run `npm run build` first)
const fs = require('fs');
const path = require('path');
const { buildSchema, parse, validate } = require('graphql');
const { getVariableValues } = require('graphql/execution/values');
const { TaddyPodcastApi } = require(
	path.join(__dirname, '../dist/nodes/TaddyPodcastApi/TaddyPodcastApi.node.js'),
);
const { TaddyPodcastApiTrigger } = require(
	path.join(__dirname, '../dist/nodes/TaddyPodcastApi/TaddyPodcastApiTrigger.node.js'),
);

const schemaPath =
	process.argv[2] ||
	path.join(__dirname, '../../taddy-api-skills/skills/taddy-podcast-api/references/schema.graphql');
const schema = buildSchema(fs.readFileSync(schemaPath, 'utf8'));

const captured = [];
function fakeResponse(query) {
	// Minimal data so handlers can continue after the call.
	const data = {};
	for (const m of query.matchAll(
		/\b(get\w+|search|add\w+|update\w+|delete\w+|mock\w+|replay\w+)\s*(\(|\{)/g,
	)) {
		const field = m[1];
		if (/^(getMultiple|getLatest|getEpisode)/.test(field)) data[field] = [];
		else if (field === 'getApiRequestsRemaining' || field === 'getTranscriptCreditsRemaining')
			data[field] = 1;
		else if (/^(delete|mock|replay)/.test(field))
			data[field] = field === 'mockWebhookEvent' ? true : '1';
		else
			data[field] = {
				uuid: 'u',
				id: '1',
				webhookSecret: 's',
				episodes: [],
				webhooks: [],
				podcastSeries: [],
				podcastEpisodes: [],
			};
	}
	return { body: { data }, statusCode: 200, headers: {} };
}
function ctx(params, hookStyle = false) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: hookStyle
			? (name, fallback) => (name in params ? params[name] : fallback)
			: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({
			name: 'Taddy',
			type: 'taddyPodcastApi',
			typeVersion: 1,
			id: 't',
			position: [0, 0],
			parameters: {},
		}),
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc',
		getWorkflowStaticData: () => ({}),
		continueOnFail: () => false,
		logger: { warn() {} },
		helpers: {
			async httpRequestWithAuthentication(_c, options) {
				captured.push({ query: options.body.query, variables: options.body.variables });
				return fakeResponse(options.body.query);
			},
		},
	};
}

const node = new TaddyPodcastApi();
const trigger = new TaddyPodcastApiTrigger();
let fails = 0;
async function op(title, params, runner) {
	const before = captured.length;
	try {
		await runner();
	} catch (error) {
		fails += 1;
		console.log(`FAIL  ${title}: handler threw: ${error.message}`);
		return;
	}
	const docs = captured.slice(before);
	if (docs.length === 0) {
		fails += 1;
		console.log(`FAIL  ${title}: no request captured`);
		return;
	}
	for (const { query, variables } of docs) {
		let doc;
		try {
			doc = parse(query);
		} catch (e) {
			fails += 1;
			console.log(`FAIL  ${title}: parse error ${e.message}`);
			continue;
		}
		const errors = validate(schema, doc);
		const varDefs = doc.definitions[0].variableDefinitions || [];
		const coerced = getVariableValues(schema, varDefs, variables || {});
		const varErrors = coerced.errors || [];
		if (errors.length || varErrors.length) {
			fails += 1;
			console.log(`FAIL  ${title}`);
			for (const e of [...errors, ...varErrors]) console.log('       -', e.message);
		} else {
			console.log(`PASS  ${title}  vars=${Object.keys(variables || {}).join(',') || '-'}`);
		}
	}
}
const exec = (params) => () => node.execute.call(ctx(params));

(async () => {
	const O = { options: {} };
	await op(
		'podcast.get (name)',
		0,
		exec({ resource: 'podcast', operation: 'get', lookupBy: 'name', name: 'Hard Fork', ...O }),
	);
	await op(
		'podcast.get (itunesId, custom fields)',
		0,
		exec({
			resource: 'podcast',
			operation: 'get',
			lookupBy: 'itunesId',
			itunesId: 201671138,
			options: {
				customFields: 'name persons { uuid name role } description(shouldStripHtmlTags: true)',
			},
		}),
	);
	await op(
		'podcast.getEpisodes (search term)',
		0,
		exec({
			resource: 'podcast',
			operation: 'getEpisodes',
			lookupBy: 'rssUrl',
			rssUrl: 'https://x/rss',
			sortOrder: 'LATEST',
			searchTerm: 'Costco',
			page: 2,
			limitPerPage: 5,
			includeRemovedEpisodes: true,
			splitIntoItems: true,
			...O,
		}),
	);
	await op(
		'podcast.getMany',
		0,
		exec({ resource: 'podcast', operation: 'getMany', uuids: 'a, b', splitIntoItems: true, ...O }),
	);
	await op(
		'podcast.getLatestEpisodes',
		0,
		exec({
			resource: 'podcast',
			operation: 'getLatestEpisodes',
			uuids: ['a'],
			rssUrls: 'https://x/rss',
			page: 1,
			limitPerPage: 25,
			splitIntoItems: true,
			...O,
		}),
	);
	await op(
		'podcast.getItunesInfo',
		0,
		exec({ resource: 'podcast', operation: 'getItunesInfo', lookupBy: 'uuid', uuid: 'u', ...O }),
	);
	await op(
		'episode.get (guid + series)',
		0,
		exec({
			resource: 'episode',
			operation: 'get',
			lookupBy: 'guid',
			guid: 'g',
			seriesUuidForLookup: 's',
			...O,
		}),
	);
	await op(
		'episode.getMany',
		0,
		exec({ resource: 'episode', operation: 'getMany', uuids: 'a,b,c', splitIntoItems: true, ...O }),
	);
	await op(
		'episode.getTranscript',
		0,
		exec({
			resource: 'episode',
			operation: 'getTranscript',
			uuid: 'e',
			style: 'UTTERANCE',
			useOnDemandCreditsIfNeeded: true,
			useOnlyPodcastProvidedTranscript: false,
			output: 'single',
			...O,
		}),
	);
	await op(
		'episode.getChapters',
		0,
		exec({ resource: 'episode', operation: 'getChapters', uuid: 'e', splitIntoItems: true, ...O }),
	);
	await op(
		'search (all filters)',
		0,
		exec({
			resource: 'search',
			operation: 'search',
			term: 'ai -crypto',
			filterForTypes: ['PODCASTSERIES', 'PODCASTEPISODE'],
			sortBy: 'POPULARITY',
			matchBy: 'ALL_TERMS',
			isSafeMode: true,
			page: 1,
			limitPerPage: 25,
			splitIntoItems: true,
			filters: {
				filterForGenres: ['PODCASTSERIES_TECHNOLOGY'],
				filterForLanguages: ['ENGLISH'],
				filterForCountries: ['CANADA'],
				filterForSeriesUuids: 'a,b',
				filterForNotInSeriesUuids: ['c'],
				filterForPodcastContentType: ['AUDIO'],
				filterForPublishedAfter: '2026-10-01T00:00:00.000Z',
				filterForPublishedBefore: '2026-10-21T00:00:00.000Z',
				filterForLastUpdatedAfter: '2026-01-01',
				filterForLastUpdatedBefore: '2026-12-31',
				filterForTotalEpisodesGreaterThan: 10,
				filterForTotalEpisodesLessThan: 1000,
				filterForDurationGreaterThan: 3600,
				filterForDurationLessThan: 7200,
				filterForHasTranscript: true,
			},
			options: { podcastFields: 'name', episodeFields: 'name duration' },
		}),
	);
	await op(
		'search (filters only)',
		0,
		exec({
			resource: 'search',
			operation: 'search',
			term: '',
			filterForTypes: ['PODCASTEPISODE'],
			sortBy: 'EXACTNESS',
			matchBy: 'MOST_TERMS',
			isSafeMode: false,
			page: 1,
			limitPerPage: 10,
			splitIntoItems: true,
			filters: { filterForGenres: ['PODCASTSERIES_NEWS_TECH'] },
			...O,
		}),
	);
	await op(
		'chart.getPopular',
		0,
		exec({
			resource: 'chart',
			operation: 'getPopular',
			filterByGenres: ['PODCASTSERIES_TRUE_CRIME'],
			filterByLanguage: 'ENGLISH',
			page: 1,
			limitPerPage: 10,
			splitIntoItems: true,
			...O,
		}),
	);
	await op(
		'chart.getTopByCountry',
		0,
		exec({
			resource: 'chart',
			operation: 'getTopByCountry',
			country: 'CANADA',
			taddyType: 'PODCASTEPISODE',
			page: 1,
			limitPerPage: 10,
			splitIntoItems: true,
			...O,
		}),
	);
	await op(
		'chart.getTopByGenres (episodes + country)',
		0,
		exec({
			resource: 'chart',
			operation: 'getTopByGenres',
			genres: ['PODCASTSERIES_COMEDY'],
			taddyType: 'PODCASTEPISODE',
			filterByCountry: 'UNITED_STATES_OF_AMERICA',
			page: 1,
			limitPerPage: 10,
			splitIntoItems: true,
			...O,
		}),
	);
	await op(
		'chart.getTopByGenres (podcasts)',
		0,
		exec({
			resource: 'chart',
			operation: 'getTopByGenres',
			genres: ['PODCASTSERIES_COMEDY'],
			taddyType: 'PODCASTSERIES',
			page: 1,
			limitPerPage: 10,
			splitIntoItems: true,
			...O,
		}),
	);
	await op('account.getUsage', 0, exec({ resource: 'account', operation: 'getUsage' }));
	await op(
		'graphql.execute',
		0,
		exec({
			resource: 'graphql',
			operation: 'execute',
			query: 'query ($n: String) { getPodcastSeries(name: $n) { uuid } }',
			variables: '{"n":"x"}',
		}),
	);
	const W = { webhookId: 'w1', filterUuid: 'f1', ...O };
	await op(
		'webhook.getMany',
		0,
		exec({ resource: 'webhook', operation: 'getMany', splitIntoItems: true, ...O }),
	);
	await op(
		'webhook.create',
		0,
		exec({
			resource: 'webhook',
			operation: 'create',
			endpointUrl: 'https://x/hook',
			webhookEvents: ['podcastepisode.created'],
			...O,
		}),
	);
	await op(
		'webhook.update',
		0,
		exec({
			resource: 'webhook',
			operation: 'update',
			endpointUrl: 'https://x/hook',
			webhookEvents: ['podcastepisode.created', 'podcastseries.updated'],
			...W,
		}),
	);
	await op('webhook.delete', 0, exec({ resource: 'webhook', operation: 'delete', ...W }));
	await op('webhook.getFilter', 0, exec({ resource: 'webhook', operation: 'getFilter', ...W }));
	await op(
		'webhook.createFilter',
		0,
		exec({
			resource: 'webhook',
			operation: 'createFilter',
			eventType: 'podcastepisode.created',
			description: 'd',
			clauses: {
				clause: [
					{ field: 'name', value: 'shopify' },
					{ field: 'podcastSeries.genres', value: 'TECH' },
				],
			},
			includedUuids: 'a,b',
			excludedUuids: '',
			...W,
		}),
	);
	await op(
		'webhook.updateFilter',
		0,
		exec({
			resource: 'webhook',
			operation: 'updateFilter',
			eventType: 'podcastseries.feed_updated',
			description: '',
			clauses: {},
			includedUuids: '',
			excludedUuids: 'c',
			...W,
		}),
	);
	await op(
		'webhook.deleteFilter',
		0,
		exec({ resource: 'webhook', operation: 'deleteFilter', ...W }),
	);
	for (const o of [
		'addToAllowlist',
		'removeFromAllowlist',
		'addToBlocklist',
		'removeFromBlocklist',
	]) {
		await op(
			`webhook.${o}`,
			0,
			exec({ resource: 'webhook', operation: o, contentUuid: 'p', ...W }),
		);
	}
	await op(
		'webhook.sendMockEvent',
		0,
		exec({
			resource: 'webhook',
			operation: 'sendMockEvent',
			taddyType: 'podcastseries',
			eventAction: 'new_episodes_released',
			contentUuid: 'p',
			...W,
		}),
	);
	await op(
		'webhook.replayFailedEvents',
		0,
		exec({ resource: 'webhook', operation: 'replayFailedEvents', ...W }),
	);

	// Trigger lifecycle mutations
	const hook = ctx(
		{
			events: ['podcastepisode.created', 'podcastseries.new_episodes_released'],
			options: { onlyPodcasts: 'a, b' },
		},
		true,
	);
	await op('trigger.create (+ filters)', 0, () => trigger.webhookMethods.default.create.call(hook));
	const hookDel = ctx({}, true);
	hookDel.getWorkflowStaticData = () => ({ webhookId: '1', webhookSecret: 's' });
	await op('trigger.delete', 0, () => trigger.webhookMethods.default.delete.call(hookDel));
	await op('trigger.checkExists', 0, () =>
		trigger.webhookMethods.default.checkExists.call(hookDel),
	);

	console.log(
		`\n${fails ? fails + ' FAILED' : 'ALL PASSED'} · ${captured.length} GraphQL documents validated against ${path.basename(schemaPath)}`,
	);
	process.exit(fails ? 1 : 0);
})();
