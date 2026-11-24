# 🍯 Honey Journal

> A private, offline-first personal reflection and pattern tracking journal built with **Tauri v2** and modern web technologies.

[![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-blue?logo=tauri)](https://tauri.app/)
[![License: ISC](https://img.shields.io/badge/License-ISC-amber.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange)]()
[![Privacy](https://img.shields.io/badge/Data-100%25%20Local%20%26%20Offline-success)]()

---

## ✨ Features

- **📊 Pattern Analytics:** Track recurring behavioral patterns, energy levels, and triggers over time.
- **📅 Visual Calendar Log:** Glanceable monthly, weekly, and daily breakdown of daily entries.
- **🏠 Intelligent Dashboard:** Unified view of streaks, quick-entry prompts, and recent insights.
- **🔒 100% Offline & Private:** Zero cloud tracking; all logs stay on your local disk.
- **📦 Data Portability:** Built-in JSZip automated export and backup archiving.
- **⚡ Ultralight Desktop Experience:** Powered by Tauri's tiny native system webview wrapper (Rust backend) for ultra-low memory footprint.
- **🌙 Deep OLED Obsidian Theme:** Crafted with a calm, dark aesthetic designed for daily reflection without eye fatigue.

---

## 🛠 Tech Stack

- **Desktop Framework:** [Tauri 2.0](https://tauri.app/) (Rust backend)
- **Frontend:** Vanilla ES6+ JavaScript, Responsive HTML5 & CSS3
- **Icons:** FontAwesome 6
- **Data Export:** JSZip for offline encrypted backup archives

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://www.rust-lang.org/tools/install)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yuvanmoz/Honey-Journal.git
   cd Honey-Journal
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run in development mode:**
   ```bash
   npm run tauri dev
   ```

4. **Build release desktop binary:**
   ```bash
   npm run tauri build
   ```

---

## 📂 Project Structure

```text
Honey-Journal/
├── src-tauri/          # Tauri Rust configuration & native bindings
│   ├── Cargo.toml
│   └── tauri.conf.json
├── Images/             # Brand marks, app icons & design assets
├── app.js              # Core application logic & view state router
├── index.html          # Unified desktop UI viewport layout
├── style.css           # Design tokens, obsidian theme & animations
├── jszip.min.js        # Offline archive export engine
└── package.json
```

---

## 📄 License

This project is licensed under the ISC License.
