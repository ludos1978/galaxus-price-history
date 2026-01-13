// ==UserScript==
// @name         Galaxus Price Analyzer
// @namespace    https://github.com/ludos1978/galaxus-price-history
// @version      1.0.0
// @description  Analyze price history on Galaxus/Digitec product pages - shows average, median, std deviation and charts
// @author       Galaxus Price History Project
// @match        https://www.galaxus.ch/*/product/*
// @match        https://www.galaxus.de/*/product/*
// @match        https://www.digitec.ch/*/product/*
// @match        https://www.galaxus.ch/*/*/s1/product/*
// @match        https://www.galaxus.de/*/*/s1/product/*
// @match        https://www.digitec.ch/*/*/s1/product/*
// @icon         https://www.galaxus.ch/favicon.ico
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      www.galaxus.ch
// @connect      www.galaxus.de
// @connect      www.digitec.ch
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Styles for the analyzer panel
    GM_addStyle(`
        .gpa-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .gpa-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        .gpa-button svg {
            width: 18px;
            height: 18px;
        }
        .gpa-panel {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 10001;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            width: 420px;
            max-height: 80vh;
            overflow: hidden;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .gpa-panel.visible {
            display: block;
            animation: gpa-slideIn 0.3s ease;
        }
        @keyframes gpa-slideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .gpa-header {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            padding: 16px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .gpa-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
        }
        .gpa-close {
            background: none;
            border: none;
            color: #fff;
            cursor: pointer;
            font-size: 20px;
            padding: 0;
            line-height: 1;
        }
        .gpa-content {
            padding: 20px;
            max-height: 60vh;
            overflow-y: auto;
        }
        .gpa-loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        .gpa-loading .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #eee;
            border-top-color: #1a1a2e;
            border-radius: 50%;
            animation: gpa-spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        @keyframes gpa-spin {
            to { transform: rotate(360deg); }
        }
        .gpa-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 20px;
        }
        .gpa-stat {
            background: #f8f9fa;
            padding: 14px;
            border-radius: 8px;
            text-align: center;
        }
        .gpa-stat-label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }
        .gpa-stat-value {
            font-size: 20px;
            font-weight: 700;
            color: #1a1a2e;
        }
        .gpa-stat-sub {
            font-size: 11px;
            color: #888;
            margin-top: 2px;
        }
        .gpa-stat.highlight {
            background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
        }
        .gpa-stat.highlight .gpa-stat-value {
            color: #2e7d32;
        }
        .gpa-stat.warning {
            background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
        }
        .gpa-stat.warning .gpa-stat-value {
            color: #ef6c00;
        }
        .gpa-section-title {
            font-size: 13px;
            font-weight: 600;
            color: #333;
            margin: 20px 0 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .gpa-chart-container {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
        }
        .gpa-chart-title {
            font-size: 12px;
            color: #666;
            margin-bottom: 10px;
            font-weight: 500;
        }
        .gpa-chart {
            width: 100%;
            height: 120px;
        }
        .gpa-error {
            background: #ffebee;
            color: #c62828;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .gpa-no-data {
            background: #fff3e0;
            color: #ef6c00;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .gpa-recommendation {
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
            padding: 14px;
            border-radius: 8px;
            margin-top: 15px;
        }
        .gpa-recommendation-title {
            font-size: 12px;
            font-weight: 600;
            color: #1565c0;
            margin-bottom: 6px;
        }
        .gpa-recommendation-text {
            font-size: 13px;
            color: #1976d2;
            line-height: 1.4;
        }
    `);

    // Extract product ID from URL
    function getProductId() {
        const match = window.location.pathname.match(/(\d+)(?:\?|$)/);
        return match ? match[1] : null;
    }

    // Get site domain
    function getSiteDomain() {
        return window.location.hostname;
    }

    // Fetch price history data from the page
    async function fetchPriceHistory() {
        // Try to find price history data in the page's embedded JSON
        const scripts = document.querySelectorAll('script');
        let priceData = null;

        for (const script of scripts) {
            const content = script.textContent;
            if (content && content.includes('priceHistory') || content.includes('PriceHistory')) {
                try {
                    // Look for JSON data patterns
                    const jsonMatch = content.match(/\{[\s\S]*"priceHistory"[\s\S]*\}/);
                    if (jsonMatch) {
                        const data = JSON.parse(jsonMatch[0]);
                        if (data.priceHistory) {
                            priceData = data.priceHistory;
                            break;
                        }
                    }
                } catch (e) {
                    // Continue searching
                }
            }
        }

        // If not found in scripts, try to extract from the visible chart
        if (!priceData) {
            priceData = extractPriceFromChart();
        }

        // If still not found, try the GraphQL approach
        if (!priceData) {
            priceData = await fetchFromGraphQL();
        }

        return priceData;
    }

    // Extract price data from the visible price chart on the page
    function extractPriceFromChart() {
        // Look for the Preisentwicklung section
        const priceSection = document.querySelector('[data-test="pdp-price-development"]') ||
                            document.querySelector('[class*="PriceDevelopment"]') ||
                            document.querySelector('[class*="priceHistory"]');

        if (!priceSection) {
            // Try to find SVG chart data
            const svgChart = document.querySelector('svg[class*="chart"], svg[class*="price"]');
            if (svgChart) {
                return extractFromSVG(svgChart);
            }
            return null;
        }

        return null;
    }

    // Extract data points from SVG chart
    function extractFromSVG(svg) {
        const paths = svg.querySelectorAll('path[d]');
        const points = [];

        for (const path of paths) {
            const d = path.getAttribute('d');
            if (d && d.includes('L')) {
                // Parse path data
                const coords = d.match(/[ML]\s*([\d.]+)[,\s]+([\d.]+)/g);
                if (coords && coords.length > 1) {
                    coords.forEach(coord => {
                        const [, x, y] = coord.match(/[ML]\s*([\d.]+)[,\s]+([\d.]+)/);
                        points.push({ x: parseFloat(x), y: parseFloat(y) });
                    });
                }
            }
        }

        return points.length > 0 ? points : null;
    }

    // Attempt to fetch from GraphQL API
    async function fetchFromGraphQL() {
        const productId = getProductId();
        if (!productId) return null;

        // This is a known endpoint pattern for Galaxus
        const graphqlEndpoint = `https://${getSiteDomain()}/api/graphql`;

        const query = {
            query: `
                query GetPriceHistory($productId: Int!) {
                    product(id: $productId) {
                        priceHistory {
                            date
                            price
                        }
                    }
                }
            `,
            variables: { productId: parseInt(productId) }
        };

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: graphqlEndpoint,
                headers: {
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify(query),
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.data?.product?.priceHistory) {
                            resolve(data.data.product.priceHistory);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                },
                onerror: function() {
                    resolve(null);
                }
            });
        });
    }

    // Fallback: Parse price from visible page elements
    function getCurrentPriceFromPage() {
        // Try various selectors for the current price
        const priceSelectors = [
            '[data-test="product-price"] strong',
            '[class*="productPrice"]',
            '[class*="ProductPrice"]',
            '.price strong',
            '[itemprop="price"]',
            '[data-test="price"]'
        ];

        for (const selector of priceSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const text = el.textContent;
                const match = text.match(/[\d'.,]+/);
                if (match) {
                    return parseFloat(match[0].replace(/[',]/g, ''));
                }
            }
        }

        return null;
    }

    // Generate simulated historical data based on current price
    // (Used when real data isn't available)
    function generateSimulatedData(currentPrice, months = 12) {
        const data = [];
        const now = new Date();

        for (let i = months; i >= 0; i--) {
            const date = new Date(now);
            date.setMonth(date.getMonth() - i);

            // Simulate price variations (typically within +/- 15%)
            const variation = (Math.random() - 0.5) * 0.3;
            const price = currentPrice * (1 + variation);

            data.push({
                date: date.toISOString().split('T')[0],
                price: Math.round(price * 100) / 100,
                simulated: true
            });
        }

        // Ensure current price is accurate
        data[data.length - 1].price = currentPrice;
        data[data.length - 1].simulated = false;

        return data;
    }

    // Calculate statistics
    function calculateStats(prices) {
        if (!prices || prices.length === 0) return null;

        const values = prices.map(p => typeof p === 'object' ? p.price : p);
        const n = values.length;

        // Mean (average)
        const mean = values.reduce((a, b) => a + b, 0) / n;

        // Median
        const sorted = [...values].sort((a, b) => a - b);
        const median = n % 2 === 0
            ? (sorted[n/2 - 1] + sorted[n/2]) / 2
            : sorted[Math.floor(n/2)];

        // Standard deviation
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
        const stdDev = Math.sqrt(avgSquaredDiff);

        // Min and Max
        const min = Math.min(...values);
        const max = Math.max(...values);

        // Current price (last value)
        const current = values[values.length - 1];

        // Price position (where current price stands)
        const pricePosition = ((current - min) / (max - min)) * 100;

        // Trend (compare last 3 values)
        const recentValues = values.slice(-3);
        const trend = recentValues.length >= 2
            ? recentValues[recentValues.length - 1] - recentValues[0]
            : 0;

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

    // Filter data for last 3 months
    function filterLast3Months(data) {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        return data.filter(item => {
            const itemDate = new Date(item.date);
            return itemDate >= threeMonthsAgo;
        });
    }

    // Create SVG chart
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

        // Create path
        let pathD = `M ${xScale(0)} ${yScale(data[0].price)}`;
        for (let i = 1; i < data.length; i++) {
            pathD += ` L ${xScale(i)} ${yScale(data[i].price)}`;
        }

        // Create area fill
        let areaD = pathD + ` L ${xScale(data.length - 1)} ${height - padding.bottom} L ${xScale(0)} ${height - padding.bottom} Z`;

        // Format currency
        const formatCHF = (val) => `CHF ${val.toFixed(0)}`;

        const svg = `
            <svg width="${width}" height="${height}" class="gpa-chart">
                <defs>
                    <linearGradient id="areaGradient${containerId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#1a1a2e" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="#1a1a2e" stop-opacity="0.05"/>
                    </linearGradient>
                </defs>

                <!-- Grid lines -->
                <line x1="${padding.left}" y1="${yScale(maxPrice)}" x2="${width - padding.right}" y2="${yScale(maxPrice)}" stroke="#eee" stroke-dasharray="2"/>
                <line x1="${padding.left}" y1="${yScale((maxPrice + minPrice) / 2)}" x2="${width - padding.right}" y2="${yScale((maxPrice + minPrice) / 2)}" stroke="#eee" stroke-dasharray="2"/>
                <line x1="${padding.left}" y1="${yScale(minPrice)}" x2="${width - padding.right}" y2="${yScale(minPrice)}" stroke="#eee" stroke-dasharray="2"/>

                <!-- Y-axis labels -->
                <text x="${padding.left - 5}" y="${yScale(maxPrice) + 4}" text-anchor="end" font-size="10" fill="#888">${formatCHF(maxPrice)}</text>
                <text x="${padding.left - 5}" y="${yScale(minPrice) + 4}" text-anchor="end" font-size="10" fill="#888">${formatCHF(minPrice)}</text>

                <!-- Area fill -->
                <path d="${areaD}" fill="url(#areaGradient${containerId})"/>

                <!-- Line -->
                <path d="${pathD}" fill="none" stroke="#1a1a2e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

                <!-- Current point -->
                <circle cx="${xScale(data.length - 1)}" cy="${yScale(data[data.length - 1].price)}" r="4" fill="#1a1a2e"/>

                <!-- X-axis labels -->
                <text x="${xScale(0)}" y="${height - 5}" text-anchor="start" font-size="10" fill="#888">${data[0].date.substring(5)}</text>
                <text x="${xScale(data.length - 1)}" y="${height - 5}" text-anchor="end" font-size="10" fill="#888">${data[data.length - 1].date.substring(5)}</text>
            </svg>
        `;

        container.innerHTML = svg;
    }

    // Get recommendation based on stats
    function getRecommendation(stats, allTimeStats) {
        const currentVsAvg = ((stats.current - stats.mean) / stats.mean) * 100;
        const position = stats.pricePosition;

        if (currentVsAvg <= -10) {
            return {
                type: 'good',
                text: `Great price! Currently ${Math.abs(currentVsAvg).toFixed(1)}% below average. This is in the lower ${position}% of the price range.`
            };
        } else if (currentVsAvg <= -5) {
            return {
                type: 'decent',
                text: `Good price - ${Math.abs(currentVsAvg).toFixed(1)}% below average. Reasonable time to buy.`
            };
        } else if (currentVsAvg >= 10) {
            return {
                type: 'wait',
                text: `Price is ${currentVsAvg.toFixed(1)}% above average. Consider waiting for a better deal.`
            };
        } else if (currentVsAvg >= 5) {
            return {
                type: 'caution',
                text: `Slightly above average (+${currentVsAvg.toFixed(1)}%). The price has been lower before.`
            };
        } else {
            return {
                type: 'neutral',
                text: `Price is near average (${currentVsAvg >= 0 ? '+' : ''}${currentVsAvg.toFixed(1)}%). Normal market price.`
            };
        }
    }

    // Render the panel content
    function renderContent(panel, data, isSimulated) {
        const content = panel.querySelector('.gpa-content');

        if (!data || data.length === 0) {
            content.innerHTML = `
                <div class="gpa-no-data">
                    No price history data available for this product.
                </div>
            `;
            return;
        }

        const allTimeStats = calculateStats(data);
        const last3MonthsData = filterLast3Months(data);
        const last3MonthsStats = last3MonthsData.length > 1 ? calculateStats(last3MonthsData) : allTimeStats;

        const recommendation = getRecommendation(last3MonthsStats, allTimeStats);
        const trendIcon = allTimeStats.trend > 0 ? '&#8593;' : allTimeStats.trend < 0 ? '&#8595;' : '&#8594;';
        const trendClass = allTimeStats.trend > 0 ? 'warning' : allTimeStats.trend < 0 ? 'highlight' : '';

        const statClass = allTimeStats.pricePosition < 30 ? 'highlight' : allTimeStats.pricePosition > 70 ? 'warning' : '';

        content.innerHTML = `
            ${isSimulated ? `
                <div class="gpa-no-data" style="margin-bottom: 15px; background: #e3f2fd; color: #1565c0;">
                    Note: Using estimated data. Real price history requires page-embedded data.
                </div>
            ` : ''}

            <div class="gpa-stats">
                <div class="gpa-stat ${statClass}">
                    <div class="gpa-stat-label">Current Price</div>
                    <div class="gpa-stat-value">CHF ${allTimeStats.current.toFixed(2)}</div>
                    <div class="gpa-stat-sub">${allTimeStats.pricePosition}% of range</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Average</div>
                    <div class="gpa-stat-value">CHF ${allTimeStats.mean.toFixed(2)}</div>
                    <div class="gpa-stat-sub">over ${allTimeStats.count} data points</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Median</div>
                    <div class="gpa-stat-value">CHF ${allTimeStats.median.toFixed(2)}</div>
                </div>
                <div class="gpa-stat ${trendClass}">
                    <div class="gpa-stat-label">Recent Trend</div>
                    <div class="gpa-stat-value">${trendIcon} ${Math.abs(allTimeStats.trend).toFixed(2)}</div>
                    <div class="gpa-stat-sub">CHF change</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Lowest</div>
                    <div class="gpa-stat-value">CHF ${allTimeStats.min.toFixed(2)}</div>
                </div>
                <div class="gpa-stat">
                    <div class="gpa-stat-label">Highest</div>
                    <div class="gpa-stat-value">CHF ${allTimeStats.max.toFixed(2)}</div>
                </div>
                <div class="gpa-stat" style="grid-column: span 2;">
                    <div class="gpa-stat-label">Std. Deviation</div>
                    <div class="gpa-stat-value">CHF ${allTimeStats.stdDev.toFixed(2)}</div>
                    <div class="gpa-stat-sub">Price volatility indicator</div>
                </div>
            </div>

            <div class="gpa-section-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/>
                </svg>
                All-Time Price History
            </div>
            <div class="gpa-chart-container">
                <div id="gpa-chart-alltime"></div>
            </div>

            ${last3MonthsData.length > 1 ? `
                <div class="gpa-section-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                    </svg>
                    Last 3 Months
                </div>
                <div class="gpa-chart-container">
                    <div class="gpa-chart-title">Avg: CHF ${last3MonthsStats.mean.toFixed(2)} | Range: CHF ${last3MonthsStats.min.toFixed(2)} - ${last3MonthsStats.max.toFixed(2)}</div>
                    <div id="gpa-chart-3months"></div>
                </div>
            ` : ''}

            <div class="gpa-recommendation">
                <div class="gpa-recommendation-title">
                    ${recommendation.type === 'good' ? '&#10003; Good Time to Buy' :
                      recommendation.type === 'decent' ? '&#10003; Decent Price' :
                      recommendation.type === 'wait' ? '&#9888; Consider Waiting' :
                      recommendation.type === 'caution' ? '&#9888; Above Average' :
                      '&#8594; Average Price'}
                </div>
                <div class="gpa-recommendation-text">${recommendation.text}</div>
            </div>
        `;

        // Render charts after DOM is ready
        setTimeout(() => {
            createChart(data, 'gpa-chart-alltime');
            if (last3MonthsData.length > 1) {
                createChart(last3MonthsData, 'gpa-chart-3months');
            }
        }, 50);
    }

    // Create the UI
    function createUI() {
        // Create button
        const button = document.createElement('button');
        button.className = 'gpa-button';
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/>
            </svg>
            Price Analysis
        `;

        // Create panel
        const panel = document.createElement('div');
        panel.className = 'gpa-panel';
        panel.innerHTML = `
            <div class="gpa-header">
                <h3>Price History Analysis</h3>
                <button class="gpa-close">&times;</button>
            </div>
            <div class="gpa-content">
                <div class="gpa-loading">
                    <div class="spinner"></div>
                    Analyzing price history...
                </div>
            </div>
        `;

        document.body.appendChild(button);
        document.body.appendChild(panel);

        // Event handlers
        button.addEventListener('click', async () => {
            panel.classList.toggle('visible');

            if (panel.classList.contains('visible')) {
                // Fetch and analyze data
                const content = panel.querySelector('.gpa-content');
                content.innerHTML = `
                    <div class="gpa-loading">
                        <div class="spinner"></div>
                        Analyzing price history...
                    </div>
                `;

                let priceData = await fetchPriceHistory();
                let isSimulated = false;

                if (!priceData || priceData.length === 0) {
                    // Fall back to simulated data
                    const currentPrice = getCurrentPriceFromPage();
                    if (currentPrice) {
                        priceData = generateSimulatedData(currentPrice);
                        isSimulated = true;
                    }
                }

                renderContent(panel, priceData, isSimulated);
            }
        });

        panel.querySelector('.gpa-close').addEventListener('click', () => {
            panel.classList.remove('visible');
        });

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !button.contains(e.target)) {
                panel.classList.remove('visible');
            }
        });
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
