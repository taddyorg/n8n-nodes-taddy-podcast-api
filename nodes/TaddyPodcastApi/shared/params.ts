import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { parseStringList } from './utils';

/** Reads the Look Up By selector and its value field into GraphQL variables, e.g. { rssUrl }. */
export function getLookupVariables(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const lookupBy = ctx.getNodeParameter('lookupBy', itemIndex) as string;
	const value = ctx.getNodeParameter(lookupBy, itemIndex) as string | number;
	const empty =
		value === undefined ||
		value === null ||
		value === '' ||
		(lookupBy === 'itunesId' && value === 0);
	if (empty) {
		throw new NodeOperationError(ctx.getNode(), `Enter a value for "${lookupBy}"`, { itemIndex });
	}
	return { [lookupBy]: lookupBy === 'itunesId' ? Number(value) : String(value).trim() };
}

/** Reads a value from the operation's Options collection. */
export function getOption<T>(
	ctx: IExecuteFunctions,
	itemIndex: number,
	name: string,
	fallback: T,
): T {
	const options = ctx.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const value = options[name];
	return value === undefined || value === null || value === '' ? fallback : (value as T);
}

/** Reads a comma-separated / array list parameter and enforces size limits. */
export function getListParam(
	ctx: IExecuteFunctions,
	itemIndex: number,
	name: string,
	options: { label: string; max?: number; required?: boolean },
): string[] {
	const raw = ctx.getNodeParameter(name, itemIndex, '') as unknown;
	const list = parseStringList(raw);
	if (options.required && list.length === 0) {
		throw new NodeOperationError(ctx.getNode(), `Enter at least one ${options.label}`, {
			itemIndex,
		});
	}
	if (options.max !== undefined && list.length > options.max) {
		throw new NodeOperationError(
			ctx.getNode(),
			`At most ${options.max} ${options.label}s can be sent per request (got ${list.length})`,
			{ itemIndex },
		);
	}
	return list;
}

/** Reads a boolean parameter with a default. */
export function getBool(
	ctx: IExecuteFunctions,
	itemIndex: number,
	name: string,
	fallback: boolean,
): boolean {
	return ctx.getNodeParameter(name, itemIndex, fallback) as boolean;
}
