# Promote Digital Cover Picard Plugin — Design

## Summary

A Picard 2.x plugin that bulk-filters loaded albums, keeping only those whose release group could benefit from promoting a digital release's cover art. Mirrors the rules of the `mb-promote-digital-cover` userscript but applies them to a Picard album selection.

## Scope

### In scope

- New plugin at `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`.
- Two `BaseAction` subclasses registered via `register_album_action`:
  - **Strict**: keep albums in an RG where the current cover is non-digital AND at least one digital release has usable front cover art.
  - **Broad**: keep albums in an RG where the current cover is non-digital AND at least one digital release exists (with or without cover art).
- Leverages Picard's `tagger.mb_api` and `tagger.webservice` for rate-limited async fetches.
- Opportunistic use of pre-downloaded `CaaCoverArtImageRg` data to skip the CAA call when possible.
- Root `README.md` entry describing the plugin.

### Out of scope (v1)

- Cross-album local short-circuits (e.g., inspecting another loaded album to classify the RG cover source). Rarely applicable in practice.
- User-facing settings (thresholds, rule customization).
- Picard 3.0 packaging (`MANIFEST.toml`, new extension points). Targets 2.x only.
- Any UI beyond the two menu items.

## Definitions

- **Digital release**: a MusicBrainz release where every medium's `format` is exactly `Digital Media`. Hybrid (mixed physical + digital) releases are excluded.
- **Usable front cover art**: `cover-art-archive.artwork === true` AND `cover-art-archive.front === true` AND `cover-art-archive.darkened !== true`.
- **Current RG cover source**: the release MBID whose image serves as the group's front cover. Determined either from a pre-downloaded `CaaCoverArtImageRg` (URL contains the source MBID) or from a CAA JSON fetch.
- **Keep rule — strict**: `not currentCoverIsDigital` AND any digital release has usable front cover art.
- **Keep rule — broad**: `not currentCoverIsDigital` AND at least one digital release exists in the RG.

"No current cover" is treated as "non-digital" — same as the userscript spec.

## Architecture

### Plugin shape

- Single `.py` file with module-level `PLUGIN_*` constants.
- Matches the style of `discid_finder/discid_finder.py` and `findimprovements/find_improvements.py`.
- `PLUGIN_API_VERSIONS = ['2.6', '2.7', '2.8', '2.9', '2.10', '2.11', '2.12', '2.13']`.
- Two registered `BaseAction`s:
  - `KeepAlbumsWithPromotableDigitalCover` — strict mode.
  - `KeepAlbumsWithPromotableDigitalRelease` — broad mode.
- Both delegate to a shared internal `_keep_album(classified, mode)` predicate.

### Data flow

For each loaded album in `objs`:

1. Kick off the fetch pipeline for the album's RG (`album.metadata['musicbrainz_releasegroupid']`):
   - **Always**: `tagger.mb_api.browse_releases(handler, **{'release-group': rgMbid, 'limit': 100})` with a custom handler that retains the full JSON (keeps `media[].format` and `cover-art-archive` per release).
   - **Conditionally** (only when the browse response shows digital releases exist and we don't already know the source):
     - **First try local**: scan `album.metadata.images` for a `CaaCoverArtImageRg` instance. If present, parse the source release MBID from its URL (path contains `/release/<mbid>/<image-id>.jpg`).
     - **Fallback to CAA**: `tagger.webservice.get_url('https://coverartarchive.org/release-group/<rgMbid>', handler=...)`. Parse the front image's `image` URL for the source MBID.
2. **On fetch completion**, classify the RG:
   - `digitalReleases` = releases where every medium is `Digital Media`.
   - `currentCoverMbid` = from the CAA response (or from local `CaaCoverArtImageRg`, or null if neither has it).
   - `currentCoverIsDigital` = `currentCoverMbid in digitalReleases`.
3. **Apply the mode's keep rule** to the album. If it fails, call `tagger.remove_album(album)` and run `QCoreApplication.processEvents()`.

No cross-album caching in v1. If two albums happen to be in the same RG, we fetch twice — rare in practice and not worth the added complexity.

### Per-album API cost

| RG state | browse_releases | CAA lookup |
|---|---|---|
| Has no digital releases | 1 | 0 (skipped after browse reveals no digital) |
| Has digital releases, `CaaCoverArtImageRg` present on the album | 1 | 0 |
| Has digital releases, no local image data | 1 | 1 |

Best case for users who prefer RG art in Picard settings: one `browse_releases` call per album.

### Execution model

Async via Picard's web-service queue. `BaseAction.callback` iterates albums, enqueues fetches, then returns. Removals happen inside fetch callbacks as results arrive. Picard's status bar shows queue progress.

### Error handling

- Any fetch failure (network, 404, rate-limited): log via `picard.log.warning` with the RG MBID and HTTP error. Keep the album (conservative — don't hide data on transient errors).
- Album missing `musicbrainz_releasegroupid`: log warning, keep the album.
- `browse_releases` returns `release-count > 100`: log warning and proceed with the first 100.

## Edge cases

- **Unloaded / non-Album objects in `objs`**: skip silently.
- **Album has no RG MBID**: log warning, keep.
- **Darkened cover art**: treated as unusable for both the RG cover source check and per-digital-release cover presence.
- **Hybrid release** (mixed digital + physical media): not counted as a digital release.
- **RG with zero cover art at all**: `currentCoverMbid` is null, `currentCoverIsDigital` is false — scenarios 1/2 apply as usual.
- **Single-release digital RG**: current cover is digital, album removed (scenario 4).

## Testing plan

All testing is manual.

1. **Scenario 1 (strict + broad both keep):** Load an album from release group `b76520a1-3c5f-3a0c-a755-4c4d99b97c98` (Genesis — Abacab). RG cover is vinyl; digital release `4c138b92-…` exists with cover art. Both filters should keep the loaded album.
2. **Scenario 4 (both remove):** Load an album from an RG where the RG cover is already sourced from a digital release. Both filters should remove it.
3. **No digital release (both remove):** Load an album from a vinyl/CD-only RG. Both filters should remove it.
4. **Scenario 2 (strict removes, broad keeps):** Load an album from an RG where digital releases exist but none has cover art. Strict removes; broad keeps.
5. **Bulk run:** Select 20+ albums from varied RGs. Confirm the filter completes, UI stays responsive, and Picard's status bar reports progress.
6. **Network failure:** Enable airplane mode mid-run. Confirm albums remain in the list and warnings appear in Picard's log.
7. **Local short-circuit path:** With Picard configured to prefer RG art, load an album whose RG cover was pre-downloaded. Confirm (via log inspection) no CAA call was made.

## Rollout

- Single PR adds:
  - `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`
  - A new entry in the top-level `README.md` (under the "Picard Plugins" section, mirroring the format used by `findimprovements` / `discid_finder`).
- `PLUGIN_VERSION = '0.1'`.
- Same license and author as other plugins in the repo.
