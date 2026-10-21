import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TaddyPodcastApi implements ICredentialType {
	name = 'taddyPodcastApi';

	displayName = 'Taddy Podcast API';

	icon: Icon = { light: 'file:../icons/taddy.svg', dark: 'file:../icons/taddy.dark.svg' };

	documentationUrl =
		'https://github.com/taddyorg/n8n-nodes-taddy-podcast-api?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'User ID',
			name: 'userId',
			type: 'string',
			default: '',
			required: true,
			description:
				'Your numeric Taddy user ID, shown next to your API key at <a href="https://taddy.org/dashboard">taddy.org/dashboard</a>',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Taddy API key. Sign up at <a href="https://taddy.org/signup/developers">taddy.org/signup/developers</a> and click "Get my API Key" in the dashboard',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-USER-ID': '={{$credentials.userId}}',
				'X-API-KEY': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.taddy.org',
			url: '',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: '{ getApiRequestsRemaining }' }),
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message: 'Invalid User ID or API Key. Check both values at https://taddy.org/dashboard',
				},
			},
		],
	};
}
