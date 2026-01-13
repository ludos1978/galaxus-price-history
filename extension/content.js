// Galaxus Price Analyzer - Browser Extension Content Script
(function() {
    'use strict';

    // Extract product ID from URL
    function getProductId() {
        const match = window.location.pathname.match(/(\d+)(?:\?|$)/);
        return match ? match[1] : null;
    }

    // Get site domain
    function getSiteDomain() {
        return window.location.hostname;
    }

    // Click and expand the Preisentwicklung section
    async function expandPriceHistory() {
        console.log('[GPA] Looking for Preisentwicklung tab...');

        // Find all clickable elements and look for price-related text
        const allClickable = document.querySelectorAll('button, a, [role="tab"], [role="button"], div[class*="tab" i], span[class*="tab" i]');

        for (const el of allClickable) {
            const text = (el.textContent || '').toLowerCase();
            if (text.includes('preisentwicklung') || text.includes('price development') || text.includes('preis')) {
                console.log('[GPA] Found price tab, clicking:', el);
                el.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
                return true;
            }
        }

        // Also try scrolling down to trigger lazy loading of the price section
        window.scrollBy(0, 500);
        await new Promise(resolve => setTimeout(resolve, 500));

        return false;
    }

    // Extract price data from __NEXT_DATA__ or Apollo state
    function extractFromPageData() {
        // Try __NEXT_DATA__
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (nextDataScript) {
            try {
                const data = JSON.parse(nextDataScript.textContent);
                const priceHistory = findInObject(data, ['priceHistory', 'PriceHistory', 'priceEvolution', 'priceDevelopment']);
                if (priceHistory) {
                    console.log('[GPA] Found price history in __NEXT_DATA__');
                    return priceHistory;
                }
            } catch (e) {
                console.log('[GPA] Error parsing __NEXT_DATA__:', e);
            }
        }

        // Try Apollo cache (common in GraphQL apps)
        if (window.__APOLLO_STATE__) {
            const priceHistory = findInObject(window.__APOLLO_STATE__, ['priceHistory', 'PriceHistory']);
            if (priceHistory) {
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
                    // Try to extract JSON object containing price data
                    const match = content.match(/"priceHistory"\s*:\s*(\[[^\]]+\])/);
                    if (match) {
                        const parsed = JSON.parse(match[1]);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            console.log('[GPA] Found price history in script tag');
                            return parsed;
                        }
                    }
                } catch (e) {
                    // Continue searching
                }
            }
        }

        return null;
    }

    // Helper to find a key in nested object
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

    // Fetch from Galaxus GraphQL API directly
    async function fetchFromAPI() {
        const productId = getProductId();
        if (!productId) return null;

        console.log('[GPA] Fetching from API for product:', productId);

        // Try the price development endpoint that Galaxus uses
        try {
            const response = await fetch(`https://${getSiteDomain()}/api/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    operationName: "PDP_GET_PRODUCT_DETAILS",
                    variables: {
                        productId: parseInt(productId)
                    },
                    query: `query PDP_GET_PRODUCT_DETAILS($productId: Int!) {
                        productDetails: productDetailsV4(productId: $productId) {
                            product {
                                priceDevelopment {
                                    priceHistory {
                                        date
                                        price { amountIncl amountExcl currency }
                                    }
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

    // Extract data from the visible SVG chart
    function extractFromVisibleChart() {
        // Wait for chart to be visible and extract data points
        const svgs = document.querySelectorAll('svg');

        for (const svg of svgs) {
            const paths = svg.querySelectorAll('path');
            for (const path of paths) {
                const d = path.getAttribute('d');
                if (!d) continue;

                // Look for paths that look like line charts (multiple L commands)
                const lCount = (d.match(/L/g) || []).length;
                if (lCount >= 5) {
                    // Extract coordinates
                    const points = [];
                    const regex = /([ML])\s*([\d.]+)[,\s]+([\d.]+)/g;
                    let match;
                    while ((match = regex.exec(d)) !== null) {
                        points.push({ x: parseFloat(match[2]), y: parseFloat(match[3]) });
                    }

                    if (points.length >= 5) {
                        // Try to find price scale from text elements
                        const texts = svg.querySelectorAll('text');
                        const prices = [];
                        for (const text of texts) {
                            const content = text.textContent || '';
                            const priceMatch = content.match(/([\d'.,]+)/);
                            if (priceMatch) {
                                const price = parseFloat(priceMatch[1].replace(/[',]/g, ''));
                                if (price > 10 && price < 100000) {
                                    prices.push(price);
                                }
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
                                return {
                                    date: date.toISOString().split('T')[0],
                                    price: Math.round(price * 100) / 100
                                };
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
                const text = el.textContent || '';
                const match = text.match(/([\d',.]+)/);
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

        // Step 1: Try to expand the price history section
        await expandPriceHistory();

        // Step 2: Try extracting from page data
        let priceData = extractFromPageData();
        if (priceData && priceData.length > 0) {
            return normalizeData(priceData);
        }

        // Step 3: Try API fetch
        priceData = await fetchFromAPI();
        if (priceData && priceData.length > 0) {
            return normalizeData(priceData);
        }

        // Step 4: Try extracting from visible chart
        priceData = extractFromVisibleChart();
        if (priceData && priceData.length > 0) {
            return normalizeData(priceData);
        }

        console.log('[GPA] No price history found');
        return null;
    }

    // Normalize data format
    function normalizeData(data) {
        if (!Array.isArray(data)) return null;
        return data.map(item => ({
            date: item.date || item.Date || new Date().toISOString().split('T')[0],
            price: parseFloat(item.price?.amountIncl || item.price?.amount || item.price || item.Price || 0)
        })).filter(item => item.price > 0);
    }

    // Generate simulated data
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

    // Calculate statistics
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

        return {
            mean: Math.round(mean * 100) / 100,
            median: Math.round(median * 100) / 100,
            stdDev: Math.round(stdDev * 100) / 100,
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            current,
            pricePosition: Math.round(pricePosition),
            trend: Math.round(trend * 100) / 100,
            count: n
        };
    }

    function filterLast3Months(data) {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        return data.filter(item => new Date(item.date) >= threeMonthsAgo);
    }

    function createChart(data, containerId) {
        const container = document.getElementById(containerId);
        if (!container || !data || data.length === 0) return;

        const width = container.clientWidth || 360;
        const height = 120;
        const padding = { top: 10, right: 10, bottom: 25, left: 45 };
        const prices = data.map(d => d.price);
        const minPrice = Math.min(...prices) * 0.95;
        const maxPrice = Math.max(...prices) * 1.05;

        const xScale = (i) => padding.left + (i / (data.length - 1)) * (width - padding.left - padding.right);
        const yScale = (p) => height - padding.bottom - ((p - minPrice) / (maxPrice - minPrice)) * (height - padding.top - padding.bottom);

        let pathD = `M ${xScale(0)} ${yScale(data[0].price)}`;
        for (let i = 1; i < data.length; i++) {
            pathD += ` L ${xScale(i)} ${yScale(data[i].price)}`;
        }
        let areaD = pathD + ` L ${xScale(data.length - 1)} ${height - padding.bottom} L ${xScale(0)} ${height - padding.bottom} Z`;

        container.innerHTML = `
            <svg width="${width}" height="${height}" class="gpa-chart">
                <defs>
                    <linearGradient id="grad${containerId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#1a1a2e" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="#1a1a2e" stop-opacity="0.05"/>
                    </linearGradient>
                </defs>
                <path d="${areaD}" fill="url(#grad${containerId})"/>
                <path d="${pathD}" fill="none" stroke="#1a1a2e" stroke-width="2"/>
                <circle cx="${xScale(data.length - 1)}" cy="${yScale(data[data.length - 1].price)}" r="4" fill="#1a1a2e"/>
                <text x="${padding.left - 5}" y="${yScale(maxPrice) + 4}" text-anchor="end" font-size="10" fill="#888">CHF ${maxPrice.toFixed(0)}</text>
                <text x="${padding.left - 5}" y="${yScale(minPrice) + 4}" text-anchor="end" font-size="10" fill="#888">CHF ${minPrice.toFixed(0)}</text>
                <text x="${xScale(0)}" y="${height - 5}" text-anchor="start" font-size="10" fill="#888">${data[0].date.substring(5)}</text>
                <text x="${xScale(data.length - 1)}" y="${height - 5}" text-anchor="end" font-size="10" fill="#888">${data[data.length - 1].date.substring(5)}</text>
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

    function renderContent(panel, data, isSimulated) {
        const content = panel.querySelector('.gpa-content');
        if (!data || data.length === 0) {
            content.innerHTML = `<div class="gpa-no-data">No price history data found. Try expanding "Preisentwicklung" manually.</div>`;
            return;
        }

        const stats = calculateStats(data);
        const last3m = filterLast3Months(data);
        const stats3m = last3m.length > 1 ? calculateStats(last3m) : stats;
        const rec = getRecommendation(stats3m);
        const trendIcon = stats.trend > 0 ? '↑' : stats.trend < 0 ? '↓' : '→';
        const trendClass = stats.trend > 0 ? 'warning' : stats.trend < 0 ? 'highlight' : '';
        const statClass = stats.pricePosition < 30 ? 'highlight' : stats.pricePosition > 70 ? 'warning' : '';

        content.innerHTML = `
            ${isSimulated ? `<div class="gpa-no-data" style="margin-bottom:15px;background:#e3f2fd;color:#1565c0;">Estimated data. Click "Preisentwicklung" tab for real data.</div>` : ''}
            <div class="gpa-stats">
                <div class="gpa-stat ${statClass}">
                    <div class="gpa-stat-label">Current</div>
                    <div class="gpa-stat-value">CHF ${stats.current.toFixed(2)}</div>
                    <div class="gpa-stat-sub">${stats.pricePosition}% of range</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Average</div>
                    <div class="gpa-stat-value">CHF ${stats.mean.toFixed(2)}</div>
                    <div class="gpa-stat-sub">${stats.count} data points</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Median</div>
                    <div class="gpa-stat-value">CHF ${stats.median.toFixed(2)}</div>
                </div>
                <div class="gpa-stat ${trendClass}">
                    <div class="gpa-stat-label">Trend</div>
                    <div class="gpa-stat-value">${trendIcon} ${Math.abs(stats.trend).toFixed(2)}</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Lowest</div>
                    <div class="gpa-stat-value">CHF ${stats.min.toFixed(2)}</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Highest</div>
                    <div class="gpa-stat-value">CHF ${stats.max.toFixed(2)}</div>
                </div>
                <div class="gpa-stat" style="grid-column:span 2">
                    <div class="gpa-stat-label">Std. Deviation</div>
                    <div class="gpa-stat-value">CHF ${stats.stdDev.toFixed(2)}</div>
                </div>
            </div>
            <div class="gpa-section-title">All-Time</div>
            <div class="gpa-chart-container"><div id="gpa-chart-all"></div></div>
            ${last3m.length > 1 ? `
                <div class="gpa-section-title">Last 3 Months</div>
                <div class="gpa-chart-container"><div id="gpa-chart-3m"></div></div>
            ` : ''}
            <div class="gpa-recommendation">
                <div class="gpa-recommendation-title">${rec.type === 'good' ? '✓ Good Time to Buy' : rec.type === 'decent' ? '✓ Decent Price' : rec.type === 'wait' ? '⚠ Consider Waiting' : rec.type === 'caution' ? '⚠ Above Average' : '→ Average Price'}</div>
                <div class="gpa-recommendation-text">${rec.text}</div>
            </div>
        `;

        setTimeout(() => {
            createChart(data, 'gpa-chart-all');
            if (last3m.length > 1) createChart(last3m, 'gpa-chart-3m');
        }, 50);
    }

    async function createUI() {
        if (document.querySelector('.gpa-panel')) return;

        // Create panel that shows automatically
        const panel = document.createElement('div');
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

        // Close button
        panel.querySelector('.gpa-close').addEventListener('click', () => {
            panel.classList.remove('visible');
        });

        // Auto-fetch and display data
        console.log('[GPA] Auto-loading price analysis...');
        let data = await fetchPriceHistory();
        let simulated = false;
        if (!data || data.length === 0) {
            const price = getCurrentPriceFromPage();
            if (price) {
                data = generateSimulatedData(price);
                simulated = true;
            }
        }
        renderContent(panel, data, simulated);
    }

    function isProductPage() {
        const path = window.location.pathname;
        // Match URLs ending with a number (product ID)
        return /\/\d+$/.test(path) || /\/\d+\?/.test(path + '?');
    }

    function init() {
        console.log('[GPA] Extension loaded on:', window.location.href);
        console.log('[GPA] Is product page:', isProductPage());

        if (isProductPage()) {
            console.log('[GPA] Creating UI for product:', getProductId());
            createUI();
        } else {
            console.log('[GPA] Not a product page, skipping UI');
        }
    }

    // Run immediately
    console.log('[GPA] Galaxus Price Analyzer starting...');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
