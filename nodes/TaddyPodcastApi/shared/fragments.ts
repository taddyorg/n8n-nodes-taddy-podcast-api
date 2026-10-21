// Default GraphQL field selections. They mirror mcp/lib/fragments.js in the Taddy monorepo,
// which in turn mirror the field sets a Taddy webhook payload carries, so data looks the same
// whether it arrives through this node's operations or through the trigger node.

const PODCASTSERIES_SELECTION = `uuid hash name description imageUrl datePublished language seriesType contentType
	isExplicitContent copyright websiteUrl rssUrl rssOwnerName rssOwnerPublicEmail authorName isCompleted isBlocked
	itunesId genres childrenHash popularityRank
	itunesInfo { uuid publisherId publisherName baseArtworkUrl baseArtworkUrlOf(size: 640) }`;

const PODCASTEPISODE_SELECTION = `uuid hash name description imageUrl datePublished guid subtitle audioUrl videoUrl
	fileLength fileType duration episodeType seasonNumber episodeNumber websiteUrl isExplicitContent isRemoved
	podcastSeries { uuid name rssUrl itunesId language genres popularityRank }`;

const ITUNESINFO_SELECTION = `uuid hash subtitle summary baseArtworkUrl publisherId publisherName country
	podcastSeries { uuid name rssUrl itunesId language genres popularityRank }`;

export const SERIES_FIELDS = `${PODCASTSERIES_SELECTION} totalEpisodesCount taddyTranscribeStatus`;
export const EPISODE_FIELDS = `${PODCASTEPISODE_SELECTION} taddyTranscribeStatus`;
export const ITUNES_FIELDS = ITUNESINFO_SELECTION;

export const FILTER_FIELDS =
	'uuid webhookId eventType description clause1 clause2 clause3 clause4 clause5 hasIncludedUuids hasExcludedUuids includedUuids excludedUuids';
export const WEBHOOK_FIELDS = `id endpointUrl events isActive isVerified createdAt filters { ${FILTER_FIELDS} }`;
export const NEW_WEBHOOK_FIELDS =
	'id endpointUrl events isActive isVerified webhookSecret createdAt';

export const TRANSCRIPT_ITEM_FIELDS = 'id text speaker startTimecode endTimecode';
export const CHAPTER_FIELDS = 'id title startTimecode';
export const SEARCH_RESPONSE_DETAILS = 'id type totalCount pagesCount';

/**
 * Returns the custom selection with the type's key field prepended, or the default selection
 * when the custom one is empty. The Taddy API rejects selections that leave out the key field.
 */
export function selection(custom: unknown, defaultSelection: string, keyField: string): string {
	const trimmed = typeof custom === 'string' ? custom.trim() : '';
	return trimmed ? `${keyField} ${trimmed}` : defaultSelection;
}
