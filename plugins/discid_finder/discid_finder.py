PLUGIN_NAME = 'Disc ID Finder'
PLUGIN_AUTHOR = 'benmayne'
PLUGIN_DESCRIPTION = (
    'Identifies releases that have a ripping log (XLD/EAC) but no disc ID '
    'in MusicBrainz. Select albums and use "Remove albums with disc IDs or '
    'no ripping log" to filter down to releases that need a disc ID submitted.'
)
PLUGIN_VERSION = '0.1'
PLUGIN_API_VERSIONS = ['2.6', '2.7', '2.8', '2.9', '2.10', '2.11', '2.12', '2.13']
PLUGIN_LICENSE = "GPL-2.0"
PLUGIN_LICENSE_URL = "https://www.gnu.org/licenses/gpl-2.0.html"

import os

from PyQt5.QtCore import QCoreApplication

from picard.album import Album
from picard.ui.itemviews import BaseAction, register_album_action


def _has_disc_id(album):
    for track in album.tracks:
        if track.metadata.getall('~musicbrainz_discids'):
            return True
    return False


def _has_ripping_log(album):
    dirs_checked = set()
    for track in album.tracks:
        for file in track.files:
            directory = os.path.dirname(file.filename)
            if directory in dirs_checked:
                continue
            dirs_checked.add(directory)
            try:
                for entry in os.listdir(directory):
                    if entry.lower().endswith('.log'):
                        return True
            except OSError:
                continue
    return False


class RemoveAlbumsWithDiscIdOrNoLog(BaseAction):
    NAME = 'Keep only albums with log and no disc ID'

    def callback(self, objs):
        for album in objs:
            if isinstance(album, Album) and album.loaded:
                if _has_disc_id(album) or not _has_ripping_log(album):
                    self.tagger.remove_album(album)
            QCoreApplication.processEvents()


register_album_action(RemoveAlbumsWithDiscIdOrNoLog())
