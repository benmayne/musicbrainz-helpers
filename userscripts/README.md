# MusicBrainz Userscripts

Browser userscripts for importing and managing data in [MusicBrainz](https://musicbrainz.org/). Designed for use with [Violentmonkey](https://violentmonkey.github.io/).

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) for your browser
2. Click one of the install links below; Violentmonkey will prompt to install

| Script | Install |
|---|---|
| Amazon Audiobook Importer | [install](https://raw.githubusercontent.com/benmayne/musicbrainz-helpers/main/userscripts/amazon-audiobook-importer.user.js) |
| Promote Digital Cover Art | [install](https://raw.githubusercontent.com/benmayne/musicbrainz-helpers/main/userscripts/mb-promote-digital-cover.user.js) |

For local development, you can also paste the script contents directly into Violentmonkey's editor (Dashboard → New → paste code).

## Updates

Each script declares `@updateURL` / `@downloadURL` pointing at its raw GitHub file. Violentmonkey polls on a schedule (Dashboard → Settings → Update; default once per day) and installs any version with a higher `@version` than the one you have installed. Bump the `@version` header on each release so clients pick up the change.

## Scripts

### Amazon Audiobook Importer

**File:** `amazon-audiobook-importer.user.js`

Adds an "Import into MusicBrainz" button to Amazon audiobook (Audible) product pages. Clicking it opens the MusicBrainz "Add Release" editor pre-filled with:

- Title, author, narrator (formatted as "$author read by $narrator")
- Release date, publisher, language
- Duration (as a single track)
- Type: Other + Audiobook
- Link back to the Amazon page

**Supported sites:** amazon.com, amazon.co.uk, amazon.de, amazon.fr, amazon.co.jp

**Testing:**

1. Navigate to an Amazon audiobook page, e.g. https://www.amazon.com/dp/B0DJRN88XX
2. An orange "Import into MusicBrainz" button should appear near the title
3. Click it — a new tab opens with the MusicBrainz release editor pre-filled
4. Verify the fields look correct, then submit the edit on MusicBrainz

**Known limitations:**

- Release date parsing only works on English-language Amazon pages
- Only captures the first author and first narrator
- Imports a single track (chapter splitting must be done manually in MusicBrainz)

### Promote Digital Cover Art

**File:** `mb-promote-digital-cover.user.js`

Nudges MusicBrainz editors to promote a digital release's cover art to the release-group level. Digital releases usually have higher-quality artwork than scans of physical media; when the release group's current cover comes from a non-digital release and a digital release exists in the group, the script adds a button beneath the cover image.

On the `/release-group/<mbid>/set-cover-art` edit page, the script injects a side-by-side preview of the current cover versus the proposed cover, and auto-selects the suggested release in the form. The preview updates live if the editor picks a different release.

**Supported pages:** `musicbrainz.org/release/*`, `musicbrainz.org/release-group/*` (including `/set-cover-art`).

**Testing:**

1. Find a release group whose current cover is sourced from a physical release (e.g., a CD scan) while a digital release in the group has its own uploaded cover art.
2. Load the RG page or any release in it. A button labelled **"Promote digital cover to release group →"** should appear below the cover image.
3. Click the button. You'll land on the set-cover-art page with the digital release pre-selected and a side-by-side comparison at the top.
4. Change the selected release in the form; the "Proposed" image should update live.
5. If instead the group has a digital release with no cover art yet, the button reads **"Add cover art to digital release →"** and takes you to that release's upload page.

**Known limitations:**

- Runs once on page load; doesn't react to MB's in-place navigation.
- Strict format check: only `Digital Media` counts as digital (not `Download Card` or hybrid digital+physical releases).
- "Oldest digital release" heuristic picks the target; there's no UI for picking a specific digital release to promote.
