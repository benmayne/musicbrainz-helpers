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

    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------

    const MB_ADD_RELEASE_URL = 'https://musicbrainz.org/release/add';

    const LANGUAGE_MAP = {
        english: 'eng',
        spanish: 'spa',
        french: 'fra',
        german: 'deu',
        italian: 'ita',
        portuguese: 'por',
        japanese: 'jpn',
        chinese: 'zho',
        korean: 'kor',
        russian: 'rus',
        dutch: 'nld',
        swedish: 'swe',
        norwegian: 'nor',
        danish: 'dan',
        finnish: 'fin',
        polish: 'pol',
        turkish: 'tur',
        arabic: 'ara',
        hindi: 'hin',
        hebrew: 'heb',
    };

    // ---------------------------------------------------------------------------
    // Helper: parse duration string to milliseconds
    // ---------------------------------------------------------------------------

    /**
     * Parse strings like "X hours and Y minutes", "X hours", "Y minutes" into ms.
     * @param {string} str
     * @returns {number|null}
     */
    function durationToMs(str) {
        if (!str) return null;
        let hours = 0;
        let minutes = 0;

        const hourMatch = str.match(/(\d+)\s*hour/i);
        const minuteMatch = str.match(/(\d+)\s*minute/i);

        if (hourMatch) hours = parseInt(hourMatch[1], 10);
        if (minuteMatch) minutes = parseInt(minuteMatch[1], 10);

        if (!hourMatch && !minuteMatch) return null;

        return (hours * 60 + minutes) * 60 * 1000;
    }

    // ---------------------------------------------------------------------------
    // Helper: get product detail value by label
    // ---------------------------------------------------------------------------

    /**
     * Search product details table rows for a matching header label and return
     * the corresponding cell value.
     * @param {string} label
     * @returns {string|null}
     */
    function getProductDetail(label) {
        const rows = document.querySelectorAll(
            '#productDetails_techSpec_section_1 tr, #audibleProductDetails tr, [class*="productDetails"] tr'
        );

        for (const row of rows) {
            const header = row.querySelector('th, td:first-child');
            if (!header) continue;
            if (header.textContent.trim().toLowerCase().includes(label.toLowerCase())) {
                const valueCell = row.querySelector('td:last-child');
                if (valueCell) {
                    return valueCell.textContent.trim();
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------------
    // Main scraper
    // ---------------------------------------------------------------------------

    /**
     * Parse all relevant metadata from the current Amazon page.
     * @returns {object}
     */
    function parsePageData() {
        const data = {};

        // --- Title ---
        const titleEl =
            document.querySelector('#productTitle') ||
            document.querySelector('#title span:first-child');

        if (titleEl) {
            let title = titleEl.textContent.trim();
            // Strip "Audible Audiobook – Unabridged" / "Audible Audiobook – Abridged" suffix
            title = title.replace(/\s*[–\-]\s*(Unabridged|Abridged)\s*$/i, '').trim();
            // Strip trailing "Audible Audiobook" itself if still present
            title = title.replace(/\s*[:–\-]?\s*Audible Audiobook\s*$/i, '').trim();
            data.title = title || null;
        }

        // --- Author & Narrator ---
        // Look through all byline links and check the parent element text for role hints
        const bylineLinks = document.querySelectorAll(
            '.authorNameColumn a, #bylineInfo a, [class*="byline"] a'
        );

        for (const link of bylineLinks) {
            const name = link.textContent.trim();
            if (!name) continue;

            // Walk up to find the containing element that mentions the role
            let container = link.parentElement;
            while (container && container !== document.body) {
                const text = container.textContent;
                if (text.includes('(Author)') || text.includes('- Author')) {
                    if (!data.author) data.author = name;
                    break;
                }
                if (text.includes('(Narrator)') || text.includes('- Narrator')) {
                    if (!data.narrator) data.narrator = name;
                    break;
                }
                container = container.parentElement;
            }

            // Stop once we have both
            if (data.author && data.narrator) break;
        }

        // --- Product details (duration, release date, publisher, language, ASIN) ---
        const durationRaw = getProductDetail('Listening Length') || getProductDetail('Duration');
        data.durationMs = durationToMs(durationRaw);

        const releaseDateRaw = getProductDetail('Release date') || getProductDetail('Publication Date');
        if (releaseDateRaw) {
            // Expected format: "Month DD, YYYY" e.g. "January 01, 2023"
            const dateMatch = releaseDateRaw.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
            if (dateMatch) {
                const monthNames = [
                    'january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'
                ];
                const monthIndex = monthNames.indexOf(dateMatch[1].toLowerCase());
                data.year = dateMatch[3];
                data.month = monthIndex !== -1 ? String(monthIndex + 1).padStart(2, '0') : null;
                data.day = dateMatch[2].padStart(2, '0');
            }
        }

        data.publisher = getProductDetail('Publisher') || null;

        const languageRaw = getProductDetail('Language');
        if (languageRaw) {
            const langKey = languageRaw.trim().toLowerCase();
            data.language = LANGUAGE_MAP[langKey] || null;
        }

        // ASIN from product details table
        data.asin = getProductDetail('ASIN') || null;

        // ASIN fallback: extract from URL path
        if (!data.asin) {
            const asinMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]+)/i);
            if (asinMatch) data.asin = asinMatch[1].toUpperCase();
        }

        // --- Clean URL (strip query params and hash) ---
        data.url = window.location.origin + window.location.pathname;

        return data;
    }

    // ---------------------------------------------------------------------------
    // Form parameter builder
    // ---------------------------------------------------------------------------

    /**
     * Build an array of [name, value] pairs for the MusicBrainz "Add Release" form.
     * @param {object} data  Output of parsePageData()
     * @returns {Array<[string, string]>}
     */
    function buildFormParams(data) {
        const params = [];

        const add = (name, value) => {
            if (value !== null && value !== undefined && value !== '') {
                params.push([name, String(value)]);
            }
        };

        add('name', data.title);
        add('type', 'other');
        add('secondary_types', 'Audiobook');
        add('status', 'official');
        add('packaging', 'none');
        add('language', data.language);
        add('script', 'Latn');

        add('date.year', data.year);
        add('date.month', data.month);
        add('date.day', data.day);

        add('labels.0.name', data.publisher);

        add('mediums.0.format', 'Digital Media');
        add('mediums.0.track.0.name', data.title);
        if (data.durationMs !== null && data.durationMs !== undefined) {
            add('mediums.0.track.0.length', data.durationMs);
        }

        add('urls.0.url', data.url);
        add('urls.0.link_type', '79'); // purchase for mail-order

        add('edit_note', `Imported from ${data.url}`);

        // Artist credits
        if (data.author) {
            add('artist_credit.names.0.artist.name', data.author);

            if (data.narrator && data.narrator !== data.author) {
                add('artist_credit.names.0.join_phrase', ' read by ');
                add('artist_credit.names.1.artist.name', data.narrator);
            }
        }

        return params;
    }

    // ---------------------------------------------------------------------------
    // Button injection
    // ---------------------------------------------------------------------------

    /**
     * Create and inject a form that submits to MusicBrainz "Add Release".
     * @param {Array<[string, string]>} params
     */
    function injectButton(params) {
        const form = document.createElement('form');
        form.method = 'post';
        form.action = MB_ADD_RELEASE_URL;
        form.target = '_blank';
        form.style.cssText = 'display:inline-block; margin-top:8px;';

        for (const [name, value] of params) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        }

        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = 'Import into MusicBrainz';
        button.style.cssText = [
            'background: #eb743b',
            'color: #fff',
            'border: none',
            'border-radius: 4px',
            'padding: 8px 14px',
            'font-size: 14px',
            'font-weight: bold',
            'cursor: pointer',
            'letter-spacing: 0.3px',
        ].join(';');

        button.addEventListener('mouseover', () => {
            button.style.background = '#c45f2e';
        });
        button.addEventListener('mouseout', () => {
            button.style.background = '#eb743b';
        });

        form.appendChild(button);

        // Insert near the title area
        const anchor =
            document.querySelector('#title_feature_div') ||
            document.querySelector('#titleSection') ||
            document.querySelector('#productTitle');

        if (anchor) {
            anchor.appendChild(form);
        } else {
            // Fallback: insert after body's first child
            document.body.insertBefore(form, document.body.firstChild);
        }
    }

    // ---------------------------------------------------------------------------
    // Audiobook detection
    // ---------------------------------------------------------------------------

    /**
     * Returns true if the page appears to be an Audible Audiobook product.
     */
    function isAudiobook() {
        const titleSection =
            document.querySelector('#title_feature_div') ||
            document.querySelector('#titleSection');

        if (!titleSection) return false;
        return /audible audiobook/i.test(titleSection.textContent);
    }

    // ---------------------------------------------------------------------------
    // Main
    // ---------------------------------------------------------------------------

    if (!isAudiobook()) return;

    const data = parsePageData();
    if (!data.title) return;

    const params = buildFormParams(data);
    injectButton(params);
})();
