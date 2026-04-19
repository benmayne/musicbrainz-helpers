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
    // Constants
    // ---------------------------------------------------------------------------

    const MB_WS_BASE = 'https://musicbrainz.org/ws/2';
    const CAA_BASE = 'https://coverartarchive.org';
    const CAA_RELEASE_GROUP_FRONT = (mbid, size) =>
        `${CAA_BASE}/release-group/${mbid}/front-${size}`;
    const CAA_RELEASE_FRONT = (mbid, size) =>
        `${CAA_BASE}/release/${mbid}/front-${size}`;

    // ---------------------------------------------------------------------------
    // URL / DOM helpers
    // ---------------------------------------------------------------------------

    /**
     * Extract an MBID from the current URL using a regex with one capture group.
     * @param {RegExp} re
     * @returns {string|null}
     */
    function mbidFromPath(re) {
        const m = location.pathname.match(re);
        return m ? m[1].toLowerCase() : null;
    }

    /**
     * Find the release group MBID from a release view page by reading the
     * sidebar link `a[href^="/release-group/..."]`.
     * @returns {string|null}
     */
    function releaseGroupMbidFromReleasePage() {
        const link = document.querySelector('a[href^="/release-group/"]');
        if (!link) return null;
        const m = link.getAttribute('href').match(/\/release-group\/([0-9a-f-]{36})/i);
        return m ? m[1].toLowerCase() : null;
    }

    // ---------------------------------------------------------------------------
    // Fetch helpers
    // ---------------------------------------------------------------------------

    /**
     * Fetch JSON from a URL, returning null on any error.
     * @param {string} url
     * @returns {Promise<object|null>}
     */
    async function fetchJson(url) {
        try {
            const resp = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!resp.ok) {
                console.warn('[promote-digital-cover] fetch failed', url, resp.status);
                return null;
            }
            return await resp.json();
        } catch (err) {
            console.warn('[promote-digital-cover] fetch error', url, err);
            return null;
        }
    }

    /**
     * Fetch release group data with embedded releases + media.
     * @param {string} rgMbid
     * @returns {Promise<object|null>}
     */
    function fetchReleaseGroupData(rgMbid) {
        return fetchJson(`${MB_WS_BASE}/release-group/${rgMbid}?inc=releases+media&fmt=json`);
    }

    /**
     * Fetch the CAA JSON listing for a release group (image records with
     * per-image `release` URLs).
     * @param {string} rgMbid
     * @returns {Promise<object|null>}
     */
    function fetchCaaReleaseGroup(rgMbid) {
        return fetchJson(`${CAA_BASE}/release-group/${rgMbid}`);
    }

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
