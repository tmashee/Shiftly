# Shift Calendar iOS

A new iOS-first shift calendar built from scratch using the scheduling rules from the original Shift-Cal project.

## Files

- `index.html` main app shell
- `styles.css` iOS-first responsive styling
- `app.js` independent shift calculation and UI logic
- `manifest.json` installable PWA metadata
- `sw.js` offline app shell cache
- `icon.svg` app icon

## Schedule logic

Intel uses the two existing 56-day pattern arrays with a July 1 reset and a 28-day day/night switch.

Pfizer uses the existing 28-day cycle anchored on June 30, 2025, with its alternating day/night halves.

Crèche appears Monday, Tuesday and Thursday from September 1 of each year.

## Run locally

Serve the folder with any static web server. A PWA service worker requires HTTPS or localhost.

Example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` on the iPhone or in Safari.
