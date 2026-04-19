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
