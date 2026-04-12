# musicbrainz-helpers

Tools for working with [MusicBrainz](https://musicbrainz.org/): Picard plugins for library maintenance and browser userscripts for data entry.

## Picard Plugins

Plugins for [MusicBrainz Picard](https://picard.musicbrainz.org/) (2.x). Install via Options > Plugins > Install Plugin, then select the `.py` file.

### Length Diff Checker

**File:** `picard_2_plugins/length_diff_checker/length_diff_checker.py`

Identifies releases where files may be tagged against the wrong release by comparing file audio lengths to MusicBrainz track lengths. Select albums, right-click, and choose **"Remove albums with low length diff..."** to set a threshold in seconds. Albums with a total absolute length difference below the threshold are removed, leaving only suspicious releases.

### Disc ID Finder

**File:** `picard_2_plugins/discid_finder/discid_finder.py`

Finds releases that have a ripping log (XLD/EAC) in the file directory but no disc ID in MusicBrainz. Select albums, right-click, and choose **"Keep only albums with log and no disc ID"** to filter down to releases where a disc ID can be submitted using the TOC from the ripping log.

### Find Albums To Improve

**File:** `picard_2_plugins/findimprovements/find_improvements.py`

Bulk filtering actions for loaded albums:
- **Remove Albums With Artwork** — removes albums that already have front cover art
- **Find Dupe Release Groups** — removes albums that aren't duplicates, leaving only releases that share a release group

## Userscripts

Browser userscripts for [Violentmonkey](https://violentmonkey.github.io/). See [userscripts/README.md](userscripts/README.md) for installation and details.

### Amazon Audiobook Importer

**File:** `userscripts/amazon-audiobook-importer.user.js`

Adds an "Import into MusicBrainz" button to Amazon audiobook pages, pre-filling the release editor with title, author, narrator, duration, and other metadata.
