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
	lookupProperties,
	optionsCollection,
	splitIntoItemsProperty,
} from '../shared/descriptions';
import {
	CHAPTER_FIELDS,
	EPISODE_FIELDS,
	TRANSCRIPT_ITEM_FIELDS,
	selection,
} from '../shared/fragments';
import { getBool, getListParam, getLookupVariables, getOption } from '../shared/params';
import { DEFAULT_TIMEOUT_MS, taddyApiRequest } from '../shared/transport';
import { asArray, cleanVariables, toItems } from '../shared/utils';

const RESOURCE = 'episode';
const showGet = { resource: [RESOURCE], operation: ['get'] };
const showGetChapters = { resource: [RESOURCE], operation: ['getChapters'] };
const showGetMany = { resource: [RESOURCE], operation: ['getMany'] };
const showGetTranscript = { resource: [RESOURCE], operation: ['getTranscript'] };

const ON_DEMAND_TIMEOUT_MS = 6 * 60 * 1000;

export const episodeDescription: INodeProperties[] = [
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
				action: 'Get an episode',
				description: 'Look up one episode by UUID, GUID or name',
			},
			{
				name: 'Get Chapters',
				value: 'getChapters',
				action: 'Get the chapters of an episode',
				description:
					'Chapter markers for an episode (title and start time in milliseconds). Most podcasts do not provide chapters.',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many episodes',
				description: 'Fetch up to 25 episodes by UUID in one request',
			},
			{
				name: 'Get Transcript',
				value: 'getTranscript',
				action: 'Get the transcript of an episode',
				description:
					'The transcript of an episode as timed items (text, speaker, start and end in milliseconds)',
			},
		],
		default: 'get',
	},

	// Get
	...lookupProperties(showGet, ['uuid', 'guid', 'name'], 'episode'),
	{
		displayName: 'Podcast UUID',
		name: 'seriesUuidForLookup',
		type: 'string',
		default: '',
		displayOptions: { show: { ...showGet, lookupBy: ['guid', 'name'] } },
		description:
			'Taddy UUID of the podcast the episode belongs to. Recommended with GUID or name lookups to avoid matching an episode from a different podcast.',
	},
	optionsCollection(showGet, [customFieldsOption('episode', 'uuid')]),

	// Get Chapters
	{
		displayName: 'Episode UUID',
		name: 'uuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showGetChapters },
		description: 'Taddy UUID of the episode',
	},
	splitIntoItemsProperty(showGetChapters, 'chapter'),
	optionsCollection(showGetChapters, [customFieldsOption('chapter', 'id')]),

	// Get Many
	listProperty(
		'uuids',
		'Episode UUIDs',
		showGetMany,
		'Comma-separated Taddy UUIDs of the episodes (up to 25). Also accepts an array via an expression. Unknown UUIDs are silently left out',
		true,
	),
	splitIntoItemsProperty(showGetMany, 'episode'),
	optionsCollection(showGetMany, [customFieldsOption('episode', 'uuid')]),

	// Get Transcript
	{
		displayName: 'Episode UUID',
		name: 'uuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showGetTranscript },
		description: 'Taddy UUID of the episode',
	},
	{
		displayName: 'Style',
		name: 'style',
		type: 'options',
		options: [
			{ name: 'Paragraph', value: 'PARAGRAPH', description: 'Sentences grouped into paragraphs' },
			{ name: 'Utterance', value: 'UTTERANCE', description: 'One item per utterance' },
		],
		default: 'PARAGRAPH',
		displayOptions: { show: showGetTranscript },
		description: 'How transcript text is grouped into items',
	},
	{
		displayName: 'Use On-Demand Credits If Needed',
		name: 'useOnDemandCreditsIfNeeded',
		type: 'boolean',
		default: true,
		displayOptions: { show: showGetTranscript },
		description:
			'Whether to let Taddy generate a transcript when the podcast does not publish one. Costs 1 transcript credit per episode per billing month and needs a Pro or Business plan (takes about 10 seconds per hour of audio). Repeat calls for the same episode in the same month are free',
	},
	{
		displayName: 'Only Podcast-Provided Transcript',
		name: 'useOnlyPodcastProvidedTranscript',
		type: 'boolean',
		default: false,
		displayOptions: { show: showGetTranscript },
		description:
			'Whether to return only a transcript the podcast itself publishes. Free on every plan and never spends credits; empty when the podcast has none. Takes precedence over the on-demand option',
	},
	{
		displayName: 'Output',
		name: 'output',
		type: 'options',
		options: [
			{
				name: 'One Item Per Transcript Item',
				value: 'items',
				description: 'Each timed segment becomes its own item',
			},
			{
				name: 'Single Item',
				value: 'single',
				description: 'One item with all segments in "transcript" and the joined text in "text"',
			},
		],
		default: 'items',
		displayOptions: { show: showGetTranscript },
		description: 'How to output the transcript',
	},
	optionsCollection(showGetTranscript, [customFieldsOption('transcript item', 'id')]),
];

export async function executeEpisode(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	const fields = getOption<string>(this, itemIndex, 'customFields', '');

	if (operation === 'get') {
		const variables = getLookupVariables(this, itemIndex);
		const seriesUuidForLookup = (
			this.getNodeParameter('seriesUuidForLookup', itemIndex, '') as string
		).trim();
		if (seriesUuidForLookup && variables.uuid === undefined) {
			variables.seriesUuidForLookup = seriesUuidForLookup;
		}
		const query = `query GetPodcastEpisode($uuid: ID, $guid: String, $name: String, $seriesUuidForLookup: ID) {
			getPodcastEpisode(uuid: $uuid, guid: $guid, name: $name, seriesUuidForLookup: $seriesUuidForLookup) {
				${selection(fields, EPISODE_FIELDS, 'uuid')}
			}
		}`;
		const data = await taddyApiRequest.call(this, query, variables, { itemIndex });
		const episode = data.getPodcastEpisode as IDataObject | null;
		return toItems([episode ?? { getPodcastEpisode: null }], itemIndex);
	}

	if (operation === 'getChapters') {
		const uuid = (this.getNodeParameter('uuid', itemIndex) as string).trim();
		const query = `query GetEpisodeChapters($uuid: ID) {
			getEpisodeChapters(uuid: $uuid) { ${selection(fields, CHAPTER_FIELDS, 'id')} }
		}`;
		const data = await taddyApiRequest.call(this, query, { uuid }, { itemIndex });
		const chapters = asArray(data.getEpisodeChapters);
		if (!getBool(this, itemIndex, 'splitIntoItems', true)) return toItems([data], itemIndex);
		if (chapters.length === 0) {
			return toItems(
				[{ uuid, chapters: [], message: 'No chapters are available for this episode.' }],
				itemIndex,
			);
		}
		return toItems(chapters, itemIndex);
	}

	if (operation === 'getMany') {
		const uuids = getListParam(this, itemIndex, 'uuids', {
			label: 'episode UUID',
			max: 25,
			required: true,
		});
		const query = `query GetMultiplePodcastEpisodes($uuids: [ID]) {
			getMultiplePodcastEpisodes(uuids: $uuids) { ${selection(fields, EPISODE_FIELDS, 'uuid')} }
		}`;
		const data = await taddyApiRequest.call(this, query, { uuids }, { itemIndex });
		if (!getBool(this, itemIndex, 'splitIntoItems', true)) return toItems([data], itemIndex);
		return toItems(asArray(data.getMultiplePodcastEpisodes), itemIndex);
	}

	if (operation === 'getTranscript') {
		const uuid = (this.getNodeParameter('uuid', itemIndex) as string).trim();
		const style = this.getNodeParameter('style', itemIndex, 'PARAGRAPH') as string;
		const podcastProvidedOnly = getBool(this, itemIndex, 'useOnlyPodcastProvidedTranscript', false);
		const useOnDemand =
			!podcastProvidedOnly && getBool(this, itemIndex, 'useOnDemandCreditsIfNeeded', true);
		const output = this.getNodeParameter('output', itemIndex, 'items') as string;

		const variables = cleanVariables({ uuid, style });
		variables.useOnDemandCreditsIfNeeded = useOnDemand;
		variables.useOnlyPodcastProvidedTranscript = podcastProvidedOnly;
		const query = `query GetEpisodeTranscript($uuid: ID, $style: TranscriptItemStyle, $useOnDemandCreditsIfNeeded: Boolean, $useOnlyPodcastProvidedTranscript: Boolean) {
			getEpisodeTranscript(uuid: $uuid, style: $style, useOnDemandCreditsIfNeeded: $useOnDemandCreditsIfNeeded, useOnlyPodcastProvidedTranscript: $useOnlyPodcastProvidedTranscript) {
				${selection(fields, TRANSCRIPT_ITEM_FIELDS, 'id')}
			}
		}`;
		const data = await taddyApiRequest.call(this, query, variables, {
			itemIndex,
			timeoutMs: useOnDemand ? ON_DEMAND_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
		});
		const transcript = asArray(data.getEpisodeTranscript);

		if (transcript.length === 0) {
			let message: string;
			if (podcastProvidedOnly) {
				message =
					'This podcast does not publish its own transcript for this episode. Turn off "Only Podcast-Provided Transcript" to have Taddy generate one (Pro and Business plans).';
			} else if (useOnDemand) {
				message =
					'Taddy returned no transcript for this episode. Likely causes: the account is out of transcript credits (check Account > Get Usage), or the episode is blocked or has no audio.';
			} else {
				message =
					'The podcast does not provide a transcript for this episode. Turn on "Use On-Demand Credits If Needed" to have Taddy generate one (Pro and Business plans, 1 credit).';
			}
			return toItems([{ uuid, transcript: [], text: '', message }], itemIndex);
		}

		if (output === 'single') {
			const text = transcript
				.map((item) => (typeof item.text === 'string' ? item.text : ''))
				.filter((line) => line.length > 0)
				.join('\n');
			return toItems([{ uuid, style, transcript, text, totalItems: transcript.length }], itemIndex);
		}
		return toItems(transcript, itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unknown episode operation "${operation}"`, {
		itemIndex,
	});
}
