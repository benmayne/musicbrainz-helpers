# Promote Digital Cover Picard Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Picard 2.x plugin that bulk-filters loaded albums down to those whose release group could benefit from promoting a digital release's cover art.

**Architecture:** Single `.py` file at `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`. Two `BaseAction` subclasses (strict + broad) registered with `register_album_action`. Per album: one async `mb_api.browse_releases` call; if digital releases exist and no `CaaCoverArtImageRg` is present locally, also one `webservice.get_url` call to CAA. No cross-album cache.

**Tech Stack:** Python 3, PyQt5 (via Picard), Picard 2.x plugin API.

**Spec:** `docs/superpowers/specs/2026-04-18-promote-digital-cover-picard-plugin-design.md`

**Reference codebase:** existing plugins at `picard_2_plugins/discid_finder/discid_finder.py`, `picard_2_plugins/findimprovements/find_improvements.py`, and `picard_2_plugins/length_diff_checker/length_diff_checker.py`. Picard source tree at `/Users/ben/code/picard` if deeper lookup is needed (e.g., `picard/releasegroup.py`, `picard/coverart/providers/caa_release_group.py`).

**Testing approach:** This repo's existing plugins have no automated tests — the pattern is manual testing inside Picard. This plan keeps that pattern but exercises the pure-helper functions (no PyQt5 imports) with `python3` one-liners so logic bugs are caught before manual install. Picard-integration steps (installing the plugin, running the filter on loaded albums) are deferred to a human.

**Test URLs / fixtures:**
- Scenario 1 RG: `b76520a1-3c5f-3a0c-a755-4c4d99b97c98` (Genesis — Abacab) — non-digital RG cover + digital release `4c138b92-dce4-4f24-a5b4-8f4c087cd216` with cover art.
- The implementer should re-verify these URLs reflect the expected scenarios before testing, since MB data may change.

---

### Task 1: Scaffold the plugin with metadata and empty action classes

**Files:**
- Create: `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

- [ ] **Step 1: Create the plugin file with metadata and empty classes**

```python
PLUGIN_NAME = 'Promote Digital Cover'
PLUGIN_AUTHOR = 'benmayne'
PLUGIN_DESCRIPTION = (
    'Filter loaded albums down to release groups where a digital release\'s '
    'cover art could be promoted to the release-group level. Two variants: '
    'strict (digital cover already uploaded) and broad (any digital release '
    'in the group, even without cover art).'
)
PLUGIN_VERSION = '0.1'
PLUGIN_API_VERSIONS = ['2.6', '2.7', '2.8', '2.9', '2.10', '2.11', '2.12', '2.13']
PLUGIN_LICENSE = 'GPL-2.0'
PLUGIN_LICENSE_URL = 'https://www.gnu.org/licenses/gpl-2.0.html'

from PyQt5.QtCore import QCoreApplication

from picard import log
from picard.album import Album
from picard.ui.itemviews import BaseAction, register_album_action


MODE_STRICT = 'strict'
MODE_BROAD = 'broad'


class KeepAlbumsWithPromotableDigitalCover(BaseAction):
    NAME = 'Keep albums where a digital cover is ready to promote'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                # Implementation added in later tasks.
                pass
            QCoreApplication.processEvents()


class KeepAlbumsWithPromotableDigitalRelease(BaseAction):
    NAME = 'Keep albums where a digital release could be promoted (including no cover art yet)'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                # Implementation added in later tasks.
                pass
            QCoreApplication.processEvents()


register_album_action(KeepAlbumsWithPromotableDigitalCover())
register_album_action(KeepAlbumsWithPromotableDigitalRelease())
```

- [ ] **Step 2: Verify syntax with `python3 -m py_compile`**

Run:

```bash
python3 -m py_compile picard_2_plugins/promote_digital_cover/promote_digital_cover.py
```

Expected: no output, exit status 0. (Compile-only check — PyQt5/picard imports are unavailable here, but `py_compile` only parses.)

Wait — `py_compile` also imports top-level names when it encounters `import` statements. It will fail on the `from PyQt5.QtCore import QCoreApplication` line in an environment without PyQt5. If it fails, that's expected in a bare environment; skip this step and rely on manual verification in Step 3. If it succeeds (PyQt5 is installed), even better.

- [ ] **Step 3: Manual install and verify menus appear (DEFERRED TO HUMAN)**

A human needs to install this file in Picard (Options → Plugins → Install Plugin, select the `.py`), restart Picard, then select some albums, right-click, and confirm both menu items appear under the Plugins submenu:

- "Keep albums where a digital cover is ready to promote"
- "Keep albums where a digital release could be promoted (including no cover art yet)"

Clicking them should be a no-op at this point (actions don't do anything yet).

Flag this in your report.

- [ ] **Step 4: Commit**

```bash
git add picard_2_plugins/promote_digital_cover/promote_digital_cover.py
git commit -m "feat(picard): scaffold promote-digital-cover plugin with two actions"
```

---

### Task 2: Add pure classification helpers

**Files:**
- Modify: `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

These helpers must remain PyQt5- and Picard-free so they can be verified outside Picard with `python3 -c`.

- [ ] **Step 1: Add `import re` to the imports block**

At the top of the file, immediately after the existing `from picard.ui.itemviews import ...` line, add:

```python
import re
```

- [ ] **Step 2: Insert the classification helpers**

Add these functions AFTER the `MODE_STRICT` / `MODE_BROAD` constants and BEFORE the first `class` declaration:

```python
_RELEASE_MBID_IN_URL = re.compile(r'/release/([0-9a-f-]{36})', re.IGNORECASE)


def _is_digital_release(release):
    """A release is digital iff every medium has format exactly 'Digital Media'."""
    media = release.get('media') or []
    if not media:
        return False
    return all(m.get('format') == 'Digital Media' for m in media)


def _has_usable_front_cover(release):
    """Front cover art is usable only if artwork+front are True AND darkened is not True."""
    caa = release.get('cover-art-archive') or {}
    return (
        caa.get('artwork') is True
        and caa.get('front') is True
        and caa.get('darkened') is not True
    )


def _source_mbid_from_caa_image_url(url):
    """Extract a release MBID from a CAA image URL, e.g.
    http://coverartarchive.org/release/<mbid>/<id>.jpg. Returns lowercase MBID or None."""
    if not isinstance(url, str):
        return None
    match = _RELEASE_MBID_IN_URL.search(url)
    return match.group(1).lower() if match else None


def _current_cover_mbid_from_caa(caa_data):
    """Given a CAA release-group JSON payload, return the MBID of the release that
    the front image is sourced from, or None.

    CAA's release-group response does not include a `release` field on each
    image; the release MBID is encoded in the `image` URL path. Fall back to
    `release` or thumbnail URLs if present.
    """
    if not isinstance(caa_data, dict):
        return None
    images = caa_data.get('images')
    if not isinstance(images, list):
        return None
    for img in images:
        if img.get('front') is not True:
            continue
        thumbs = img.get('thumbnails') or {}
        for candidate in (img.get('image'), img.get('release'), thumbs.get('large'), thumbs.get('small')):
            mbid = _source_mbid_from_caa_image_url(candidate)
            if mbid:
                return mbid
        return None
    return None


def _classify(releases, current_cover_mbid):
    """Classify a release-group response.

    Args:
        releases: list of MB release dicts (from browse_releases response).
        current_cover_mbid: MBID of the release sourcing the current RG cover, or None.

    Returns dict with:
        all_releases: the input list
        digital_releases: filtered list of digital-only releases
        current_cover_mbid: echo of input
        current_cover_is_digital: bool
    """
    all_releases = releases or []
    digital_releases = [r for r in all_releases if _is_digital_release(r)]
    current_cover_is_digital = bool(current_cover_mbid) and any(
        r.get('id') == current_cover_mbid for r in digital_releases
    )
    return {
        'all_releases': all_releases,
        'digital_releases': digital_releases,
        'current_cover_mbid': current_cover_mbid,
        'current_cover_is_digital': current_cover_is_digital,
    }
```

- [ ] **Step 3: Verify with a Python one-liner**

Run this from `/Users/ben/code/musicbrainz-helpers`:

```bash
python3 <<'EOF'
import sys, importlib.util, types
# Stub PyQt5 and picard so we can import the plugin as a module.
for name in ('PyQt5', 'PyQt5.QtCore', 'picard', 'picard.album', 'picard.ui', 'picard.ui.itemviews'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['PyQt5.QtCore'].QCoreApplication = type('Q', (), {'processEvents': staticmethod(lambda: None)})
sys.modules['picard'].log = type('L', (), {'warning': staticmethod(lambda *a, **k: None)})
sys.modules['picard.album'].Album = type('Album', (), {})
sys.modules['picard.ui.itemviews'].BaseAction = type('BaseAction', (), {'__init__': lambda self: None})
sys.modules['picard.ui.itemviews'].register_album_action = lambda *a, **k: None

spec = importlib.util.spec_from_file_location('plugin', 'picard_2_plugins/promote_digital_cover/promote_digital_cover.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# --- _is_digital_release ---
assert m._is_digital_release({'media': [{'format': 'Digital Media'}]}) is True
assert m._is_digital_release({'media': [{'format': 'CD'}]}) is False
assert m._is_digital_release({'media': [{'format': 'Digital Media'}, {'format': 'CD'}]}) is False
assert m._is_digital_release({'media': []}) is False
assert m._is_digital_release({}) is False
print('is_digital_release: ok')

# --- _has_usable_front_cover ---
assert m._has_usable_front_cover({'cover-art-archive': {'artwork': True, 'front': True, 'darkened': False}}) is True
assert m._has_usable_front_cover({'cover-art-archive': {'artwork': True, 'front': True, 'darkened': True}}) is False
assert m._has_usable_front_cover({'cover-art-archive': {'artwork': False, 'front': False}}) is False
assert m._has_usable_front_cover({}) is False
print('has_usable_front_cover: ok')

# --- _source_mbid_from_caa_image_url ---
assert m._source_mbid_from_caa_image_url('http://coverartarchive.org/release/B76520A1-3C5F-3A0C-A755-4C4D99B97C98/123.jpg') == 'b76520a1-3c5f-3a0c-a755-4c4d99b97c98'
assert m._source_mbid_from_caa_image_url('https://musicbrainz.org/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216') == '4c138b92-dce4-4f24-a5b4-8f4c087cd216'
assert m._source_mbid_from_caa_image_url('http://example.org/artist/foo') is None
assert m._source_mbid_from_caa_image_url(None) is None
print('source_mbid_from_caa_image_url: ok')

# --- _current_cover_mbid_from_caa ---
caa1 = {'images': [{'front': True, 'image': 'http://coverartarchive.org/release/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1.jpg'}]}
assert m._current_cover_mbid_from_caa(caa1) == 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
# Empty images
assert m._current_cover_mbid_from_caa({'images': []}) is None
# No front
assert m._current_cover_mbid_from_caa({'images': [{'front': False}]}) is None
# Null payload
assert m._current_cover_mbid_from_caa(None) is None
# Fallback to thumbnail
caa2 = {'images': [{'front': True, 'image': None, 'thumbnails': {'large': 'http://coverartarchive.org/release/bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee/2.jpg'}}]}
assert m._current_cover_mbid_from_caa(caa2) == 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
print('current_cover_mbid_from_caa: ok')

# --- _classify ---
releases = [
    {'id': 'aaaa0000-0000-0000-0000-000000000001', 'media': [{'format': 'CD'}], 'cover-art-archive': {}},
    {'id': 'aaaa0000-0000-0000-0000-000000000002', 'media': [{'format': 'Digital Media'}], 'cover-art-archive': {}},
]
r1 = m._classify(releases, 'aaaa0000-0000-0000-0000-000000000001')
assert len(r1['digital_releases']) == 1
assert r1['current_cover_mbid'] == 'aaaa0000-0000-0000-0000-000000000001'
assert r1['current_cover_is_digital'] is False
r2 = m._classify(releases, 'aaaa0000-0000-0000-0000-000000000002')
assert r2['current_cover_is_digital'] is True
r3 = m._classify(releases, None)
assert r3['current_cover_is_digital'] is False
print('classify: ok')

print('ALL OK')
EOF
```

Expected output:
```
is_digital_release: ok
has_usable_front_cover: ok
source_mbid_from_caa_image_url: ok
current_cover_mbid_from_caa: ok
classify: ok
ALL OK
```

- [ ] **Step 4: Commit**

```bash
git add picard_2_plugins/promote_digital_cover/promote_digital_cover.py
git commit -m "feat(picard): add pure classification helpers"
```

---

### Task 3: Add the strict/broad keep predicate

**Files:**
- Modify: `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

- [ ] **Step 1: Insert the predicate**

Add this function immediately after `_classify` and before the first `class` declaration:

```python
def _keep_album(classified, mode):
    """Decide whether an album should be kept based on its RG classification.

    Strict mode: keep iff current RG cover is non-digital AND at least one
    digital release has usable front cover art.

    Broad mode: keep iff current RG cover is non-digital AND at least one
    digital release exists in the RG.
    """
    if classified['current_cover_is_digital']:
        return False
    digital = classified['digital_releases']
    if not digital:
        return False
    if mode == MODE_STRICT:
        return any(_has_usable_front_cover(r) for r in digital)
    if mode == MODE_BROAD:
        return True
    # Unknown mode — be conservative.
    return True
```

- [ ] **Step 2: Verify with a Python one-liner**

```bash
python3 <<'EOF'
import sys, importlib.util, types
for name in ('PyQt5', 'PyQt5.QtCore', 'picard', 'picard.album', 'picard.ui', 'picard.ui.itemviews'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['PyQt5.QtCore'].QCoreApplication = type('Q', (), {'processEvents': staticmethod(lambda: None)})
sys.modules['picard'].log = type('L', (), {'warning': staticmethod(lambda *a, **k: None)})
sys.modules['picard.album'].Album = type('Album', (), {})
sys.modules['picard.ui.itemviews'].BaseAction = type('BaseAction', (), {'__init__': lambda self: None})
sys.modules['picard.ui.itemviews'].register_album_action = lambda *a, **k: None
spec = importlib.util.spec_from_file_location('plugin', 'picard_2_plugins/promote_digital_cover/promote_digital_cover.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Shorthand
digital_with_cover = {'id': 'a', 'media': [{'format': 'Digital Media'}], 'cover-art-archive': {'artwork': True, 'front': True, 'darkened': False}}
digital_no_cover = {'id': 'b', 'media': [{'format': 'Digital Media'}], 'cover-art-archive': {'artwork': False, 'front': False}}
cd_with_cover = {'id': 'c', 'media': [{'format': 'CD'}], 'cover-art-archive': {'artwork': True, 'front': True}}

# Scenario 1: current cover is CD, digital has cover → keep in both
c1 = m._classify([cd_with_cover, digital_with_cover], 'c')
assert m._keep_album(c1, m.MODE_STRICT) is True
assert m._keep_album(c1, m.MODE_BROAD) is True
print('scenario 1: keep both - ok')

# Scenario 2: current cover is CD, digital has NO cover → strict removes, broad keeps
c2 = m._classify([cd_with_cover, digital_no_cover], 'c')
assert m._keep_album(c2, m.MODE_STRICT) is False
assert m._keep_album(c2, m.MODE_BROAD) is True
print('scenario 2: strict remove / broad keep - ok')

# Scenario 4: current cover is digital → remove in both
c4 = m._classify([cd_with_cover, digital_with_cover], 'a')
assert m._keep_album(c4, m.MODE_STRICT) is False
assert m._keep_album(c4, m.MODE_BROAD) is False
print('scenario 4: remove both - ok')

# No digital releases at all → remove in both
c_nodigital = m._classify([cd_with_cover], 'c')
assert m._keep_album(c_nodigital, m.MODE_STRICT) is False
assert m._keep_album(c_nodigital, m.MODE_BROAD) is False
print('no digital: remove both - ok')

# No current cover at all, digital exists with cover → keep in both (non-digital treated as absent)
c_nocover = m._classify([cd_with_cover, digital_with_cover], None)
assert m._keep_album(c_nocover, m.MODE_STRICT) is True
assert m._keep_album(c_nocover, m.MODE_BROAD) is True
print('no current cover + digital exists: keep both - ok')

print('ALL OK')
EOF
```

Expected output:
```
scenario 1: keep both - ok
scenario 2: strict remove / broad keep - ok
scenario 4: remove both - ok
no digital: remove both - ok
no current cover + digital exists: keep both - ok
ALL OK
```

- [ ] **Step 3: Commit**

```bash
git add picard_2_plugins/promote_digital_cover/promote_digital_cover.py
git commit -m "feat(picard): add strict/broad keep predicates"
```

---

### Task 4: Add the local-image source-MBID helper

**Files:**
- Modify: `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

Picard's `CoverArtProviderCaaReleaseGroup` (when enabled) downloads the RG cover and stores it as a `CaaCoverArtImageRg` instance in `album.metadata.images`. The image's `url` attribute contains a CAA URL of the form `http(s)://coverartarchive.org/release/<mbid>/<image-id>.jpg` — so the source release MBID can be parsed from the URL without another API call.

- [ ] **Step 1: Add the import and helper**

Add this import near the top of the file, grouped with the other Picard imports:

```python
try:
    from picard.coverart.providers.caa_release_group import CaaCoverArtImageRg
except ImportError:
    # Older Picard 2.x builds may not expose this; provide a sentinel class
    # so isinstance() below always returns False.
    class CaaCoverArtImageRg:
        pass
```

Add this function immediately after `_keep_album` and before the class declarations:

```python
def _source_mbid_from_local_images(album):
    """Try to determine the RG cover source release MBID from images Picard
    has already downloaded for this album. Returns an MBID string or None.

    Only `CaaCoverArtImageRg` instances are considered — the generic
    `CaaCoverArtImage` uses the album's own release MBID in its URL, which
    can't distinguish scenario 4 (RG cover is from this release) from
    scenario 1 (RG cover is from a different release that happens to match).
    """
    images = []
    metadata = getattr(album, 'metadata', None)
    if metadata is not None:
        images = getattr(metadata, 'images', None) or []
    for img in images:
        if not isinstance(img, CaaCoverArtImageRg):
            continue
        url = getattr(img, 'url', None)
        # Picard wraps URLs as QUrl; stringify.
        if url is not None and not isinstance(url, str):
            url = url.toString()
        mbid = _source_mbid_from_caa_image_url(url)
        if mbid:
            return mbid
    return None
```

- [ ] **Step 2: Verify the URL-parsing path with `python3` fake objects**

```bash
python3 <<'EOF'
import sys, importlib.util, types
for name in ('PyQt5', 'PyQt5.QtCore', 'picard', 'picard.album', 'picard.ui', 'picard.ui.itemviews', 'picard.coverart', 'picard.coverart.providers', 'picard.coverart.providers.caa_release_group'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['PyQt5.QtCore'].QCoreApplication = type('Q', (), {'processEvents': staticmethod(lambda: None)})
sys.modules['picard'].log = type('L', (), {'warning': staticmethod(lambda *a, **k: None)})
sys.modules['picard.album'].Album = type('Album', (), {})
sys.modules['picard.ui.itemviews'].BaseAction = type('BaseAction', (), {'__init__': lambda self: None})
sys.modules['picard.ui.itemviews'].register_album_action = lambda *a, **k: None

class FakeCaaRg:
    def __init__(self, url):
        self.url = url
sys.modules['picard.coverart.providers.caa_release_group'].CaaCoverArtImageRg = FakeCaaRg

spec = importlib.util.spec_from_file_location('plugin', 'picard_2_plugins/promote_digital_cover/promote_digital_cover.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class FakeMeta:
    def __init__(self, images): self.images = images
class FakeAlbum:
    def __init__(self, images): self.metadata = FakeMeta(images)

# Match: one CaaRg image with URL
a1 = FakeAlbum([FakeCaaRg('http://coverartarchive.org/release/aaaa0000-0000-0000-0000-000000000001/7.jpg')])
assert m._source_mbid_from_local_images(a1) == 'aaaa0000-0000-0000-0000-000000000001'
# No images
assert m._source_mbid_from_local_images(FakeAlbum([])) is None
# Image is a wrong class
class Other: pass
a2 = FakeAlbum([Other()])
assert m._source_mbid_from_local_images(a2) is None
# Image with URL not matching
a3 = FakeAlbum([FakeCaaRg('http://example.org/other/foo.jpg')])
assert m._source_mbid_from_local_images(a3) is None
print('source_mbid_from_local_images: ok')
EOF
```

Expected:
```
source_mbid_from_local_images: ok
```

- [ ] **Step 3: Commit**

```bash
git add picard_2_plugins/promote_digital_cover/promote_digital_cover.py
git commit -m "feat(picard): add local-image source-MBID helper"
```

---

### Task 5: Add the async per-album fetch pipeline

**Files:**
- Modify: `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

This task wires up the async MB and CAA fetches via Picard's APIs. The callbacks compose as follows:

1. `_process_album(album, mode, tagger)` — entry point; fires `browse_releases`.
2. `_on_browse_done(album, mode, tagger, document, http, error)` — processes MB response; if classification can be completed, calls `_finalize`. Otherwise fires CAA lookup.
3. `_on_caa_done(album, mode, tagger, releases, data, http, error)` — processes CAA response and calls `_finalize`.
4. `_finalize(album, mode, tagger, classified)` — applies `_keep_album`; if it returns False, calls `tagger.remove_album(album)`.

- [ ] **Step 1: Add the async pipeline**

Add this function block immediately after `_source_mbid_from_local_images` and BEFORE the class declarations:

```python
def _process_album(album, mode, tagger):
    """Entry point: kick off the async fetch pipeline for one album."""
    rg_mbid = album.metadata.get('musicbrainz_releasegroupid')
    if not rg_mbid:
        log.warning(
            '[promote-digital-cover] album %r has no musicbrainz_releasegroupid; keeping',
            album,
        )
        return

    def on_browse_done(document, http, error):
        _on_browse_done(album, mode, tagger, rg_mbid, document, http, error)

    tagger.mb_api.browse_releases(
        on_browse_done,
        **{'release-group': rg_mbid, 'limit': 100},
    )


def _on_browse_done(album, mode, tagger, rg_mbid, document, http, error):
    if error:
        _log_fetch_failure('browse_releases', rg_mbid, http, error)
        return
    if not isinstance(document, dict):
        log.warning('[promote-digital-cover] browse_releases: unexpected payload for %s', rg_mbid)
        return

    releases = document.get('releases') or []
    release_count = document.get('release-count')
    if isinstance(release_count, int) and release_count > 100:
        log.warning(
            '[promote-digital-cover] RG %s has %d releases; only the first 100 considered',
            rg_mbid, release_count,
        )

    # Early bail-out: no digital releases at all → remove immediately.
    if not any(_is_digital_release(r) for r in releases):
        classified = _classify(releases, None)
        _finalize(album, mode, tagger, classified)
        return

    # Try local image first for the current-cover source.
    source_mbid = _source_mbid_from_local_images(album)
    if source_mbid is not None:
        classified = _classify(releases, source_mbid)
        _finalize(album, mode, tagger, classified)
        return

    # Fall back to CAA.
    def on_caa_done(data, http_, error_):
        _on_caa_done(album, mode, tagger, rg_mbid, releases, data, http_, error_)

    tagger.webservice.get_url(
        url='https://coverartarchive.org/release-group/%s' % rg_mbid,
        handler=on_caa_done,
    )


def _on_caa_done(album, mode, tagger, rg_mbid, releases, data, http, error):
    if error:
        # 404 from CAA means no RG-level cover art exists; treat as None.
        # Other errors: log and keep the album.
        if _is_http_404(http):
            classified = _classify(releases, None)
            _finalize(album, mode, tagger, classified)
            return
        _log_fetch_failure('CAA release-group', rg_mbid, http, error)
        return

    current_mbid = _current_cover_mbid_from_caa(data if isinstance(data, dict) else None)
    classified = _classify(releases, current_mbid)
    _finalize(album, mode, tagger, classified)


def _finalize(album, mode, tagger, classified):
    if _keep_album(classified, mode):
        return
    tagger.remove_album(album)


def _is_http_404(http):
    """Best-effort 404 detection across Picard's http reply shapes."""
    if http is None:
        return False
    # Picard passes a QNetworkReply; duck-type to stay decoupled.
    get_status = getattr(http, 'attribute', None)
    if callable(get_status):
        try:
            # 203 = HttpStatusCodeAttribute in Qt; value equals the HTTP status int.
            from PyQt5.QtNetwork import QNetworkRequest
            status = http.attribute(QNetworkRequest.HttpStatusCodeAttribute)
            if status == 404:
                return True
        except Exception:
            pass
    # Fallback: stringify error.
    return '404' in str(getattr(http, 'errorString', lambda: '')())


def _log_fetch_failure(kind, rg_mbid, http, error):
    err_str = ''
    try:
        err_str = http.errorString() if http is not None else str(error)
    except Exception:
        err_str = str(error)
    log.warning(
        '[promote-digital-cover] %s fetch failed for RG %s: %s',
        kind, rg_mbid, err_str,
    )
```

- [ ] **Step 2: Verify the file still parses**

```bash
python3 <<'EOF'
import sys, importlib.util, types
for name in ('PyQt5', 'PyQt5.QtCore', 'PyQt5.QtNetwork', 'picard', 'picard.album', 'picard.ui', 'picard.ui.itemviews', 'picard.coverart', 'picard.coverart.providers', 'picard.coverart.providers.caa_release_group'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['PyQt5.QtCore'].QCoreApplication = type('Q', (), {'processEvents': staticmethod(lambda: None)})
sys.modules['PyQt5.QtNetwork'].QNetworkRequest = type('Q', (), {'HttpStatusCodeAttribute': 0})
sys.modules['picard'].log = type('L', (), {'warning': staticmethod(lambda *a, **k: None)})
sys.modules['picard.album'].Album = type('Album', (), {})
sys.modules['picard.ui.itemviews'].BaseAction = type('BaseAction', (), {'__init__': lambda self: None})
sys.modules['picard.ui.itemviews'].register_album_action = lambda *a, **k: None
class FakeCaaRg: pass
sys.modules['picard.coverart.providers.caa_release_group'].CaaCoverArtImageRg = FakeCaaRg

spec = importlib.util.spec_from_file_location('plugin', 'picard_2_plugins/promote_digital_cover/promote_digital_cover.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Verify symbols exist
for name in ('_process_album', '_on_browse_done', '_on_caa_done', '_finalize', '_is_http_404', '_log_fetch_failure'):
    assert hasattr(m, name), 'missing ' + name
print('imports OK, symbols present')
EOF
```

Expected:
```
imports OK, symbols present
```

- [ ] **Step 3: Commit**

```bash
git add picard_2_plugins/promote_digital_cover/promote_digital_cover.py
git commit -m "feat(picard): add async fetch pipeline with browse + CAA fallback"
```

---

### Task 6: Wire the action callbacks to the pipeline

**Files:**
- Modify: `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

- [ ] **Step 1: Replace the placeholder callback bodies**

Find the existing `callback` methods on both classes (they currently contain `# Implementation added in later tasks.`). Replace each as follows.

For `KeepAlbumsWithPromotableDigitalCover`:

```python
class KeepAlbumsWithPromotableDigitalCover(BaseAction):
    NAME = 'Keep albums where a digital cover is ready to promote'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                _process_album(album, MODE_STRICT, self.tagger)
            QCoreApplication.processEvents()
```

For `KeepAlbumsWithPromotableDigitalRelease`:

```python
class KeepAlbumsWithPromotableDigitalRelease(BaseAction):
    NAME = 'Keep albums where a digital release could be promoted (including no cover art yet)'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                _process_album(album, MODE_BROAD, self.tagger)
            QCoreApplication.processEvents()
```

- [ ] **Step 2: Verify the file still parses and symbols resolve**

```bash
python3 <<'EOF'
import sys, importlib.util, types
for name in ('PyQt5', 'PyQt5.QtCore', 'PyQt5.QtNetwork', 'picard', 'picard.album', 'picard.ui', 'picard.ui.itemviews', 'picard.coverart', 'picard.coverart.providers', 'picard.coverart.providers.caa_release_group'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['PyQt5.QtCore'].QCoreApplication = type('Q', (), {'processEvents': staticmethod(lambda: None)})
sys.modules['PyQt5.QtNetwork'].QNetworkRequest = type('Q', (), {'HttpStatusCodeAttribute': 0})
sys.modules['picard'].log = type('L', (), {'warning': staticmethod(lambda *a, **k: None)})
sys.modules['picard.album'].Album = type('Album', (), {})
sys.modules['picard.ui.itemviews'].BaseAction = type('BaseAction', (), {'__init__': lambda self: None})
sys.modules['picard.ui.itemviews'].register_album_action = lambda *a, **k: None
class FakeCaaRg: pass
sys.modules['picard.coverart.providers.caa_release_group'].CaaCoverArtImageRg = FakeCaaRg

spec = importlib.util.spec_from_file_location('plugin', 'picard_2_plugins/promote_digital_cover/promote_digital_cover.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Both classes should have a callback method that is NOT a pass-only body.
import inspect
src_strict = inspect.getsource(m.KeepAlbumsWithPromotableDigitalCover.callback)
src_broad = inspect.getsource(m.KeepAlbumsWithPromotableDigitalRelease.callback)
assert '_process_album' in src_strict and 'MODE_STRICT' in src_strict, 'strict callback not wired'
assert '_process_album' in src_broad and 'MODE_BROAD' in src_broad, 'broad callback not wired'
print('callbacks wired')
EOF
```

Expected:
```
callbacks wired
```

- [ ] **Step 3: Manual integration test in Picard (DEFERRED TO HUMAN)**

This is where the real behavioral verification happens. Flag the following steps in your report as human-only:

1. Copy `picard_2_plugins/promote_digital_cover/promote_digital_cover.py` into Picard (Options → Plugins → Install Plugin) and restart.
2. Find the release group in MB: `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98`. Verify it still has a non-digital RG cover and a digital release (`4c138b92-…`) with cover art. If either has changed, pick a fresh scenario-1 RG.
3. In Picard, load a file tagged to one of that RG's releases (or use "Add cluster as release" with the release MBID). Confirm it loads.
4. Select the loaded album, right-click → Plugins → **"Keep albums where a digital cover is ready to promote"**.
5. Expected: the album stays in the list.
6. Add albums from a scenario-4 RG (current cover is already from a digital release) and a vinyl-only RG. Run the strict filter again and confirm they are removed.
7. Reload and run the **broad** filter in a scenario-2 RG (digital release exists but no cover art). Expected: the album stays under broad; would be removed under strict.
8. Disable network mid-run and run again — expected: albums are kept (conservative on errors), with `[promote-digital-cover]` warnings in Picard's log.

- [ ] **Step 4: Commit**

```bash
git add picard_2_plugins/promote_digital_cover/promote_digital_cover.py
git commit -m "feat(picard): wire action callbacks to the fetch pipeline"
```

---

### Task 7: Add README entry

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a new section under "Picard Plugins"**

Open `README.md`. Find the last Picard plugin section ("Find Albums To Improve"). Add this section AFTER it, keeping the existing blank line before the "Userscripts" section:

```markdown

### Promote Digital Cover

**File:** `picard_2_plugins/promote_digital_cover/promote_digital_cover.py`

Filters loaded albums down to release groups whose cover art could be upgraded by promoting a digital release's cover to the release-group level. Two variants:

- **Keep albums where a digital cover is ready to promote** (strict) — the release group's current cover is not from a digital release, and at least one digital release in the group has uploaded cover art. Ready for a one-click promotion in MusicBrainz.
- **Keep albums where a digital release could be promoted (including no cover art yet)** (broad) — same as strict, plus cases where a digital release exists but hasn't had cover art uploaded yet.

Uses Picard's web-service queue for rate-limited async fetches; if you have the "Cover Art Archive: Release Group" provider enabled, the plugin reuses Picard's pre-downloaded RG cover to avoid one CAA round-trip per album.
```

- [ ] **Step 2: Verify rendering**

Preview the README (GitHub web UI, `glow`, or a VS Code preview pane). Confirm the new section sits between "Find Albums To Improve" and "Userscripts" with consistent formatting.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add readme section for promote-digital-cover picard plugin"
```

---

## Post-implementation sanity checks

- [ ] All four scenario tests from the spec's Testing Plan produce the expected keep/remove behavior.
- [ ] The local short-circuit path is exercised: with RG art preference enabled in Picard, the plugin runs without making a CAA call for scenario-1 albums (visible by absence of `coverartarchive.org` requests in Picard's network activity).
- [ ] Network failure leaves albums intact with `[promote-digital-cover]` warnings in the log.
- [ ] No plugin-related errors in Picard's log during normal use.
