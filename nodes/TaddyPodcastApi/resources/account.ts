import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { taddyApiRequest } from '../shared/transport';
import { toItems } from '../shared/utils';

const RESOURCE = 'account';

export const accountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{
				name: 'Get Usage',
				value: 'getUsage',
				action: 'Get remaining API requests and transcript credits',
				description:
					'How many API requests and Taddy transcript credits are left this billing month for the API key',
			},
		],
		default: 'getUsage',
	},
];

export async function executeAccount(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	if (operation !== 'getUsage') {
		throw new NodeOperationError(this.getNode(), `Unknown account operation "${operation}"`, {
			itemIndex,
		});
	}
	const data = await taddyApiRequest.call(
		this,
		'{ getApiRequestsRemaining getTranscriptCreditsRemaining }',
		{},
		{ itemIndex },
	);
	return toItems(
		[
			{
				apiRequestsRemaining: data.getApiRequestsRemaining ?? null,
				transcriptCreditsRemaining: data.getTranscriptCreditsRemaining ?? null,
			},
		],
		itemIndex,
	);
}
