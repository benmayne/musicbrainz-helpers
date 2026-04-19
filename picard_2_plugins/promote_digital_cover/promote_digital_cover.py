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
