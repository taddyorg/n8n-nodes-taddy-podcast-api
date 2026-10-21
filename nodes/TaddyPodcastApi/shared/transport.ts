import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { compact } from './utils';

export const TADDY_API_URL = 'https://api.taddy.org';
export const CREDENTIAL_NAME = 'taddyPodcastApi';
const USER_AGENT = 'n8n-nodes-taddy-podcast-api';
const RETRY_DELAY_MS = 1000;
export const DEFAULT_TIMEOUT_MS = 30_000;

export type TaddyContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

export interface TaddyRequestOptions {
	timeoutMs?: number;
	itemIndex?: number;
}

/** Hints shown under the error message, mirroring mcp/lib/taddy-api.js ERROR_HINTS. */
const ERROR_HINTS: Record<string, string> = {
	API_KEY_INVALID:
		'Check the User ID and API Key in your Taddy Podcast API credential (find them at https://taddy.org/dashboard).',
	API_RATE_LIMIT_EXCEEDED:
		'Either the per-minute rate limit or the monthly request quota was hit. Run Account > Get Usage: if requests remaining is above 0, wait a few seconds and retry; if it is 0, the monthly quota is used up and retrying will not help.',
	INVALID_QUERY_OR_SYNTAX:
		'Check field and argument names against https://taddy.org/developers/podcast-api, and include the key field (uuid or id) on every selected object in a Custom Fields selection.',
	QUERY_TOO_COMPLEX:
		'Lower Limit Per Page, drop nested lists (such as episodes inside a list of podcasts) and transcript fields from Custom Fields, or split the request into two operations.',
	BAD_USER_INPUT: 'An argument value was rejected; fix it as the message says.',
	ACCESS_NOT_ALLOWED:
		"The account's plan does not include this feature (see https://taddy.org/developers/pricing). Webhooks need the Business plan; Taddy-generated transcripts need Pro or Business. Podcast-provided transcripts work on every plan.",
	TADDY_SERVER_ERROR:
		'Taddy had a server error; this is not a problem with the request. Try again later.',
	TIMEOUT: 'The request took too long. Try again, or lower Limit Per Page.',
	NETWORK_ERROR: 'Could not reach https://api.taddy.org. Check network access from the n8n host.',
};

export class TaddyApiError extends Error {
	code: string;
	httpCode?: number;

	constructor(message: string, code: string, httpCode?: number) {
		super(message);
		this.name = 'TaddyApiError';
		this.code = code;
		this.httpCode = httpCode;
	}
}

const isMutation = (query: string) => /^\s*mutation\b/.test(query || '');
const isRetryable = (error: TaddyApiError) =>
	['NETWORK_ERROR', 'TADDY_SERVER_ERROR'].includes(error.code) || /^HTTP_5\d\d$/.test(error.code);

interface GraphqlErrorEntry {
	message?: string;
	code?: string;
	extensions?: { code?: string };
}

interface FullResponse {
	body: unknown;
	statusCode: number;
	statusMessage?: string;
}

async function sendOnce(
	ctx: TaddyContext,
	query: string,
	variables: IDataObject,
	timeoutMs: number,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: TADDY_API_URL,
		body: { query, variables },
		json: true,
		headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
		timeout: timeoutMs,
		ignoreHttpStatusErrors: true,
		returnFullResponse: true,
	};

	let response: FullResponse | undefined;
	let transportError: unknown;
	try {
		response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			CREDENTIAL_NAME,
			options,
		)) as FullResponse;
	} catch (error) {
		transportError = error;
	}
	if (!response) {
		const text = String((transportError as Error)?.message ?? transportError);
		const causeCode = (transportError as { cause?: { code?: string } })?.cause?.code ?? '';
		if (/timeout|ECONNABORTED|ETIMEDOUT/i.test(`${text} ${causeCode}`)) {
			throw new TaddyApiError(
				`Taddy API request timed out after ${Math.round(timeoutMs / 1000)}s`,
				'TIMEOUT',
			);
		}
		throw new TaddyApiError(
			`Could not reach the Taddy API (${causeCode || text})`,
			'NETWORK_ERROR',
		);
	}

	let body = response.body as { data?: IDataObject; errors?: GraphqlErrorEntry[] } | string | null;
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body) as { data?: IDataObject; errors?: GraphqlErrorEntry[] };
		} catch {
			body = null;
		}
	}

	const errors = body && typeof body === 'object' ? body.errors : undefined;
	if (Array.isArray(errors) && errors.length) {
		const message = errors
			.map((entry) => entry.message)
			.filter(Boolean)
			.join('\n');
		const code = errors[0].code || errors[0].extensions?.code || 'GRAPHQL_ERROR';
		throw new TaddyApiError(message || 'GraphQL request failed', code, response.statusCode);
	}

	if (response.statusCode >= 400) {
		const raw =
			typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? '');
		throw new TaddyApiError(
			`Taddy API responded with HTTP ${response.statusCode}${raw ? `: ${raw.slice(0, 300)}` : ''}`,
			`HTTP_${response.statusCode}`,
			response.statusCode,
		);
	}

	return body && typeof body === 'object' ? (body.data ?? {}) : {};
}

/**
 * Sends one GraphQL operation to the Taddy API using the node's credential. Retries once after
 * 1 s on network errors, HTTP 5xx and TADDY_SERVER_ERROR; mutations, timeouts and rate limits
 * are never retried. Throws NodeApiError with the Taddy error code and a hint.
 */
export async function taddyApiRequest(
	this: TaddyContext,
	query: string,
	variables: IDataObject = {},
	options: TaddyRequestOptions = {},
): Promise<IDataObject> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let failure: unknown;
	try {
		return compact(await sendOnce(this, query, variables, timeoutMs));
	} catch (error) {
		failure = error;
	}

	const canRetry = failure instanceof TaddyApiError && isRetryable(failure) && !isMutation(query);
	if (canRetry) {
		await sleep(RETRY_DELAY_MS);
		try {
			return compact(await sendOnce(this, query, variables, timeoutMs));
		} catch (error) {
			failure = error;
		}
	}

	if (failure instanceof TaddyApiError) {
		throw new NodeApiError(
			this.getNode(),
			{ code: failure.code, message: failure.message } as JsonObject,
			{
				message: `${failure.code}: ${failure.message}`,
				description: ERROR_HINTS[failure.code],
				httpCode: failure.httpCode ? String(failure.httpCode) : undefined,
				itemIndex: options.itemIndex,
			},
		);
	}
	throw new NodeOperationError(this.getNode(), failure as Error, { itemIndex: options.itemIndex });
}

/** Returns the Taddy error code carried by an error thrown from taddyApiRequest, if any. */
export function taddyErrorCode(error: unknown): string | undefined {
	const message = (error as Error)?.message ?? '';
	const match = /^([A-Z_0-9]+):/.exec(message);
	return match ? match[1] : undefined;
}
