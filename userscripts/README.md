# MusicBrainz Userscripts

Browser userscripts for importing and managing data in [MusicBrainz](https://musicbrainz.org/). Designed for use with [Violentmonkey](https://violentmonkey.github.io/).

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) for your browser
2. Open the `.user.js` file you want to install (e.g. on GitHub, click "Raw")
3. Violentmonkey will prompt you to install the script

For local development, you can also paste the script contents directly into Violentmonkey's editor (Dashboard → New → paste code).

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
