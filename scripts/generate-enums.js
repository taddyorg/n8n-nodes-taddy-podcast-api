#!/usr/bin/env node
// Dev-only script. Regenerates nodes/TaddyPodcastApi/shared/enums.ts from the Taddy
// monorepo's zero-dependency `@taddy/public` package so the node ships static option
// lists (n8n community nodes may not have runtime dependencies).
//
// Usage: node scripts/generate-enums.js [path/to/taddy/packages/public]
const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(
	process.argv[2] || path.join(__dirname, '../../../taddy/packages/public'),
);
const { allCountries, getPrettyCountry } = require(path.join(publicDir, 'country.js'));
const { allLanguages, getPrettyLanguage } = require(path.join(publicDir, 'language.js'));
const { iTunesGenreToTaddyGenre } = require(path.join(publicDir, 'genres.js'));
// Mirrors mcp/lib/enums.js PODCAST_WEBHOOK_EVENTS (podcast-only subset of Taddy's webhook events).
const PODCAST_WEBHOOK_EVENTS = [
	'podcastseries.created',
	'podcastseries.updated',
	'podcastseries.deleted',
	'podcastseries.new_episodes_released',
	'podcastseries.feed_updated',
	'podcastepisode.created',
	'podcastepisode.updated',
	'podcastepisode.deleted',
	'itunesinfo.created',
	'itunesinfo.updated',
	'itunesinfo.deleted',
];

const byName = (a, b) => a.name.localeCompare(b.name);
const title = (s) =>
	s
		.split('_')
		.map((w) => w[0] + w.slice(1).toLowerCase())
		.join(' ');

// Genres: PODCASTSERIES_* only. Sub-genres are rendered "Parent: Child" so the
// hierarchy stays readable and parents sort right before their children.
const genreValues = [...new Set(Object.values(iTunesGenreToTaddyGenre))]
	.filter((g) => g && g.startsWith('PODCASTSERIES_'))
	.sort();
const parents = genreValues.filter(
	(g) => !genreValues.some((p) => p !== g && g.startsWith(p + '_')),
);
const genreOptions = genreValues
	.map((value) => {
		const parent = parents.find((p) => value !== p && value.startsWith(p + '_'));
		const strip = (v) => v.replace(/^PODCASTSERIES_/, '');
		const pretty = (v) =>
			title(strip(v))
				.replace(/\bAnd\b/g, '&')
				.replace(/\bTv\b/g, 'TV');
		return {
			name: parent
				? `${pretty(parent)}: ${title(value.slice(parent.length + 1))
						.replace(/\bAnd\b/g, '&')
						.replace(/\bTv\b/g, 'TV')}`
				: pretty(value),
			value,
		};
	})
	.sort(byName);

const countryOptions = allCountries
	.map((value) => ({ name: getPrettyCountry(value), value }))
	.sort(byName);
const languageOptions = allLanguages
	.map((value) => ({ name: getPrettyLanguage(value), value }))
	.sort(byName);

const EVENT_LABELS = {
	podcastseries: 'Podcast',
	podcastepisode: 'Episode',
	itunesinfo: 'iTunes Info',
};
const webhookEventOptions = PODCAST_WEBHOOK_EVENTS.map((value) => {
	const [type, action] = value.split('.');
	return { name: `${EVENT_LABELS[type]} ${title(action.toUpperCase())} (${value})`, value };
}).sort(byName);

const render = (name, arr, type = 'INodePropertyOptions') =>
	`export const ${name}: ${type}[] = [\n${arr
		.map(
			(o) =>
				`\t{ name: ${JSON.stringify(o.name)}, value: ${JSON.stringify(o.value)}${o.description ? `, description: ${JSON.stringify(o.description)}` : ''} },`,
		)
		.join('\n')}\n];\n`;

const out = `// GENERATED FILE. Do not edit by hand. Regenerate with: npm run generate:enums
// Source: Taddy monorepo packages/public (country.js, language.js, genres.js, webhook.js).
import type { INodePropertyOptions } from 'n8n-workflow';

${render('GENRE_OPTIONS', genreOptions)}
${render('COUNTRY_OPTIONS', countryOptions)}
${render('LANGUAGE_OPTIONS', languageOptions)}
${render('WEBHOOK_EVENT_OPTIONS', webhookEventOptions)}
export const WEBHOOK_EVENTS: string[] = ${JSON.stringify(PODCAST_WEBHOOK_EVENTS, null, '\t')};
`;

const target = path.join(__dirname, '../nodes/TaddyPodcastApi/shared/enums.ts');
fs.writeFileSync(target, out);
console.log(
	`Wrote ${path.relative(process.cwd(), target)}: ${genreOptions.length} genres, ${countryOptions.length} countries, ${languageOptions.length} languages, ${webhookEventOptions.length} webhook events`,
);
