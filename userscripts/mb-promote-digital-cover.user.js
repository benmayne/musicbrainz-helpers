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

    // Permissive regexes used by helpers to extract MBIDs from any
    // release / release-group URL (including subpages).
    const RELEASE_GROUP_RE = /^\/release-group\/([0-9a-f-]{36})(?:\/|$)/i;
    const RELEASE_RE = /^\/release\/([0-9a-f-]{36})(?:\/|$)/i;

    // Strict regexes that identify which mode to run. Using an allow-list
    // (only the bare view pages or the exact set-cover-art edit page) is
    // safer than maintaining a denylist of MB subpages.
    const BUTTON_MODE_RE = /^\/release(?:-group)?\/[0-9a-f-]{36}\/?$/i;
    const SET_COVER_ART_RE = /^\/release-group\/([0-9a-f-]{36})\/set-cover-art\/?$/i;

    if (SET_COVER_ART_RE.test(path)) {
        console.log('[promote-digital-cover] preview mode');
        // runPreviewMode() — added in later tasks
        return;
    }

    if (BUTTON_MODE_RE.test(path)) {
        console.log('[promote-digital-cover] button mode');
        // runButtonMode() — added in later tasks
        return;
    }
})();
