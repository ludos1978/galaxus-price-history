#!/bin/bash
# Build script for Galaxus Price Analyzer
# Works on macOS and Linux

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/dist"
EXT_DIR="$SCRIPT_DIR/extension"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Galaxus Price Analyzer - Build Tool  ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Create dist directory
mkdir -p "$BUILD_DIR"

# Get version from manifest.json
VERSION=$(grep -o '"version": *"[^"]*"' "$EXT_DIR/manifest.json" | grep -o '[0-9]\.[0-9]\.[0-9]')
echo -e "${YELLOW}Building version: ${VERSION}${NC}"
echo ""

# Build Chrome extension (zip)
echo -e "📦 Building Chrome extension..."
CHROME_ZIP="$BUILD_DIR/galaxus-price-analyzer-chrome-v${VERSION}.zip"
rm -f "$CHROME_ZIP"
cd "$EXT_DIR"
zip -r "$CHROME_ZIP" . -x "*.DS_Store" -x "__MACOSX/*" > /dev/null
cd "$SCRIPT_DIR"
echo -e "${GREEN}   ✓ Created: dist/galaxus-price-analyzer-chrome-v${VERSION}.zip${NC}"

# Build Firefox extension (zip with different name)
echo -e "📦 Building Firefox extension..."
FIREFOX_ZIP="$BUILD_DIR/galaxus-price-analyzer-firefox-v${VERSION}.zip"
rm -f "$FIREFOX_ZIP"
cd "$EXT_DIR"
zip -r "$FIREFOX_ZIP" . -x "*.DS_Store" -x "__MACOSX/*" > /dev/null
cd "$SCRIPT_DIR"
echo -e "${GREEN}   ✓ Created: dist/galaxus-price-analyzer-firefox-v${VERSION}.zip${NC}"

# Copy userscript to dist
echo -e "📄 Copying userscript..."
cp "$SCRIPT_DIR/galaxus-price-analyzer.user.js" "$BUILD_DIR/"
echo -e "${GREEN}   ✓ Copied: dist/galaxus-price-analyzer.user.js${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build complete!                      ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Output files in dist/:"
ls -la "$BUILD_DIR"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  Chrome Web Store: Upload dist/galaxus-price-analyzer-chrome-v${VERSION}.zip"
echo "  Firefox Add-ons:  Upload dist/galaxus-price-analyzer-firefox-v${VERSION}.zip"
echo "  GreasyFork:       Upload dist/galaxus-price-analyzer.user.js"
