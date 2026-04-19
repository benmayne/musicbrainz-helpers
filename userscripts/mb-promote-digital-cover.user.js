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
    // Preview panel (preview mode)
    // ---------------------------------------------------------------------------

    let previewState = null;

    /**
     * Build a single "slot" column (Current or Proposed).
     * @param {{label: string, imageUrl: string|null, caption: string, placeholderText: string}} args
     * @returns {HTMLElement}
     */
    function buildPreviewSlot({ label, imageUrl, caption, placeholderText }) {
        const col = document.createElement('div');
        col.style.cssText = 'flex: 1; text-align: center; padding: 0.5em;';

        const heading = document.createElement('div');
        heading.textContent = label;
        heading.style.cssText = 'font-weight: bold; margin-bottom: 0.5em; font-size: 1em;';
        col.appendChild(heading);

        if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = label;
            img.style.cssText = 'max-width: 100%; max-height: 500px; border: 1px solid #ccc; background: #f9f9f9;';
            img.onerror = () => {
                img.replaceWith(buildPlaceholder('(cover art unavailable)'));
            };
            col.appendChild(img);
        } else {
            col.appendChild(buildPlaceholder(placeholderText));
        }

        const cap = document.createElement('div');
        cap.className = 'promote-digital-cover-caption';
        cap.textContent = caption;
        cap.style.cssText = 'margin-top: 0.5em; font-size: 0.9em; color: #555;';
        col.appendChild(cap);

        return col;
    }

    function buildPlaceholder(text) {
        const p = document.createElement('div');
        p.textContent = text;
        p.style.cssText =
            'height: 300px; display: flex; align-items: center; justify-content: center; border: 1px dashed #ccc; background: #f9f9f9; color: #888;';
        return p;
    }

    /**
     * Format release metadata for the caption.
     * @param {object|null} release
     * @returns {string}
     */
    function captionForRelease(release) {
        if (!release) return '';
        const formats = (release.media || []).map((m) => m.format).filter(Boolean).join(' + ');
        const bits = [release.title || '(untitled)'];
        if (formats) bits.push(formats);
        if (release.date) bits.push(release.date);
        return bits.join(' · ');
    }

    /**
     * Build the full preview panel with both slots.
     * @param {{
     *   rgMbid: string,
     *   currentRelease: object|null,
     *   proposedRelease: object|null,
     *   hasCurrentCover: boolean,
     * }} args
     * @returns {HTMLElement}
     */
    function buildPreviewPanel({ rgMbid, currentRelease, proposedRelease, hasCurrentCover }) {
        const panel = document.createElement('div');
        panel.className = 'promote-digital-cover-preview';
        panel.style.cssText =
            'margin: 1em 0; padding: 1em; border: 1px solid #ccc; background: #fffbe6; border-radius: 3px;';

        const heading = document.createElement('div');
        heading.textContent = 'Cover art comparison';
        heading.style.cssText = 'font-weight: bold; margin-bottom: 0.5em;';
        panel.appendChild(heading);

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: 1em; align-items: flex-start;';

        row.appendChild(
            buildPreviewSlot({
                label: 'Current release group cover',
                imageUrl: hasCurrentCover ? CAA_RELEASE_GROUP_FRONT(rgMbid, 500) : null,
                caption: hasCurrentCover
                    ? `From: ${captionForRelease(currentRelease)}`
                    : '(no current cover)',
                placeholderText: 'No current cover',
            })
        );

        const proposedUrl =
            proposedRelease && hasUsableFrontCover(proposedRelease)
                ? CAA_RELEASE_FRONT(proposedRelease.id, 500)
                : null;
        row.appendChild(
            buildPreviewSlot({
                label: 'Proposed',
                imageUrl: proposedUrl,
                caption: proposedRelease
                    ? `From: ${captionForRelease(proposedRelease)}`
                    : '(select a release below)',
                placeholderText: proposedRelease
                    ? '(no cover art uploaded)'
                    : '(select a release below)',
            })
        );

        panel.appendChild(row);
        return panel;
    }

    /**
     * Insert the preview panel at the top of the set-cover-art form.
     * Returns the inserted panel, or null if no hook was found.
     * @param {HTMLElement} panelEl
     * @returns {HTMLElement|null}
     */
    function insertPreviewPanel(panelEl) {
        // MB's set-cover-art page has a <form> for selecting the release.
        // Insert the panel just above it so it appears near the top of the
        // content area.
        const form = document.querySelector('#content form, form.set-cover-art');
        if (!form) {
            console.warn('[promote-digital-cover] set-cover-art form not found');
            return null;
        }
        form.parentNode.insertBefore(panelEl, form);
        return panelEl;
    }

    /**
     * Find radio inputs in the set-cover-art form that correspond to release options.
     * Returns an array so callers can filter by value.
     * @returns {HTMLInputElement[]}
     */
    function findReleaseRadios() {
        return Array.from(
            document.querySelectorAll('input[type="radio"][name*="release" i]')
        );
    }

    /**
     * Click the radio whose value matches the given MBID. Returns true if matched.
     * @param {string} mbid
     * @returns {boolean}
     */
    function selectReleaseRadio(mbid) {
        const radio = findReleaseRadios().find(
            (r) => (r.value || '').toLowerCase() === mbid.toLowerCase()
        );
        if (!radio) return false;
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    /**
     * Re-render the "Proposed" column of the preview panel.
     * @param {{release: object|null}} args
     */
    function updateProposedSlot({ release }) {
        if (!previewState || !previewState.panel) return;

        const panel = previewState.panel;
        const columns = panel.querySelectorAll(':scope > div:last-child > div');
        // columns[0] = current, columns[1] = proposed
        const proposedCol = columns[1];
        if (!proposedCol) return;

        const newSlot = buildPreviewSlot({
            label: 'Proposed',
            imageUrl:
                release && hasUsableFrontCover(release)
                    ? CAA_RELEASE_FRONT(release.id, 500)
                    : null,
            caption: release
                ? `From: ${captionForRelease(release)}`
                : '(select a release below)',
            placeholderText: release
                ? '(no cover art uploaded)'
                : '(select a release below)',
        });
        proposedCol.replaceWith(newSlot);
    }

    /**
     * Attach a change listener to the release picker to update the proposed slot live.
     */
    function wireLiveUpdate() {
        if (!previewState) return;
        document.addEventListener('change', (event) => {
            const t = event.target;
            if (!t || t.tagName !== 'INPUT' || t.type !== 'radio') return;
            if (!(t.name || '').match(/release/i)) return;
            const mbid = (t.value || '').toLowerCase();
            if (!/^[0-9a-f-]{36}$/.test(mbid)) return;
            const release = previewState.releasesById.get(mbid) || null;
            updateProposedSlot({ release });
        });
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
        runPreviewMode();
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

    async function runPreviewMode() {
        const rgMbid = mbidFromPath(SET_COVER_ART_RE);
        if (!rgMbid) return;

        const [mbData, caaData] = await Promise.all([
            fetchReleaseGroupData(rgMbid),
            fetchCaaReleaseGroup(rgMbid),
        ]);
        if (!mbData) return;

        const classified = classifyReleases(mbData, caaData);
        const releasesById = new Map(classified.allReleases.map((r) => [r.id, r]));

        const hash = location.hash || '';
        const hashMatch = hash.match(/#promote=([0-9a-f-]{36})/i);
        const initialMbid = hashMatch ? hashMatch[1].toLowerCase() : null;
        const initialRelease = initialMbid ? releasesById.get(initialMbid) : null;

        const currentRelease = classified.currentCoverMbid
            ? releasesById.get(classified.currentCoverMbid)
            : null;
        const hasCurrentCover = !!classified.currentCoverMbid;

        const panel = buildPreviewPanel({
            rgMbid,
            currentRelease,
            proposedRelease: initialRelease,
            hasCurrentCover,
        });
        insertPreviewPanel(panel);

        previewState = {
            rgMbid,
            releasesById,
            panel,
            hasCurrentCover,
            currentRelease,
        };

        if (initialMbid) {
            const matched = selectReleaseRadio(initialMbid);
            if (!matched) {
                console.warn('[promote-digital-cover] could not find radio for', initialMbid);
            }
        }

        wireLiveUpdate();
    }
})();
