import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	customFieldsOption,
	listProperty,
	optionsCollection,
	splitIntoItemsProperty,
} from '../shared/descriptions';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_OPTIONS } from '../shared/enums';
import { FILTER_FIELDS, NEW_WEBHOOK_FIELDS, WEBHOOK_FIELDS, selection } from '../shared/fragments';
import { getBool, getListParam, getOption } from '../shared/params';
import { taddyApiRequest } from '../shared/transport';
import { asArray, parseStringList, toItems } from '../shared/utils';

const RESOURCE = 'webhook';
const op = (...operations: string[]) => ({ resource: [RESOURCE], operation: operations });

const WEBHOOK_RETURNING = ['create', 'createFilter', 'deleteFilter', 'update', 'updateFilter'];
const FILTER_RETURNING = [
	'addToAllowlist',
	'addToBlocklist',
	'getFilter',
	'removeFromAllowlist',
	'removeFromBlocklist',
];
const NEEDS_WEBHOOK_ID = [
	'addToAllowlist',
	'addToBlocklist',
	'createFilter',
	'delete',
	'deleteFilter',
	'getFilter',
	'removeFromAllowlist',
	'removeFromBlocklist',
	'replayFailedEvents',
	'sendMockEvent',
	'update',
	'updateFilter',
];
const NEEDS_FILTER_UUID = [
	'addToAllowlist',
	'addToBlocklist',
	'deleteFilter',
	'getFilter',
	'removeFromAllowlist',
	'removeFromBlocklist',
	'updateFilter',
];
const LIST_OPERATIONS = [
	'addToAllowlist',
	'addToBlocklist',
	'removeFromAllowlist',
	'removeFromBlocklist',
];
const FILTER_INPUT_OPERATIONS = ['createFilter', 'updateFilter'];

const BUSINESS_NOTE = 'Business plan only';

const FILTER_FIELDS_HELP =
	'Allowed fields for podcast events: uuid, hash, name, description, imageUrl, datePublished, language, seriesType, contentType, isExplicitContent, copyright, websiteUrl, rssUrl, rssOwnerName, rssOwnerPublicEmail, authorName, isCompleted, isBlocked, itunesId, genres, childrenHash, popularityRank, itunesInfo.uuid, itunesInfo.publisherId, itunesInfo.publisherName, itunesInfo.baseArtworkUrl. ' +
	'For episode events: uuid, hash, name, description, imageUrl, datePublished, guid, subtitle, audioUrl, videoUrl, fileLength, fileType, duration, episodeType, seasonNumber, episodeNumber, websiteUrl, isExplicitContent, isRemoved, podcastSeries.uuid, podcastSeries.name, podcastSeries.rssUrl, podcastSeries.itunesId, podcastSeries.language, podcastSeries.genres, podcastSeries.popularityRank. ' +
	'For iTunes info events: uuid, hash, subtitle, summary, baseArtworkUrl, publisherId, publisherName, country, and the same podcastSeries.* fields';

const FIELD_HELP = `Payload field to match. ${FILTER_FIELDS_HELP}.`;

const REGEX_HELP =
	'Regular expression the field must match: case-insensitive, unanchored ("apple" matches "pineapple"), max 500 characters. An array field matches if any entry matches; description is matched as raw HTML; null, empty, false and 0 never match. Not allowed: any *, {0,}, a quantifier after a group such as )+, and two .+ in one pattern. Use bounded repeats like .{0,50} instead';

export const webhookDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Add to Allowlist',
				value: 'addToAllowlist',
				action: 'Add a podcast to a webhook filter allowlist',
				description: `${BUSINESS_NOTE}: once the allowlist is non-empty, only events for allowlisted podcasts pass the filter`,
			},
			{
				name: 'Add to Blocklist',
				value: 'addToBlocklist',
				action: 'Add a podcast to a webhook filter blocklist',
				description: `${BUSINESS_NOTE}: events for blocklisted podcasts never pass the filter`,
			},
			{
				name: 'Create',
				value: 'create',
				action: 'Create a webhook',
				description:
					',: register a public HTTPS endpoint that receives POSTed events. The response includes the webhook secret sent in the X-TADDY-WEBHOOK-SECRET header of every delivery.',
			},
			{
				name: 'Create Filter',
				value: 'createFilter',
				action: 'Create a webhook filter',
				description:
					",: add a filter so the webhook only receives matching events. A filter's clauses are ANDed; separate filters are ORed.",
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a webhook',
				description: `${BUSINESS_NOTE}: permanently delete a webhook and all of its filters`,
			},
			{
				name: 'Delete Filter',
				value: 'deleteFilter',
				action: 'Delete a webhook filter',
				description:
					',: remove one filter. If it was the last filter for its event type, every event of that type is delivered again.',
			},
			{
				name: 'Get Filter',
				value: 'getFilter',
				action: 'Get a webhook filter',
				description: `${BUSINESS_NOTE}: one filter on a webhook, including its clauses and allow/block lists`,
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many webhooks',
				description: `${BUSINESS_NOTE}: all webhooks registered for the account, with their events, verification status and filters`,
			},
			{
				name: 'Remove From Allowlist',
				value: 'removeFromAllowlist',
				action: 'Remove a podcast from a webhook filter allowlist',
				description: `${BUSINESS_NOTE}: remove a podcast from a filter's allowlist`,
			},
			{
				name: 'Remove From Blocklist',
				value: 'removeFromBlocklist',
				action: 'Remove a podcast from a webhook filter blocklist',
				description: `${BUSINESS_NOTE}: remove a podcast from a filter's blocklist`,
			},
			{
				name: 'Replay Failed Events',
				value: 'replayFailedEvents',
				action: 'Replay failed webhook events',
				description:
					',: redeliver every event that failed in the last 14 days. Returns how many events were queued, not how many were delivered.',
			},
			{
				name: 'Send Mock Event',
				value: 'sendMockEvent',
				action: 'Send a mock webhook event',
				description: `${BUSINESS_NOTE}: send a test event with the current data of a real podcast, episode or iTunes info record through the webhook's subscriptions and filters`,
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a webhook',
				description:
					",: change a webhook's endpoint URL and event list. Both replace the old values, so pass the complete event list.",
			},
			{
				name: 'Update Filter',
				value: 'updateFilter',
				action: 'Update a webhook filter',
				description:
					",: replace a filter's whole definition. Anything not sent, including description and allow/block lists, is cleared.",
			},
		],
		default: 'getMany',
	},

	{
		displayName: 'Webhook ID',
		name: 'webhookId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: op(...NEEDS_WEBHOOK_ID) },
		description: 'ID of the webhook (from Get Many)',
	},
	{
		displayName: 'Filter UUID',
		name: 'filterUuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: op(...NEEDS_FILTER_UUID) },
		description: 'UUID of the filter (from Get Many or Get Filter)',
	},

	// Create / Update
	{
		displayName: 'Endpoint URL',
		name: 'endpointUrl',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: op('create', 'update') },
		placeholder: 'https://example.com/taddy-webhook',
		description:
			'Public HTTPS URL that receives POSTed events. It must return a 2xx status quickly or the event is recorded as failed. For n8n, prefer the Taddy Podcast API Trigger node, which registers its own URL',
	},
	{
		displayName: 'Events',
		name: 'webhookEvents',
		type: 'multiOptions',
		options: WEBHOOK_EVENT_OPTIONS,
		default: [],
		required: true,
		displayOptions: { show: op('create', 'update') },
		description:
			'Events to subscribe to. An episode dropped from its feed arrives as podcastepisode.updated with isRemoved true; the *.deleted events are only sent for content removed for policy violations. Roughly 1k new podcasts and 50k new episodes arrive per day',
	},

	// Allowlist / blocklist
	{
		displayName: 'Podcast',
		name: 'contentUuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: op(...LIST_OPERATIONS) },
		description:
			'The podcast to add or remove, matched exactly against its UUID, RSS URL or iTunes ID',
	},

	// Filter definition
	{
		displayName: 'Event Type',
		name: 'eventType',
		type: 'options',
		options: WEBHOOK_EVENT_OPTIONS,
		default: 'podcastepisode.created',
		required: true,
		displayOptions: { show: op(...FILTER_INPUT_OPERATIONS) },
		description:
			'The event this filter applies to. The webhook must be subscribed to it, or the filter never runs.',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		default: '',
		displayOptions: { show: op(...FILTER_INPUT_OPERATIONS) },
		description: 'A note to recognise the filter by',
	},
	{
		displayName: 'Clauses',
		name: 'clauses',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add clause',
		default: {},
		displayOptions: { show: op(...FILTER_INPUT_OPERATIONS) },
		description: 'Up to 5 field/regex clauses that must all match (AND)',
		options: [
			{
				displayName: 'Clause',
				name: 'clause',
				values: [
					{
						displayName: 'Field',
						name: 'field',
						type: 'string',
						default: '',
						placeholder: 'podcastSeries.name',
						description: FIELD_HELP,
					},
					{
						displayName: 'Regex',
						name: 'value',
						type: 'string',
						default: '',
						placeholder: 'shopify|e-commerce',
						description: REGEX_HELP,
					},
				],
			},
		],
	},
	listProperty(
		'includedUuids',
		'Allowlist',
		op(...FILTER_INPUT_OPERATIONS),
		'Comma-separated podcasts (UUID, RSS URL or iTunes ID). When non-empty, only events for these podcasts pass the filter',
	),
	listProperty(
		'excludedUuids',
		'Blocklist',
		op(...FILTER_INPUT_OPERATIONS),
		'Comma-separated podcasts (UUID, RSS URL or iTunes ID) whose events never pass the filter',
	),

	// Send Mock Event
	{
		displayName: 'Content Type',
		name: 'taddyType',
		type: 'options',
		options: [
			{ name: 'Episode', value: 'podcastepisode' },
			{ name: 'iTunes Info', value: 'itunesinfo' },
			{ name: 'Podcast', value: 'podcastseries' },
		],
		default: 'podcastepisode',
		displayOptions: { show: op('sendMockEvent') },
		description: 'What kind of content the mock event carries',
	},
	{
		displayName: 'Event Action',
		name: 'eventAction',
		type: 'options',
		options: [
			{ name: 'Created', value: 'created' },
			{ name: 'Deleted', value: 'deleted' },
			{ name: 'Feed Updated (Podcasts Only)', value: 'feed_updated' },
			{ name: 'New Episodes Released (Podcasts Only)', value: 'new_episodes_released' },
			{ name: 'Updated', value: 'updated' },
		],
		default: 'created',
		displayOptions: { show: op('sendMockEvent') },
		description:
			'The event action to simulate. The webhook must be subscribed to the resulting event.',
	},
	{
		displayName: 'Content UUID',
		name: 'contentUuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: op('sendMockEvent') },
		description:
			'Taddy UUID of the real podcast, episode or iTunes info record whose current data the mock event carries',
	},

	splitIntoItemsProperty(op('getMany'), 'webhook'),
	optionsCollection(op('getMany', ...WEBHOOK_RETURNING), [customFieldsOption('webhook', 'id')]),
	optionsCollection(op(...FILTER_RETURNING), [customFieldsOption('webhook filter', 'uuid')]),
];

function readFilterInput(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const filter: IDataObject = {
		eventType: ctx.getNodeParameter('eventType', itemIndex) as string,
	};
	const description = (ctx.getNodeParameter('description', itemIndex, '') as string).trim();
	if (description) filter.description = description;

	const clauses = ctx.getNodeParameter('clauses', itemIndex, {}) as { clause?: IDataObject[] };
	const rows = asArray(clauses.clause).filter(
		(row) => String(row.field ?? '').trim() || String(row.value ?? '').trim(),
	);
	if (rows.length > 5) {
		throw new NodeOperationError(ctx.getNode(), 'A filter can have at most 5 clauses', {
			itemIndex,
		});
	}
	rows.forEach((row, index) => {
		const field = String(row.field ?? '').trim();
		const value = String(row.value ?? '').trim();
		if (!field || !value) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Clause ${index + 1} needs both a field and a regex`,
				{ itemIndex },
			);
		}
		filter[`field${index + 1}`] = field;
		filter[`value${index + 1}`] = value;
	});

	const includedUuids = parseStringList(ctx.getNodeParameter('includedUuids', itemIndex, ''));
	const excludedUuids = parseStringList(ctx.getNodeParameter('excludedUuids', itemIndex, ''));
	if (includedUuids.length) filter.includedUuids = includedUuids;
	if (excludedUuids.length) filter.excludedUuids = excludedUuids;
	return filter;
}

const LIST_MUTATIONS: Record<string, string> = {
	addToAllowlist: 'addUuidToWebhookFilterAllowlist',
	addToBlocklist: 'addUuidToWebhookFilterBlocklist',
	removeFromAllowlist: 'deleteUuidFromWebhookFilterAllowlist',
	removeFromBlocklist: 'deleteUuidFromWebhookFilterBlocklist',
};

export async function executeWebhook(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	const fields = getOption<string>(this, itemIndex, 'customFields', '');
	const webhookSel = selection(fields, WEBHOOK_FIELDS, 'id');
	const filterSel = selection(fields, FILTER_FIELDS, 'uuid');
	const webhookId = NEEDS_WEBHOOK_ID.includes(operation)
		? (this.getNodeParameter('webhookId', itemIndex) as string).trim()
		: '';
	const filterUuid = NEEDS_FILTER_UUID.includes(operation)
		? (this.getNodeParameter('filterUuid', itemIndex) as string).trim()
		: '';

	if (operation === 'getMany') {
		const query = `{ getMyDeveloperWebhooks { userId webhooks { ${webhookSel} } } }`;
		const data = await taddyApiRequest.call(this, query, {}, { itemIndex });
		const result = (data.getMyDeveloperWebhooks as IDataObject | null) ?? {};
		if (!getBool(this, itemIndex, 'splitIntoItems', true)) return toItems([result], itemIndex);
		return toItems(asArray(result.webhooks), itemIndex);
	}

	if (operation === 'create' || operation === 'update') {
		const endpointUrl = (this.getNodeParameter('endpointUrl', itemIndex) as string).trim();
		const webhookEvents = getListParam(this, itemIndex, 'webhookEvents', {
			label: 'event',
			required: true,
		});
		if (operation === 'create') {
			const query = `mutation AddWebhook($endpointUrl: String!, $webhookEvents: [String!]!) {
				addWebhookUrlForUser(endpointUrl: $endpointUrl, webhookEvents: $webhookEvents) { ${selection(fields, NEW_WEBHOOK_FIELDS, 'id')} }
			}`;
			const data = await taddyApiRequest.call(
				this,
				query,
				{ endpointUrl, webhookEvents },
				{ itemIndex },
			);
			return toItems([(data.addWebhookUrlForUser as IDataObject) ?? {}], itemIndex);
		}
		const query = `mutation UpdateWebhook($id: ID!, $endpointUrl: String!, $webhookEvents: [String!]!) {
			updateWebhookForUser(id: $id, endpointUrl: $endpointUrl, webhookEvents: $webhookEvents) { ${webhookSel} }
		}`;
		const data = await taddyApiRequest.call(
			this,
			query,
			{ id: webhookId, endpointUrl, webhookEvents },
			{ itemIndex },
		);
		return toItems([(data.updateWebhookForUser as IDataObject) ?? {}], itemIndex);
	}

	if (operation === 'delete') {
		const query = 'mutation DeleteWebhook($id: ID!) { deleteWebhookForUser(id: $id) }';
		const data = await taddyApiRequest.call(this, query, { id: webhookId }, { itemIndex });
		return toItems([{ deleted: true, id: data.deleteWebhookForUser ?? webhookId }], itemIndex);
	}

	if (operation === 'getFilter') {
		const query = `query GetWebhookFilter($webhookId: ID!, $filterUuid: ID!) {
			getWebhookFilterByUuid(webhookId: $webhookId, filterUuid: $filterUuid) { ${filterSel} }
		}`;
		const data = await taddyApiRequest.call(this, query, { webhookId, filterUuid }, { itemIndex });
		const filter = data.getWebhookFilterByUuid as IDataObject | null;
		return toItems([filter ?? { getWebhookFilterByUuid: null }], itemIndex);
	}

	if (operation === 'createFilter') {
		const filter = readFilterInput(this, itemIndex);
		const query = `mutation AddWebhookFilter($webhookId: ID!, $filter: WebhookFilterInput!) {
			addWebhookFilter(webhookId: $webhookId, filter: $filter) { ${webhookSel} }
		}`;
		const data = await taddyApiRequest.call(this, query, { webhookId, filter }, { itemIndex });
		return toItems([(data.addWebhookFilter as IDataObject) ?? {}], itemIndex);
	}

	if (operation === 'updateFilter') {
		const filter = readFilterInput(this, itemIndex);
		const query = `mutation UpdateWebhookFilter($webhookId: ID!, $filterUuid: ID!, $filter: WebhookFilterInput!) {
			updateWebhookFilter(webhookId: $webhookId, filterUuid: $filterUuid, filter: $filter) { ${webhookSel} }
		}`;
		const data = await taddyApiRequest.call(
			this,
			query,
			{ webhookId, filterUuid, filter },
			{ itemIndex },
		);
		return toItems([(data.updateWebhookFilter as IDataObject) ?? {}], itemIndex);
	}

	if (operation === 'deleteFilter') {
		const query = `mutation DeleteWebhookFilter($webhookId: ID!, $filterUuid: ID!) {
			deleteWebhookFilter(webhookId: $webhookId, filterUuid: $filterUuid) { ${webhookSel} }
		}`;
		const data = await taddyApiRequest.call(this, query, { webhookId, filterUuid }, { itemIndex });
		return toItems([(data.deleteWebhookFilter as IDataObject) ?? {}], itemIndex);
	}

	if (operation in LIST_MUTATIONS) {
		const field = LIST_MUTATIONS[operation];
		const contentUuid = (this.getNodeParameter('contentUuid', itemIndex) as string).trim();
		const query = `mutation ($webhookId: ID!, $filterUuid: ID!, $contentUuid: String!) {
			${field}(webhookId: $webhookId, filterUuid: $filterUuid, contentUuid: $contentUuid) { ${filterSel} }
		}`;
		const data = await taddyApiRequest.call(
			this,
			query,
			{ webhookId, filterUuid, contentUuid },
			{ itemIndex },
		);
		return toItems([(data[field] as IDataObject) ?? {}], itemIndex);
	}

	if (operation === 'sendMockEvent') {
		const taddyType = this.getNodeParameter('taddyType', itemIndex) as string;
		const action = this.getNodeParameter('eventAction', itemIndex) as string;
		const contentUuid = (this.getNodeParameter('contentUuid', itemIndex) as string).trim();
		const event = `${taddyType}.${action}`;
		if (!WEBHOOK_EVENTS.includes(event)) {
			throw new NodeOperationError(
				this.getNode(),
				`"${event}" is not a Taddy webhook event. Valid events: ${WEBHOOK_EVENTS.join(', ')}`,
				{ itemIndex },
			);
		}
		const query = `mutation MockWebhookEvent($webhookId: ID!, $contentUuid: String!, $taddyType: String!, $action: WebhookEventActionType!) {
			mockWebhookEvent(webhookId: $webhookId, contentUuid: $contentUuid, taddyType: $taddyType, action: $action)
		}`;
		const data = await taddyApiRequest.call(
			this,
			query,
			{ webhookId, contentUuid, taddyType, action },
			{ itemIndex },
		);
		return toItems(
			[{ webhookId, event, contentUuid, sent: data.mockWebhookEvent === true }],
			itemIndex,
		);
	}

	if (operation === 'replayFailedEvents') {
		const query =
			'mutation ReplayFailedWebhookEvents($webhookId: ID!) { replayFailedWebhookEvents(webhookId: $webhookId) }';
		const data = await taddyApiRequest.call(this, query, { webhookId }, { itemIndex });
		return toItems([{ webhookId, queuedCount: data.replayFailedWebhookEvents ?? 0 }], itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unknown webhook operation "${operation}"`, {
		itemIndex,
	});
}
