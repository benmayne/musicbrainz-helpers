PLUGIN_NAME = 'Length Diff Checker'
PLUGIN_AUTHOR = 'benmayne'
PLUGIN_DESCRIPTION = (
    'Identifies releases where files may be tagged against the wrong release '
    'by comparing file audio lengths to MusicBrainz track lengths. '
    'Select albums and use "Remove albums with low length diff" to filter '
    'out correctly-tagged releases, leaving only suspicious ones.'
)
PLUGIN_VERSION = '0.1'
PLUGIN_API_VERSIONS = ['2.6', '2.7', '2.8', '2.9', '2.10', '2.11', '2.12', '2.13']
PLUGIN_LICENSE = "GPL-2.0"
PLUGIN_LICENSE_URL = "https://www.gnu.org/licenses/gpl-2.0.html"

from PyQt5.QtCore import QCoreApplication
from PyQt5.QtWidgets import QInputDialog

from picard.album import Album
from picard.file import register_file_post_addition_to_track_processor
from picard.ui.itemviews import BaseAction, register_album_action
from picard.util import format_time


def _track_diff(track):
    if not track.files:
        return 0
    file_length = track.files[0].orig_metadata.length
    mb_length = track.metadata.length
    if file_length and mb_length:
        return abs(file_length - mb_length)
    return 0


def _album_diff(album):
    return sum(_track_diff(t) for t in album.tracks)


class RemoveAlbumsWithLowLengthDiff(BaseAction):
    NAME = 'Remove albums with low length diff...'

    def callback(self, objs):
        threshold, ok = QInputDialog.getInt(
            self.tagger.window,
            "Length Diff Threshold",
            "Remove albums with total length diff below (seconds):",
            10, 0, 3600,
        )
        if not ok:
            return
        threshold_ms = threshold * 1000
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                if _album_diff(album) < threshold_ms:
                    self.tagger.remove_album(album)
            QCoreApplication.processEvents()


def on_file_added_to_track(track, file):
    diff = _track_diff(track)
    track.metadata['~length_diff'] = format_time(diff, display_zero=True) if diff else ""

    album = track.album
    if album:
        total = _album_diff(album)
        album.metadata['~length_diff'] = format_time(total, display_zero=True) if total else ""


register_file_post_addition_to_track_processor(on_file_added_to_track)
register_album_action(RemoveAlbumsWithLowLengthDiff())
