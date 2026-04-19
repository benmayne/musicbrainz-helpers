# CLAUDE.md

## Project overview

Collection of MusicBrainz tools: Picard plugins (Python) and browser userscripts (JavaScript).

## Picard plugins

### Picard 2.x vs 3.0

Current plugins target **2.x** (tested on 2.13.3). Key differences to be aware of:

| | Picard 2.x | Picard 3.0 (alpha) |
|---|---|---|
| Qt binding | PyQt5 | PyQt6 |
| Plugin format | Legacy: module-level constants (`PLUGIN_NAME`, `PLUGIN_API_VERSIONS`, etc.) | New: `MANIFEST.toml` + `enable(api)`/`disable()` |
| Custom columns | Not available — use `BaseAction` for bulk filtering instead | `picard.ui.itemviews.custom_columns` — `make_callable_column`, `make_provider_column`, `registry.register()` |
| Processor imports | `from picard.file import register_file_post_addition_to_track_processor` | `from picard.extension_points.event_hooks import register_file_post_addition_to_track_processor` |
| API version format | `['2.6', '2.7', ..., '2.13']` | `['3.0', '3.1']` |

`PLUGIN_API_VERSIONS` must include the user's installed version or the plugin will silently fail to install.

### Plugin format (2.x)

- Plugins are **single `.py` files**, not Python packages. Picard's "Install Plugin" UI expects you to select a `.py` file directly.
- The directory structure (`picard_2_plugins/plugin_name/plugin_name.py`) is for organizing this repo — only the `.py` file gets installed into Picard.

### Key Picard internals (shared across versions)

- `file.orig_metadata.length` — actual audio file duration in milliseconds
- `track.metadata.length` — MusicBrainz track duration in milliseconds
- `track.metadata.getall('~musicbrainz_discids')` — disc IDs from MB for the medium
- `file.filename` — full filesystem path to the audio file
- `album.tracks` — list of Track objects; `track.files` — list of matched File objects
- Metadata `~` variables (e.g. `~length_diff`) are internal and won't be saved to file tags

### Reference codebases

- **Picard source**: https://github.com/metabrainz/picard
- **Picard plugins repo**: https://github.com/metabrainz/picard-plugins — examples of working 2.x plugins

## Userscripts

- Built for [Violentmonkey](https://violentmonkey.github.io/)
- See `userscripts/README.md` for details

### Metadata block requirements

Every userscript must include `@updateURL` and `@downloadURL` pointing at the raw GitHub file on `main`, so Violentmonkey can auto-update installs:

```
// @updateURL    https://raw.githubusercontent.com/benmayne/musicbrainz-helpers/main/userscripts/<filename>.user.js
// @downloadURL  https://raw.githubusercontent.com/benmayne/musicbrainz-helpers/main/userscripts/<filename>.user.js
```

Bump `@version` on **every** change, including trivial ones (typo fixes, comment edits, whitespace). Violentmonkey only pulls updates when the remote `@version` is higher than the installed one, so an un-bumped change will never reach users.

## External documentation

- Picard docs: https://picard-docs.musicbrainz.org/
- MusicBrainz API: https://musicbrainz.org/doc/MusicBrainz_API
- MusicBrainz style guides: https://musicbrainz.org/doc/Style
