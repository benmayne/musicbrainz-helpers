// ==UserScript==
// @name         MusicBrainz: Promote Digital Cover Art
// @namespace    https://github.com/benmayne/musicbrainz-helpers
// @description  Suggest promoting a digital release's cover art to the release-group level; preview old vs new on the set-cover-art page.
// @version      0.1
// @match        https://musicbrainz.org/release/*
// @match        https://musicbrainz.org/release-group/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---------------------------------------------------------------------------
    // Entry point / mode dispatch
    // ---------------------------------------------------------------------------

    const path = location.pathname;
    const SET_COVER_ART_RE = /^\/release-group\/([0-9a-f-]{36})\/set-cover-art\/?$/i;
    const RELEASE_GROUP_RE = /^\/release-group\/([0-9a-f-]{36})\/?$/i;
    const RELEASE_RE = /^\/release\/([0-9a-f-]{36})(?:\/|$)/i;

    if (SET_COVER_ART_RE.test(path)) {
        console.log('[promote-digital-cover] preview mode');
        // runPreviewMode() — added in later tasks
        return;
    }

    if (RELEASE_GROUP_RE.test(path) || RELEASE_RE.test(path)) {
        // Skip edit sub-pages of releases (e.g. /release/<id>/edit, /release/<id>/add-cover-art).
        // Only run button mode on the main release or release-group view pages.
        const isEditSubpage = /\/(edit|add-cover-art|cover-art|disc|discids)(\/|$)/i.test(path);
        if (isEditSubpage) return;

        console.log('[promote-digital-cover] button mode');
        // runButtonMode() — added in later tasks
        return;
    }
})();
