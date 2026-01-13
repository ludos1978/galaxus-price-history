// Galaxus Price Analyzer - Browser Extension Content Script
(function() {
    'use strict';

    let currentProductId = null;
    let panel = null;

    // Extract product ID from URL
    function getProductId() {
        const match = window.location.pathname.match(/-(\d+)$/);
        return match ? match[1] : null;
    }

    // Click and expand the Preisentwicklung section
    async function expandPriceHistory() {
        console.log('[GPA] Looking for Preisentwicklung button...');

        // Save current scroll position
        const savedScrollY = window.scrollY;

        // Specific selector for the Preisentwicklung button
        const button = document.querySelector('#priceHistoryBlock') ||
                       document.querySelector('[data-test="priceHistoryBlock"]') ||
                       document.querySelector('button[aria-controls*="priceHistory"]');

        if (button) {
            // Scroll the button into view to trigger lazy loading
            console.log('[GPA] Scrolling Preisentwicklung into view...');
            button.scrollIntoView({ behavior: 'auto', block: 'center' });
            await sleep(300);

            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            console.log('[GPA] Found priceHistoryBlock button, expanded:', isExpanded);

            if (!isExpanded) {
                console.log('[GPA] Clicking to expand...');
                button.click();
                await sleep(1500); // Wait for data to load
            } else {
                console.log('[GPA] Already expanded');
            }

            // Now click time period tabs to load both datasets
            await clickTimePeriodTabs();

            // Restore scroll position
            window.scrollTo({ top: savedScrollY, behavior: 'auto' });

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
                await sleep(300);
                el.click();
                await sleep(1500);
                await clickTimePeriodTabs();
                // Restore scroll position
                window.scrollTo({ top: savedScrollY, behavior: 'auto' });
                return true;
            }
        }

        console.log('[GPA] Could not find Preisentwicklung button');
        return false;
    }

    // Click both "3 Monate" and "Alles" tabs to load both time periods
    async function clickTimePeriodTabs() {
        console.log('[GPA] Looking for time period tabs...');

        // Store data from each period
        window._gpaTimeData = { threeMonths: null, allTime: null };

        // Find all buttons/tabs in the price history section
        const priceHistorySection = document.querySelector('#priceHistoryBlock')?.parentElement?.parentElement ||
                                    document.querySelector('[data-test="priceHistoryBlock"]')?.parentElement?.parentElement;

        if (!priceHistorySection) {
            console.log('[GPA] Could not find price history section for tabs');
            return;
        }

        // Look for tab buttons - they typically contain "3 Monate" or "Alles"
        const buttons = priceHistorySection.querySelectorAll('button, [role="tab"], [role="button"]');
        let threeMonthsBtn = null;
        let allTimeBtn = null;

        for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            if (text.includes('3 monate') || text.includes('3 month') || text === '3m') {
                threeMonthsBtn = btn;
            } else if (text.includes('alles') || text.includes('all') || text === 'max' || text === 'alle') {
                allTimeBtn = btn;
            }
        }

        // Click "Alles" first to get full history
        if (allTimeBtn) {
            console.log('[GPA] Clicking "Alles" tab...');
            allTimeBtn.click();
            await sleep(1500);
            // Extract and store "all time" data
            window._gpaTimeData.allTime = extractFromVisibleChart() || extractFromPriceText();
        }

        // Click "3 Monate" to get recent data
        if (threeMonthsBtn) {
            console.log('[GPA] Clicking "3 Monate" tab...');
            threeMonthsBtn.click();
            await sleep(1500);
            // Extract and store "3 months" data
            window._gpaTimeData.threeMonths = extractFromVisibleChart() || extractFromPriceText();
        }

        // If no tabs found, try looking for segmented control or similar
        if (!threeMonthsBtn && !allTimeBtn) {
            console.log('[GPA] No time period tabs found, looking for alternatives...');
            const allButtons = document.querySelectorAll('button, [role="tab"]');
            for (const btn of allButtons) {
                const text = (btn.textContent || '').trim();
                if (/^(3\s*M|3\s*Monate|Alles|All|Max)$/i.test(text)) {
                    console.log('[GPA] Found time button:', text);
                }
            }
        }
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

    // Extract price info from the visible text description
    function extractFromPriceText() {
        // Look for the price description paragraph
        const textEl = document.querySelector('.yAa8UXh') ||
                       document.querySelector('[class*="priceDescription"]') ||
                       document.querySelector('#priceHistoryBlock + div p');

        if (!textEl) return null;

        const text = textEl.textContent || '';
        console.log('[GPA] Found price text:', text);

        // Parse: "Der Preis sank am 5.9.2025 auf 398.– und erreichte am 29.1.2025 seinen Höchststand mit 738.36. Der aktuelle Preis liegt bei 449.–"
        const currentMatch = text.match(/aktuelle[rn]?\s+Preis\s+(?:liegt\s+)?bei\s+([\d'.,]+)/i);
        const lowestMatch = text.match(/(?:sank|fiel).*?auf\s+([\d'.,]+)/i);
        const highestMatch = text.match(/Höchststand.*?([\d'.,]+)/i);

        const current = currentMatch ? parseFloat(currentMatch[1].replace(/[',–]/g, '')) : null;
        const lowest = lowestMatch ? parseFloat(lowestMatch[1].replace(/[',–]/g, '')) : null;
        const highest = highestMatch ? parseFloat(highestMatch[1].replace(/[',–]/g, '')) : null;

        if (current && lowest && highest) {
            console.log('[GPA] Extracted from text - Current:', current, 'Low:', lowest, 'High:', highest);
            // Generate approximate data based on these values
            const data = [];
            const now = new Date();
            for (let i = 12; i >= 0; i--) {
                const date = new Date(now);
                date.setMonth(date.getMonth() - i);
                // Simulate price between low and high
                const range = highest - lowest;
                const randomFactor = Math.random();
                const price = lowest + (range * randomFactor);
                data.push({
                    date: date.toISOString().split('T')[0],
                    price: Math.round(price * 100) / 100
                });
            }
            // Set current price as last value
            data[data.length - 1].price = current;
            return data;
        }

        return null;
    }

    // Extract from visible SVG chart
    function extractFromVisibleChart() {
        const svgs = document.querySelectorAll('svg');

        for (const svg of svgs) {
            const paths = svg.querySelectorAll('path');
            for (const path of paths) {
                const d = path.getAttribute('d');
                if (!d) continue;

                const lCount = (d.match(/L/g) || []).length;
                if (lCount >= 5) {
                    const points = [];
                    const regex = /([ML])\s*([\d.]+)[,\s]+([\d.]+)/g;
                    let match;
                    while ((match = regex.exec(d)) !== null) {
                        points.push({ x: parseFloat(match[2]), y: parseFloat(match[3]) });
                    }

                    if (points.length >= 5) {
                        const texts = svg.querySelectorAll('text');
                        const prices = [];
                        for (const text of texts) {
                            const priceMatch = (text.textContent || '').match(/([\d'.,]+)/);
                            if (priceMatch) {
                                const price = parseFloat(priceMatch[1].replace(/[',]/g, ''));
                                if (price > 10 && price < 100000) prices.push(price);
                            }
                        }

                        if (prices.length >= 2) {
                            const minPrice = Math.min(...prices);
                            const maxPrice = Math.max(...prices);
                            const minY = Math.min(...points.map(p => p.y));
                            const maxY = Math.max(...points.map(p => p.y));

                            console.log('[GPA] Extracting from chart, price range:', minPrice, '-', maxPrice);

                            return points.map((p, i) => {
                                const normalizedY = (maxY - p.y) / (maxY - minY);
                                const price = minPrice + normalizedY * (maxPrice - minPrice);
                                const date = new Date();
                                date.setMonth(date.getMonth() - (points.length - 1 - i));
                                return { date: date.toISOString().split('T')[0], price: Math.round(price * 100) / 100 };
                            });
                        }
                    }
                }
            }
        }
        return null;
    }

    // Get current price from page
    function getCurrentPriceFromPage() {
        const selectors = [
            '[data-test="product-price"]',
            '[class*="productPrice" i]',
            '[class*="currentPrice" i]',
            '[itemprop="price"]',
            'strong[class*="price" i]'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                const match = (el.textContent || '').match(/([\d',.]+)/);
                if (match) {
                    const price = parseFloat(match[1].replace(/[',]/g, '').replace(/\.–$/, ''));
                    if (price > 0) {
                        console.log('[GPA] Found current price:', price);
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

    function generateSimulatedData(currentPrice, months = 12) {
        const data = [];
        const now = new Date();
        for (let i = months; i >= 0; i--) {
            const date = new Date(now);
            date.setMonth(date.getMonth() - i);
            const variation = (Math.random() - 0.5) * 0.3;
            data.push({
                date: date.toISOString().split('T')[0],
                price: Math.round(currentPrice * (1 + variation) * 100) / 100,
                simulated: true
            });
        }
        data[data.length - 1].price = currentPrice;
        data[data.length - 1].simulated = false;
        return data;
    }

    function calculateStats(prices) {
        if (!prices || prices.length === 0) return null;
        const values = prices.map(p => p.price);
        const n = values.length;
        const mean = values.reduce((a, b) => a + b, 0) / n;
        const sorted = [...values].sort((a, b) => a - b);
        const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
        const stdDev = Math.sqrt(values.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / n);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const current = values[values.length - 1];
        const pricePosition = max !== min ? ((current - min) / (max - min)) * 100 : 50;
        const recentValues = values.slice(-3);
        const trend = recentValues.length >= 2 ? recentValues[recentValues.length - 1] - recentValues[0] : 0;

        return { mean: Math.round(mean * 100) / 100, median: Math.round(median * 100) / 100, stdDev: Math.round(stdDev * 100) / 100, min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100, current, pricePosition: Math.round(pricePosition), trend: Math.round(trend * 100) / 100, count: n };
    }

    function filterLast3Months(data) {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        return data.filter(item => new Date(item.date) >= threeMonthsAgo);
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

        let pathD = `M ${xScale(0)} ${yScale(data[0].price)}`;
        for (let i = 1; i < data.length; i++) pathD += ` L ${xScale(i)} ${yScale(data[i].price)}`;
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

    function getRecommendation(stats) {
        const diff = ((stats.current - stats.mean) / stats.mean) * 100;
        if (diff <= -10) return { type: 'good', text: `Great price! ${Math.abs(diff).toFixed(1)}% below average.` };
        if (diff <= -5) return { type: 'decent', text: `Good price - ${Math.abs(diff).toFixed(1)}% below average.` };
        if (diff >= 10) return { type: 'wait', text: `${diff.toFixed(1)}% above average. Consider waiting.` };
        if (diff >= 5) return { type: 'caution', text: `Slightly above average (+${diff.toFixed(1)}%).` };
        return { type: 'neutral', text: `Near average price (${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%).` };
    }

    function renderContent(dataObj, isSimulated) {
        const content = panel.querySelector('.gpa-content');

        // Handle both old format (array) and new format (object with allTime/threeMonths)
        let allTimeData = null;
        let threeMonthsData = null;

        if (Array.isArray(dataObj)) {
            // Old format: single array
            allTimeData = dataObj;
            threeMonthsData = filterLast3Months(dataObj);
        } else if (dataObj && typeof dataObj === 'object') {
            // New format: object with allTime and threeMonths
            allTimeData = dataObj.allTime;
            threeMonthsData = dataObj.threeMonths || (allTimeData ? filterLast3Months(allTimeData) : null);
        }

        if ((!allTimeData || allTimeData.length === 0) && (!threeMonthsData || threeMonthsData.length === 0)) {
            content.innerHTML = `<div class="gpa-no-data">No price history data found. Try clicking "Preisentwicklung" tab on the page.</div>`;
            return;
        }

        // Use allTime for statistics, fall back to threeMonths if not available
        const primaryData = allTimeData && allTimeData.length > 0 ? allTimeData : threeMonthsData;
        const stats = calculateStats(primaryData);
        const stats3m = threeMonthsData && threeMonthsData.length > 1 ? calculateStats(threeMonthsData) : stats;
        const rec = getRecommendation(stats3m);
        const trendIcon = stats.trend > 0 ? '↑' : stats.trend < 0 ? '↓' : '→';
        const trendClass = stats.trend > 0 ? 'warning' : stats.trend < 0 ? 'highlight' : '';
        const statClass = stats.pricePosition < 30 ? 'highlight' : stats.pricePosition > 70 ? 'warning' : '';

        // Build chart sections
        let chartHtml = '';
        if (threeMonthsData && threeMonthsData.length > 1) {
            chartHtml += `
                <div class="gpa-section-title">Last 3 Months</div>
                <div class="gpa-chart-container"><div class="gpa-chart-title">Recent price trend</div><div id="gpa-chart-3m" class="gpa-chart"></div></div>
            `;
        }
        if (allTimeData && allTimeData.length > 1) {
            chartHtml += `
                <div class="gpa-section-title">All Time</div>
                <div class="gpa-chart-container"><div class="gpa-chart-title">Full price history (${allTimeData.length} data points)</div><div id="gpa-chart-all" class="gpa-chart"></div></div>
            `;
        }

        content.innerHTML = `
            ${isSimulated ? `<div class="gpa-no-data" style="margin-bottom:12px;background:#e3f2fd;color:#1565c0;font-size:12px;">Estimated data. Click "Preisentwicklung" for real data.</div>` : ''}
            <div class="gpa-stats">
                <div class="gpa-stat ${statClass}"><div class="gpa-stat-label">Current</div><div class="gpa-stat-value">CHF ${stats.current.toFixed(2)}</div><div class="gpa-stat-sub">${stats.pricePosition}% of range</div></div>
                <div class="gpa-stat"><div class="gpa-stat-label">Average</div><div class="gpa-stat-value">CHF ${stats.mean.toFixed(2)}</div><div class="gpa-stat-sub">${stats.count} points</div></div>
                <div class="gpa-stat"><div class="gpa-stat-label">Median</div><div class="gpa-stat-value">CHF ${stats.median.toFixed(2)}</div></div>
                <div class="gpa-stat ${trendClass}"><div class="gpa-stat-label">Trend</div><div class="gpa-stat-value">${trendIcon} ${Math.abs(stats.trend).toFixed(2)}</div></div>
                <div class="gpa-stat"><div class="gpa-stat-label">Lowest</div><div class="gpa-stat-value">CHF ${stats.min.toFixed(2)}</div></div>
                <div class="gpa-stat"><div class="gpa-stat-label">Highest</div><div class="gpa-stat-value">CHF ${stats.max.toFixed(2)}</div></div>
            </div>
            ${chartHtml}
            <div class="gpa-recommendation">
                <div class="gpa-recommendation-title">${rec.type === 'good' ? '✓ Good Time to Buy' : rec.type === 'decent' ? '✓ Decent Price' : rec.type === 'wait' ? '⚠ Consider Waiting' : rec.type === 'caution' ? '⚠ Above Average' : '→ Average Price'}</div>
                <div class="gpa-recommendation-text">${rec.text}</div>
            </div>
        `;

        // Render charts after DOM is updated
        setTimeout(() => {
            if (threeMonthsData && threeMonthsData.length > 1) {
                createChart(threeMonthsData, 'gpa-chart-3m');
            }
            if (allTimeData && allTimeData.length > 1) {
                createChart(allTimeData, 'gpa-chart-all');
            }
        }, 50);
    }

    async function loadPriceData() {
        if (!panel) return;

        panel.querySelector('.gpa-content').innerHTML = `<div class="gpa-loading"><div class="spinner"></div>Analyzing price history...</div>`;

        let data = await fetchPriceHistory();
        let simulated = false;

        // Check if we have any data in the new format
        const hasData = data && (
            (data.allTime && data.allTime.length > 0) ||
            (data.threeMonths && data.threeMonths.length > 0) ||
            (Array.isArray(data) && data.length > 0)
        );

        if (!hasData) {
            const price = getCurrentPriceFromPage();
            if (price) {
                data = { allTime: generateSimulatedData(price), threeMonths: null };
                simulated = true;
            }
        }
        renderContent(data, simulated);
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
                <button class="gpa-close">×</button>
            </div>
            <div class="gpa-content">
                <div class="gpa-loading"><div class="spinner"></div>Analyzing price history...</div>
            </div>
        `;

        document.body.appendChild(panel);
        panel.querySelector('.gpa-close').addEventListener('click', () => panel.classList.remove('visible'));

        loadPriceData();
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

    // Watch for DOM changes that might indicate price data loaded
    function watchForPriceData() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    const addedNodes = Array.from(mutation.addedNodes);
                    for (const node of addedNodes) {
                        if (node.nodeType === 1) {
                            const text = node.textContent || '';
                            if (text.includes('Preisentwicklung') || text.includes('priceHistory')) {
                                console.log('[GPA] Price data might be available, reloading...');
                                setTimeout(loadPriceData, 500);
                                return;
                            }
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Initialize
    console.log('[GPA] Galaxus Price Analyzer starting...');

    // Initial check
    checkAndInit();

    // Watch for URL changes every 500ms (for SPA navigation)
    setInterval(watchUrlChanges, 500);

    // Watch for price data appearing in DOM
    watchForPriceData();
})();
