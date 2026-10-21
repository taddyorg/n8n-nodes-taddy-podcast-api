import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { jsonParse, NodeOperationError } from 'n8n-workflow';
import { taddyApiRequest } from '../shared/transport';
import { toItems } from '../shared/utils';

const RESOURCE = 'graphql';
const show = { resource: [RESOURCE], operation: ['execute'] };
const CUSTOM_QUERY_TIMEOUT_MS = 120_000;

export const graphqlDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Execute Query',
				value: 'execute',
				action: 'Execute a custom graph ql query',
				description:
					'Run any GraphQL query or mutation against the Taddy API. Use this when no other operation fits.',
			},
		],
		default: 'execute',
	},
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		typeOptions: { rows: 8, editor: 'codeNodeEditor', editorLanguage: 'json' },
		default: '',
		required: true,
		displayOptions: { show },
		placeholder:
			'query ($name: String) { getPodcastSeries(name: $name) { uuid name totalEpisodesCount } }',
		description:
			'GraphQL query or mutation. Every selected object must include its key field (uuid or ID). Schema and docs: <a href="https://taddy.org/developers/podcast-api">taddy.org/developers/podcast-api</a>',
	},
	{
		displayName: 'Variables',
		name: 'variables',
		type: 'json',
		default: '{}',
		displayOptions: { show },
		description: 'GraphQL variables as a JSON object',
	},
];

export async function executeGraphql(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	if (operation !== 'execute') {
		throw new NodeOperationError(this.getNode(), `Unknown GraphQL operation "${operation}"`, {
			itemIndex,
		});
	}
	const query = (this.getNodeParameter('query', itemIndex) as string).trim();
	if (!query) {
		throw new NodeOperationError(this.getNode(), 'Enter a GraphQL query', { itemIndex });
	}
	const rawVariables = this.getNodeParameter('variables', itemIndex, '{}') as string | IDataObject;
	let variables: IDataObject = {};
	if (typeof rawVariables === 'string') {
		if (rawVariables.trim()) {
			variables = jsonParse<IDataObject>(rawVariables, {
				errorMessage: 'Variables must be a valid JSON object',
			});
		}
	} else if (rawVariables && typeof rawVariables === 'object') {
		variables = rawVariables;
	}
	const data = await taddyApiRequest.call(this, query, variables, {
		itemIndex,
		timeoutMs: CUSTOM_QUERY_TIMEOUT_MS,
	});
	return toItems([data], itemIndex);
}
