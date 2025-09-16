# PoE2 Trade - Path of Exile 2 Trading Assistant

A modern, standalone trading application for Path of Exile 2 that provides real-time trade monitoring, automated hideout travel, and intelligent purchase assistance.

## Features

- **Real-time Trade Monitoring**: Monitor up to 20 concurrent live searches via WebSocket connections
- **Automated Hideout Travel**: Instantly travel to seller hideouts with a single click
- **Computer Vision Purchase Assistance**: Automatically detect and purchase purple-bordered items
- **Modern UI**: Clean, responsive interface with Material Design principles
- **Secure Authentication**: Encrypted storage of POESESSID and cf_clearance cookies
- **Standalone Distribution**: Single executable file with no external dependencies

## Installation

### Prerequisites

**Before running the application, you need to install Python and required packages:**

1. **Install Python 3.8 or higher**:
   - Download from [python.org](https://www.python.org/downloads/)
   - Make sure to check "Add Python to PATH" during installation
   - Verify installation: Open Command Prompt and run `python --version`

2. **Install required Python packages**:
   ```bash
   pip install opencv-python==4.8.1.78 numpy==1.24.3 mss==9.0.1 Pillow==10.0.1 pyautogui==0.9.54
   ```

3. **Verify installation**:
   ```bash
   python -c "import cv2, numpy, mss, PIL, pyautogui; print('All packages installed successfully!')"
   ```

### Application Installation

1. Download the latest release from the [Releases](https://github.com/your-repo/poe2-trade/releases) page
2. Choose your preferred version:
   - **`PoE2 Trade Setup 1.0.0.exe`** - Windows installer (recommended for most users)
   - **`PoE2 Trade 1.0.0.exe`** - Portable version (no installation required)
3. Run the executable and configure your authentication credentials

## Quick Start

1. **Authentication Setup**:
   - Click the "Auth" button in the header
   - Enter your POESESSID and cf_clearance cookie values
   - These can be found in your browser's developer tools

2. **Add Live Search**:
   - Click "Add Search" in the sidebar
   - Enter a search name, select league, and paste your search ID from the PoE website
   - Configure auto-travel and auto-purchase options

3. **Start Trading**:
   - Click "Connect" on your search to start monitoring
   - Items will appear in real-time in the results area
   - Use "Travel" to go to hideouts or "Purchase" for automated buying

## Configuration

### Authentication
- **POESESSID**: Your session cookie from pathofexile.com
- **cf_clearance**: Cloudflare clearance token

### Computer Vision Settings
- **Detection Window**: Define the area to monitor for items
- **Confidence Threshold**: Minimum confidence for item detection (default: 94%)
- **Detection Timeout**: Maximum time to search for items (default: 15 seconds)

### Automation Settings
- **Mouse Speed**: Control cursor movement speed
- **Click Modifiers**: Keys to hold during clicks (default: Ctrl)
- **Refresh Key**: Key to press after purchase (default: F5)

## API Integration

The application integrates with Path of Exile 2's trading APIs:

- **WebSocket Endpoint**: `wss://www.pathofexile.com/api/trade2/live/poe2/{league}/{searchId}`
- **Travel API**: `https://www.pathofexile.com/api/trade2/whisper`
- **Rate Limiting**: 1 request per second for travel API

## Computer Vision Algorithm

The item detection system uses OpenCV to identify purple-bordered items:

1. **Screen Capture**: Captures the configured merchant window region
2. **Color Detection**: Converts to HSV and detects purple color range (120-180 hue)
3. **Contour Analysis**: Finds square/rectangular borders with proper aspect ratios
4. **Confidence Scoring**: Only items with >94% confidence are selected
5. **Single Item**: Only the highest confidence item is purchased

## Security & Privacy

- All authentication credentials are encrypted at rest
- No data is sent to external servers except PoE's official APIs
- Configuration is stored locally in the application directory
- Browser-like headers are used to avoid detection

## Troubleshooting

### Python Issues
- **"spawn python ENOENT" error**: Python is not installed or not in PATH
  - Install Python 3.8+ from [python.org](https://www.python.org/downloads/)
  - Make sure to check "Add Python to PATH" during installation
  - Restart Command Prompt and verify with `python --version`
- **"Module not found" errors**: Required Python packages are missing
  - Run: `pip install opencv-python==4.8.1.78 numpy==1.24.3 mss==9.0.1 Pillow==10.0.1 pyautogui==0.9.54`
  - If pip is not found, try `python -m pip install` instead

### Connection Issues
- Verify your POESESSID and cf_clearance are current
- Check that you're not rate-limited (wait 1 second between travel requests)
- Ensure your firewall allows the application to connect

### Computer Vision Issues
- Adjust the detection window to match your merchant window
- Increase confidence threshold if getting false positives
- Ensure the merchant window is visible and not minimized
- If CV detection fails, check that Python packages are installed correctly

### Performance Issues
- Reduce the number of concurrent searches
- Increase detection interval for computer vision
- Close other applications to free up system resources

## Development

### Prerequisites
- Node.js 18+
- Python 3.8+
- Git

### Setup
```bash
git clone https://github.com/your-repo/poe2-trade.git
cd poe2-trade
npm install
pip install -r python/requirements.txt
```

### Development Mode
```bash
npm run dev
```

### Building
```bash
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Disclaimer

This application is not affiliated with Grinding Gear Games. Use at your own risk and in accordance with Path of Exile's Terms of Service.
