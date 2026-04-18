# Promote Digital Cover Userscript — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Violentmonkey userscript that nudges MusicBrainz editors to promote digital releases' cover art to the release-group level, and enhances the `/set-cover-art` edit page with a side-by-side preview.

**Architecture:** Single self-contained `.user.js` file. On release and release group pages it fetches data from MB WS and CAA, decides whether a digital cover should be promoted, and injects a button below the cover-art image. On the `/release-group/<mbid>/set-cover-art` page it injects a side-by-side "current vs proposed" preview that syncs with MB's native release-picker form.

**Tech Stack:** Vanilla JavaScript, Violentmonkey userscript API, MusicBrainz WS v2 (`/ws/2/`), Cover Art Archive JSON API.

**Spec:** `docs/superpowers/specs/2026-04-18-promote-digital-cover-userscript-design.md`

**Test URLs (recon / verification):**
- Example RG with physical-sourced cover: `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98`
- Example release in that group: `https://musicbrainz.org/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216`
- The implementer should verify the *current* state of these URLs (MB data can change). If they no longer match the expected scenarios, pick fresh test URLs using MB search + the CAA JSON endpoint.

**Testing approach:** The existing userscript in this repo (`amazon-audiobook-importer.user.js`) has no automated tests — all verification is manual in the browser. This plan follows the same convention. Pure helper functions are verified with inline `node -e` commands so behavior can be checked before loading into the browser.

---

### Task 1: Scaffold the userscript with metadata header and mode dispatcher

**Files:**
- Create: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Create the file with the userscript header and mode dispatch skeleton**

```javascript
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
```

- [ ] **Step 2: Install the script in Violentmonkey**

Open Violentmonkey → Dashboard → New (+) → paste the file contents → save. (Alternatively drag-and-drop the `.user.js` file onto the dashboard.)

- [ ] **Step 3: Manual verification**

Open the browser DevTools console and navigate to each of these URLs in turn. Expected console output:

- `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98` → `[promote-digital-cover] button mode`
- `https://musicbrainz.org/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216` → `[promote-digital-cover] button mode`
- `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98/set-cover-art` → `[promote-digital-cover] preview mode`
- `https://musicbrainz.org/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216/edit` → (no log; edit subpage is skipped)
- `https://musicbrainz.org/artist/<any>` → (no log; not matched)

- [ ] **Step 4: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): scaffold promote-digital-cover with mode dispatcher"
```

---

### Task 2: Add URL/DOM parsers and fetch helpers

**Files:**
- Modify: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Add constants, URL helpers, and fetch helpers**

Immediately after `'use strict';` and before the "Entry point" comment block, insert:

```javascript
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
```

- [ ] **Step 2: Verify pure helpers behave as expected**

Run each of these `node -e` invocations. Expected output is printed after each command.

```bash
node -e '
const mbidFromPath = (re, path) => { const m = path.match(re); return m ? m[1].toLowerCase() : null; };
const RG = /^\/release-group\/([0-9a-f-]{36})\/?$/i;
const REL = /^\/release\/([0-9a-f-]{36})(?:\/|$)/i;
console.log(mbidFromPath(RG, "/release-group/B76520A1-3C5F-3A0C-A755-4C4D99B97C98"));
console.log(mbidFromPath(REL, "/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216"));
console.log(mbidFromPath(RG, "/artist/foo"));
'
```

Expected:
```
b76520a1-3c5f-3a0c-a755-4c4d99b97c98
4c138b92-dce4-4f24-a5b4-8f4c087cd216
null
```

- [ ] **Step 3: Verify live fetches succeed**

Open https://musicbrainz.org in a browser (so the script is loaded) and open DevTools console. Run:

```javascript
await (await fetch('https://musicbrainz.org/ws/2/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98?inc=releases+media&fmt=json', { headers: { Accept: 'application/json' } })).json();
```

Expected: a JSON object with `releases: [...]` where each release has `media` and `cover-art-archive`. Then:

```javascript
await (await fetch('https://coverartarchive.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98', { headers: { Accept: 'application/json' } })).json();
```

Expected: a JSON object with `images: [...]` or an HTTP 404 JSON error (if the RG has no cover art — the 404 response body is still JSON with `{ "error": "..." }`).

If 404: note that our code path must handle this — `fetchJson` returns null on non-ok status, which is correct. Confirm `fetchJson` logs the 404 warning but doesn't throw.

- [ ] **Step 4: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): add url parsers and MB/CAA fetch helpers"
```

---

### Task 3: Implement release classification (digital detection + current-cover lookup)

**Files:**
- Modify: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Add classification helpers**

Immediately after the fetch helpers block, insert:

```javascript
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
```

- [ ] **Step 2: Verify classification with fixture data via `node -e`**

```bash
node -e '
function isDigitalRelease(release) {
    const media = release.media || [];
    if (media.length === 0) return false;
    return media.every((m) => m.format === "Digital Media");
}
function currentCoverReleaseMbid(caaData) {
    if (!caaData || !Array.isArray(caaData.images)) return null;
    const front = caaData.images.find((img) => img.front === true);
    if (!front || typeof front.release !== "string") return null;
    const m = front.release.match(/\/release\/([0-9a-f-]{36})/i);
    return m ? m[1].toLowerCase() : null;
}
function classifyReleases(mbData, caaData) {
    const allReleases = mbData.releases || [];
    const digitalReleases = allReleases.filter(isDigitalRelease);
    const currentCoverMbid = currentCoverReleaseMbid(caaData);
    const currentCoverIsDigital =
        !!currentCoverMbid && digitalReleases.some((r) => r.id === currentCoverMbid);
    return { allReleases, digitalReleases, currentCoverMbid, currentCoverIsDigital };
}

const mb = {
    releases: [
        { id: "aaaa0000-0000-0000-0000-000000000001", media: [{ format: "CD" }] },
        { id: "aaaa0000-0000-0000-0000-000000000002", media: [{ format: "Digital Media" }] },
        { id: "aaaa0000-0000-0000-0000-000000000003", media: [{ format: "Digital Media" }, { format: "CD" }] },
        { id: "aaaa0000-0000-0000-0000-000000000004", media: [] },
    ],
};
const caaCdCover = { images: [{ front: true, release: "https://musicbrainz.org/release/aaaa0000-0000-0000-0000-000000000001" }] };
const caaDigitalCover = { images: [{ front: true, release: "https://musicbrainz.org/release/aaaa0000-0000-0000-0000-000000000002" }] };
const caaNone = { images: [] };

const r1 = classifyReleases(mb, caaCdCover);
console.log("case: CD cover =>", r1.digitalReleases.length, r1.currentCoverMbid, r1.currentCoverIsDigital);
// expect: 1 aaaa0000-0000-0000-0000-000000000001 false

const r2 = classifyReleases(mb, caaDigitalCover);
console.log("case: digital cover =>", r2.digitalReleases.length, r2.currentCoverMbid, r2.currentCoverIsDigital);
// expect: 1 aaaa0000-0000-0000-0000-000000000002 true

const r3 = classifyReleases(mb, caaNone);
console.log("case: no cover =>", r3.digitalReleases.length, r3.currentCoverMbid, r3.currentCoverIsDigital);
// expect: 1 null false
'
```

Expected output:
```
case: CD cover => 1 aaaa0000-0000-0000-0000-000000000001 false
case: digital cover => 1 aaaa0000-0000-0000-0000-000000000002 true
case: no cover => 1 null false
```

- [ ] **Step 3: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): classify releases (digital detection + current cover source)"
```

---

### Task 4: Implement target digital-release picker

**Files:**
- Modify: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Add target picker**

Immediately after the classification block, insert:

```javascript
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
```

- [ ] **Step 2: Verify picker via `node -e`**

```bash
node -e '
function oldestSortKey(release) {
    const date = release.date && release.date.length > 0 ? release.date : "9999-99-99";
    return `${date}|${release.id}`;
}
function hasUsableFrontCover(release) {
    const caa = release["cover-art-archive"] || {};
    return caa.artwork === true && caa.front === true && caa.darkened !== true;
}
function pickTargetDigitalRelease(digitalReleases) {
    if (digitalReleases.length === 0) return null;
    const sorted = [...digitalReleases].sort((a, b) =>
        oldestSortKey(a).localeCompare(oldestSortKey(b))
    );
    const withCover = sorted.find(hasUsableFrontCover);
    if (withCover) return { release: withCover, hasCover: true };
    return { release: sorted[0], hasCover: false };
}

const oldNoCover = { id: "a", date: "2005-01-01", "cover-art-archive": { artwork: false, front: false } };
const newWithCover = { id: "b", date: "2020-05-10", "cover-art-archive": { artwork: true, front: true, darkened: false } };
const newerNoCover = { id: "c", date: "2021-01-01", "cover-art-archive": { artwork: false, front: false } };
const darkened = { id: "d", date: "1999-01-01", "cover-art-archive": { artwork: true, front: true, darkened: true } };

const picked1 = pickTargetDigitalRelease([oldNoCover, newWithCover, newerNoCover]);
console.log("prefers with cover =>", picked1.release.id, picked1.hasCover);
// expect: b true

const picked2 = pickTargetDigitalRelease([oldNoCover, newerNoCover]);
console.log("fallback to oldest =>", picked2.release.id, picked2.hasCover);
// expect: a false

const picked3 = pickTargetDigitalRelease([darkened, newWithCover]);
console.log("darkened skipped =>", picked3.release.id, picked3.hasCover);
// expect: b true

const picked4 = pickTargetDigitalRelease([]);
console.log("empty =>", picked4);
// expect: null
'
```

Expected output:
```
prefers with cover => b true
fallback to oldest => a false
darkened skipped => b true
empty => null
```

- [ ] **Step 3: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): pick target digital release (oldest with cover, fallback oldest)"
```

---

### Task 5: Implement button mode (render button on release / release-group pages)

**Files:**
- Modify: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Recon the DOM to find the cover-art container selector**

Open https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98 and inspect the sidebar cover art image. Note which element wraps the image. Common candidates on MB (as of this plan) include:

- `div.cover-art` (most likely)
- `#sidebar div.cover-art`
- `div.coverart`

Do the same on a release page: https://musicbrainz.org/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216. Confirm that the same or an equivalent selector matches on both page types.

Record the confirmed selector here in a comment before moving on. If MB uses different wrappers on release vs release-group pages, include both in the selector list.

- [ ] **Step 2: Add button rendering helpers**

Immediately after the target-picker block, insert:

```javascript
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
```

- [ ] **Step 3: Wire up the button-mode main flow**

At the bottom of the file, immediately before the closing `})();`, add the main flow:

```javascript
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
```

Then replace the existing `// runButtonMode() — added in later tasks` comment in the entry-point dispatcher with an actual call:

```javascript
        console.log('[promote-digital-cover] button mode');
        runButtonMode();
        return;
```

- [ ] **Step 4: Manual browser verification**

Reload the userscript in Violentmonkey (paste the updated file contents). Then:

1. **Scenario 1 verification:** Navigate to `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98`.
   - If the RG's current cover is non-digital AND a digital release in the group has cover art: expect a yellow/orange button block below the cover saying **"Promote digital cover to release group →"** with a subtext like "Source: <release title>, <date>".
   - Hover the button; href should be `/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98/set-cover-art#promote=<mbid>`.
   - Clicking should take you to the set-cover-art page (no preview yet — added in task 6/7).

2. **Release page verification:** Navigate to any release in that group, e.g. `https://musicbrainz.org/release/4c138b92-dce4-4f24-a5b4-8f4c087cd216`.
   - Same button should appear below that release's cover.

3. **Scenario 2 verification:** Find an RG whose current cover is non-digital and where no digital release in the group has cover art. (Query MB WS in the console to identify one, or use one you know of.) Expect button **"Add cover art to digital release →"** with subtext about uploading first. Clicking should go to `/release/<mbid>/add-cover-art`.

4. **Scenario 4 verification:** Navigate to any RG whose cover is already from a digital release. Expect NO button to appear.

5. **No digital release in group verification:** Navigate to an RG with only physical releases. Expect NO button.

6. **Error resilience:** In DevTools Network tab, block `coverartarchive.org`. Reload. Expect NO button and a console warning from `fetchJson`.

If the button doesn't appear on an expected-true case, inspect the console for the "cover-art hook not found" warning. If present, fix `COVER_ART_SELECTOR` to match the actual DOM (identified during Step 1 recon).

- [ ] **Step 5: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): render promote button on release and release-group pages"
```

---

### Task 6: Implement preview panel on set-cover-art page

**Files:**
- Modify: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Recon the set-cover-art form DOM**

Navigate to `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98/set-cover-art` (you'll need to be logged in to MusicBrainz). Inspect the page. Identify:

1. The element that wraps the entire release-selector form — probably a `<form>` element or a specific `<div>`.
2. How releases are presented — radio inputs (`<input type="radio" name="...">`) or a `<select>` dropdown, or clickable cards.
3. Each release entry's MBID — is it on a `data-mbid` attribute, in a radio `value`, or in a `href`? Record this for Task 7.

Record findings in a comment at the top of the section you're about to add. If MB's form structure differs wildly from what this plan assumes, stop and check with the user before proceeding.

- [ ] **Step 2: Add preview panel rendering**

Immediately after the button-rendering block (and before the "Main flows" section), insert:

```javascript
    // ---------------------------------------------------------------------------
    // Preview panel (preview mode)
    // ---------------------------------------------------------------------------

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
```

- [ ] **Step 3: Wire up the preview-mode main flow (without live update yet)**

At the bottom of the file, after `runButtonMode`, add:

```javascript
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

        // Expose state for Task 7's live-update wiring.
        window.__promoteDigitalCoverState = {
            rgMbid,
            releasesById,
            panel,
            hasCurrentCover,
            currentRelease,
        };
    }
```

And in the dispatcher at the top, replace:

```javascript
        console.log('[promote-digital-cover] preview mode');
        // runPreviewMode() — added in later tasks
        return;
```

with:

```javascript
        console.log('[promote-digital-cover] preview mode');
        runPreviewMode();
        return;
```

- [ ] **Step 4: Manual browser verification**

Reload the userscript. Log into MusicBrainz (required for the edit page). Then:

1. **With `#promote=` hash:** Navigate to `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98/set-cover-art#promote=<any-release-mbid-from-that-group>`.
   - Expect a yellow-ish panel at the top of the form with two columns. Left: current RG cover with caption. Right: the chosen release's cover (or placeholder if no cover art).
   - Images should load and be roughly the same visual size.

2. **Without hash:** Navigate to the same URL without `#promote=...`.
   - Expect the panel to render, with Current filled in (if RG has a cover) and Proposed showing the "(select a release below)" placeholder.

3. **Invalid MBID in hash:** Navigate with a made-up MBID like `#promote=00000000-0000-0000-0000-000000000000`.
   - Expect the panel to render with Proposed caption "(select a release below)" (since `releasesById.get(...)` returns undefined, which is falsy).

4. **RG with no cover art:** Navigate to a set-cover-art page for an RG with no existing cover. Expect Current slot to show the "No current cover" placeholder.

5. **Form not found:** Without logging in, navigate to the set-cover-art URL. MB will redirect or show an error page. Expect the script to console-warn and not crash.

- [ ] **Step 5: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): render side-by-side preview panel on set-cover-art page"
```

---

### Task 7: Wire up form sync and live update on preview panel

**Files:**
- Modify: `userscripts/mb-promote-digital-cover.user.js`

- [ ] **Step 1: Identify the release-picker's DOM shape** (builds on Task 6 Step 1 recon)

Back on the set-cover-art page, find:

1. Whether each release entry is a radio input (`<input type="radio" name="..." value="<mbid>">`) or part of a `<select>`, or something else.
2. On change, which element emits the event (probably the input itself).
3. How to read the selected release MBID from the DOM.

Based on reconnaissance (MB typically uses radio inputs in this page), assume:
- `document.querySelectorAll('input[type="radio"][name*="release"]')` returns the radio list.
- `radio.value` is the release MBID.

If MB's form uses different identifiers, adapt the selectors below accordingly.

- [ ] **Step 2: Add live-update logic**

Append this block to the bottom of the "Preview panel" section (after `insertPreviewPanel`):

```javascript
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
        const state = window.__promoteDigitalCoverState;
        if (!state || !state.panel) return;

        const panel = state.panel;
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
        const state = window.__promoteDigitalCoverState;
        if (!state) return;
        document.addEventListener('change', (event) => {
            const t = event.target;
            if (!t || t.tagName !== 'INPUT' || t.type !== 'radio') return;
            if (!(t.name || '').match(/release/i)) return;
            const mbid = (t.value || '').toLowerCase();
            if (!/^[0-9a-f-]{36}$/.test(mbid)) return;
            const release = state.releasesById.get(mbid) || null;
            updateProposedSlot({ release });
        });
    }
```

- [ ] **Step 3: Call `selectReleaseRadio` and `wireLiveUpdate` from the preview-mode main flow**

In `runPreviewMode`, after `insertPreviewPanel(panel);` and the `window.__promoteDigitalCoverState = { ... };` line, add:

```javascript
        if (initialMbid) {
            const matched = selectReleaseRadio(initialMbid);
            if (!matched) {
                console.warn('[promote-digital-cover] could not find radio for', initialMbid);
            }
        }

        wireLiveUpdate();
```

- [ ] **Step 4: Manual browser verification**

Reload the userscript. Then:

1. **Auto-select from hash:** Navigate to `https://musicbrainz.org/release-group/b76520a1-3c5f-3a0c-a755-4c4d99b97c98/set-cover-art#promote=<digital-release-mbid>`.
   - Expect the matching release's radio button to be checked on page load.
   - Proposed column shows that release's cover.

2. **Live update:** Manually click a different release's radio in the form.
   - Expect the Proposed column to update: new image (or placeholder if no cover), new caption.

3. **Click radios rapidly:** Change selection several times quickly. Expect no visual glitches; each change re-renders cleanly.

4. **Direct visit (no hash):** Navigate to the set-cover-art URL with no hash. Proposed column initially says "(select a release below)". Click any radio; Proposed updates.

5. **End-to-end flow:** Start from a release or release-group view page with the button visible. Click the button. On the set-cover-art page, verify the correct release is auto-selected and the preview matches. Submit the edit (if you're actually going to make an edit) and verify the edit is created correctly.

- [ ] **Step 5: Commit**

```bash
git add userscripts/mb-promote-digital-cover.user.js
git commit -m "feat(userscript): sync preview panel with release picker; auto-select from hash"
```

---

### Task 8: Update userscripts README

**Files:**
- Modify: `userscripts/README.md`

- [ ] **Step 1: Add a section describing the new script**

Open `userscripts/README.md`. After the existing "Amazon Audiobook Importer" section (before the end of the file), add:

```markdown

### Promote Digital Cover Art

**File:** `mb-promote-digital-cover.user.js`

Nudges MusicBrainz editors to promote a digital release's cover art to the release-group level. Digital releases usually have higher-quality artwork than scans of physical media; when the release group's current cover comes from a non-digital release and a digital release exists in the group, the script adds a button beneath the cover image.

On the `/release-group/<mbid>/set-cover-art` edit page, the script injects a side-by-side preview of the current cover versus the proposed cover, and auto-selects the suggested release in the form. The preview updates live if the editor picks a different release.

**Supported pages:** `musicbrainz.org/release/*`, `musicbrainz.org/release-group/*` (including `/set-cover-art`).

**Testing:**

1. Find a release group whose current cover is sourced from a physical release (e.g., a CD scan) while a digital release in the group has its own uploaded cover art.
2. Load the RG page or any release in it. A button labelled **"Promote digital cover to release group →"** should appear below the cover image.
3. Click the button. You'll land on the set-cover-art page with the digital release pre-selected and a side-by-side comparison at the top.
4. Change the selected release in the form; the "Proposed" image should update live.
5. If instead the group has a digital release with no cover art yet, the button reads **"Add cover art to digital release →"** and takes you to that release's upload page.

**Known limitations:**

- Runs once on page load; doesn't react to MB's in-place navigation.
- Strict format check: only `Digital Media` counts as digital (not `Download Card` or hybrid digital+physical releases).
- "Oldest digital release" heuristic picks the target; there's no UI for picking a specific digital release to promote.
```

- [ ] **Step 2: Verify the README renders**

Preview the README in a markdown renderer (GitHub web UI, `glow`, or a VS Code preview pane). Confirm formatting is consistent with the Amazon Audiobook Importer section.

- [ ] **Step 3: Commit**

```bash
git add userscripts/README.md
git commit -m "docs: add readme section for promote-digital-cover userscript"
```

---

## Post-implementation sanity checks

After all tasks are complete, confirm:

- [ ] All four manual scenarios from the spec's testing plan produce the expected behavior (scenario 1, scenario 2, scenario 4, no-cover-at-all).
- [ ] The button's click navigates to a URL that the preview mode recognizes (`#promote=<mbid>` fragment).
- [ ] The preview panel reacts to form changes.
- [ ] Disabling network or blocking `coverartarchive.org` does not crash either mode.
- [ ] Nothing in the console logs errors in the happy path (warnings during blocked-network tests are expected).
