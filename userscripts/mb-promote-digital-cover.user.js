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
    // Classification
    // ---------------------------------------------------------------------------

    /**
     * A release is "digital" iff every medium has format exactly "Digital Media".
     * Releases with zero media are excluded (no format info).
     * @param {object} release
     * @returns {boolean}
     */
    function isDigitalRelease(release) {
        const media = release.media || [];
        if (media.length === 0) return false;
        return media.every((m) => m.format === 'Digital Media');
    }

    /**
     * Extract the MBID of the release that the CAA "front" image is from.
     * @param {object|null} caaData
     * @returns {string|null}
     */
    function currentCoverReleaseMbid(caaData) {
        if (!caaData || !Array.isArray(caaData.images)) return null;
        const front = caaData.images.find((img) => img.front === true);
        if (!front || typeof front.release !== 'string') return null;
        const m = front.release.match(/\/release\/([0-9a-f-]{36})/i);
        return m ? m[1].toLowerCase() : null;
    }

    /**
     * Classify the release group: list digital releases, identify current
     * cover source, determine whether the current cover is from a digital
     * release.
     *
     * @param {object} mbData  - MB WS release-group payload
     * @param {object|null} caaData  - CAA release-group JSON payload (nullable)
     * @returns {{
     *   allReleases: object[],
     *   digitalReleases: object[],
     *   currentCoverMbid: string|null,
     *   currentCoverIsDigital: boolean,
     * }}
     */
    function classifyReleases(mbData, caaData) {
        const allReleases = mbData.releases || [];
        const digitalReleases = allReleases.filter(isDigitalRelease);
        const currentCoverMbid = currentCoverReleaseMbid(caaData);
        const currentCoverIsDigital =
            !!currentCoverMbid && digitalReleases.some((r) => r.id === currentCoverMbid);
        return { allReleases, digitalReleases, currentCoverMbid, currentCoverIsDigital };
    }

    // ---------------------------------------------------------------------------
    // Target release picker
    // ---------------------------------------------------------------------------

    /**
     * Sort key for "oldest first": date ascending, MBID as tie-breaker.
     * Missing date sorts after present dates (so dated releases win).
     * @param {object} release
     * @returns {string}
     */
    function oldestSortKey(release) {
        const date = release.date && release.date.length > 0 ? release.date : '9999-99-99';
        return `${date}|${release.id}`;
    }

    /**
     * Consider a release to have usable front cover art only if
     * artwork/front are true AND darkened is false.
     * @param {object} release
     * @returns {boolean}
     */
    function hasUsableFrontCover(release) {
        const caa = release['cover-art-archive'] || {};
        return caa.artwork === true && caa.front === true && caa.darkened !== true;
    }

    /**
     * Pick the digital release to target:
     *   - Prefer the oldest digital release with usable front cover art.
     *   - Otherwise, the oldest digital release overall.
     *   - Null if there are no digital releases.
     *
     * @param {object[]} digitalReleases
     * @returns {{ release: object, hasCover: boolean }|null}
     */
    function pickTargetDigitalRelease(digitalReleases) {
        if (digitalReleases.length === 0) return null;
        const sorted = [...digitalReleases].sort((a, b) =>
            oldestSortKey(a).localeCompare(oldestSortKey(b))
        );
        const withCover = sorted.find(hasUsableFrontCover);
        if (withCover) return { release: withCover, hasCover: true };
        return { release: sorted[0], hasCover: false };
    }

    // ---------------------------------------------------------------------------
    // Button rendering (button mode)
    // ---------------------------------------------------------------------------

    // Selectors confirmed during Task 5 Step 1 recon. Keep both to be defensive.
    const COVER_ART_SELECTOR = 'div.cover-art, div.coverart';

    /**
     * Describe a release in the subtext line. Prefers title + date.
     * @param {object} release
     * @returns {string}
     */
    function describeRelease(release) {
        const parts = [release.title || '(untitled release)'];
        if (release.date) parts.push(release.date);
        if (release.country) parts.push(release.country);
        return parts.join(', ');
    }

    /**
     * Build the promote button + subtext block.
     * @param {{ rgMbid: string, target: { release: object, hasCover: boolean } }} args
     * @returns {HTMLElement}
     */
    function buildPromoteButtonBlock({ rgMbid, target }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'promote-digital-cover-block';
        wrapper.style.cssText =
            'margin-top: 0.5em; padding: 0.5em; border: 1px solid #ccc; background: #fffbe6; border-radius: 3px;';

        const button = document.createElement('a');
        const rid = target.release.id;
        if (target.hasCover) {
            button.href = `/release-group/${rgMbid}/set-cover-art#promote=${rid}`;
            button.textContent = 'Promote digital cover to release group →';
        } else {
            button.href = `/release/${rid}/add-cover-art`;
            button.textContent = 'Add cover art to digital release →';
        }
        button.style.cssText =
            'display: inline-block; padding: 4px 10px; background: #ea6005; color: white; text-decoration: none; border-radius: 3px; font-weight: bold;';
        wrapper.appendChild(button);

        const subtext = document.createElement('div');
        subtext.style.cssText = 'margin-top: 0.4em; font-size: 0.9em; color: #555;';
        if (target.hasCover) {
            subtext.textContent = `Source: ${describeRelease(target.release)}`;
        } else {
            subtext.textContent = `Upload cover art to "${describeRelease(target.release)}" first. You'll still need to set it as the group cover afterward.`;
        }
        wrapper.appendChild(subtext);

        return wrapper;
    }

    /**
     * Insert the button block immediately after the cover-art container.
     * Returns true if inserted, false if no hook was found.
     * @param {HTMLElement} blockEl
     * @returns {boolean}
     */
    function insertButtonBlock(blockEl) {
        const hook = document.querySelector(COVER_ART_SELECTOR);
        if (!hook) {
            console.warn('[promote-digital-cover] cover-art hook not found; selector:', COVER_ART_SELECTOR);
            return false;
        }
        hook.insertAdjacentElement('afterend', blockEl);
        return true;
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
        runButtonMode();
        return;
    }

    // ---------------------------------------------------------------------------
    // Main flows
    // ---------------------------------------------------------------------------

    async function runButtonMode() {
        let rgMbid = mbidFromPath(RELEASE_GROUP_RE);
        if (!rgMbid) {
            const releaseMbid = mbidFromPath(RELEASE_RE);
            if (!releaseMbid) return;
            rgMbid = releaseGroupMbidFromReleasePage();
            if (!rgMbid) {
                console.warn('[promote-digital-cover] could not determine RG MBID from release page');
                return;
            }
        }

        const [mbData, caaData] = await Promise.all([
            fetchReleaseGroupData(rgMbid),
            fetchCaaReleaseGroup(rgMbid),
        ]);
        if (!mbData) return;

        const classified = classifyReleases(mbData, caaData);
        if (classified.currentCoverIsDigital) return;
        if (classified.digitalReleases.length === 0) return;

        const target = pickTargetDigitalRelease(classified.digitalReleases);
        if (!target) return;

        const block = buildPromoteButtonBlock({ rgMbid, target });
        insertButtonBlock(block);
    }
})();
