import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { accountDescription, executeAccount } from './resources/account';
import { chartDescription, executeChart } from './resources/chart';
import { episodeDescription, executeEpisode } from './resources/episode';
import { executeGraphql, graphqlDescription } from './resources/graphql';
import { executePodcast, podcastDescription } from './resources/podcast';
import { executeSearch, searchDescription } from './resources/search';
import { executeWebhook, webhookDescription } from './resources/webhook';
import { CREDENTIAL_NAME } from './shared/transport';

type ResourceExecutor = (
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
) => Promise<INodeExecutionData[]>;

const EXECUTORS: Record<string, ResourceExecutor> = {
	account: executeAccount,
	chart: executeChart,
	episode: executeEpisode,
	graphql: executeGraphql,
	podcast: executePodcast,
	search: executeSearch,
	webhook: executeWebhook,
};

export class TaddyPodcastApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Taddy Podcast API',
		name: 'taddyPodcastApi',
		icon: { light: 'file:../../icons/taddy.svg', dark: 'file:../../icons/taddy.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Search 4M podcasts and 200M episodes, read top charts, fetch transcripts and manage webhooks with the Taddy Podcast API',
		defaults: {
			name: 'Taddy Podcast API',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL_NAME,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account',
						value: 'account',
						description: 'Remaining API requests and transcript credits',
					},
					{
						name: 'Chart',
						value: 'chart',
						description: 'Apple Podcasts top charts and Taddy popularity rankings',
					},
					{ name: 'Episode', value: 'episode', description: 'Episodes, transcripts and chapters' },
					{ name: 'GraphQL', value: 'graphql', description: 'Run a custom GraphQL query' },
					{
						name: 'Podcast',
						value: 'podcast',
						description: 'Podcasts, their episodes and Apple Podcasts details',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Full-text search across podcasts and episodes',
					},
					{
						name: 'Webhook',
						value: 'webhook',
						description: 'Manage webhooks and filters (Business plan)',
					},
				],
				default: 'podcast',
			},
			...accountDescription,
			...chartDescription,
			...episodeDescription,
			...graphqlDescription,
			...podcastDescription,
			...searchDescription,
			...webhookDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const executor = EXECUTORS[resource];

		if (!executor) {
			throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`);
		}

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			let failure: unknown;
			try {
				const results = await executor.call(this, itemIndex, operation);
				returnData.push(...results);
			} catch (error) {
				failure = error;
			}
			if (failure === undefined) continue;

			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (failure as Error).message },
					error: failure as NodeOperationError,
					pairedItem: { item: itemIndex },
				});
				continue;
			}
			if (failure instanceof NodeApiError || failure instanceof NodeOperationError) {
				failure.context.itemIndex = itemIndex;
				throw failure;
			}
			throw new NodeOperationError(this.getNode(), failure as Error, { itemIndex });
		}

		return [returnData];
	}
}
