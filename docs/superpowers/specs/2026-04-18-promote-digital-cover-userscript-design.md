# Promote Digital Cover Userscript — Design

## Summary

A MusicBrainz userscript that surfaces a button on release and release-group pages suggesting the user promote a digital release's cover art to the release-group level. On the set-cover-art edit page, it renders the existing and proposed covers side-by-side for visual comparison.

Motivation: digital releases usually have higher-quality artwork than scans of physical media. When the release group's current cover comes from a non-digital release, a one-click nudge helps editors upgrade it.

## Scope

### In scope

- New userscript at `userscripts/mb-promote-digital-cover.user.js`.
- Button shown on any release page and release group page in a qualifying release group.
- Side-by-side preview injection on the `/release-group/<mbid>/set-cover-art` edit page.
- Two triggering scenarios:
  - **Scenario 1**: RG cover comes from a non-digital release, and a digital release in the group has cover art.
  - **Scenario 2**: RG cover comes from a non-digital release, and a digital release exists in the group without cover art yet. Button routes the user to that release's "add cover art" page.
- README update describing the new script.

### Out of scope (v1)

- Enhancements to the release's own "add cover art" page (scenario 2's destination).
- Automating the actual submission of the set-cover-art edit.
- Client-side-nav support (`MutationObserver`). Script runs once per page load.
- Detecting non-`Digital Media` formats (e.g. `Download Card`). Only strict `Digital Media` format counts.
- Handling hybrid releases (mixed physical + digital media) as digital targets.

## Definitions

- **Digital release**: a release where *every* medium has format `Digital Media`. A release with any physical medium does not qualify, even if it also has a digital medium.
- **Current RG cover**: the release group's current front cover image. Identified via the CAA JSON endpoint, which records which release each image came from.
- **Triggering scenarios** (button shown if any apply):
  - **Scenario 1**: RG cover is non-digital (or absent); at least one digital release has cover art.
  - **Scenario 2**: RG cover is non-digital (or absent); digital release(s) exist but none has cover art.
- **Non-triggering** (button hidden):
  - RG cover is already from a digital release.
  - No digital release exists in the group.

"RG cover absent" is folded into the non-digital case, since the fix is identical: promote a digital release's cover (uploading first, if needed).

## Architecture

### Script shape

- Single `.user.js` file, plain JavaScript, `@grant none`, single IIFE.
- Same structure as `userscripts/amazon-audiobook-importer.user.js`: constants at top, pure helpers, then main logic.
- `@match` patterns:
  - `https://musicbrainz.org/release/*`
  - `https://musicbrainz.org/release-group/*`
- The script branches on `location.pathname`:
  - On release or release group view pages → run "button mode".
  - On `/release-group/<mbid>/set-cover-art` → run "preview mode".

### Data sources

1. **MusicBrainz Web Service** — `GET /ws/2/release-group/<mbid>?inc=releases+media&fmt=json`
   - Returns the full release list with `media[].format` and per-release `cover-art-archive: {artwork, front, darkened, ...}`.
2. **Cover Art Archive JSON** — `GET https://coverartarchive.org/release-group/<mbid>`
   - Returns `images[]`, each with `front: bool`, `types[]`, and a `release` URL identifying which release the image is from.

One call to each endpoint per page load. Both return JSON. A custom `User-Agent` header is set (MB requires it):

```
musicbrainz-helpers-userscript/<version> (github.com/benmayne/musicbrainz-helpers)
```

(Userscripts can't set `User-Agent` directly via `fetch`; MB's WS tolerates userscript requests in practice. If they start rejecting, the fallback is `@grant GM_xmlhttpRequest`.)

## Button mode (release and release group pages)

### Flow

1. Determine RG MBID:
   - RG page: parse from `location.pathname` (`/release-group/<uuid>`).
   - Release page: parse release MBID from URL, then read the RG MBID from the release page's sidebar link (`a[href^="/release-group/"]`). Fallback: one MB WS call to resolve.
2. Fetch MB release list + CAA JSON in parallel.
3. Classify releases:
   - `digitalReleases` = releases whose every medium has `format === "Digital Media"`.
   - `currentCoverReleaseMbid` = the release MBID from the CAA image flagged `front: true` (if any).
   - `currentCoverIsDigital` = whether that MBID is in `digitalReleases`.
4. Decide visibility:
   - Show button only if `!currentCoverIsDigital` AND `digitalReleases.length > 0`.
5. Pick the target digital release:
   - Prefer: oldest digital release with `cover-art-archive.front === true` and `darkened === false`.
   - Fallback: oldest digital release (regardless of cover art state).
   - "Oldest" = smallest `date` field (ISO string compare); tie-break by MBID.

### Button UI

- Inserted directly after the sidebar cover-art container (`.cover-art` or the closest equivalent wrapper of the sidebar image).
- Styled to match MB's native UI buttons where possible; otherwise an inline-styled `<button>` consistent with the Amazon importer's approach.
- Label:
  - Scenario 1: **"Promote digital cover to release group →"**
  - Scenario 2: **"Add cover art to digital release →"**
- Subtext (small `<div>` below the button):
  - Scenario 1: `Source: <digital release title> (<date>, <country>)`
  - Scenario 2: `Upload cover art to <digital release title> first. You'll still need to set it as the group cover afterward.`
- Click behavior:
  - Scenario 1: navigate to `/release-group/<rg-mbid>/set-cover-art#promote=<release-mbid>`.
  - Scenario 2: navigate to `/release/<release-mbid>/add-cover-art`.

### Loading behavior

- No spinner. Button appears only after the two API calls resolve.
- On any fetch error, the script exits silently (no button, console warning).

## Preview mode (`/release-group/<mbid>/set-cover-art`)

### Flow

1. Fetch MB release list + CAA JSON (same two endpoints as button mode).
2. Read `location.hash` for `#promote=<mbid>`:
   - If present, that's the initial selection.
   - If not, no initial selection; preview renders only after the user picks a release from MB's form.
3. Inject a preview panel at the top of the existing set-cover-art form.
4. If an initial selection exists, click the matching radio/option in MB's release picker to sync form state.
5. Attach a `change` listener to MB's release picker. Each change updates the "Proposed" side.

### Preview panel layout

A single `<div>` containing two columns:

```
┌──────────────────────┬──────────────────────┐
│   Current RG cover   │       Proposed       │
│      [image]         │       [image]        │
│  From: <release>     │  From: <release>     │
│  (format, date)      │  (format, date)      │
└──────────────────────┴──────────────────────┘
```

- Image sizes: ~500px wide each, capped by container width.
- Captions below each image: release title, format(s), date.

### Image sources

- Current: `https://coverartarchive.org/release-group/<rg-mbid>/front-500`. If the RG has no current cover, render a `"No current cover"` text placeholder in that slot.
- Proposed: `https://coverartarchive.org/release/<release-mbid>/front-500`. If the selected release has no cover art, render `"(no cover art uploaded)"` placeholder.

### Live update

- On `change` of MB's release selector, read the selected release MBID from the DOM.
- Update `<img src>` of the "Proposed" slot to the new release's `/front-500` URL.
- Update the caption using the option's own text (release title) and — if needed — format/date from the cached MB WS response.

### Failure handling

- If MB's release picker element can't be found (HTML change), console-warn and skip injection. The page remains fully functional in its default MB form.
- If fetches fail, no panel is shown. Don't break the native form.

## Edge cases

- **RG has no cover art at all** (`cover-art-archive.front === false` at RG level): button still triggers if digital release with cover art exists (scenario 1-equivalent). Preview's "Current" slot shows a placeholder.
- **Darkened cover art** (`cover-art-archive.darkened === true`): treat as "no usable cover". Don't count as a promotable source. Don't count as a valid current cover for scenario 4 detection (i.e., if RG is darkened, we still want to show the button).
- **Hybrid release (mixed media)**: excluded from `digitalReleases`.
- **Multiple digital releases with cover art**: pick the oldest.
- **Single-release RG where the one release is digital**: button will not show (current cover is from a digital release, i.e., scenario 4).
- **Pseudo-releases / translations**: not filtered out. If a pseudo-release happens to be the only digital release with cover art, it's eligible. Rare and acceptable for v1.

## Rate limits & compliance

- MB WS limit is 1 req/s per client. Script makes 1 MB call per page load — well within limit.
- CAA has no enforced rate limit.
- User-Agent: best-effort. Script sets it where possible; if the `fetch` API doesn't allow override, requests fall back to default UA. (Monitor for rejection in practice.)

## Testing plan

All testing is manual. Record results in a brief PR description or commit note.

1. **Scenario 1** — find an RG where a physical release's cover is currently the RG cover but a digital release has higher-quality cover art.
   - Release group page: button appears with "Promote digital cover to release group →". Subtext shows digital release title.
   - Any release page in that group (physical or digital): button appears with same text.
   - Click → lands on `/set-cover-art#promote=<mbid>`, side-by-side panel shows old vs new, digital release radio is pre-selected.
   - Change selection: "Proposed" side updates live.
2. **Scenario 2** — find an RG where physical has cover but no digital release has cover.
   - Button text: "Add cover art to digital release →". Subtext mentions uploading first.
   - Click → lands on `/release/<digital-mbid>/add-cover-art`.
3. **Scenario 4** — RG already uses digital cover: button does not appear on any page.
4. **RG with no cover at all** but a digital release exists with cover: button appears (scenario 1 behavior).
5. **Set-cover-art page direct visit** (no `#promote` hash): preview hidden initially, appears live once user picks a release.
6. **Set-cover-art page with invalid `#promote` hash**: panel renders, Current shown, Proposed slot shows "no cover" placeholder. No crash.
7. **API failure simulation** (toggle off network or block coverartarchive.org): no button, no panel, console warning. Native MB UI unchanged.

## README update

Add a new section to `userscripts/README.md` describing the script, supported pages, and manual test steps — mirroring the Amazon importer's README section.

## Rollout

- Single PR adds the userscript plus README section.
- No versioning infra beyond the `@version` header in the script itself.
