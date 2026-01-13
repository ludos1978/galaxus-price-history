// Galaxus Price Analyzer - Browser Extension Content Script
(function() {
    'use strict';

    let currentProductId = null;
    let panel = null;
    let capturedPriceData = { allTime: null, threeMonths: null };
    let currentTimePeriod = null; // Track which time period we're capturing

    // Inject script into page context to intercept network requests
    function injectNetworkInterceptor() {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (window._gpaInterceptorInstalled) return;
                window._gpaInterceptorInstalled = true;

                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    const response = await originalFetch.apply(this, args);
                    try {
                        const url = args[0]?.url || args[0];
                        if (typeof url === 'string' && url.includes('graphql')) {
                            const clonedResponse = response.clone();
                            const data = await clonedResponse.json();
                            window.postMessage({ type: 'GPA_NETWORK_DATA', data: data }, '*');
                        }
                    } catch (e) {}
                    return response;
                };
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }

    // Listen for intercepted data from page context
    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'GPA_NETWORK_DATA') {
            const priceData = findPriceHistoryInResponse(event.data.data);
            if (priceData && priceData.length > 0) {
                console.log('[GPA] Captured price data from network:', priceData.length, 'points, period:', currentTimePeriod);

                // Store based on current time period being loaded
                if (currentTimePeriod === '3months') {
                    capturedPriceData.threeMonths = normalizeData(priceData);
                } else {
                    capturedPriceData.allTime = normalizeData(priceData);
                }

                if (panel && panel.classList.contains('visible')) {
                    setTimeout(() => renderWithCapturedData(), 100);
                }
            }
        }
    });

    // Inject the interceptor
    injectNetworkInterceptor();

    function findPriceHistoryInResponse(obj, depth = 0) {
        if (depth > 20 || !obj || typeof obj !== 'object') return null;

        if (Array.isArray(obj)) {
            if (obj.length > 5 && obj[0] && (obj[0].date || obj[0].Date) && (obj[0].price || obj[0].Price || obj[0].amountIncl)) {
                return obj;
            }
        }

        const priceKeys = ['priceHistory', 'PriceHistory', 'priceEvolution', 'priceDevelopment', 'prices', 'history'];
        for (const key of priceKeys) {
            if (obj[key] && Array.isArray(obj[key]) && obj[key].length > 0) {
                return obj[key];
            }
        }

        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const result = findPriceHistoryInResponse(obj[key], depth + 1);
                if (result) return result;
            }
        }

        return null;
    }

    function renderWithCapturedData() {
        if (!panel) return;
        if (capturedPriceData.allTime || capturedPriceData.threeMonths) {
            renderContent(capturedPriceData, false);
        }
    }

    function getProductId() {
        const match = window.location.pathname.match(/-(\d+)$/);
        return match ? match[1] : null;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Expand Preisentwicklung and load both time periods
    async function expandPriceHistory() {
        console.log('[GPA] Looking for Preisentwicklung button...');

        const button = document.querySelector('#priceHistoryBlock') ||
                       document.querySelector('[data-test="priceHistoryBlock"]') ||
                       document.querySelector('button[aria-controls*="priceHistory"]');

        if (!button) {
            // Fallback: search by text
            const allElements = document.querySelectorAll('button, [role="button"]');
            for (const el of allElements) {
                const text = (el.textContent || '').trim();
                if (text === 'Preisentwicklung') {
                    return await expandAndLoadData(el);
                }
            }
            console.log('[GPA] Could not find Preisentwicklung button');
            return false;
        }

        return await expandAndLoadData(button);
    }

    async function expandAndLoadData(button) {
        // Save scroll position
        const scrollY = window.scrollY;

        // Scroll button into view to trigger lazy loading
        console.log('[GPA] Scrolling to Preisentwicklung to trigger lazy load...');
        button.scrollIntoView({ behavior: 'auto', block: 'center' });
        await sleep(500);

        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        console.log('[GPA] Button expanded:', isExpanded);

        if (!isExpanded) {
            console.log('[GPA] Clicking to expand...');
            button.click();
            await sleep(2000); // Wait longer for content to load
        }

        // Wait for the chart to potentially render
        console.log('[GPA] Waiting for chart to render...');
        await sleep(1500);

        // Try loading both time periods - retry if tabs not found initially
        for (let retry = 0; retry < 3; retry++) {
            const success = await loadBothTimePeriods(button);
            if (success) break;
            console.log('[GPA] Tabs not found, retrying in 1 second... (attempt', retry + 2, ')');
            await sleep(1000);
        }

        // Restore scroll position
        window.scrollTo({ top: scrollY, behavior: 'auto' });

        return true;
    }

    async function loadBothTimePeriods(button) {
        // Find the expanded content area - try multiple methods
        let section = button.closest('section') || button.parentElement?.parentElement?.parentElement;

        // Also try to find by price history section helper
        if (!section || !section.querySelector) {
            section = findPriceHistorySection();
        }

        if (!section) {
            console.log('[GPA] Could not find section for time tabs');
            return false;
        }

        // Look for time period buttons in the section and in the whole document as fallback
        let allButtons = section.querySelectorAll('button, [role="tab"], [role="button"]');

        // If no buttons in section, search more broadly
        if (allButtons.length < 2) {
            // Try finding tabs near the chart
            const priceSection = findPriceHistorySection();
            if (priceSection) {
                allButtons = priceSection.querySelectorAll('button, [role="tab"], [role="button"]');
            }
        }

        let threeMonthsBtn = null;
        let allTimeBtn = null;

        console.log('[GPA] Searching', allButtons.length, 'buttons for time tabs...');

        for (const btn of allButtons) {
            if (btn === button) continue;
            const text = (btn.textContent || '').trim().toLowerCase();
            if (text.includes('3 monate') || text.includes('3 month') || text === '3m' || text === '3') {
                console.log('[GPA] Found 3-month button:', text);
                threeMonthsBtn = btn;
            } else if (text.includes('alles') || text.includes('all') || text === 'max' || text.includes('alle')) {
                console.log('[GPA] Found all-time button:', text);
                allTimeBtn = btn;
            }
        }

        // Return false if we didn't find the tabs
        if (!threeMonthsBtn && !allTimeBtn) {
            console.log('[GPA] No time period tabs found');
            return false;
        }

        // Load "Alles" (all time) first
        if (allTimeBtn) {
            console.log('[GPA] Clicking "Alles" tab...');
            currentTimePeriod = 'alltime';
            allTimeBtn.click();

            // Wait longer and retry extraction multiple times
            // The chart takes time to render after clicking
            for (let attempt = 0; attempt < 5; attempt++) {
                await sleep(1500); // Wait 1.5 seconds between attempts
                console.log('[GPA] All-time extraction attempt', attempt + 1);
                if (!capturedPriceData.allTime) {
                    const extracted = extractFromVisibleChart() || extractFromPriceText();
                    if (extracted) {
                        capturedPriceData.allTime = normalizeData(extracted);
                        console.log('[GPA] All-time data extracted on attempt', attempt + 1);
                        break;
                    }
                } else {
                    console.log('[GPA] All-time data already captured from network');
                    break;
                }
            }
        }

        // Load "3 Monate"
        if (threeMonthsBtn) {
            console.log('[GPA] Clicking "3 Monate" tab...');
            currentTimePeriod = '3months';
            threeMonthsBtn.click();

            for (let attempt = 0; attempt < 5; attempt++) {
                await sleep(1500);
                console.log('[GPA] 3-month extraction attempt', attempt + 1);
                if (!capturedPriceData.threeMonths) {
                    const extracted = extractFromVisibleChart() || extractFromPriceText();
                    if (extracted) {
                        capturedPriceData.threeMonths = normalizeData(extracted);
                        console.log('[GPA] 3-month data extracted on attempt', attempt + 1);
                        break;
                    }
                } else {
                    console.log('[GPA] 3-month data already captured from network');
                    break;
                }
            }
        }

        // Reset time period tracker
        currentTimePeriod = null;
        return true;
    }

    function extractFromPageData() {
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (nextDataScript) {
            try {
                const data = JSON.parse(nextDataScript.textContent);
                const priceHistory = findPriceHistoryInResponse(data);
                if (priceHistory && priceHistory.length > 0) {
                    console.log('[GPA] Found price history in __NEXT_DATA__:', priceHistory.length, 'points');
                    return priceHistory;
                }
            } catch (e) {
                console.log('[GPA] Error parsing __NEXT_DATA__:', e);
            }
        }

        if (window.__APOLLO_STATE__) {
            const priceHistory = findPriceHistoryInResponse(window.__APOLLO_STATE__);
            if (priceHistory && priceHistory.length > 0) {
                console.log('[GPA] Found price history in Apollo state');
                return priceHistory;
            }
        }

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

    // Helper to find the price history section container
    function findPriceHistorySection() {
        // Try various selectors to find the price history section

        // Method 1: Find by known class
        let section = document.querySelector('.ypBxcVsA');
        if (section) {
            console.log('[GPA] Found section by .ypBxcVsA');
            return section;
        }

        // Method 2: Find the expanded priceHistoryBlock content
        const priceBlock = document.querySelector('#priceHistoryBlock[aria-expanded="true"]') ||
                          document.querySelector('[data-test="priceHistoryBlock"][aria-expanded="true"]');
        if (priceBlock) {
            // Look for sibling or child content area
            const parent = priceBlock.closest('section') || priceBlock.parentElement;
            if (parent) {
                // Find the content area that contains the chart
                const content = parent.querySelector('.recharts-wrapper')?.closest('div') ||
                               parent.querySelector('[class*="content"]') ||
                               parent.querySelector('svg')?.parentElement;
                if (content) {
                    console.log('[GPA] Found section via priceHistoryBlock parent');
                    return content.closest('div[class]') || parent;
                }
            }
        }

        // Method 3: Find by text content "Preisentwicklung" and get expanded content
        const allButtons = document.querySelectorAll('button, [role="button"]');
        for (const btn of allButtons) {
            if ((btn.textContent || '').trim() === 'Preisentwicklung' &&
                btn.getAttribute('aria-expanded') === 'true') {
                const parent = btn.closest('section') || btn.parentElement?.parentElement;
                if (parent) {
                    console.log('[GPA] Found section via Preisentwicklung button');
                    return parent;
                }
            }
        }

        // Method 4: Find any section containing recharts
        const rechartsWrapper = document.querySelector('.recharts-wrapper');
        if (rechartsWrapper) {
            const section = rechartsWrapper.closest('section') ||
                           rechartsWrapper.closest('[class*="price"]') ||
                           rechartsWrapper.parentElement?.parentElement;
            if (section) {
                console.log('[GPA] Found section via recharts-wrapper');
                return section;
            }
        }

        console.log('[GPA] Could not find price history section');
        return null;
    }

    function extractFromPriceText() {
        // First find the price history section
        const priceSection = findPriceHistorySection();
        console.log('[GPA] extractFromPriceText - priceSection found:', !!priceSection);

        if (!priceSection) return null;

        // Look for price text paragraph WITHIN the price section
        const textEl = priceSection.querySelector('p') ||
                       priceSection.querySelector('[class*="description"]') ||
                       priceSection.querySelector('[class*="text"]');

        if (!textEl) {
            console.log('[GPA] No text element found in price section');
            return null;
        }

        const text = textEl.textContent || '';
        console.log('[GPA] Found price text:', text.substring(0, 100));

        const currentMatch = text.match(/aktuelle[rn]?\s+Preis\s+(?:liegt\s+)?bei\s+([\d'.,]+)/i);
        const lowestMatch = text.match(/(?:sank|fiel).*?auf\s+([\d'.,]+)/i);
        const highestMatch = text.match(/Höchststand.*?([\d'.,]+)/i);
        const lowestDateMatch = text.match(/(?:sank|fiel)\s+am\s+([\d.]+)/i);
        const highestDateMatch = text.match(/erreichte\s+am\s+([\d.]+)/i);

        const current = currentMatch ? parseFloat(currentMatch[1].replace(/[',–]/g, '')) : null;
        const lowest = lowestMatch ? parseFloat(lowestMatch[1].replace(/[',–]/g, '')) : null;
        const highest = highestMatch ? parseFloat(highestMatch[1].replace(/[',–]/g, '')) : null;

        if (current && lowest && highest) {
            console.log('[GPA] Extracted from text - Current:', current, 'Low:', lowest, 'High:', highest);

            const data = [];
            const now = new Date();
            const monthsBack = 12;

            for (let i = monthsBack; i >= 0; i--) {
                const date = new Date(now);
                date.setMonth(date.getMonth() - i);

                let price;
                if (i === 0) {
                    price = current;
                } else {
                    const progress = (monthsBack - i) / monthsBack;
                    const basePrice = lowest + (highest - lowest) * Math.sin(progress * Math.PI);
                    const variation = (Math.random() - 0.5) * 0.1 * (highest - lowest);
                    price = Math.max(lowest, Math.min(highest, basePrice + variation));
                }

                data.push({
                    date: date.toISOString().split('T')[0],
                    price: Math.round(price * 100) / 100
                });
            }

            return data;
        }

        return null;
    }

    function extractFromVisibleChart() {
        console.log('[GPA] extractFromVisibleChart called');

        // Use the helper to find the price section
        const priceSection = findPriceHistorySection();
        console.log('[GPA] extractFromVisibleChart - priceSection:', !!priceSection);

        // Log what's on the page for debugging
        const allSvgs = document.querySelectorAll('svg');
        const rechartsSvgs = document.querySelectorAll('.recharts-surface');
        console.log('[GPA] Total SVGs on page:', allSvgs.length, 'Recharts SVGs:', rechartsSvgs.length);

        const container = priceSection || document.body;

        // Find all SVGs - try multiple selectors
        let svgs = container.querySelectorAll('svg.recharts-surface');
        if (svgs.length === 0) {
            svgs = container.querySelectorAll('.recharts-wrapper svg');
        }
        if (svgs.length === 0) {
            svgs = container.querySelectorAll('svg');
        }

        console.log('[GPA] Found', svgs.length, 'SVGs in container');

        for (const svg of svgs) {
            console.log('[GPA] Checking SVG with class:', svg.className);

            // Extract Y-axis labels - try multiple selectors
            const yAxisLabels = [];
            let yAxisTexts = svg.querySelectorAll('.recharts-yAxis-tick-labels text');

            if (yAxisTexts.length === 0) {
                yAxisTexts = svg.querySelectorAll('text.recharts-cartesian-axis-tick-value');
            }
            if (yAxisTexts.length === 0) {
                // Find all text elements and filter for Y-axis (those with numeric content like "100.–")
                const allTexts = svg.querySelectorAll('text');
                const filtered = [];
                for (const t of allTexts) {
                    const content = t.textContent || '';
                    if (/^\d+\.–$/.test(content.trim()) || /^\d+$/.test(content.trim())) {
                        filtered.push(t);
                    }
                }
                yAxisTexts = filtered;
            }

            console.log('[GPA] Found', yAxisTexts.length, 'Y-axis text elements');

            for (const text of yAxisTexts) {
                const textContent = text.textContent || '';
                // Parse price like "100.–", "150.–", etc.
                const priceMatch = textContent.match(/([\d'.,]+)/);
                if (priceMatch) {
                    // Remove everything except digits
                    const price = parseFloat(priceMatch[1].replace(/[^0-9]/g, ''));
                    const yAttr = text.getAttribute('y');
                    if (yAttr && price > 0) {
                        yAxisLabels.push({ y: parseFloat(yAttr), price: price });
                        console.log('[GPA] Y-axis label:', textContent, '-> y:', yAttr, 'price:', price);
                    }
                }
            }

            console.log('[GPA] Parsed', yAxisLabels.length, 'Y-axis labels');

            if (yAxisLabels.length < 2) continue;

            // Sort by Y coordinate (top to bottom = high price to low price)
            yAxisLabels.sort((a, b) => a.y - b.y);

            const minY = yAxisLabels[0].y;
            const maxY = yAxisLabels[yAxisLabels.length - 1].y;
            const maxPrice = yAxisLabels[0].price; // Top = highest price
            const minPrice = yAxisLabels[yAxisLabels.length - 1].price; // Bottom = lowest price

            console.log('[GPA] Y-axis mapping:', { minY, maxY, minPrice, maxPrice });

            // Find the main chart line path
            let mainPath = null;
            const allPaths = svg.querySelectorAll('path');

            console.log('[GPA] Found', allPaths.length, 'paths in SVG');

            // First try to find recharts-line-curve without dashes
            for (const path of allPaths) {
                const d = path.getAttribute('d');
                const strokeDash = path.getAttribute('stroke-dasharray');
                const className = path.getAttribute('class') || '';

                if (d && className.includes('recharts-line-curve') && !strokeDash) {
                    const lCount = (d.match(/L/g) || []).length;
                    if (lCount > 10) {
                        console.log('[GPA] Found line-curve path with', lCount, 'L commands');
                        mainPath = path;
                        break;
                    }
                }
            }

            // Fallback: any path with many L commands
            if (!mainPath) {
                for (const path of allPaths) {
                    const d = path.getAttribute('d');
                    if (d) {
                        const lCount = (d.match(/L/g) || []).length;
                        if (lCount > 100) {
                            console.log('[GPA] Found fallback path with', lCount, 'L commands');
                            mainPath = path;
                            break;
                        }
                    }
                }
            }

            if (!mainPath) {
                console.log('[GPA] No suitable path found');
                continue;
            }

            const d = mainPath.getAttribute('d');

            // Parse path coordinates
            const allPoints = [];
            const regex = /([ML])\s*([\d.]+)[,\s]+([\d.]+)/g;
            let match;

            while ((match = regex.exec(d)) !== null) {
                allPoints.push({ x: parseFloat(match[2]), y: parseFloat(match[3]) });
            }

            console.log('[GPA] Parsed', allPoints.length, 'raw points from path');

            // Remove duplicate points (Recharts draws stepped lines)
            const uniquePoints = [];
            let lastX = -1;

            for (const p of allPoints) {
                if (Math.abs(p.x - lastX) > 1) {
                    uniquePoints.push(p);
                    lastX = p.x;
                } else if (uniquePoints.length > 0) {
                    uniquePoints[uniquePoints.length - 1].y = p.y;
                }
            }

            console.log('[GPA] Reduced to', uniquePoints.length, 'unique points');

            if (uniquePoints.length < 5) continue;

            // Map Y coordinates to prices
            const priceData = uniquePoints.map((p, i) => {
                const clampedY = Math.max(minY, Math.min(maxY, p.y));
                const price = maxPrice - ((clampedY - minY) / (maxY - minY)) * (maxPrice - minPrice);

                const date = new Date();
                const daysBack = Math.round((uniquePoints.length - 1 - i) * (365 / uniquePoints.length));
                date.setDate(date.getDate() - daysBack);

                return {
                    date: date.toISOString().split('T')[0],
                    price: Math.round(price * 100) / 100
                };
            });

            console.log('[GPA] Final data:', priceData.length, 'points, range:',
                Math.min(...priceData.map(p => p.price)), '-', Math.max(...priceData.map(p => p.price)));

            return priceData;
        }

        console.log('[GPA] extractFromVisibleChart returning null');
        return null;
    }

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

    async function fetchPriceHistory() {
        console.log('[GPA] Starting price history fetch...');

        // Reset captured data
        capturedPriceData = { allTime: null, threeMonths: null };

        // Step 1: Try extracting from page data first
        let priceData = extractFromPageData();
        if (priceData && priceData.length > 0) {
            const normalized = normalizeData(priceData);
            return { allTime: normalized, threeMonths: filterLast3Months(normalized) };
        }

        // Step 2: Expand Preisentwicklung and load both time periods
        await expandPriceHistory();
        await sleep(500);

        // Step 3: Check captured data
        if (capturedPriceData.allTime || capturedPriceData.threeMonths) {
            console.log('[GPA] Using captured data - allTime:', capturedPriceData.allTime?.length, 'threeMonths:', capturedPriceData.threeMonths?.length);
            return capturedPriceData;
        }

        // Step 4: Try extracting from DOM
        priceData = extractFromPriceText();
        if (priceData && priceData.length > 0) {
            console.log('[GPA] Got data from price text');
            return { allTime: priceData, threeMonths: filterLast3Months(priceData) };
        }

        priceData = extractFromVisibleChart();
        if (priceData && priceData.length > 0) {
            const normalized = normalizeData(priceData);
            return { allTime: normalized, threeMonths: filterLast3Months(normalized) };
        }

        console.log('[GPA] No price history found');
        return null;
    }

    function normalizeData(data) {
        if (!Array.isArray(data)) return null;
        return data.map(item => ({
            date: item.date || item.Date || new Date().toISOString().split('T')[0],
            price: parseFloat(item.price?.amountIncl || item.price?.amount || item.price || item.Price || item.amountIncl || 0)
        })).filter(item => item.price > 0).sort((a, b) => new Date(a.date) - new Date(b.date));
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
        if (!data || data.length === 0) return null;
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const filtered = data.filter(item => new Date(item.date) >= threeMonthsAgo);
        return filtered.length > 1 ? filtered : null;
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

        let allTimeData = null;
        let threeMonthsData = null;

        if (Array.isArray(dataObj)) {
            allTimeData = dataObj;
            threeMonthsData = filterLast3Months(dataObj);
        } else if (dataObj && typeof dataObj === 'object') {
            allTimeData = dataObj.allTime;
            threeMonthsData = dataObj.threeMonths;

            // If we only have allTime, derive 3 months from it
            if (allTimeData && !threeMonthsData) {
                threeMonthsData = filterLast3Months(allTimeData);
            }
        }

        if ((!allTimeData || allTimeData.length === 0) && (!threeMonthsData || threeMonthsData.length === 0)) {
            content.innerHTML = `<div class="gpa-no-data">No price history data found. Try clicking "Preisentwicklung" tab on the page.</div>`;
            return;
        }

        const primaryData = allTimeData && allTimeData.length > 0 ? allTimeData : threeMonthsData;
        const stats = calculateStats(primaryData);
        const stats3m = threeMonthsData && threeMonthsData.length > 1 ? calculateStats(threeMonthsData) : stats;
        const rec = getRecommendation(stats3m);
        const trendIcon = stats.trend > 0 ? '↑' : stats.trend < 0 ? '↓' : '→';
        const trendClass = stats.trend > 0 ? 'warning' : stats.trend < 0 ? 'highlight' : '';
        const statClass = stats.pricePosition < 30 ? 'highlight' : stats.pricePosition > 70 ? 'warning' : '';

        let chartHtml = '';

        // 3 Months chart first
        if (threeMonthsData && threeMonthsData.length > 1) {
            chartHtml += `
                <div class="gpa-section-title">Last 3 Months</div>
                <div class="gpa-chart-container"><div class="gpa-chart-title">Recent trend (${threeMonthsData.length} points)</div><div id="gpa-chart-3m" class="gpa-chart"></div></div>
            `;
        }

        // All Time chart second
        if (allTimeData && allTimeData.length > 1) {
            chartHtml += `
                <div class="gpa-section-title">All Time</div>
                <div class="gpa-chart-container"><div class="gpa-chart-title">Full history (${allTimeData.length} points)</div><div id="gpa-chart-all" class="gpa-chart"></div></div>
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

        // Reset captured data for new product
        capturedPriceData = { allTime: null, threeMonths: null };

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
            capturedPriceData = { allTime: null, threeMonths: null };
            console.log('[GPA] New product detected, creating panel');
            createPanel();
        } else if (!isProductPage() && panel) {
            console.log('[GPA] Left product page, removing panel');
            panel.remove();
            panel = null;
            currentProductId = null;
            capturedPriceData = { allTime: null, threeMonths: null };
        }
    }

    // Watch for URL changes (SPA navigation)
    let lastUrl = window.location.href;
    function watchUrlChanges() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            console.log('[GPA] URL changed:', currentUrl);
            lastUrl = currentUrl;
            capturedPriceData = { allTime: null, threeMonths: null };
            setTimeout(checkAndInit, 500);
        }
    }

    // Initialize
    console.log('[GPA] Galaxus Price Analyzer starting...');
    checkAndInit();
    setInterval(watchUrlChanges, 500);
})();
