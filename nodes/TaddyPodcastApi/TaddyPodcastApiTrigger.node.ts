import { timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { WEBHOOK_EVENT_OPTIONS } from './shared/enums';
import { CREDENTIAL_NAME, taddyApiRequest, taddyErrorCode } from './shared/transport';
import { asArray, parseStringList } from './shared/utils';

const SECRET_HEADER = 'x-taddy-webhook-secret';

interface TriggerStaticData extends IDataObject {
	webhookId?: string;
	webhookSecret?: string;
	endpointUrl?: string;
}

export class TaddyPodcastApiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Taddy Podcast API Trigger',
		name: 'taddyPodcastApiTrigger',
		icon: { light: 'file:../../icons/taddy.svg', dark: 'file:../../icons/taddy.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when Taddy sends a webhook event, such as a new podcast episode (Business plan)',
		defaults: {
			name: 'Taddy Podcast API Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL_NAME,
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Webhooks need a Taddy Business plan, and an account has one webhook endpoint by default. On activation this node registers the n8n webhook URL with Taddy and removes it on deactivation. Without a podcast filter, podcastepisode.created alone delivers roughly 50k events per day.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: WEBHOOK_EVENT_OPTIONS,
				default: ['podcastepisode.created'],
				required: true,
				description:
					'Events to subscribe to. An episode dropped from its feed arrives as "Episode Updated" with isRemoved true; the "Deleted" events are only sent for content removed for policy violations.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Only These Podcasts',
						name: 'onlyPodcasts',
						type: 'string',
						default: '',
						placeholder: 'uuid, https://feeds.example.com/rss, 201671138',
						description:
							'Comma-separated podcasts (Taddy UUID, RSS URL or iTunes ID). When set, a filter is created for every selected event so only events about these podcasts are delivered.',
					},
					{
						displayName: 'Verify Secret',
						name: 'verifySecret',
						type: 'boolean',
						default: true,
						description:
							'Whether to reject deliveries whose X-TADDY-WEBHOOK-SECRET header does not match the secret Taddy issued when the webhook was registered',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!staticData.webhookId || !staticData.webhookSecret) return false;

				const data = await taddyApiRequest.call(
					this,
					'{ getMyDeveloperWebhooks { webhooks { id endpointUrl events } } }',
				);
				const webhooks = asArray((data.getMyDeveloperWebhooks as IDataObject | null)?.webhooks);
				const existing = webhooks.find(
					(webhook) => String(webhook.id) === String(staticData.webhookId),
				);
				if (existing && existing.endpointUrl === webhookUrl) return true;

				// The stored webhook is gone or points elsewhere: forget it so create() runs again.
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				delete staticData.endpointUrl;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				const endpointUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events') as string[];
				const options = this.getNodeParameter('options', {}) as IDataObject;
				const onlyPodcasts = parseStringList(options.onlyPodcasts);

				if (!events || events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Select at least one event');
				}
				if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)[:/]/i.test(endpointUrl)) {
					throw new NodeOperationError(
						this.getNode(),
						'Taddy can only deliver webhooks to a public HTTPS URL, but this n8n instance uses a localhost webhook URL',
						{
							description:
								'Set the WEBHOOK_URL environment variable of n8n to a public URL (for example a tunnel) and activate the workflow again.',
						},
					);
				}

				let created: IDataObject = {};
				let failure: unknown;
				try {
					const data = await taddyApiRequest.call(
						this,
						`mutation AddWebhook($endpointUrl: String!, $webhookEvents: [String!]!) {
							addWebhookUrlForUser(endpointUrl: $endpointUrl, webhookEvents: $webhookEvents) {
								id endpointUrl events isActive webhookSecret
							}
						}`,
						{ endpointUrl, webhookEvents: events },
					);
					created = (data.addWebhookUrlForUser as IDataObject | null) ?? {};
				} catch (error) {
					failure = error;
				}
				if (failure !== undefined) {
					const code = taddyErrorCode(failure);
					const message = (failure as Error).message ?? '';
					if (code === 'ACCESS_NOT_ALLOWED' || /limit|maximum|already|exceed/i.test(message)) {
						throw new NodeOperationError(this.getNode(), message, {
							description:
								'Webhooks need a Taddy Business plan, and an account has one webhook endpoint by default. Delete an unused webhook at https://taddy.org/dashboard (or with the Taddy Podcast API node, Webhook > Delete), or contact danny@taddy.org for more endpoints.',
						});
					}
					throw new NodeOperationError(this.getNode(), failure as Error);
				}

				if (!created.id || !created.webhookSecret) {
					throw new NodeOperationError(
						this.getNode(),
						'Taddy did not return a webhook ID and secret when registering the webhook',
					);
				}
				staticData.webhookId = String(created.id);
				staticData.webhookSecret = String(created.webhookSecret);
				staticData.endpointUrl = endpointUrl;

				if (onlyPodcasts.length > 0) {
					for (const eventType of events) {
						await taddyApiRequest.call(
							this,
							`mutation AddWebhookFilter($webhookId: ID!, $filter: WebhookFilterInput!) {
								addWebhookFilter(webhookId: $webhookId, filter: $filter) { id }
							}`,
							{
								webhookId: staticData.webhookId,
								filter: {
									eventType,
									description: 'n8n trigger: only selected podcasts',
									includedUuids: onlyPodcasts,
								},
							},
						);
					}
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
				if (staticData.webhookId) {
					try {
						await taddyApiRequest.call(
							this,
							'mutation DeleteWebhook($id: ID!) { deleteWebhookForUser(id: $id) }',
							{ id: staticData.webhookId },
						);
					} catch (error) {
						this.logger.warn(
							`Taddy Podcast API Trigger: could not delete webhook ${staticData.webhookId}: ${(error as Error).message}`,
						);
						return false;
					}
				}
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				delete staticData.endpointUrl;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const staticData = this.getWorkflowStaticData('node') as TriggerStaticData;
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const verifySecret = options.verifySecret !== false;

		if (verifySecret) {
			const expected = staticData.webhookSecret ?? '';
			const header = this.getHeaderData()[SECRET_HEADER];
			const received = Array.isArray(header) ? header[0] : header;
			const expectedBuffer = Buffer.from(expected);
			const receivedBuffer = Buffer.from(typeof received === 'string' ? received : '');
			const matches =
				expected.length > 0 &&
				expectedBuffer.length === receivedBuffer.length &&
				timingSafeEqual(expectedBuffer, receivedBuffer);
			if (!matches) {
				this.getResponseObject().status(401).send('Unauthorized').end();
				return { noWebhookResponse: true };
			}
		}

		const body = this.getBodyData();
		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}
