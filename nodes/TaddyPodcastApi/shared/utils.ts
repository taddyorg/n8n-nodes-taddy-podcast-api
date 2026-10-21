import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

/** Recursively drops null/undefined object keys. Array entries are kept. */
export function stripNulls<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => stripNulls(entry)) as unknown as T;
	}
	if (value && typeof value === 'object') {
		const result: IDataObject = {};
		for (const [key, entry] of Object.entries(value as IDataObject)) {
			if (entry === null || entry === undefined) continue;
			result[key] = stripNulls(entry);
		}
		return result as T;
	}
	return value;
}

/**
 * Strips nulls inside the response but keeps top-level keys, so a lookup that found nothing
 * still reads as `{ getPodcastSeries: null }` instead of `{}`.
 */
export function compact(data: IDataObject | undefined | null): IDataObject {
	if (!data || typeof data !== 'object') return {};
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(data)) {
		result[key] = value === null || value === undefined ? null : stripNulls(value);
	}
	return result;
}

/** Accepts an array, or a string separated by commas and/or newlines. Returns trimmed, non-empty entries. */
export function parseStringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
	}
	if (typeof value === 'string') {
		return value
			.split(/[\n,]/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
	if (value === undefined || value === null || value === '') return [];
	return [String(value).trim()];
}

/** Converts an n8n dateTime value (ISO string, Date, or epoch seconds/milliseconds) to Unix seconds. */
export function toEpochSeconds(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') {
		return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
	}
	const str = String(value).trim();
	if (/^\d+$/.test(str)) return toEpochSeconds(Number(str));
	const ms = new Date(str).getTime();
	if (Number.isNaN(ms)) return undefined;
	return Math.floor(ms / 1000);
}

/** Returns a copy of `variables` without undefined / null / empty-string values. */
export function cleanVariables(variables: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(variables)) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		result[key] = value;
	}
	return result;
}

/** Wraps plain objects as n8n items linked to the input item at `itemIndex`. */
export function toItems(records: IDataObject[], itemIndex: number): INodeExecutionData[] {
	return records.map((json) => ({ json, pairedItem: { item: itemIndex } }));
}

/** Pulls an array out of a GraphQL result, tolerating null. */
export function asArray(value: unknown): IDataObject[] {
	return Array.isArray(value) ? (value as IDataObject[]) : [];
}
