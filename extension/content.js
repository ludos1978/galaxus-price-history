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

    // Fetch price history data from the page
    async function fetchPriceHistory() {
        const scripts = document.querySelectorAll('script');
        let priceData = null;

        for (const script of scripts) {
            const content = script.textContent;
            if (content && (content.includes('priceHistory') || content.includes('PriceHistory'))) {
                try {
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

        if (!priceData) {
            priceData = extractPriceFromChart();
        }

        if (!priceData) {
            priceData = await fetchFromGraphQL();
        }

        return priceData;
    }

    function extractPriceFromChart() {
        const priceSection = document.querySelector('[data-test="pdp-price-development"]') ||
                            document.querySelector('[class*="PriceDevelopment"]') ||
                            document.querySelector('[class*="priceHistory"]');

        if (!priceSection) {
            const svgChart = document.querySelector('svg[class*="chart"], svg[class*="price"]');
            if (svgChart) {
                return extractFromSVG(svgChart);
            }
            return null;
        }

        return null;
    }

    function extractFromSVG(svg) {
        const paths = svg.querySelectorAll('path[d]');
        const points = [];

        for (const path of paths) {
            const d = path.getAttribute('d');
            if (d && d.includes('L')) {
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

    async function fetchFromGraphQL() {
        const productId = getProductId();
        if (!productId) return null;

        const graphqlEndpoint = `https://${getSiteDomain()}/api/graphql`;

        try {
            const response = await fetch(graphqlEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `
                        query GetPriceHistory($productId: Int!) {
                            product(id: $productId) {
                                priceHistory { date price }
                            }
                        }
                    `,
                    variables: { productId: parseInt(productId) }
                })
            });

            const data = await response.json();
            return data.data?.product?.priceHistory || null;
        } catch (e) {
            return null;
        }
    }

    function getCurrentPriceFromPage() {
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

    function generateSimulatedData(currentPrice, months = 12) {
        const data = [];
        const now = new Date();

        for (let i = months; i >= 0; i--) {
            const date = new Date(now);
            date.setMonth(date.getMonth() - i);

            const variation = (Math.random() - 0.5) * 0.3;
            const price = currentPrice * (1 + variation);

            data.push({
                date: date.toISOString().split('T')[0],
                price: Math.round(price * 100) / 100,
                simulated: true
            });
        }

        data[data.length - 1].price = currentPrice;
        data[data.length - 1].simulated = false;

        return data;
    }

    function calculateStats(prices) {
        if (!prices || prices.length === 0) return null;

        const values = prices.map(p => typeof p === 'object' ? p.price : p);
        const n = values.length;

        const mean = values.reduce((a, b) => a + b, 0) / n;

        const sorted = [...values].sort((a, b) => a - b);
        const median = n % 2 === 0
            ? (sorted[n/2 - 1] + sorted[n/2]) / 2
            : sorted[Math.floor(n/2)];

        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
        const stdDev = Math.sqrt(avgSquaredDiff);

        const min = Math.min(...values);
        const max = Math.max(...values);
        const current = values[values.length - 1];
        const pricePosition = ((current - min) / (max - min)) * 100;

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

    function filterLast3Months(data) {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        return data.filter(item => {
            const itemDate = new Date(item.date);
            return itemDate >= threeMonthsAgo;
        });
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

        const formatCHF = (val) => `CHF ${val.toFixed(0)}`;

        const svg = `
            <svg width="${width}" height="${height}" class="gpa-chart">
                <defs>
                    <linearGradient id="areaGradient${containerId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#1a1a2e" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="#1a1a2e" stop-opacity="0.05"/>
                    </linearGradient>
                </defs>
                <line x1="${padding.left}" y1="${yScale(maxPrice)}" x2="${width - padding.right}" y2="${yScale(maxPrice)}" stroke="#eee" stroke-dasharray="2"/>
                <line x1="${padding.left}" y1="${yScale((maxPrice + minPrice) / 2)}" x2="${width - padding.right}" y2="${yScale((maxPrice + minPrice) / 2)}" stroke="#eee" stroke-dasharray="2"/>
                <line x1="${padding.left}" y1="${yScale(minPrice)}" x2="${width - padding.right}" y2="${yScale(minPrice)}" stroke="#eee" stroke-dasharray="2"/>
                <text x="${padding.left - 5}" y="${yScale(maxPrice) + 4}" text-anchor="end" font-size="10" fill="#888">${formatCHF(maxPrice)}</text>
                <text x="${padding.left - 5}" y="${yScale(minPrice) + 4}" text-anchor="end" font-size="10" fill="#888">${formatCHF(minPrice)}</text>
                <path d="${areaD}" fill="url(#areaGradient${containerId})"/>
                <path d="${pathD}" fill="none" stroke="#1a1a2e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="${xScale(data.length - 1)}" cy="${yScale(data[data.length - 1].price)}" r="4" fill="#1a1a2e"/>
                <text x="${xScale(0)}" y="${height - 5}" text-anchor="start" font-size="10" fill="#888">${data[0].date.substring(5)}</text>
                <text x="${xScale(data.length - 1)}" y="${height - 5}" text-anchor="end" font-size="10" fill="#888">${data[data.length - 1].date.substring(5)}</text>
            </svg>
        `;

        container.innerHTML = svg;
    }

    function getRecommendation(stats) {
        const currentVsAvg = ((stats.current - stats.mean) / stats.mean) * 100;
        const position = stats.pricePosition;

        if (currentVsAvg <= -10) {
            return { type: 'good', text: `Great price! Currently ${Math.abs(currentVsAvg).toFixed(1)}% below average. This is in the lower ${position}% of the price range.` };
        } else if (currentVsAvg <= -5) {
            return { type: 'decent', text: `Good price - ${Math.abs(currentVsAvg).toFixed(1)}% below average. Reasonable time to buy.` };
        } else if (currentVsAvg >= 10) {
            return { type: 'wait', text: `Price is ${currentVsAvg.toFixed(1)}% above average. Consider waiting for a better deal.` };
        } else if (currentVsAvg >= 5) {
            return { type: 'caution', text: `Slightly above average (+${currentVsAvg.toFixed(1)}%). The price has been lower before.` };
        } else {
            return { type: 'neutral', text: `Price is near average (${currentVsAvg >= 0 ? '+' : ''}${currentVsAvg.toFixed(1)}%). Normal market price.` };
        }
    }

    function renderContent(panel, data, isSimulated) {
        const content = panel.querySelector('.gpa-content');

        if (!data || data.length === 0) {
            content.innerHTML = `<div class="gpa-no-data">No price history data available for this product.</div>`;
            return;
        }

        const allTimeStats = calculateStats(data);
        const last3MonthsData = filterLast3Months(data);
        const last3MonthsStats = last3MonthsData.length > 1 ? calculateStats(last3MonthsData) : allTimeStats;

        const recommendation = getRecommendation(last3MonthsStats);
        const trendIcon = allTimeStats.trend > 0 ? '&#8593;' : allTimeStats.trend < 0 ? '&#8595;' : '&#8594;';
        const trendClass = allTimeStats.trend > 0 ? 'warning' : allTimeStats.trend < 0 ? 'highlight' : '';
        const statClass = allTimeStats.pricePosition < 30 ? 'highlight' : allTimeStats.pricePosition > 70 ? 'warning' : '';

        content.innerHTML = `
            ${isSimulated ? `<div class="gpa-no-data" style="margin-bottom: 15px; background: #e3f2fd; color: #1565c0;">Note: Using estimated data. Real price history requires page-embedded data.</div>` : ''}
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/></svg>
                All-Time Price History
            </div>
            <div class="gpa-chart-container"><div id="gpa-chart-alltime"></div></div>
            ${last3MonthsData.length > 1 ? `
                <div class="gpa-section-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
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
                      recommendation.type === 'caution' ? '&#9888; Above Average' : '&#8594; Average Price'}
                </div>
                <div class="gpa-recommendation-text">${recommendation.text}</div>
            </div>
        `;

        setTimeout(() => {
            createChart(data, 'gpa-chart-alltime');
            if (last3MonthsData.length > 1) {
                createChart(last3MonthsData, 'gpa-chart-3months');
            }
        }, 50);
    }

    function createUI() {
        const button = document.createElement('button');
        button.className = 'gpa-button';
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/>
            </svg>
            Price Analysis
        `;

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

        button.addEventListener('click', async () => {
            panel.classList.toggle('visible');

            if (panel.classList.contains('visible')) {
                const content = panel.querySelector('.gpa-content');
                content.innerHTML = `<div class="gpa-loading"><div class="spinner"></div>Analyzing price history...</div>`;

                let priceData = await fetchPriceHistory();
                let isSimulated = false;

                if (!priceData || priceData.length === 0) {
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

        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !button.contains(e.target)) {
                panel.classList.remove('visible');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
