PLUGIN_NAME = 'Find Albums To Improve'
PLUGIN_AUTHOR = 'benmayne'
PLUGIN_DESCRIPTION = '''Remove loaded albums based on heuristics for specific types of missing data'''
PLUGIN_VERSION = '0.1'
PLUGIN_API_VERSIONS = ['2.0', '2.1', '2.2', '2.3']
PLUGIN_LICENSE = "GPL-2.0"
PLUGIN_LICENSE_URL = "https://www.gnu.org/licenses/gpl-2.0.html"

from PyQt5.QtCore import QCoreApplication
from collections import defaultdict

from picard import log
from picard.album import Album
from picard.ui.itemviews import BaseAction, register_album_action

class RemoveAlbumsWithArtwork(BaseAction):
    NAME = 'Remove Albums With Artwork'
    def callback(self, objs):
        for album in objs:
            if (isinstance(album, Album) and album.loaded and album.metadata.images.get_front_image()):
                    self.tagger.remove_album(album)
            QCoreApplication.processEvents()

class FindDupeAlbums(BaseAction):
    NAME = 'Find Dupe Release Groups'

    def __init__(self):
        super().__init__()
        self.albums_by_release_group = defaultdict(list)

    def callback(self, objs):
        for album in objs:
            if (isinstance(album, Album) and album.loaded):
                self.albums_by_release_group[album.metadata["musicbrainz_releasegroupid"]].append(album)
        for albums in self.albums_by_release_group.values():
            if (len(albums) == 1):
                self.tagger.remove_album(albums[0])
            QCoreApplication.processEvents()
        self.albums_by_release_group = defaultdict(list)

register_album_action(RemoveAlbumsWithArtwork())
register_album_action(FindDupeAlbums())
