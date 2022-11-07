PLUGIN_NAME = 'Find Albums To Improve'
PLUGIN_AUTHOR = 'benmayne'
PLUGIN_DESCRIPTION = '''Remove loaded albums based on heuristics for specific types of missing data'''
PLUGIN_VERSION = '0.1'
PLUGIN_API_VERSIONS = ['2.0', '2.1', '2.2', '2.3']
PLUGIN_LICENSE = "GPL-2.0"
PLUGIN_LICENSE_URL = "https://www.gnu.org/licenses/gpl-2.0.html"

from PyQt5.QtCore import QCoreApplication

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

register_album_action(RemoveAlbumsWithArtwork())
