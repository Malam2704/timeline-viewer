# Google Maps Timeline Viewer

A local web app to visualize your Google Location History data.

## Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/timeline-viewer.git
   cd timeline-viewer
   ```

2. Get your location data:
   - Open Google Maps on your phone
   - Go to Settings → Your data in Maps
   - Tap "Download your Maps data"
   - Select "Location History" and choose JSON format
   - Download the file (it will be named `Location History.json`)
   - Rename it to `location-history.json` and place it in this directory

3. Open `index.html` in your web browser (you may need to serve it locally for large files)

## Features

- Visualize your location history on an interactive map
- View aggregated data by countries, cities, and places
- See visit durations and frequencies
- Optional reverse geocoding for city/country names

## Privacy

Your location data stays completely local - it's never uploaded or shared. The app runs entirely in your browser.

## Supported Formats

- Google Takeout Location History (timelineObjects)
- Records.json (locations array)
- Device export format (semanticSegments or top-level array)

