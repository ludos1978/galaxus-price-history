# Galaxus Price Analyzer

Analyze price history on Galaxus/Digitec product pages - shows average, median, standard deviation, and visual charts for price development.

## Features

- **Statistical Analysis**: Current price, average, median, min, max, standard deviation
- **Visual Charts**: SVG-based price history graphs (all-time and last 3 months)
- **Buy Recommendation**: Intelligent advice based on price position relative to historical data
- **Trend Indicator**: Shows if prices are rising or falling
- **Works on**: galaxus.ch, galaxus.de, digitec.ch

## Technology Options

### Comparison Table

| Option | Installation Effort | Distribution Effort | Power/Features | Best For |
|--------|-------------------|-------------------|----------------|----------|
| **Userscript** | Low (needs Tampermonkey) | Very Easy | High | Most users |
| **Browser Extension** | Very Low | Medium (store approval) | Highest | Wide distribution |
| **Bookmarklet** | None | Very Easy | Limited | Quick testing |

### Recommended: Userscript (via Tampermonkey/Greasemonkey)

**Best balance of power and easy distribution.**

#### For Users:
1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge/Firefox/Safari)
2. Click the raw userscript file or drag it to the browser
3. Tampermonkey will prompt to install - click "Install"
4. Done! Visit any Galaxus product page

#### For Distribution:
- Host on [GreasyFork](https://greasyfork.org/) (free, most popular)
- Host on [OpenUserJS](https://openuserjs.org/) (free)
- Share via GitHub (users click "Raw" to install)
- Share direct link: `https://raw.githubusercontent.com/YOUR_USER/galaxus-price-history/main/galaxus-price-analyzer.user.js`

### Alternative: Browser Extension

**Most seamless user experience, but requires store submission.**

#### Chrome Web Store
1. One-time $5 registration fee
2. Submit extension for review (1-3 days)
3. Users install with one click from store

#### Firefox Add-ons
1. Free to publish
2. Submit for review
3. Usually faster approval than Chrome

#### Local Installation (for testing/personal use)
1. Chrome: Go to `chrome://extensions/`, enable Developer Mode, click "Load unpacked", select the `extension` folder
2. Firefox: Go to `about:debugging`, click "Load Temporary Add-on", select `manifest.json`

### Simplest: Bookmarklet

**Zero installation, but limited by browser security policies (CSP).**

Create a bookmark with this URL (minified version):
```javascript
javascript:(function(){/* See bookmarklet.js for full code */})();
```

**Limitations:**
- May be blocked by Content Security Policy (CSP)
- Cannot make cross-origin requests
- Limited UI capabilities
- No persistent storage

## Installation

### Option 1: Userscript (Recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser
2. [Click here to install the userscript](galaxus-price-analyzer.user.js) (or open the raw file)
3. Visit any Galaxus/Digitec product page
4. Click the "Price Analysis" button in the bottom-right corner

### Option 2: Browser Extension

#### Chrome/Edge (Developer Mode)
```bash
1. Download/clone this repository
2. Open chrome://extensions/
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the 'extension' folder
```

#### Firefox (Temporary)
```bash
1. Download/clone this repository
2. Open about:debugging
3. Click "This Firefox" > "Load Temporary Add-on"
4. Select extension/manifest.json
```

## Usage

1. Navigate to any product page on:
   - https://www.galaxus.ch/
   - https://www.galaxus.de/
   - https://www.digitec.ch/

2. Click the **"Price Analysis"** button (bottom-right corner)

3. View:
   - Current price vs. historical average
   - Price position (where current price sits in the historical range)
   - Trend direction
   - All-time and 3-month price charts
   - Buy/wait recommendation

## How It Works

The tool attempts to extract price history data through multiple methods:

1. **Page-embedded JSON**: Searches for price history data in the page's script tags
2. **SVG Chart Parsing**: Extracts data points from visible price charts
3. **GraphQL API**: Attempts to query Galaxus's internal API
4. **Fallback**: If no historical data is available, generates estimated data based on current price (clearly marked as estimated)

### Statistics Calculated

| Metric | Description |
|--------|-------------|
| **Average (Mean)** | Sum of all prices divided by count |
| **Median** | Middle value when prices are sorted |
| **Std. Deviation** | Measure of price volatility |
| **Min/Max** | Lowest and highest recorded prices |
| **Price Position** | Where current price sits in the range (0-100%) |
| **Trend** | Recent price direction based on last 3 data points |

## Distribution Options for Sharing

### Easiest: GreasyFork

1. Create account at [greasyfork.org](https://greasyfork.org/)
2. Click "Post a script"
3. Paste the userscript code
4. Share your script URL

Users just need Tampermonkey installed, then one-click install.

### GitHub Pages

Host the userscript and create an install page:

```html
<!-- install.html -->
<a href="galaxus-price-analyzer.user.js">Click to Install</a>
```

### Chrome Web Store (for wide reach)

1. Pay $5 one-time developer fee
2. Zip the `extension` folder
3. Upload at [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Fill in listing details
5. Submit for review

### Firefox Add-ons (free)

1. Zip the `extension` folder
2. Submit at [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
3. Fill in listing details
4. Submit for review

## Building

Build scripts are provided for one-command builds on macOS, Linux, and Windows.

### Prerequisites

- **macOS/Linux**: `zip` command (pre-installed on most systems)
- **Windows**: PowerShell 5.0+ (pre-installed on Windows 10/11)

### One-Command Build

#### macOS / Linux
```bash
# Make the script executable (first time only)
chmod +x build.sh

# Run the build
./build.sh
```

#### Windows (PowerShell)
```powershell
# Run the build script
.\build.ps1
```

#### Windows (Command Prompt)
```cmd
# Double-click build.bat or run:
build.bat
```

### Build Output

After running the build, you'll find the following in the `dist/` folder:

| File | Purpose |
|------|---------|
| `galaxus-price-analyzer-chrome-v*.zip` | Upload to Chrome Web Store |
| `galaxus-price-analyzer-firefox-v*.zip` | Upload to Firefox Add-ons |
| `galaxus-price-analyzer.user.js` | Upload to GreasyFork or share directly |

### Version Bumping

To release a new version:

1. Update the version in `extension/manifest.json`
2. Update the version in `galaxus-price-analyzer.user.js` (line with `@version`)
3. Run the build script
4. Upload the new files to the respective stores

## Project Structure

```
galaxus-price-history/
├── README.md
├── galaxus-price-analyzer.user.js    # Userscript (Tampermonkey)
├── build.sh                          # Build script (macOS/Linux)
├── build.ps1                         # Build script (Windows PowerShell)
├── build.bat                         # Build script (Windows CMD wrapper)
├── extension/                        # Browser extension
│   ├── manifest.json                 # Extension manifest (MV3)
│   ├── content.js                    # Content script
│   ├── styles.css                    # Styles
│   └── icons/
│       └── icon.svg                  # Extension icon
└── dist/                             # Build output (created by build script)
    ├── galaxus-price-analyzer-chrome-v*.zip
    ├── galaxus-price-analyzer-firefox-v*.zip
    └── galaxus-price-analyzer.user.js
```

## Technical Notes

- Uses Manifest V3 for the browser extension (Chrome requirement)
- Pure JavaScript, no external dependencies
- SVG-based charts (no canvas or chart libraries needed)
- Respects same-origin policy; uses available APIs

## Privacy

- No data is sent to external servers
- All processing happens locally in your browser
- No tracking or analytics

## License

MIT License - Free to use, modify, and distribute.

## Credits

Inspired by the need for better price transparency when shopping on Galaxus/Digitec.

**Note:** This tool is not affiliated with Digitec Galaxus AG.

## Related Projects

- [fredj/dg-price-tracker](https://github.com/fredj/dg-price-tracker) - Price tracker for Digitec/Galaxus
- [Firefox Price Tracker Extension](https://addons.mozilla.org/en-US/firefox/addon/price-tracker-digitec-galaxus/)
