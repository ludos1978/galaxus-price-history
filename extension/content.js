// Galaxus Price Analyzer - Browser Extension Content Script
(function() {
    'use strict';

    // Configurable wait times (in ms)
    const WAIT_3_MONTHS = 300;      // Wait after clicking 3 Monate tab
    const WAIT_ALLES = 500;        // Wait after clicking Alles tab for data to load
    const WAIT_SCROLL_RESTORE = 200; // Wait before restoring scroll after clicking Alles
    const POLL_INTERVAL = 100;       // How often to check for tabs appearing

    let currentProductId = null;
    let panel = null;
    let isLoading = false; // Prevent double loading

    // Load settings from localStorage (with defaults)
    let autoLoad = localStorage.getItem('gpa-autoLoad') !== 'false'; // Default true
    let detailLevel = parseInt(localStorage.getItem('gpa-detailLevel'), 10) || 7;

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
    // Returns null - we don't generate fake data, only use real extracted data
    function extractFromPriceText() {
        return null;
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
                if (!isNaN(p)) yPrices.push(p); // Include 0 for correct scale
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

    // Calculate time-weighted stats over a specific period (integral of price over time)
    function calcStatsForPeriod(allData, periodStartDays, periodEndDays) {
        if (!allData || allData.length === 0) return { avg: null, min: null, max: null, count: 0, days: 0 };

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Period boundaries
        const periodStart = new Date(today);
        periodStart.setDate(periodStart.getDate() - periodStartDays);
        const periodEnd = new Date(today);
        periodEnd.setDate(periodEnd.getDate() - periodEndDays);

        // Sort all data by date
        const sorted = [...allData].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Find starting price (last price before period start)
        let startingPrice = null;
        const pointsInPeriod = [];

        for (const point of sorted) {
            const pointDate = new Date(point.date);
            if (pointDate < periodStart) {
                startingPrice = point.price;
            } else if (pointDate < periodEnd) {
                pointsInPeriod.push({ date: pointDate, price: point.price });
            }
        }

        // If no data before period, use first point in period
        if (startingPrice === null && pointsInPeriod.length > 0) {
            startingPrice = pointsInPeriod[0].price;
        }
        if (startingPrice === null) {
            return { avg: null, min: null, max: null, count: 0, days: 0 };
        }

        // Calculate integral: sum of (price × duration) over the period
        let totalWeightedPrice = 0;
        let currentPrice = startingPrice;
        let currentDate = periodStart;
        const allPrices = [startingPrice];

        for (const point of pointsInPeriod) {
            const days = (point.date - currentDate) / (1000 * 60 * 60 * 24);
            totalWeightedPrice += currentPrice * days;
            currentPrice = point.price;
            currentDate = point.date;
            allPrices.push(point.price);
        }

        // Final segment: from last point to period end
        const finalDays = (periodEnd - currentDate) / (1000 * 60 * 60 * 24);
        totalWeightedPrice += currentPrice * finalDays;

        const totalDays = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
        const avg = totalDays > 0 ? totalWeightedPrice / totalDays : startingPrice;

        return {
            avg: Math.round(avg * 100) / 100,
            min: Math.round(Math.min(...allPrices) * 100) / 100,
            max: Math.round(Math.max(...allPrices) * 100) / 100,
            count: pointsInPeriod.length,
            days: Math.round(totalDays)
        };
    }

    function calculateStats(allData, currentPriceOverride) {
        if (!allData || allData.length === 0) return null;

        // Calculate time-weighted stats for each period (proper integral over each time range)
        // Each period computes the integral of price over its full duration
        const y3 = calcStatsForPeriod(allData, 1095, 365);  // 3Y-1Y
        const y1 = calcStatsForPeriod(allData, 365, 90);    // 1Y-3M
        const m3 = calcStatsForPeriod(allData, 90, 30);     // 3M-1M
        const m1 = calcStatsForPeriod(allData, 30, 7);      // 1M-1W
        const w1 = calcStatsForPeriod(allData, 7, 1);       // 1W-1D
        const d1 = calcStatsForPeriod(allData, 1, 0);       // 1D-now

        // Overall stats for the full data range
        const sorted = [...allData].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstDate = new Date(sorted[0].date);
        const totalDays = Math.round((new Date() - firstDate) / (1000 * 60 * 60 * 24));
        const totalStats = calcStatsForPeriod(allData, totalDays, 0);

        const current = currentPriceOverride || allData[allData.length - 1]?.price || 0;
        const pricePosition = totalStats.max !== totalStats.min ? ((current - totalStats.min) / (totalStats.max - totalStats.min)) * 100 : 50;

        return {
            current: Math.round(current * 100) / 100,
            // Stats for each exclusive period (time-weighted)
            d1, w1, m1, m3, y1, y3,
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
                <text x="${padding.left - 5}" y="${yScale(maxPrice) + 4}" text-anchor="end" font-size="12" fill="#333">CHF ${maxPrice.toFixed(0)}</text>
                <text x="${padding.left - 5}" y="${yScale(minPrice) + 4}" text-anchor="end" font-size="12" fill="#333">CHF ${minPrice.toFixed(0)}</text>
            </svg>
        `;
    }

    // Create box plot / whisker chart for price distribution
    function createWhiskerChart(data, containerId, currentPrice) {
      try {
        const container = document.getElementById(containerId);
        if (!container) {
            console.log('[GPA] Chart container not found:', containerId);
            return;
        }
        if (!data || data.length === 0) {
            console.log('[GPA] No data for chart');
            return;
        }
        console.log('[GPA] Creating whisker chart with', data.length, 'data points, currentPrice:', currentPrice);
        console.log('[GPA] First 3 data points:', JSON.stringify(data.slice(0, 3)));
        console.log('[GPA] Last 3 data points:', JSON.stringify(data.slice(-3)));

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Major time boundaries (days ago): 3Y, 1Y, 3M, 1M, 1W, 1D, NOW
        // NOW (0 to 0) is a special marker for current price display
        const majorBoundaries = [1095, 365, 90, 30, 7, 1, 0, -1];
        const majorLabels = ['3Y', '1Y', '3M', '1M', '1W', '1D', 'NOW'];

        // Generate buckets based on detail level
        // NOW is always just 1 bucket, other 6 periods get subdivided
        // 7 = 6×1 + 1, 19 = 6×3 + 1, 55 = 6×9 + 1
        const numSubdividablePeriods = 6;
        const subdiv = Math.max(1, Math.round((detailLevel - 1) / numSubdividablePeriods));
        console.log('[GPA] detailLevel:', detailLevel, 'subdiv:', subdiv);
        const buckets = [];

        const numMajorPeriods = 7; // 6 subdivided + NOW
        for (let i = 0; i < numMajorPeriods; i++) {
            const startDays = majorBoundaries[i];
            const endDays = majorBoundaries[i + 1];

            // "NOW" is special - just shows current price, no time range
            if (endDays === -1) {
                buckets.push({
                    label: 'NOW',
                    isNow: true,
                    isMajor: true
                });
                continue;
            }

            const span = startDays - endDays;

            for (let j = 0; j < subdiv; j++) {
                const bucketStart = startDays - (span * j / subdiv);
                const bucketEnd = startDays - (span * (j + 1) / subdiv);
                const isMajor = (j === 0);
                buckets.push({
                    label: isMajor ? majorLabels[i] : '',
                    startDays: bucketStart,
                    endDays: bucketEnd,
                    isMajor: isMajor
                });
            }
        }

        console.log('[GPA] Buckets created:', buckets.length);

        // Calculate time-weighted percentile for a period
        // Returns the price at which cumulative duration reaches p% of total duration
        const calcTimeWeightedPercentile = (priceSegments, totalDays, p) => {
            if (priceSegments.length === 0) return null;
            // Sort by price
            const sorted = [...priceSegments].sort((a, b) => a.price - b.price);
            const targetDays = (p / 100) * totalDays;
            let cumDays = 0;
            for (const seg of sorted) {
                cumDays += seg.days;
                if (cumDays >= targetDays) return seg.price;
            }
            return sorted[sorted.length - 1].price;
        };

        // Sort data once outside the loop (performance fix)
        const sortedData = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
        console.log('[GPA] Data sorted, processing buckets...');

        const boxes = [];
        for (let i = 0; i < buckets.length; i++) {
          try {
            const bucket = buckets[i];
            console.log('[GPA] Processing bucket', i, 'of', buckets.length, 'bucket:', JSON.stringify(bucket));

            // "NOW" bucket - just shows current price, no box plot
            if (bucket.isNow) {
                console.log('[GPA] Bucket', i, 'is NOW bucket');
                boxes.push({
                    label: 'NOW',
                    isNow: true,
                    isMajor: true,
                    price: currentPrice
                });
                continue;
            }

            console.log('[GPA] Bucket', i, 'startDays:', bucket.startDays, 'endDays:', bucket.endDays);

            // Calculate period boundaries
            const periodStart = new Date(today);
            periodStart.setDate(periodStart.getDate() - bucket.startDays);
            const periodEnd = new Date(today);
            periodEnd.setDate(periodEnd.getDate() - bucket.endDays);
            console.log('[GPA] Bucket', i, 'period:', periodStart.toISOString().split('T')[0], 'to', periodEnd.toISOString().split('T')[0]);

            // Find starting price and points in period
            let startingPrice = null;
            const pointsInPeriod = [];

            for (const point of sortedData) {
                const pointDate = new Date(point.date);
                if (pointDate < periodStart) {
                    startingPrice = point.price;
                } else if (pointDate < periodEnd) {
                    pointsInPeriod.push({ date: pointDate, price: point.price });
                }
            }
            console.log('[GPA] Bucket', i, 'startingPrice:', startingPrice, 'pointsInPeriod:', pointsInPeriod.length);

            if (startingPrice === null && pointsInPeriod.length > 0) {
                startingPrice = pointsInPeriod[0].price;
            }

            if (startingPrice === null) {
                console.log('[GPA] Bucket', i, 'no data, skipping');
                boxes.push({ label: bucket.label, isMajor: bucket.isMajor, min: null });
                continue;
            }

            // Build price segments with duration (for time-weighted stats)
            const priceSegments = [];
            let segmentPrice = startingPrice;
            let segmentDate = periodStart;
            let minPriceVal = startingPrice;
            let maxPriceVal = startingPrice;

            for (const point of pointsInPeriod) {
                const days = (point.date - segmentDate) / (1000 * 60 * 60 * 24);
                if (days > 0) {
                    priceSegments.push({ price: segmentPrice, days: days });
                }
                segmentPrice = point.price;
                segmentDate = point.date;
                minPriceVal = Math.min(minPriceVal, point.price);
                maxPriceVal = Math.max(maxPriceVal, point.price);
            }

            // Final segment to period end
            const finalDays = (periodEnd - segmentDate) / (1000 * 60 * 60 * 24);
            if (finalDays > 0) {
                priceSegments.push({ price: segmentPrice, days: finalDays });
            }

            const totalDays = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
            console.log('[GPA] Bucket', i, 'totalDays:', totalDays, 'segments:', priceSegments.length);

            if (totalDays <= 0) {
                console.log('[GPA] Bucket', i, 'totalDays <= 0, skipping');
                boxes.push({ label: bucket.label, isMajor: bucket.isMajor, min: null });
                continue;
            }
            const box = {
                label: bucket.label,
                isMajor: bucket.isMajor,
                min: minPriceVal,
                q1: calcTimeWeightedPercentile(priceSegments, totalDays, 25),
                median: calcTimeWeightedPercentile(priceSegments, totalDays, 50),
                q3: calcTimeWeightedPercentile(priceSegments, totalDays, 75),
                max: maxPriceVal,
                count: pointsInPeriod.length,
                days: Math.round(totalDays)
            };
            boxes.push(box);
            console.log('[GPA] Box', i, 'created successfully');
          } catch (bucketError) {
            console.error('[GPA] Error processing bucket', i, ':', bucketError);
            boxes.push({ label: buckets[i]?.label || '', isMajor: buckets[i]?.isMajor, min: null });
          }
        }

        console.log('[GPA] Created', boxes.length, 'boxes, boxes with data:', boxes.filter(b => b.min != null).length);

        // Get global min/max for scaling
        const allPrices = boxes.filter(b => b.min != null && !b.isNow).flatMap(b => [b.min, b.max]);
        if (currentPrice) allPrices.push(currentPrice);
        if (allPrices.length === 0) {
            console.log('[GPA] No price data for chart - allPrices empty');
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#666;">No price data available for chart</div>';
            return;
        }
        console.log('[GPA] Price range:', Math.min(...allPrices), '-', Math.max(...allPrices));

        const minPrice = Math.min(...allPrices) * 0.95;
        const maxPrice = Math.max(...allPrices) * 1.05;

        const width = container.clientWidth || 480;
        const height = 380;
        const padding = { top: 35, right: 15, bottom: 40, left: 15 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const boxSpacing = chartWidth / boxes.length;
        const boxWidth = Math.min(45, boxSpacing * 0.6);

        const yScale = (p) => padding.top + chartHeight - ((p - minPrice) / (maxPrice - minPrice)) * chartHeight;

        let svg = `<svg width="${width}" height="${height}">`;

        // Current price line (dashed red, spanning full width) - no label, shown at NOW column
        if (currentPrice && currentPrice >= minPrice && currentPrice <= maxPrice) {
            const cy = yScale(currentPrice);
            svg += `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="#e53935" stroke-width="2" stroke-dasharray="6,3"/>`;
        }

        // Draw box plots
        boxes.forEach((box, i) => {
            const x = padding.left + i * boxSpacing + boxSpacing / 2;

            // "NOW" bucket - show current price with dot and label
            if (box.isNow) {
                svg += `<text x="${x}" y="${height - 8}" text-anchor="middle" font-size="12" fill="#333">${box.label}</text>`;
                if (currentPrice) {
                    const cy = yScale(currentPrice);
                    // Dot at current price
                    svg += `<circle cx="${x}" cy="${cy}" r="6" fill="#e53935"/>`;
                    // Price value above with white outline
                    svg += `<text x="${x}" y="${cy - 12}" text-anchor="middle" font-size="14" fill="#e53935" font-weight="600" stroke="#fff" stroke-width="3" paint-order="stroke">${currentPrice.toFixed(0)}</text>`;
                }
                return;
            }

            // Label only for major buckets
            if (box.isMajor && box.label) {
                svg += `<text x="${x}" y="${height - 8}" text-anchor="middle" font-size="12" fill="#333">${box.label}</text>`;
            }

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

            // Value labels only for major buckets, skip if same as current price
            // Using stroke with paint-order for white outline behind text
            const outline = 'stroke="#fff" stroke-width="3" paint-order="stroke"';
            if (box.isMajor) {
                const curr = currentPrice ? currentPrice.toFixed(0) : null;
                const med = box.median.toFixed(0);
                // Max label - skip if same as current or median
                if (box.max.toFixed(0) !== curr && box.max.toFixed(0) !== med) {
                    svg += `<text x="${x}" y="${yMax - 8}" text-anchor="middle" font-size="12" fill="#333" ${outline}>${box.max.toFixed(0)}</text>`;
                }
                // Q3 label - skip if same as current or median
                if (box.q3.toFixed(0) !== curr && box.q3.toFixed(0) !== med) {
                    svg += `<text x="${x + boxWidth/2 + 3}" y="${yQ3}" text-anchor="start" font-size="12" fill="#333" ${outline} dy="0.35em">${box.q3.toFixed(0)}</text>`;
                }
                // Median label - skip if same as current
                if (med !== curr) {
                    svg += `<text x="${x}" y="${yMedian}" text-anchor="middle" font-size="14" fill="${boxColor}" font-weight="600" ${outline} dy="0.35em">${med}</text>`;
                }
                // Q1 label - skip if same as current or median
                if (box.q1.toFixed(0) !== curr && box.q1.toFixed(0) !== med) {
                    svg += `<text x="${x + boxWidth/2 + 3}" y="${yQ1}" text-anchor="start" font-size="12" fill="#333" ${outline} dy="0.35em">${box.q1.toFixed(0)}</text>`;
                }
                // Min label - skip if same as current or median
                if (box.min.toFixed(0) !== curr && box.min.toFixed(0) !== med) {
                    svg += `<text x="${x}" y="${yMin + 18}" text-anchor="middle" font-size="12" fill="#333" ${outline}>${box.min.toFixed(0)}</text>`;
                }
            }
        });

        svg += '</svg>';
        console.log('[GPA] Setting SVG, length:', svg.length);
        container.innerHTML = svg;
        console.log('[GPA] Container innerHTML set, length:', container.innerHTML.length);
      } catch (e) {
        console.error('[GPA] Error in createWhiskerChart:', e);
      }
    }

    function getRecommendation(stats) {
        const avg = (stats.m3 && stats.m3.avg) || (stats.y1 && stats.y1.avg);
        if (!avg) return { type: 'neutral', text: 'Not enough data.' };
        const diff = ((stats.current - avg) / avg) * 100;
        // Text shows comparison to time-weighted average
        if (diff <= -10) return { type: 'good', text: `${Math.abs(diff).toFixed(0)}% below time-weighted avg` };
        if (diff <= -5) return { type: 'decent', text: `${Math.abs(diff).toFixed(0)}% below time-weighted avg` };
        if (diff >= 10) return { type: 'wait', text: `${diff.toFixed(0)}% above time-weighted avg` };
        if (diff >= 5) return { type: 'caution', text: `${diff.toFixed(0)}% above time-weighted avg` };
        return { type: 'neutral', text: `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}% vs time-weighted avg` };
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

        // Calculate % above all-time minimum
        const allTimeMin = Math.min(...allTimeData.map(d => d.price));
        const aboveMinPct = allTimeMin > 0 ? ((stats.current - allTimeMin) / allTimeMin * 100) : 0;

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
            <div class="gpa-recommendation ${rec.type === 'good' || rec.type === 'decent' ? 'buy' : rec.type === 'wait' || rec.type === 'caution' ? 'wait' : 'neutral'}">
                <div class="gpa-recommendation-title">${rec.type === 'good' ? '✓ BUY - Good Price' : rec.type === 'decent' ? '✓ BUY - OK Price' : rec.type === 'wait' ? '✗ WAIT - Too High' : rec.type === 'caution' ? '✗ WAIT - Above Average' : '• NEUTRAL - Average Price'}</div>
                <div class="gpa-recommendation-text">${rec.text}</div>
                <div class="gpa-recommendation-detail">${aboveMinPct.toFixed(0)}% above all-time low (${allTimeMin.toFixed(0)})</div>
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
                    <select class="gpa-detail">
                        <option value="7" ${detailLevel === 7 ? 'selected' : ''}>7</option>
                        <option value="19" ${detailLevel === 19 ? 'selected' : ''}>19</option>
                        <option value="55" ${detailLevel === 55 ? 'selected' : ''}>55</option>
                    </select>
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
            localStorage.setItem('gpa-autoLoad', autoLoad);
        });
        panel.querySelector('.gpa-detail').addEventListener('change', (e) => {
            detailLevel = parseInt(e.target.value, 10);
            localStorage.setItem('gpa-detailLevel', detailLevel);
            loadPriceData(); // Reload with new detail level
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
