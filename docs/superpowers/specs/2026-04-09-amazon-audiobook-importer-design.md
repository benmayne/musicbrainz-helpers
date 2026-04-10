# Amazon Audiobook → MusicBrainz Importer Userscript

## Overview

A Violentmonkey userscript that runs on Amazon audiobook product pages and injects an "Import into MusicBrainz" button. Clicking it opens a pre-filled "Add Release" form on MusicBrainz in a new tab.

Standalone script — no external dependencies.

## Data Extraction

Scrape from the Amazon audiobook page DOM:

| Field | Source |
|-------|--------|
| Title | Heading h4 text, strip "Audible Audiobook – Unabridged" suffix |
| Author | Byline link with "(Author)" role text |
| Narrator | Byline link with "(Narrator)" role text |
| Duration | "Product details" table → "Listening Length" row |
| Release Date | "Product details" table → "Audible.com Release Date" row |
| Publisher | "Product details" table → "Publisher" row |
| Language | "Product details" table → "Language" row |
| ASIN | "Product details" table → "ASIN" row (also extractable from URL) |

## MusicBrainz Field Mapping

| MB Field | Value |
|----------|-------|
| `name` | Audiobook title |
| `artist_credit.names.0.artist.name` | Author name |
| `artist_credit.names.0.join_phrase` | `" read by "` |
| `artist_credit.names.1.artist.name` | Narrator name |
| `type` | Other |
| `status` | Official |
| `language` | ISO 639-3 mapped from page (e.g. "English" → "eng") |
| `script` | Latn |
| `packaging` | None |
| `mediums.0.format` | Digital Media |
| `mediums.0.track.0.name` | Same as release title |
| `mediums.0.track.0.length` | Duration converted to milliseconds |
| `labels.0.name` | Publisher name |
| `urls.0.url` | Amazon page URL |
| `urls.0.link_type` | 79 (purchase for mail-order) |
| `edit_note` | "Imported from {url}" |

## Artist Credit

Per the MusicBrainz audiobook style guide: `$author read by $narrator`.

If the narrator is the same as the author, use only the author name (no join phrase).

## Track Handling

Single track per release, using the audiobook title as the track name and the total listening length as duration. Users can split into chapters manually in MusicBrainz.

## Duration Parsing

Amazon format: "11 hours and 3 minutes" → convert to milliseconds.
Handle variations: hours only, minutes only, hours + minutes.

## Language Mapping

Map common language names to ISO 639-3 codes (English → eng, Spanish → spa, French → fra, German → deu, etc.).

## UI

Inject an "Import into MusicBrainz" button near the product title area. The button submits a hidden HTML form that POSTs to `https://musicbrainz.org/release/add` in a new tab (`target="_blank"`).

## Script Structure

1. `parsePageData()` — extract metadata from DOM
2. `durationToMs(str)` — convert "X hours and Y minutes" to milliseconds
3. `languageToISO(name)` — map language name to ISO 639-3
4. `buildFormParams(data)` — create flat array of `{name, value}` pairs for MB form
5. `injectButton(params)` — insert hidden form + button into the page

## Userscript Metadata

```
// ==UserScript==
// @name         Import Amazon Audiobooks into MusicBrainz
// @namespace    https://github.com/benmayne/musicbrainz-helpers
// @description  One-click importing of audiobook releases from Amazon into MusicBrainz
// @version      0.1
// @match        https://www.amazon.com/*/dp/*
// @match        https://www.amazon.co.uk/*/dp/*
// @match        https://www.amazon.de/*/dp/*
// @match        https://www.amazon.fr/*/dp/*
// @match        https://www.amazon.co.jp/*/dp/*
// @grant        none
// ==/UserScript==
```

Match multiple Amazon TLDs. The script should bail early if the page is not an audiobook (check for "Audible Audiobook" in the format selectors or product type).
