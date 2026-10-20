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

## Actions #2 follow-up: HTML robots response is confirmed, its cause is not

The user supplied confirmed results from **GitHub Actions #2, run `39397725727`**:

| Source/stage     | Runner observation                                           | Correct interpretation                                                                                            |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Global robots    | HTTP `200`, `Content-Type: text/html`, `ROBOTS_HTML`, `deny` | The response is not a usable robots representation. HTML must not be parsed as an empty allow-all file.           |
| CN robots        | HTTP `404`, `ROBOTS_NOT_FOUND`, `allow-no-file`              | The missing-file handling now distinguishes a real HTTP `404` from transport failures.                            |
| CN source policy | `TERMS_UNREVIEWED`, `deny`                                   | Robots availability does not grant terms approval. Page/article collection remains disabled.                      |
| Live result      | `liveRecords: 0`; tests and build pass                       | No real banner has been synchronized. Passing engineering checks do not verify upstream event data or permission. |

These facts narrow the Global failure to an HTML response, but **do not establish whether the HTML is an SPA fallback, a challenge/protection page, a generic error page, or another website/server configuration**. The supplied report does not include the body, page title, root/app markers, asset references, final URL or a homepage comparison. A Content-Type alone cannot distinguish those causes.

### Current-cloud evidence and access limitation

Rechecked on **2026-10-20 at 09:09 UTC / 16:09 Vietnam** using TLS verification, a five-redirect limit and bounded request timeouts:

| Requested URL                             | curl exit | Proxy CONNECT | Origin HTTP          | Origin Content-Type | Redirect count / downloaded bytes |
| ----------------------------------------- | --------- | ------------- | -------------------- | ------------------- | --------------------------------- |
| `https://www.arknights.global/robots.txt` | 56        | 403           | Not received (`000`) | Not received        | 0 / 0                             |
| `https://www.arknights.global/`           | 56        | 403           | Not received (`000`) | Not received        | 0 / 0                             |
| `https://ak.hypergryph.com/robots.txt`    | 56        | 403           | Not received (`000`) | Not received        | 0 / 0                             |
| `https://ak.hypergryph.com/`              | 56        | 403           | Not received (`000`) | Not received        | 0 / 0                             |

Each curl request reported `CONNECT tunnel failed, response 403`. No origin HTML, robots representation or redirect was received. `gh run view 39397725727 --repo minhduc25022005/arknights-pull-calculator --log` also failed with `Forbidden` at the GitHub API run endpoint, so this instance could not retrieve or independently inspect the runner artifact/body.

The cloud result and runner result describe different network paths. The cloud CONNECT failure is **not** a contradiction of the user's Global HTTP `200` or CN HTTP `404` observations, and must not be substituted for them.

### Evidence required to determine the Global HTML cause

A bounded, manually initiated diagnostic in a network context that can access the official roots can compare the actual Global homepage and `/robots.txt` response metadata and HTML fingerprints:

- Identical response bodies or matching normalized HTML fingerprints, together with the same app/root and script assets, support an SPA fallback diagnosis.
- Actual challenge/verification markers, forms or explicit protection-provider metadata support a protection-page diagnosis; a generic HTML content type does not.
- A final URL or redirect to a known error/landing page can support a website routing diagnosis. Any conclusion must retain the observed redirect and response evidence.
- Missing, contradictory or incomplete evidence must remain **unknown**. A diagnostic hint never authorizes automatic collection, bypassing a challenge, or changing terms-review flags.

No official notice page, public feed/API, linked terms or real banner announcement was verified in this cloud recheck because the official root documents could not be read. No alternative domain, mirror, invented endpoint or access-control bypass was used. Both source adapters must remain gated until the actual source structure and permission are reviewed; the manually reviewed original-announcement import remains the usable path for real data supplied and verified by a reviewer. No public event record or source-policy flag was changed by this investigation.

### Manual bounded source-audit tool execution

The new manually initiated `scripts/audit-sources.mjs` was executed with the platform proxy on **2026-10-20T09:15:10.374Z** (16:15:10 Vietnam). It exited `2` and emitted metadata-only JSON. All four known official roots were attempted once; both homepage and robots requests for each server returned `NETWORK_PROXY_DENIED` before an origin response. Both comparisons were `unavailable`; `collectionEnabled`, `permissionVerified`, `sourcePolicyChanged` and `liveSyncVerified` remained `false`, with `liveRecords: 0`.

The tool did not receive HTML and therefore could not compute real Global fingerprints, discover a real terms/news/feed/API link, or verify an announcement. It made no linked-page or asset requests and changed no source policy, curated record, or public calendar. The separate manual-only **Manually inspect official banner sources** workflow can collect the same bounded evidence in a GitHub-hosted runner; it has `contents: read`, uploads a seven-day artifact, and never commits or enables collection. Its comparison classifications are hypotheses backed by fingerprints/markers, not proof of permission or a live synchronization.

### Explicit official article requested by the user

The user subsequently supplied the actual Global announcement URL **`https://www.arknights.global/news/4814`** for structure inspection and separate human-reviewed banner facts. A supplied official link is a useful review lead; it is not evidence that this machine fetched its body, verified its publication date, or established the publisher's collection terms.

The bounded audit was run with that explicit URL on **2026-10-20T09:18:06.562Z** (16:18:06 Vietnam):

```sh
node --use-env-proxy scripts/audit-sources.mjs --announcement https://www.arknights.global/news/4814
```

The optional article read was attempted exactly once, in addition to the four known roots. It also failed with `NETWORK_PROXY_DENIED` before any origin response; the report has `received: false`, no origin HTTP status, no Content-Type, no redirects, `structure.available: false` and no publication candidates. The CLI exited `2`, `liveRecords` stayed `0`, and both collection/permission flags stayed false. No linked article, asset, API or arbitrary URL was requested.

The optional workflow input `announcement_url` supports this same explicitly requested inspection on a GitHub-hosted runner. If actual HTML is received, it reports only observed JSON-LD keys/type names and named publication/modification candidates. Date-only values stay date-only; publication is never converted into an event start date, no banner facts are auto-imported, and the report never establishes collection permission. Human-supplied facts must remain attributed to human review independently of this machine's blocked request.

### Human-reviewed notice 4814 added through the import path

The user supplied the notice title **Sealed With Time**, Global Limited Headhunting, the original source URL above, the event bounds **14 October 2026 08:00 UTC−7** to **28 October 2026 03:59 UTC−7**, Operators **Kal'tsit Esperanta (Limited), Closure, Crackborne**, update day **9 October 2026**, and the section **02 LIMITED HEADHUNTING OPEN – SEALED WITH TIME**.

That user-provided extract was checked and imported with the normal CLI into `data/curated-banners.json` and `public/data/banners.json`. Its review explicitly records `method: user-provided-extract` and `sourceFetched: false`, with five field-specific extracts attributed to the user. This is human-attested data, **not** a fetched HTML fixture or an independently machine-verified announcement. The source update has `publicationPrecision: day` / `publicationKind: updated`; no publication hour was invented. Event boundaries normalize to `2026-10-14T15:00:00.000Z` / `2026-10-28T10:59:00.000Z`, displayed as 22:00 / 17:59 in Vietnam.

The calendar now has this one sourced manual Global entry. No CN confirmation or statistical estimate was manufactured. Re-importing the same packet kept both files byte-identical. The existing live-sync error/`lastSuccessAt: null` remains, and neither terms-review flag was changed. The original-site body and collection permission are still unverified by this machine.
