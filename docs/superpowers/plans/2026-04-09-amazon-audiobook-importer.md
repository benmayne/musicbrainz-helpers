# Amazon Audiobook MusicBrainz Importer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Violentmonkey userscript that adds an "Import into MusicBrainz" button to Amazon audiobook pages, pre-filling the MB "Add Release" form with scraped metadata.

**Architecture:** Single self-contained `.user.js` file. Scrapes DOM for metadata, builds hidden form params, injects a submit button. No external dependencies.

**Tech Stack:** Vanilla JavaScript, Violentmonkey userscript API

**Spec:** `docs/superpowers/specs/2026-04-09-amazon-audiobook-importer-design.md`

---

### Task 1: Create the userscript with metadata header and audiobook detection

**Files:**
- Create: `userscripts/amazon-audiobook-importer.user.js`

- [ ] **Step 1: Create the file with userscript metadata and early bail-out**

```javascript
// ==UserScript==
// @name         Import Amazon Audiobooks into MusicBrainz
// @namespace    https://github.com/benmayne/musicbrainz-helpers
// @description  One-click importing of audiobook releases from Amazon into MusicBrainz
// @version      0.1
// @match        https://www.amazon.com/*/dp/*
// @match        https://www.amazon.co.uk/*/dp/*
// @match        https://www.amazon.de/*/dp/*
// @match        https://www.amazon.fr/*/dp/*
// @match        https://www.amazon.co.jp/*/dp/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Bail if this isn't an audiobook page
    const titleHeading = document.querySelector('#productTitle, #title span, [data-action="a]');
    // Check for "Audible Audiobook" text in the format selectors or title area
    const titleArea = document.getElementById('title_feature_div') || document.getElementById('titleSection');
    if (!titleArea || !titleArea.textContent.includes('Audible Audiobook')) return;

    // Implementation continues in subsequent tasks...
})();
```

- [ ] **Step 2: Test in browser**

Install in Violentmonkey. Navigate to https://www.amazon.com/Audible-Studios-on-Brilliance-Everything/dp/B0DJRN88XX. Verify no errors in console. Navigate to a non-audiobook Amazon page and verify the script bails out silently.

- [ ] **Step 3: Commit**

```bash
git add userscripts/amazon-audiobook-importer.user.js
git commit -m "feat: add amazon audiobook importer userscript skeleton with audiobook detection"
```

---

### Task 2: Implement DOM scraping for all metadata fields

**Files:**
- Modify: `userscripts/amazon-audiobook-importer.user.js`

- [ ] **Step 1: Add helper functions for duration and language**

Replace `// Implementation continues in subsequent tasks...` with:

```javascript
    function durationToMs(str) {
        let hours = 0, minutes = 0;
        const hoursMatch = str.match(/(\d+)\s*hours?/);
        const minutesMatch = str.match(/(\d+)\s*minutes?/);
        if (hoursMatch) hours = parseInt(hoursMatch[1], 10);
        if (minutesMatch) minutes = parseInt(minutesMatch[1], 10);
        return (hours * 3600 + minutes * 60) * 1000;
    }

    const LANGUAGE_MAP = {
        'english': 'eng', 'spanish': 'spa', 'french': 'fra',
        'german': 'deu', 'italian': 'ita', 'portuguese': 'por',
        'japanese': 'jpn', 'chinese': 'zho', 'korean': 'kor',
        'russian': 'rus', 'dutch': 'nld', 'swedish': 'swe',
        'norwegian': 'nor', 'danish': 'dan', 'finnish': 'fin',
        'polish': 'pol', 'turkish': 'tur', 'arabic': 'ara',
        'hindi': 'hin', 'hebrew': 'heb',
    };
```

- [ ] **Step 2: Add the page data parser**

```javascript
    function getProductDetail(label) {
        const rows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, #audibleProductDetails tr, [class*="productDetails"] tr');
        for (const row of rows) {
            const header = row.querySelector('th, td:first-child');
            if (header && header.textContent.trim().toLowerCase().includes(label.toLowerCase())) {
                const value = row.querySelector('td:last-child, td:nth-child(2)');
                return value ? value.textContent.trim() : null;
            }
        }
        return null;
    }

    function parsePageData() {
        // Title: from the h4 heading, strip "Audible Audiobook – Unabridged" etc.
        const titleEl = document.querySelector('#productTitle') ||
                        document.querySelector('#title span:first-child') ||
                        document.querySelector('[data-action="a]');
        let title = '';
        if (titleEl) {
            title = titleEl.textContent.trim();
        } else {
            // Fallback: parse from the h4 heading
            const h4 = titleArea.querySelector('h4, h1');
            if (h4) {
                title = h4.childNodes[0]?.textContent?.trim() || h4.textContent.trim();
            }
        }
        // Clean up title - remove "Audible Audiobook" suffix
        title = title.replace(/\s*Audible\s+Audiobook\s*[–-]\s*(Unabridged|Abridged)\s*/i, '').trim();

        // Author and Narrator from byline area
        let author = '', narrator = '';
        const bylineLinks = document.querySelectorAll('.authorNameColumn a, #bylineInfo a, [class*="byline"] a');
        for (const link of bylineLinks) {
            const parentText = link.parentElement?.textContent || '';
            if (parentText.includes('(Author)')) {
                author = link.textContent.trim();
            } else if (parentText.includes('(Narrator)')) {
                narrator = link.textContent.trim();
            }
        }

        // Product details table
        const duration = getProductDetail('Listening Length') || '';
        const releaseDate = getProductDetail('Release Date') || '';
        const publisher = getProductDetail('Publisher') || '';
        const language = getProductDetail('Language') || 'English';
        const asin = getProductDetail('ASIN') || window.location.pathname.match(/\/dp\/([A-Z0-9]+)/)?.[1] || '';

        // Parse release date
        let year = '', month = '', day = '';
        const dateMatch = releaseDate.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (dateMatch) {
            const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
                             july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
            year = dateMatch[3];
            month = String(months[dateMatch[1].toLowerCase()] || '');
            day = dateMatch[2];
        }

        return {
            title, author, narrator, publisher, asin,
            durationMs: durationToMs(duration),
            year, month, day,
            language: LANGUAGE_MAP[language.toLowerCase()] || 'eng',
            url: window.location.href.replace(/[?#].*/, ''),
        };
    }
```

- [ ] **Step 3: Test in browser**

On the example audiobook page, add `console.log(parsePageData())` temporarily after the function and verify output:
```
{
  title: "I Regret Almost Everything",
  author: "Keith McNally",
  narrator: "Richard E. Grant",
  publisher: "Simon & Schuster Audio",
  asin: "B0DJRN88XX",
  durationMs: 39780000,
  year: "2025", month: "5", day: "06",
  language: "eng",
  url: "https://www.amazon.com/Audible-Studios-on-Brilliance-Everything/dp/B0DJRN88XX"
}
```

- [ ] **Step 4: Commit**

```bash
git add userscripts/amazon-audiobook-importer.user.js
git commit -m "feat: implement DOM scraping for audiobook metadata"
```

---

### Task 3: Build MusicBrainz form parameters and inject button

**Files:**
- Modify: `userscripts/amazon-audiobook-importer.user.js`

- [ ] **Step 1: Add form parameter builder**

After `parsePageData()`, add:

```javascript
    function buildFormParams(data) {
        const params = [
            ['name', data.title],
            ['type', 'other'],
            ['status', 'official'],
            ['packaging', 'none'],
            ['language', data.language],
            ['script', 'Latn'],
            ['date.year', data.year],
            ['date.month', data.month],
            ['date.day', data.day],
            ['labels.0.name', data.publisher],
            ['mediums.0.format', 'Digital Media'],
            ['mediums.0.track.0.name', data.title],
            ['mediums.0.track.0.length', String(data.durationMs)],
            ['urls.0.url', data.url],
            ['urls.0.link_type', '79'],
            ['edit_note', 'Imported from ' + data.url],
        ];

        // Artist credit: "author read by narrator"
        params.push(['artist_credit.names.0.artist.name', data.author]);
        if (data.narrator && data.narrator !== data.author) {
            params.push(['artist_credit.names.0.join_phrase', ' read by ']);
            params.push(['artist_credit.names.1.artist.name', data.narrator]);
        }

        return params;
    }
```

- [ ] **Step 2: Add button injection**

```javascript
    function injectButton(params) {
        const form = document.createElement('form');
        form.method = 'post';
        form.action = 'https://musicbrainz.org/release/add';
        form.target = '_blank';
        form.acceptCharset = 'UTF-8';

        for (const [name, value] of params) {
            if (value === undefined || value === '') continue;
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        }

        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = 'Import into MusicBrainz';
        button.style.cssText = 'background: #eb743b; color: white; border: none; padding: 8px 16px; font-size: 14px; cursor: pointer; border-radius: 4px; margin: 8px 0;';
        form.appendChild(button);

        // Insert near the title
        const target = document.getElementById('title_feature_div') ||
                        document.getElementById('titleSection') ||
                        document.querySelector('#centerCol');
        if (target) {
            target.appendChild(form);
        }
    }
```

- [ ] **Step 3: Wire it all together**

At the end of the IIFE (replacing any temporary console.log):

```javascript
    const data = parsePageData();
    if (!data.title) return;
    const params = buildFormParams(data);
    injectButton(params);
```

- [ ] **Step 4: Test end-to-end in browser**

On the example page:
1. Verify "Import into MusicBrainz" button appears below the title
2. Click it — a new tab should open to musicbrainz.org/release/add with pre-filled fields:
   - Title: "I Regret Almost Everything"
   - Artist: "Keith McNally read by Richard E. Grant"
   - Type: Other
   - Format: Digital Media
   - Label: Simon & Schuster Audio
   - Date: 2025-05-06
3. Verify on a non-audiobook Amazon page that no button appears

- [ ] **Step 5: Commit**

```bash
git add userscripts/amazon-audiobook-importer.user.js
git commit -m "feat: add MusicBrainz form builder and import button injection"
```

---

### Task 4: Add secondary type (Audiobook) to the form

**Files:**
- Modify: `userscripts/amazon-audiobook-importer.user.js`

MusicBrainz's "Add Release" form uses specific parameter names for secondary types. The secondary type "Audiobook" needs to be included.

- [ ] **Step 1: Add secondary type param**

In `buildFormParams`, add after the `['type', 'other']` line:

```javascript
            ['secondary_types', 'Audiobook'],
```

- [ ] **Step 2: Test in browser**

Click "Import into MusicBrainz" and verify the release type shows "Other + Audiobook" in the pre-filled form.

- [ ] **Step 3: Commit**

```bash
git add userscripts/amazon-audiobook-importer.user.js
git commit -m "feat: add Audiobook secondary type to import"
```
