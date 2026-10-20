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

## Follow-up: reported Actions run and current-machine recheck

The user supplied these observations from GitHub Actions **run `39394219723` / job `118532842204`**:

- CN `robots.txt`: HTTP `404`.
- Global `robots.txt`: the previous parser reported `unavailable or ambiguous`.
- `liveRecords: 0`, `status: error`, sync exit `2`; tests/build succeeded, and the workflow subsequently failed its live-sync reporting step.

These are **reported runner observations**, not an HTTP transcript retrieved by this cloud instance. An attempt to read the job log with `gh run view ... --job ... --log` failed at `https://api.github.com/repos/minhduc25022005/arknights-pull-calculator/actions/jobs/118532842204` with `Forbidden`. The exact GitHub web job URL supplied by the run/job identifiers was also requested; it returned HTTP `404` (`text/plain; charset=utf-8`) and exposed no log. This does not establish that the user's run is invalid or nonexistent: this execution context could not obtain its log.

Rechecked here on **2026-10-20 at 08:39:40 UTC / 15:39:40 Vietnam** with TLS verification enabled and bounded HTTPS redirect following:

| URL                                       | curl exit | Proxy CONNECT | Origin status        | Origin Content-Type | Origin redirects/body |
| ----------------------------------------- | --------- | ------------- | -------------------- | ------------------- | --------------------- |
| `https://www.arknights.global/robots.txt` | 56        | 403           | Not received (`000`) | Not received        | None received         |
| `https://www.arknights.global/`           | 56        | 403           | Not received (`000`) | Not received        | None received         |
| `https://ak.hypergryph.com/robots.txt`    | 56        | 403           | Not received (`000`) | Not received        | None received         |
| `https://ak.hypergryph.com/`              | 56        | 403           | Not received (`000`) | Not received        | None received         |

The proxy's own error response had `Content-Type: text/plain` and `server: envoy`; these headers describe the **CONNECT rejection**, not either official website or its robots representation. It would be incorrect to label this an origin HTTP `403`, a missing origin robots file (`404`), an HTML robots response, a redirect, or evidence of source-site terms.

Consequently the exact live Global response status, Content-Type, redirect target and body are still unverified here. The old error string alone cannot establish why it was ambiguous: the old `User-agent:`-presence check rejected legitimate plain-text empty/comment/Sitemap-only files as well as unsupported HTML fallback pages. Diagnostics must distinguish those cases instead of claiming a particular website response without a transcript.

No official news page, linked terms, API or RSS was discovered during this recheck because no origin HTML was received. Both terms-review gates must remain disabled. The current-machine failure does not contradict an actual `404` seen on a GitHub-hosted runner; the two execution environments have different network paths.

### Robots protocol reference and collection policy

Reference: [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), especially §§2.2, 2.3.1.2–2.3.1.5. The official RFC URL was also blocked by this machine's CONNECT proxy during the recheck; it was not downloaded here. The implementation and tests should retain these distinctions:

- An actual origin HTTP `404`/`410` is an unavailable robots representation. RFC §2.3.1.3 permits a crawler to access resources after a `4xx`; that permission is a **MAY**, not a requirement to scrape or an authorization from terms of use.
- The project may conservatively deny other `4xx`, including authorization/access refusals (`401`/`403`) and rate limiting (`429`). A proxy CONNECT failure is a transport error, never evidence of a missing robots file.
- Origin `5xx`, network failures and timeouts are unreachable; §2.3.1.4 requires assuming complete disallow. Do not replace them with an empty allow-all file.
- A usable UTF-8 plain-text robots file can be empty, comment-only, contain only extension records such as Sitemap, or have no matching group. Lack of a `User-agent:` line by itself is not proof of ambiguity. Parse usable rules rather than rejecting every file that also has an invalid line.
- HTTP `200` HTML, an SPA fallback, authentication/challenge markup or unsupported media type must not be reclassified as a genuine `404`. Preserve response classification, safe redirect metadata and Content-Type; deny ambiguous collection rather than quietly treating it as no rules.
- RFC §2.3.1.2 recommends following at least five consecutive robots redirects, including across authorities; project restrictions may still reject a redirect outside explicitly approved official origins. Report this as an explicit redirect policy refusal, without fetching an unapproved destination or claiming the origin file is missing.
- A robots decision and terms approval are separate gates. Neither `404` nor allow-all rules changes `permitsAutomatedCollection` or proves the source's terms allow the proposed collection.

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

## Follow-up diagnostic execution after the RFC handling fix

`npm run --silent banners:diagnose` was executed in the cloud machine at **2026-10-20T08:45:41.950Z** (15:45:41 Vietnam). It returned exit `2`, `liveRecords: 0`, `written: false`. Both sources were classified as `NETWORK_PROXY_DENIED` with no origin `httpStatus`, no redirect response and no response body. The diagnostic did not modify the public catalog or curated records. This checks the live error path, **not** a successful official-event synchronization. The source-policy flags remain unchanged and disabled.

The next Actions run will print the structured report and retain it as `banner-source-diagnostics-<run_id>-<attempt>` for seven days. That future report is required to establish the actual Global HTTP response, MIME type and redirect path on the GitHub-hosted runner; no specific upstream HTML fallback or endpoint is asserted in advance.
