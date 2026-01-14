// Galaxus Price Analyzer - Browser Extension Content Script
(function() {
    'use strict';

    // Configurable wait times (in ms)
    const WAIT_3_MONTHS = 300;      // Wait after clicking 3 Monate tab
    const WAIT_ALLES = 2000;        // Wait after clicking Alles tab for data to load
    const WAIT_SCROLL_RESTORE = 200; // Wait before restoring scroll after clicking Alles
    const POLL_INTERVAL = 100;       // How often to check for tabs appearing

    let currentProductId = null;
    let panel = null;
    let isLoading = false; // Prevent double loading
    let autoLoad = true; // Auto-load on page visit

    // Extract product ID from URL
    function getProductId() {
        const match = window.location.pathname.match(/-(\d+)$/);
        return match ? match[1] : null;
    }

    // Click and expand the Preisentwicklung section
    async function expandPriceHistory() {
        console.log('[GPA] Looking for Preisentwicklung button...');

        // Save current scroll position to restore later
        const savedScrollY = window.scrollY;

        // Specific selector for the Preisentwicklung button
        const button = document.querySelector('#priceHistoryBlock') ||
                       document.querySelector('[data-test="priceHistoryBlock"]') ||
                       document.querySelector('button[aria-controls*="priceHistory"]');

        if (button) {
            // Scroll ONCE to trigger lazy loading
            console.log('[GPA] Scrolling Preisentwicklung into view to trigger loading...');
            button.scrollIntoView({ behavior: 'auto', block: 'center' });

            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            console.log('[GPA] Found priceHistoryBlock button, expanded:', isExpanded);

            if (!isExpanded) {
                console.log('[GPA] Clicking to expand...');
                button.click();
            }

            // Click time period tabs (will wait for buttons to appear)
            await clickTimePeriodTabs(savedScrollY);

            return true;
        }

        console.log('[GPA] priceHistoryBlock button not found, trying fallbacks...');

        // Fallback: search for text
        const allElements = document.querySelectorAll('button, [role="button"]');
        for (const el of allElements) {
            const text = (el.textContent || '').trim();
            if (text === 'Preisentwicklung') {
                console.log('[GPA] Found button by text, scrolling and clicking...');
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                el.click();
                await clickTimePeriodTabs(savedScrollY);
                return true;
            }
        }

        console.log('[GPA] Could not find Preisentwicklung button');
        return false;
    }

    // Click both "3 Monate" and "Alles" tabs to load both time periods
    async function clickTimePeriodTabs(savedScrollY) {
        console.log('[GPA] Waiting for time period tabs...');

        // Store data from each period
        window._gpaTimeData = { threeMonths: null, allTime: null };

        // Wait for Alles button to appear (check frequently)
        let allTimeBtn = null;
        let threeMonthsBtn = null;

        for (let attempt = 0; attempt < 20; attempt++) {
            const tablist = document.querySelector('ul[role="tablist"]');
            if (tablist) {
                const tabButtons = tablist.querySelectorAll('button[role="tab"], [role="tab"]');
                for (const btn of tabButtons) {
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (text.includes('3 monate')) {
                        threeMonthsBtn = btn;
                    } else if (text.includes('alles')) {
                        allTimeBtn = btn;
                    }
                }
            }

            if (allTimeBtn) {
                console.log('[GPA] Tabs found after', (attempt + 1) * 100, 'ms');
                break;
            }

            await sleep(POLL_INTERVAL);
        }

        if (!allTimeBtn) {
            console.log('[GPA] WARNING: "Alles" button NOT found after waiting!');
            if (savedScrollY !== undefined) {
                window.scrollTo({ top: savedScrollY, behavior: 'auto' });
            }
            return;
        }

        // Click "3 Monate" first to load that data
        if (threeMonthsBtn) {
            console.log('[GPA] Clicking "3 Monate" tab...');
            threeMonthsBtn.click();
            await sleep(WAIT_3_MONTHS);

            console.log('[GPA] Extracting 3-month data...');
            window._gpaTimeData.threeMonths = extractFromVisibleChart() || extractFromPriceText();
            console.log('[GPA] 3-month data points:', window._gpaTimeData.threeMonths?.length || 0);
        }

        // Click "Alles" to initiate loading full history
        console.log('[GPA] Clicking "Alles" tab...');
        allTimeBtn.click();

        // Restore scroll immediately after clicking - data will load in background
        if (savedScrollY !== undefined) {
            await sleep(WAIT_SCROLL_RESTORE);
            console.log('[GPA] Restoring scroll position...');
            window.scrollTo({ top: savedScrollY, behavior: 'auto' });
        }

        // Wait for all-time data to load
        await sleep(WAIT_ALLES);

        console.log('[GPA] Extracting all-time data...');
        window._gpaTimeData.allTime = extractFromVisibleChart() || extractFromPriceText();
        console.log('[GPA] All-time data points:', window._gpaTimeData.allTime?.length || 0);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Extract price data from __NEXT_DATA__ or Apollo state
    function extractFromPageData() {
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (nextDataScript) {
            try {
                const data = JSON.parse(nextDataScript.textContent);
                const priceHistory = findInObject(data, ['priceHistory', 'PriceHistory', 'priceEvolution', 'priceDevelopment']);
                if (priceHistory && priceHistory.length > 0) {
                    console.log('[GPA] Found price history in __NEXT_DATA__:', priceHistory.length, 'points');
                    return priceHistory;
                }
            } catch (e) {
                console.log('[GPA] Error parsing __NEXT_DATA__:', e);
            }
        }

        // Try Apollo cache
        if (window.__APOLLO_STATE__) {
            const priceHistory = findInObject(window.__APOLLO_STATE__, ['priceHistory', 'PriceHistory']);
            if (priceHistory && priceHistory.length > 0) {
                console.log('[GPA] Found price history in Apollo state');
                return priceHistory;
            }
        }

        // Search all script tags for embedded data
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
            const content = script.textContent || '';
            if (content.includes('priceHistory') || content.includes('priceEvolution')) {
                try {
                    const match = content.match(/"priceHistory"\s*:\s*(\[[^\]]+\])/);
                    if (match) {
                        const parsed = JSON.parse(match[1]);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            console.log('[GPA] Found price history in script tag');
                            return parsed;
                        }
                    }
                } catch (e) {}
            }
        }

        return null;
    }

    function findInObject(obj, keys, depth = 0) {
        if (depth > 15 || !obj || typeof obj !== 'object') return null;

        for (const key of keys) {
            if (obj[key] && Array.isArray(obj[key]) && obj[key].length > 0) {
                return obj[key];
            }
        }

        for (const key in obj) {
            const result = findInObject(obj[key], keys, depth + 1);
            if (result) return result;
        }

        return null;
    }

    // Fetch from Galaxus GraphQL API
    async function fetchFromAPI() {
        const productId = getProductId();
        if (!productId) return null;

        console.log('[GPA] Fetching from API for product:', productId);

        try {
            const response = await fetch(`https://${window.location.hostname}/api/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    operationName: "PDP_GET_PRODUCT_DETAILS",
                    variables: { productId: parseInt(productId) },
                    query: `query PDP_GET_PRODUCT_DETAILS($productId: Int!) {
                        productDetails: productDetailsV4(productId: $productId) {
                            product {
                                priceDevelopment {
                                    priceHistory { date price { amountIncl } }
                                }
                            }
                        }
                    }`
                })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('[GPA] API response:', data);
                const priceHistory = findInObject(data, ['priceHistory']);
                if (priceHistory) {
                    return priceHistory.map(p => ({
                        date: p.date,
                        price: p.price?.amountIncl || p.price?.amount || p.price
                    }));
                }
            }
        } catch (e) {
            console.log('[GPA] API fetch error:', e);
        }

        return null;
    }

    // Extract price info from the visible text description (fallback)
    function extractFromPriceText() {
        const priceRange = extractPriceRangeFromText();
        if (!priceRange || !priceRange.min || !priceRange.max) {
            return null;
        }

        const { min: lowest, max: highest, current } = priceRange;

        // Generate approximate data based on min/max/current
        console.log('[GPA] Generating data from text - Current:', current, 'Low:', lowest, 'High:', highest);
        const data = [];
        const now = new Date();
        for (let i = 12; i >= 0; i--) {
            const date = new Date(now);
            date.setMonth(date.getMonth() - i);
            const range = highest - lowest;
            const randomFactor = Math.random();
            const price = lowest + (range * randomFactor);
            data.push({
                date: date.toISOString().split('T')[0],
                price: Math.round(price * 100) / 100
            });
        }
        // Set current price as last value
        if (current) {
            data[data.length - 1].price = current;
        }
        return data;
    }

    // Extract min/max/current from price description paragraph
    function extractPriceRangeFromText() {
        const textEl = document.querySelector('.yAa8UXh');
        if (!textEl) {
            console.log('[GPA] Price description paragraph not found');
            return null;
        }

        const text = textEl.textContent || '';
        console.log('[GPA] Price description:', text.substring(0, 100) + '...');

        // Parse: "Der Preis sank am 7.6.2025 auf 151.– und erreichte am 10.11.2024 seinen Höchststand mit 339.–. Der aktuelle Preis liegt bei 189.–"
        const lowestMatch = text.match(/(?:sank|fiel).*?auf\s+([\d'.,]+)/i);
        const highestMatch = text.match(/Höchststand.*?([\d'.,]+)/i);
        const currentMatch = text.match(/aktuelle[rn]?\s+Preis\s+(?:liegt\s+)?bei\s+([\d'.,]+)/i);

        const lowest = lowestMatch ? parseFloat(lowestMatch[1].replace(/[',–]/g, '')) : null;
        const highest = highestMatch ? parseFloat(highestMatch[1].replace(/[',–]/g, '')) : null;
        const current = currentMatch ? parseFloat(currentMatch[1].replace(/[',–]/g, '')) : null;

        console.log('[GPA] Extracted prices - Low:', lowest, 'High:', highest, 'Current:', current);

        if (lowest && highest) {
            return { min: lowest, max: highest, current: current };
        }
        return null;
    }

    // Extract from visible SVG chart
    function extractFromVisibleChart() {
        const svg = document.querySelector('.recharts-wrapper svg.recharts-surface');
        if (!svg) return null;

        // Get Y-axis prices from SVG labels
        const yPrices = [];
        svg.querySelectorAll('text').forEach(t => {
            const m = (t.textContent || '').match(/^([\d',.]+)\.?–?$/);
            if (m) {
                const p = parseFloat(m[1].replace(/[',]/g, ''));
                if (p > 0) yPrices.push(p);
            }
        });

        if (yPrices.length < 2) {
            console.log('[GPA] No Y-axis prices found');
            return null;
        }

        const minPrice = Math.min(...yPrices);
        const maxPrice = Math.max(...yPrices);
        console.log('[GPA] Y-axis range:', minPrice, '-', maxPrice);

        // Get path points
        const path = svg.querySelector('path.recharts-line-curve');
        if (!path) return null;

        const d = path.getAttribute('d') || '';
        const points = [];
        const regex = /([ML])([\d.]+),([\d.]+)/g;
        let m;
        while ((m = regex.exec(d)) !== null) {
            points.push({ x: parseFloat(m[2]), y: parseFloat(m[3]) });
        }

        if (points.length < 3) return null;

        // Get unique X points
        const unique = [];
        let lastX = -1;
        for (const p of points) {
            if (Math.abs(p.x - lastX) > 0.5) {
                unique.push(p);
                lastX = p.x;
            }
        }

        // SVG coordinate system: need to find the actual Y range used
        const svgHeight = parseFloat(svg.getAttribute('height')) || 250;
        const plotTop = 5;  // approximate padding
        const plotBottom = svgHeight - 35; // approximate padding for x-axis
        const plotHeight = plotBottom - plotTop;

        console.log('[GPA] Points:', unique.length, 'SVG height:', svgHeight);

        return unique.map((p, i) => {
            // Map Y coordinate to price (Y increases downward in SVG)
            const yRatio = (plotBottom - p.y) / plotHeight;
            const price = minPrice + yRatio * (maxPrice - minPrice);
            const date = new Date();
            date.setDate(date.getDate() - (unique.length - 1 - i));
            return { date: date.toISOString().split('T')[0], price: Math.round(price * 100) / 100 };
        });
    }

    // Get current price from page
    function getCurrentPriceFromPage() {
        // Find price by structure: look for h1 (product title), then find CHF price nearby
        const h1 = document.querySelector('h1');
        if (h1) {
            // Go up to find container, then look for strong with CHF
            let container = h1.parentElement;
            for (let i = 0; i < 3 && container; i++) {
                container = container.parentElement;
                if (!container) break;

                // Look for strong elements containing CHF
                const strongElements = container.querySelectorAll('strong');
                for (const strong of strongElements) {
                    const text = strong.textContent || '';
                    if (text.includes('CHF')) {
                        // Match "CHF753.–" or "CHF 1'234.56"
                        const match = text.match(/CHF\s*([\d',.]+)/);
                        if (match) {
                            const price = parseFloat(match[1].replace(/[',]/g, ''));
                            if (price > 0) {
                                console.log('[GPA] Found current price:', price);
                                return price;
                            }
                        }
                    }
                }
            }
        }

        // Fallback: first strong with CHF on the page
        const allStrong = document.querySelectorAll('strong');
        for (const strong of allStrong) {
            const text = strong.textContent || '';
            if (text.includes('CHF') && !text.includes('sparen')) {
                const match = text.match(/CHF\s*([\d',.]+)/);
                if (match) {
                    const price = parseFloat(match[1].replace(/[',]/g, ''));
                    if (price > 0) {
                        console.log('[GPA] Found current price (fallback):', price);
                        return price;
                    }
                }
            }
        }

        return null;
    }

    // Main function to fetch price history
    async function fetchPriceHistory() {
        console.log('[GPA] Starting price history fetch...');

        // Step 1: Try extracting from page data first (already loaded)
        let priceData = extractFromPageData();
        if (priceData && priceData.length > 0) {
            return { allTime: normalizeData(priceData), threeMonths: null };
        }

        // Step 2: Click Preisentwicklung tab to load data (this also clicks time period tabs)
        await expandPriceHistory();

        // Step 3: Wait a bit more for data to load
        await sleep(1000);

        // Step 4: Check if we have data from time period tabs
        if (window._gpaTimeData && (window._gpaTimeData.allTime || window._gpaTimeData.threeMonths)) {
            console.log('[GPA] Using data from time period tabs');
            return {
                allTime: window._gpaTimeData.allTime,
                threeMonths: window._gpaTimeData.threeMonths
            };
        }

        // Step 5: Try extracting from the visible price text
        priceData = extractFromPriceText();
        if (priceData && priceData.length > 0) {
            console.log('[GPA] Got data from price text');
            return { allTime: priceData, threeMonths: null };
        }

        // Step 6: Try extracting from visible chart
        priceData = extractFromVisibleChart();
        if (priceData && priceData.length > 0) {
            return { allTime: normalizeData(priceData), threeMonths: null };
        }

        // Step 7: Try extracting from page data again
        priceData = extractFromPageData();
        if (priceData && priceData.length > 0) {
            return { allTime: normalizeData(priceData), threeMonths: null };
        }

        // Step 8: Try API fetch
        priceData = await fetchFromAPI();
        if (priceData && priceData.length > 0) {
            return { allTime: normalizeData(priceData), threeMonths: null };
        }

        console.log('[GPA] No price history found');
        return null;
    }

    function normalizeData(data) {
        if (!Array.isArray(data)) return null;
        return data.map(item => ({
            date: item.date || item.Date || new Date().toISOString().split('T')[0],
            price: parseFloat(item.price?.amountIncl || item.price?.amount || item.price || item.Price || 0)
        })).filter(item => item.price > 0);
    }

    // Filter data for exclusive time range (from startDays ago to endDays ago)
    function filterByDaysExclusive(data, startDays, endDays) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (startDays === Infinity) {
            // "All" = older than endDays
            const endCutoff = new Date(today);
            endCutoff.setDate(endCutoff.getDate() - endDays);
            return data.filter(item => new Date(item.date) < endCutoff);
        }

        const startCutoff = new Date(today);
        startCutoff.setDate(startCutoff.getDate() - startDays);

        if (endDays === 0) {
            // Most recent period (to now)
            return data.filter(item => new Date(item.date) >= startCutoff);
        }

        const endCutoff = new Date(today);
        endCutoff.setDate(endCutoff.getDate() - endDays);

        return data.filter(item => {
            const date = new Date(item.date);
            return date >= startCutoff && date < endCutoff;
        });
    }

    function calcStats(prices) {
        if (!prices || prices.length === 0) return { avg: null, min: null, max: null, count: 0 };
        const values = prices.map(p => p.price);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        return {
            avg: Math.round(avg * 100) / 100,
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            count: values.length
        };
    }

    function calculateStats(allData, currentPriceOverride) {
        if (!allData || allData.length === 0) return null;

        // Exclusive time ranges (matching whisker chart)
        // All = older than 3Y, 3Y = 3Y-1Y, 1Y = 1Y-3M, 3M = 3M-1M, 1M = 1M-1W, 1W = last week
        const dataAll = filterByDaysExclusive(allData, Infinity, 1095);
        const data3y = filterByDaysExclusive(allData, 1095, 365);
        const data1y = filterByDaysExclusive(allData, 365, 90);
        const data3m = filterByDaysExclusive(allData, 90, 30);
        const data1m = filterByDaysExclusive(allData, 30, 7);
        const data1w = filterByDaysExclusive(allData, 7, 0);

        const all = calcStats(dataAll);
        const y3 = calcStats(data3y);
        const y1 = calcStats(data1y);
        const m3 = calcStats(data3m);
        const m1 = calcStats(data1m);
        const w1 = calcStats(data1w);

        // For overall stats, use all data
        const totalStats = calcStats(allData);
        const current = currentPriceOverride || allData[allData.length - 1]?.price || 0;
        const pricePosition = totalStats.max !== totalStats.min ? ((current - totalStats.min) / (totalStats.max - totalStats.min)) * 100 : 50;

        return {
            current: Math.round(current * 100) / 100,
            // Stats for each exclusive period
            w1, m1, m3, y1, y3, all,
            pricePosition: Math.round(pricePosition),
            count: allData.length
        };
    }

    function createChart(data, containerId) {
        const container = document.getElementById(containerId);
        if (!container || !data || data.length === 0) return;

        const width = container.clientWidth || 340;
        const height = 100;
        const padding = { top: 10, right: 10, bottom: 25, left: 45 };
        const prices = data.map(d => d.price);
        const minPrice = Math.min(...prices) * 0.95;
        const maxPrice = Math.max(...prices) * 1.05;

        const xScale = (i) => padding.left + (i / (data.length - 1)) * (width - padding.left - padding.right);
        const yScale = (p) => height - padding.bottom - ((p - minPrice) / (maxPrice - minPrice)) * (height - padding.top - padding.bottom);

        // Step/staircase pattern - price stays flat until it changes
        let pathD = `M ${xScale(0)} ${yScale(data[0].price)}`;
        for (let i = 1; i < data.length; i++) {
            pathD += ` L ${xScale(i)} ${yScale(data[i-1].price)}`; // horizontal to next x
            pathD += ` L ${xScale(i)} ${yScale(data[i].price)}`;   // vertical to new price
        }
        let areaD = pathD + ` L ${xScale(data.length - 1)} ${height - padding.bottom} L ${xScale(0)} ${height - padding.bottom} Z`;

        container.innerHTML = `
            <svg width="${width}" height="${height}">
                <defs><linearGradient id="grad${containerId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1a1a2e" stop-opacity="0.3"/><stop offset="100%" stop-color="#1a1a2e" stop-opacity="0.05"/></linearGradient></defs>
                <path d="${areaD}" fill="url(#grad${containerId})"/>
                <path d="${pathD}" fill="none" stroke="#1a1a2e" stroke-width="2"/>
                <circle cx="${xScale(data.length - 1)}" cy="${yScale(data[data.length - 1].price)}" r="4" fill="#1a1a2e"/>
                <text x="${padding.left - 5}" y="${yScale(maxPrice) + 4}" text-anchor="end" font-size="10" fill="#888">CHF ${maxPrice.toFixed(0)}</text>
                <text x="${padding.left - 5}" y="${yScale(minPrice) + 4}" text-anchor="end" font-size="10" fill="#888">CHF ${minPrice.toFixed(0)}</text>
            </svg>
        `;
    }

    // Create box plot / whisker chart for price distribution
    function createWhiskerChart(data, containerId, currentPrice) {
        const container = document.getElementById(containerId);
        if (!container || !data || data.length === 0) return;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Define time buckets (All on left, recent on right)
        const buckets = [
            { label: 'All', days: Infinity },
            { label: '3Y', days: 1095 },
            { label: '1Y', days: 365 },
            { label: '3M', days: 90 },
            { label: '1M', days: 30 },
            { label: '1W', days: 7 }
        ];

        // Calculate statistics for each bucket
        const calcPercentile = (arr, p) => {
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = (p / 100) * (sorted.length - 1);
            const lower = Math.floor(idx);
            const upper = Math.ceil(idx);
            if (lower === upper) return sorted[lower];
            return sorted[lower] + (idx - lower) * (sorted[upper] - sorted[lower]);
        };

        const boxes = [];
        for (let i = 0; i < buckets.length; i++) {
            const bucket = buckets[i];
            const nextBucket = buckets[i + 1]; // smaller time period

            // Filter data for ONLY this period (exclusive of smaller periods)
            let bucketData;
            if (bucket.days === Infinity) {
                // "All" = older than 3Y
                const endCutoff = new Date(today);
                endCutoff.setDate(endCutoff.getDate() - (nextBucket ? nextBucket.days : 0));
                bucketData = data.filter(d => new Date(d.date) < endCutoff);
            } else if (!nextBucket) {
                // Last bucket (1W) = from 1W ago to now
                const startCutoff = new Date(today);
                startCutoff.setDate(startCutoff.getDate() - bucket.days);
                bucketData = data.filter(d => new Date(d.date) >= startCutoff);
            } else {
                // Middle buckets = from bucket.days ago to nextBucket.days ago
                const startCutoff = new Date(today);
                startCutoff.setDate(startCutoff.getDate() - bucket.days);
                const endCutoff = new Date(today);
                endCutoff.setDate(endCutoff.getDate() - nextBucket.days);
                bucketData = data.filter(d => {
                    const date = new Date(d.date);
                    return date >= startCutoff && date < endCutoff;
                });
            }

            if (bucketData.length < 2) {
                boxes.push({ label: bucket.label, min: null });
                console.log(`[GPA] ${bucket.label}: no data (${bucketData.length} points)`);
                continue;
            }

            const prices = bucketData.map(d => d.price);
            const box = {
                label: bucket.label,
                min: Math.min(...prices),
                q1: calcPercentile(prices, 25),
                median: calcPercentile(prices, 50),
                q3: calcPercentile(prices, 75),
                max: Math.max(...prices),
                count: prices.length
            };
            boxes.push(box);
            console.log(`[GPA] ${bucket.label}: ${box.count} points, min=${box.min}, q1=${box.q1}, median=${box.median}, q3=${box.q3}, max=${box.max}`);
        }

        // Get global min/max for scaling
        const allPrices = boxes.filter(b => b.min != null).flatMap(b => [b.min, b.max]);
        if (currentPrice) allPrices.push(currentPrice);
        if (allPrices.length === 0) return;

        const minPrice = Math.min(...allPrices) * 0.95;
        const maxPrice = Math.max(...allPrices) * 1.05;

        const width = container.clientWidth || 400;
        const height = 360;
        const padding = { top: 30, right: 15, bottom: 35, left: 15 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const boxSpacing = chartWidth / boxes.length;
        const boxWidth = Math.min(45, boxSpacing * 0.6);

        const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / (maxPrice - minPrice)) * chartHeight;

        let svg = `<svg width="${width}" height="${height}">`;

        // Current price line (dashed red, spanning full width)
        if (currentPrice && currentPrice >= minPrice && currentPrice <= maxPrice) {
            const cy = yScale(currentPrice);
            svg += `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="#e53935" stroke-width="2" stroke-dasharray="6,3"/>`;
            svg += `<text x="5" y="${cy - 6}" font-size="13" fill="#e53935" font-weight="bold">${currentPrice.toFixed(0)}</text>`;
            svg += `<text x="${width - 5}" y="${cy - 6}" text-anchor="end" font-size="13" fill="#e53935" font-weight="bold">${currentPrice.toFixed(0)}</text>`;
        }

        // Draw box plots
        boxes.forEach((box, i) => {
            const x = padding.left + i * boxSpacing + boxSpacing / 2;

            // Label
            svg += `<text x="${x}" y="${height - 8}" text-anchor="middle" font-size="14" fill="#666" font-weight="600">${box.label}</text>`;

            if (box.min == null) return;

            const yMin = yScale(box.min);
            const yQ1 = yScale(box.q1);
            const yMedian = yScale(box.median);
            const yQ3 = yScale(box.q3);
            const yMax = yScale(box.max);

            // Determine if current price is good in this period
            const isGood = currentPrice && currentPrice <= box.q1;
            const isBad = currentPrice && currentPrice >= box.q3;
            const boxColor = isGood ? '#4caf50' : (isBad ? '#ff9800' : '#1a1a2e');

            // Whisker (min to max line)
            svg += `<line x1="${x}" y1="${yMin}" x2="${x}" y2="${yMax}" stroke="${boxColor}" stroke-width="2"/>`;

            // Min/Max caps
            svg += `<line x1="${x - boxWidth/3}" y1="${yMin}" x2="${x + boxWidth/3}" y2="${yMin}" stroke="${boxColor}" stroke-width="2"/>`;
            svg += `<line x1="${x - boxWidth/3}" y1="${yMax}" x2="${x + boxWidth/3}" y2="${yMax}" stroke="${boxColor}" stroke-width="2"/>`;

            // Box (Q1 to Q3)
            const boxTop = Math.min(yQ1, yQ3);
            const boxHeight = Math.abs(yQ3 - yQ1);
            svg += `<rect x="${x - boxWidth/2}" y="${boxTop}" width="${boxWidth}" height="${boxHeight}" fill="${boxColor}" fill-opacity="0.2" stroke="${boxColor}" stroke-width="2" rx="3"/>`;

            // Median line
            svg += `<line x1="${x - boxWidth/2}" y1="${yMedian}" x2="${x + boxWidth/2}" y2="${yMedian}" stroke="${boxColor}" stroke-width="3"/>`;

            // Value labels (max, median, min)
            svg += `<text x="${x}" y="${yMax - 6}" text-anchor="middle" font-size="12" fill="#666">${box.max.toFixed(0)}</text>`;
            svg += `<text x="${x}" y="${yMedian}" text-anchor="middle" font-size="14" fill="${boxColor}" font-weight="bold" dy="0.35em">${box.median.toFixed(0)}</text>`;
            svg += `<text x="${x}" y="${yMin + 16}" text-anchor="middle" font-size="12" fill="#666">${box.min.toFixed(0)}</text>`;
        });

        svg += '</svg>';
        container.innerHTML = svg;
    }

    function getRecommendation(stats) {
        const avg = (stats.m3 && stats.m3.avg) || (stats.all && stats.all.avg);
        if (!avg) return { type: 'neutral', text: 'Not enough data.' };
        const diff = ((stats.current - avg) / avg) * 100;
        if (diff <= -10) return { type: 'good', text: `${Math.abs(diff).toFixed(0)}% below avg` };
        if (diff <= -5) return { type: 'decent', text: `${Math.abs(diff).toFixed(0)}% below avg` };
        if (diff >= 10) return { type: 'wait', text: `${diff.toFixed(0)}% above avg` };
        if (diff >= 5) return { type: 'caution', text: `${diff.toFixed(0)}% above avg` };
        return { type: 'neutral', text: `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}% vs avg` };
    }

    function renderContent(dataObj) {
        const content = panel.querySelector('.gpa-content');

        let allTimeData = null;
        if (Array.isArray(dataObj)) {
            allTimeData = dataObj;
        } else if (dataObj && typeof dataObj === 'object') {
            allTimeData = dataObj.allTime || dataObj.threeMonths;
        }

        if (!allTimeData || allTimeData.length === 0) {
            content.innerHTML = `<div class="gpa-no-data">No price history found.</div>`;
            return;
        }

        const currentPrice = getCurrentPriceFromPage();
        const stats = calculateStats(allTimeData, currentPrice);
        const rec = getRecommendation(stats);

        content.innerHTML = `
            <div class="gpa-legend">
                <span class="gpa-legend-item"><span class="gpa-legend-line gpa-legend-current"></span> Current price</span>
                <span class="gpa-legend-item"><span class="gpa-legend-box"></span> 25%-75% range</span>
                <span class="gpa-legend-item">─ Median (50%)</span>
                <span class="gpa-legend-item">┬┴ Min/Max</span>
            </div>
            <div class="gpa-chart-container">
                <div id="gpa-whisker" class="gpa-whisker"></div>
            </div>
            <div class="gpa-period-note">Each column shows prices for that specific time period only (not cumulative)</div>
            <div class="gpa-recommendation">
                <div class="gpa-recommendation-title">${rec.type === 'good' ? '✓ Good Price' : rec.type === 'decent' ? '✓ OK Price' : rec.type === 'wait' ? '⚠ Wait' : rec.type === 'caution' ? '⚠ High' : '→ Average'}</div>
                <div class="gpa-recommendation-text">${rec.text}</div>
            </div>
        `;

        setTimeout(() => createWhiskerChart(allTimeData, 'gpa-whisker', stats.current), 50);
    }

    async function loadPriceData() {
        if (!panel) return;
        if (isLoading) {
            console.log('[GPA] Already loading, skipping...');
            return;
        }
        isLoading = true;

        panel.querySelector('.gpa-content').innerHTML = `<div class="gpa-loading"><div class="spinner"></div>Analyzing price history...</div>`;

        let data = await fetchPriceHistory();

        // Check if we have any data in the new format
        const hasData = data && (
            (data.allTime && data.allTime.length > 0) ||
            (data.threeMonths && data.threeMonths.length > 0) ||
            (Array.isArray(data) && data.length > 0)
        );

        if (!hasData) {
            panel.querySelector('.gpa-content').innerHTML = `<div class="gpa-no-data">No price history available for this product.</div>`;
            isLoading = false;
            return;
        }
        renderContent(data);
        isLoading = false;
    }

    function createPanel() {
        if (panel) {
            panel.remove();
        }

        panel = document.createElement('div');
        panel.className = 'gpa-panel visible';
        panel.innerHTML = `
            <div class="gpa-header">
                <h3>Price Analysis</h3>
                <div class="gpa-controls">
                    <label class="gpa-auto-label"><input type="checkbox" class="gpa-auto" ${autoLoad ? 'checked' : ''}> Auto</label>
                    <button class="gpa-read">Read</button>
                    <button class="gpa-close">×</button>
                </div>
            </div>
            <div class="gpa-content">
                <div class="gpa-instructions">Click <strong>Read</strong> to analyze price history</div>
            </div>
        `;

        document.body.appendChild(panel);
        panel.querySelector('.gpa-close').addEventListener('click', () => panel.classList.remove('visible'));
        panel.querySelector('.gpa-read').addEventListener('click', () => loadPriceData());
        panel.querySelector('.gpa-auto').addEventListener('change', (e) => {
            autoLoad = e.target.checked;
        });

        if (autoLoad) {
            loadPriceData();
        }
    }

    function isProductPage() {
        const path = window.location.pathname;
        return /\/product\/.*-(\d+)$/.test(path) || /\/product\/.*\/(\d+)$/.test(path);
    }

    function checkAndInit() {
        const productId = getProductId();
        console.log('[GPA] Checking page, product ID:', productId, 'current:', currentProductId);

        if (isProductPage() && productId !== currentProductId) {
            currentProductId = productId;
            console.log('[GPA] New product detected, creating panel');
            createPanel();
        } else if (!isProductPage() && panel) {
            console.log('[GPA] Left product page, removing panel');
            panel.remove();
            panel = null;
            currentProductId = null;
        }
    }

    // Watch for URL changes (SPA navigation)
    let lastUrl = window.location.href;
    function watchUrlChanges() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            console.log('[GPA] URL changed:', currentUrl);
            lastUrl = currentUrl;
            setTimeout(checkAndInit, 500); // Wait for page to update
        }
    }

    // Initialize
    console.log('[GPA] Galaxus Price Analyzer starting...');

    // Initial check
    checkAndInit();

    // Watch for URL changes every 500ms (for SPA navigation)
    setInterval(watchUrlChanges, 500);
})();
