# Official-source access audit

Checked from the actual cloud machine on **2026-10-20 at 08:11 UTC** (15:11, Vietnam / `Asia/Ho_Chi_Minh`). Only the two official URLs supplied for this project and the standard `/robots.txt` resource were requested. TLS verification remained enabled. No API endpoint, RSS URL, article path, or terms URL was guessed.

## Observed requests

| Requested URL                             | Result                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `https://www.arknights.global/`           | `curl` exit 56: `CONNECT tunnel failed, response 403`; target HTTP status `000` |
| `https://www.arknights.global/robots.txt` | Same proxy CONNECT failure                                                      |
| `https://ak.hypergryph.com/`              | Same proxy CONNECT failure                                                      |
| `https://ak.hypergryph.com/robots.txt`    | Same proxy CONNECT failure                                                      |

The CONNECT response was `HTTP/1.1 403 Forbidden` from an `envoy` proxy. This happened before an HTTPS connection to the official website was established. It **does not** establish that either official website denies automated access or is unavailable publicly. It does establish that this cloud instance could not inspect either website during this audit.

## What remains unverified

- Official news article URLs and their response/DOM structure.
- A public, official API or RSS feed. **No feed or API has been verified.**
- Contents of `robots.txt`, including any crawler restrictions or crawl delay.
- Links to, and contents of, each site's terms of use; whether a particular automated extraction is permitted.
- The timezone notation used by each announcement. A server name alone must not silently supply a timezone to an ambiguous source date.
- A successful live synchronization of any event, banner, operator, or announcement date.

Consequently, an empty initial calendar and a failed-source warning are honest outcomes. Synthetic fixtures used by tests must never be published as real events. Manually reviewed entries must retain the exact article URL and field-specific evidence; manual review does not turn a community source into an official source.

## Steps needed before enabling a source adapter

1. Allow HTTPS access to `www.arknights.global` and `ak.hypergryph.com` in the environment's network settings. Additional article/asset/API domains must be discovered from actual official content and reviewed before being added. Do not broaden access with a wildcard just to bypass an unknown dependency.
2. Fetch each homepage and `robots.txt` again through the supported proxy. Follow only official links to identify news listings, linked terms, and any documented public feed/API. Record the URLs, access date, policy observations, response shape, and article fixtures in this audit.
3. If robots or terms disallow the proposed collection, keep that source adapter disabled. If policy or structure cannot be established, continue using the manual review/import path rather than guessing.
4. Prefer a documented public feed/API when one is actually found. Otherwise implement a limited, conservative official-page extractor that respects source policy. Retrieve announcements in a server-side Node.js job, never from the application browser.
5. Confirm at least one real synchronization against a verified official announcement and inspect the resulting fields. A successful homepage request, successful unit tests, or a failed scheduled run is not a successful event synchronization.

## Required normalization behavior

- Validate official hostname **and** matching server. A CN announcement cannot confirm a Global date.
- Retain source URL/name, publication timestamp, collection/update timestamp, and which fields the source actually confirms.
- Only store precise timestamps when the source has an explicit timezone/offset, or a separately reviewed source timezone rule. Do not parse an offset-free date with the machine's local timezone. Display conversion to Vietnam separately from the original source notation.
- Keep an officially announced event with no confirmed date distinct from a wholly unknown event and from a statistical Global prediction.
- Keep the last valid public records when requests, policy checks, parsing, validation, or upstream structure fail. Report the unsuccessful attempt separately from the last successful event/data update.
- Deduplicate stable identities and reviewed CN/Global event links, without inferring that release order or transliterated titles establish a match.
- Treat GitHub Actions scheduling as automation infrastructure, not evidence that official-source synchronization has succeeded.

## Current deployment status

The source-access prerequisite is unresolved in this cloud instance. This audit authorizes no scraping and makes no claim of a live official-source sync. The UI, manual review flow, prediction algorithm and job failure handling can be tested independently while official sources remain inaccessible. A production automated adapter should stay gated until the policy and parser checks above are complete.
