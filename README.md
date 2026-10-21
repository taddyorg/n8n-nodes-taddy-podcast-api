# n8n-nodes-taddy-podcast-api

This is an n8n community node for the [Taddy Podcast API](https://taddy.org/developers/podcast-api). It lets you search 4M podcasts and 200M episodes, read Apple Podcasts top charts, fetch episode transcripts and chapters, manage Taddy webhooks, and start workflows when Taddy sends a webhook event.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Trigger node](#trigger-node)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-taddy-podcast-api`.

## Operations

The **Taddy Podcast API** node mirrors the tools of the [Taddy MCP server](https://taddy.org/mcp/podcast-api). Every operation sends one GraphQL request to `https://api.taddy.org`, which counts as one request against your monthly quota.

| Resource | Operation | Taddy API field |
| --- | --- | --- |
| Podcast | Get | `getPodcastSeries` by UUID, iTunes ID, RSS URL or name |
| Podcast | Get Episodes | `getPodcastSeries { episodes }` with sort order, search term and paging |
| Podcast | Get Many | `getMultiplePodcastSeries` (up to 25 UUIDs) |
| Podcast | Get Latest Episodes | `getLatestPodcastEpisodes` across up to 1000 podcasts |
| Podcast | Get iTunes Info | `getItunesInfo` |
| Episode | Get | `getPodcastEpisode` by UUID, GUID or name |
| Episode | Get Many | `getMultiplePodcastEpisodes` (up to 25 UUIDs) |
| Episode | Get Transcript | `getEpisodeTranscript` (paragraph or utterance style, on-demand or podcast-provided only) |
| Episode | Get Chapters | `getEpisodeChapters` |
| Search | Search | `search` with every filter (genres, languages, countries, dates, duration, has transcript, ...) |
| Chart | Get Popular Podcasts | `getPopularContent` (Taddy's all-time ranking) |
| Chart | Get Top Charts by Country | `getTopChartsByCountry` (Apple Podcasts, daily) |
| Chart | Get Top Charts by Genres | `getTopChartsByGenres` (Apple Podcasts, daily) |
| Webhook | Get Many, Create, Update, Delete | `getMyDeveloperWebhooks`, `addWebhookUrlForUser`, `updateWebhookForUser`, `deleteWebhookForUser` |
| Webhook | Get Filter, Create Filter, Update Filter, Delete Filter | `getWebhookFilterByUuid`, `addWebhookFilter`, `updateWebhookFilter`, `deleteWebhookFilter` |
| Webhook | Add to / Remove From Allowlist, Add to / Remove From Blocklist | `addUuidToWebhookFilterAllowlist` and friends |
| Webhook | Send Mock Event, Replay Failed Events | `mockWebhookEvent`, `replayFailedWebhookEvents` |
| Account | Get Usage | `getApiRequestsRemaining`, `getTranscriptCreditsRemaining` |
| GraphQL | Execute Query | any query or mutation, with JSON variables |

Common options:

- **Custom Fields**: a GraphQL selection that replaces the default field set for the returned type. The key field (`uuid` or `id`) is added for you; nested objects you select must include their own key field.
- **Split Into Items**: list operations output one n8n item per podcast, episode, transcript segment or webhook. Turn it off to get the raw API response as a single item (for example to keep `searchId` and `responseDetails`).
- **Page / Limit Per Page**: paging follows the API limits (search 20 pages x 25, charts 8 x 25, podcast episodes 1000 x 25, latest episodes 20 x 50). There is no automatic "return all" because every page is a billable request.

## Trigger node

The **Taddy Podcast API Trigger** node starts a workflow when Taddy delivers a webhook event. Webhooks need a Taddy **Business** plan.

- On activation the node registers the workflow's webhook URL with Taddy for the selected events (`addWebhookUrlForUser`); on deactivation it deletes that webhook again.
- Every delivery is checked against the secret Taddy issued at registration (`X-TADDY-WEBHOOK-SECRET` header). Mismatches get a 401 and do not start the workflow.
- **Only These Podcasts** creates an allowlist filter per event so you only receive events about the podcasts you care about. Without a filter, `podcastepisode.created` alone delivers roughly 50k events per day.
- An account has one webhook endpoint by default. If activation fails with an access error, delete the unused webhook in the [dashboard](https://taddy.org/dashboard) or ask danny@taddy.org for more endpoints.
- n8n must be reachable from the internet (set `WEBHOOK_URL` when running behind a tunnel or proxy).
- Each item carries `uuid`, `taddyType`, `action`, `timestamp`, `data` and, when filters matched, `matchingFilters`. An episode dropped from its feed arrives as `podcastepisode.updated` with `isRemoved: true`.
- Deliveries that failed can be replayed for 14 days with Webhook > Replay Failed Events in the action node.

## Credentials

1. Sign up for a Taddy API account at [taddy.org/signup/developers](https://taddy.org/signup/developers).
2. Open the [dashboard](https://taddy.org/dashboard) and click **Get my API Key**.
3. In n8n create a **Taddy Podcast API** credential with your **User ID** and **API Key**. The credential test calls `getApiRequestsRemaining`.

Plans: the Free plan includes 500 requests per month and podcast-provided transcripts. Taddy-generated (on-demand) transcripts need Pro or Business and cost one transcript credit per episode per month; webhooks need Business. See [pricing](https://taddy.org/developers/pricing).

## Compatibility

Built and tested with n8n 2.x (`n8n-workflow` 2.16+) and Node.js 22 or newer. The package has no runtime dependencies.

## Usage

- Dates in results are Unix timestamps in seconds; durations are seconds; transcript and chapter timecodes are milliseconds. Date filters in the Search operation accept any n8n date value and are converted for you.
- `description` fields contain HTML. Add `description(shouldStripHtmlTags: true)` to Custom Fields for plain text.
- A lookup that finds nothing returns one item such as `{ "getPodcastSeries": null }` instead of failing, so you can branch on it.
- Errors carry the Taddy error code (`API_KEY_INVALID`, `API_RATE_LIMIT_EXCEEDED`, `QUERY_TOO_COMPLEX`, `ACCESS_NOT_ALLOWED`, ...) and a hint. Network errors, 5xx responses and `TADDY_SERVER_ERROR` are retried once.
- Episode > Get Transcript waits up to six minutes when a transcript has to be generated. Use **Only Podcast-Provided Transcript** when you want to avoid spending credits.

### Developing locally

```bash
npm install
npm run dev        # builds in watch mode and starts n8n at http://localhost:5678 with the node loaded
npm run lint
npm run build
npm run generate:enums   # refreshes genre/country/language lists from ../../taddy/packages/public
npm run test:queries     # validates every GraphQL document the nodes build against the published schema (offline)
npm run test:trigger     # checks the trigger's webhook secret verification (offline)
TADDY_USER_ID=... TADDY_API_KEY=... npm run test:smoke   # live smoke test, about a dozen requests against api.taddy.org
```

The icons in `icons/` are placeholders; replace them with the official Taddy logo (light and dark SVG) before publishing.

## Resources

- [Taddy Podcast API documentation](https://taddy.org/developers/podcast-api)
- [Taddy webhooks](https://taddy.org/developers/podcast-api/webhooks)
- [Taddy MCP server](https://taddy.org/mcp/podcast-api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version history

- **0.1.0**: initial release with the action node, the trigger node and the credential.
