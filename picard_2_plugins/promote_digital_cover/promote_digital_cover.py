PLUGIN_NAME = 'Promote Digital Cover'
PLUGIN_AUTHOR = 'benmayne'
PLUGIN_DESCRIPTION = (
    'Two filter actions for loaded albums. '
    '"Keep albums where a digital cover is ready to promote" keeps only '
    'release groups whose current cover is non-digital and where a digital '
    'release has uploaded cover art ready to promote. '
    '"Keep albums where a digital release could be promoted (including no '
    'cover art yet)" is broader, also keeping groups where a digital release '
    'exists but has not had cover art uploaded yet.'
)
PLUGIN_VERSION = '0.1'
PLUGIN_API_VERSIONS = ['2.10', '2.11', '2.12', '2.13']
PLUGIN_LICENSE = 'GPL-2.0'
PLUGIN_LICENSE_URL = 'https://www.gnu.org/licenses/gpl-2.0.html'

from PyQt5.QtCore import QCoreApplication
from PyQt5.QtNetwork import QNetworkReply

from picard import log
from picard.album import Album
from picard.ui.itemviews import BaseAction, register_album_action

try:
    from picard.coverart.providers.caa_release_group import CaaCoverArtImageRg
except ImportError:
    # Older Picard 2.x builds may not expose this; provide a sentinel class
    # so isinstance() below always returns False.
    class CaaCoverArtImageRg:
        pass

import re


MODE_STRICT = 'strict'
MODE_BROAD = 'broad'


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


def _process_album(album, mode):
    """Entry point: kick off the async fetch pipeline for one album."""
    metadata = getattr(album, 'metadata', None)
    rg_mbid = metadata.get('musicbrainz_releasegroupid') if metadata is not None else None
    if not rg_mbid:
        log.warning(
            '[promote-digital-cover] album %r has no musicbrainz_releasegroupid; keeping',
            album,
        )
        return

    def on_browse_done(document, http, error):
        _on_browse_done(album, mode, rg_mbid, document, http, error)

    album.tagger.mb_api.browse_releases(
        on_browse_done,
        **{'release-group': rg_mbid, 'limit': 100},
    )


def _on_browse_done(album, mode, rg_mbid, document, http, error):
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
        _finalize(album, mode, classified)
        return

    # Try local image first for the current-cover source.
    source_mbid = _source_mbid_from_local_images(album)
    if source_mbid is not None:
        classified = _classify(releases, source_mbid)
        _finalize(album, mode, classified)
        return

    # Fall back to CAA.
    def on_caa_done(data, http_, error_):
        _on_caa_done(album, mode, rg_mbid, releases, data, http_, error_)

    album.tagger.webservice.get_url(
        url='https://coverartarchive.org/release-group/%s' % rg_mbid,
        handler=on_caa_done,
    )


def _on_caa_done(album, mode, rg_mbid, releases, data, http, error):
    if error:
        # 404 from CAA means no RG-level cover art exists; treat as None.
        # Other errors: log and keep the album (no _finalize call = no remove).
        if error == QNetworkReply.NetworkError.ContentNotFoundError:
            classified = _classify(releases, None)
            _finalize(album, mode, classified)
            return
        _log_fetch_failure('CAA release-group', rg_mbid, http, error)
        return

    current_mbid = _current_cover_mbid_from_caa(data if isinstance(data, dict) else None)
    classified = _classify(releases, current_mbid)
    _finalize(album, mode, classified)


def _finalize(album, mode, classified):
    if _keep_album(classified, mode):
        return
    album.tagger.remove_album(album)


def _log_fetch_failure(kind, rg_mbid, http, error):
    err_str = http.errorString() if http is not None else str(error)
    log.warning(
        '[promote-digital-cover] %s fetch failed for RG %s: %s',
        kind, rg_mbid, err_str,
    )


class KeepAlbumsWithPromotableDigitalCover(BaseAction):
    NAME = 'Keep albums where a digital cover is ready to promote'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                _process_album(album, MODE_STRICT)
            QCoreApplication.processEvents()


class KeepAlbumsWithPromotableDigitalRelease(BaseAction):
    NAME = 'Keep albums where a digital release could be promoted (including no cover art yet)'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                _process_album(album, MODE_BROAD)
            QCoreApplication.processEvents()


register_album_action(KeepAlbumsWithPromotableDigitalCover())
register_album_action(KeepAlbumsWithPromotableDigitalRelease())
