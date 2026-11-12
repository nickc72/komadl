# KomaDL — Local gallery-dl Archive & Wide Manga Reader

[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B%20%7C%2020%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**KomaDL** is a self-hosted local web application that pairs an extraction manager for [`gallery-dl`](https://github.com/mikf/gallery-dl) with a distraction-free, hardware-accelerated manga reader designed for desktop and ultrawide displays.

It organizes downloaded chapters into structured local folders in `./downloads`, tracks your reading progress, exports chapters to `.cbz` comic archives, and provides edge-to-edge **Wide Cover** and virtualized **Long Strip** reading modes.

---

## Highlights

### 📥 Archiving & Downloader
- **`gallery-dl` Integration**: Leverages the system `gallery-dl` CLI to extract images and metadata across 100+ supported manga, booru, and art sites.
- **Zero-Dependency Fallback**: If `gallery-dl` is not installed on your system, KomaDL automatically falls back to an internal HTTP and MangaDex API extractor—no Python required to get started.
- **One-Click Sample Feeds**: Includes built-in sample chapter feeds so you can test the downloader and reader immediately after installation.
- **Local File & Archive Import**: Drag and drop local images or import folders directly into your archive.
- **CBZ Export**: Download any archived chapter as a standard `.cbz` comic book archive with a single click.
- **Live Job Queue**: Monitor downloads with real-time progress indicators, retry counters, and stdout logs.

### 📖 Distraction-Free Manga Reader
- **Wide Cover Mode (`[W]`)**: Scales manga pages to fill 100% of the screen width edge-to-edge, ideal for widescreen and high-resolution monitors.
- **Smooth Long Strip Mode (`[M]`)**: Continuous vertical scrolling with GPU layer acceleration and CSS `content-visibility: auto` virtualization, maintaining a fluid 60+ FPS even on 50+ page chapters.
- **Single & Double Page (Spread) Views**: Automatically detects wide double-page spreads and pairs consecutive portrait pages.
- **RTL & LTR Support**: Toggle seamlessly between Japanese Right-to-Left (RTL) and Western Left-to-Right (LTR) reading directions.
- **Total Immersion Mode (`[H]`)**: Hide all UI toolbars and navigation bars for 100% unobstructed full-screen viewing.
- **Smart Keyboard & Mouse Navigation**: Press `Space` to scroll smoothly down tall pages before flipping to the next page. Click zones (left/right 30%) allow easy page turning while protecting the scrollbar gutter from accidental clicks.
- **Reading Progress Persistence**: Automatically saves your current page position per chapter locally.

---

## Quick Start

### 1. Prerequisites
- **Node.js**: v18.0.0+ or v20.0.0+ installed ([Download Node.js](https://nodejs.org/)).
- *(Optional)* **`gallery-dl`**: Recommended for extracting from 100+ external sites:
  ```bash
  pip install -U gallery-dl
  ```
  *(If `gallery-dl` is not present, KomaDL will automatically use its built-in fallback extractor.)*

### 2. Clone & Install

```bash
git clone https://github.com/<your-username>/komadl.git
cd komadl
npm install
```

### 3. Build & Run

Build the production assets and launch the server:

```bash
npm run build
npm start
```

Open your browser and navigate to:
```text
http://localhost:3000
```

---

## Reader Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **`W`** | Toggle **Wide cover mode** (scales page across 100% container width) |
| **`F`** | Toggle **Fullscreen mode** (with seamless viewport lock fallback) |
| **`H`** | Toggle **HUD toolbars** (hide headers/footers for pure page viewing) |
| **`M`** | Switch layout mode between **Single Page** and **Long Strip** |
| **`Space`** | Smoothly scrolls down tall pages; advances to next page when at the bottom |
| **`Shift + Space`** | Smoothly scrolls up tall pages; goes to previous page when at the top |
| **`←` / `→`** | Navigate pages (automatically respects active RTL / LTR direction) |
| **`Esc`** | Exit fullscreen mode / return to library view |

---

## Development

If you want to modify or contribute to KomaDL:

```bash
# Start development server with hot-module replacement
npm run dev

# Run TypeScript type checks
npm run lint

# Clean build artifacts
npm run clean
```

---

## Configuration

KomaDL stores its persistent state and configuration locally inside `./downloads`:
- **`./downloads/.komadl-index.json`**: Library metadata, chapter records, and reading progress.
- **`./downloads/gallery-dl.conf`**: The active `gallery-dl` configuration file.

You can modify extractor options directly from the **Config** tab in the web interface:
- Base download directory & template paths (`{category}/{manga}/c{chapter:03d}`)
- Filename pattern (`{num:03d}.{extension}`)
- Request delay (`--sleep-request`) and retry thresholds
- Custom User-Agent strings, proxy endpoints, and cookies file paths

---

## Project Structure

```text
komadl/
├── server.ts              # Express API server & static file host
├── server.js              # Bundled production server
├── server/
│   ├── cbzBuilder.ts      # In-memory CBZ zip generation
│   └── mangaPlates.ts     # Procedural SVG vector plates for sample feeds
├── src/
│   ├── App.tsx            # Main shell & tab state
│   ├── main.tsx           # React DOM root entry
│   ├── index.css          # Tailwind CSS v4 design tokens & scroll styles
│   ├── types.ts           # Shared TypeScript interfaces
│   ├── components/
│   │   ├── MangaReader.tsx       # Fullscreen/wide/strip manga reader component
│   │   ├── LibraryView.tsx       # Series shelf, chapter cards, search & filter
│   │   ├── DownloaderPanel.tsx   # URL extractor form & download job logs
│   │   ├── ConfigPanel.tsx       # gallery-dl settings editor
│   │   └── ui.tsx                # Reusable UI primitives (MangaImage, Surface, Button)
│   └── utils/
│       └── galleryDl.ts   # URL parser, command builder, & filename sanitizer
├── downloads/             # Extracted manga chapters and local index state
└── package.json           # Scripts and dependencies
```

---

## License

This project is open-source under the [MIT License](LICENSE).
