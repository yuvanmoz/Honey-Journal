// State variables
let entries = [];
let tags = [];
let customAttributes = [];

let activeEntryId = null;
let activeCalendarDate = null; // Filter setups by calendar date if set
let storagePath = null;        // Sync/storage folder path on local disk

// View state
let currentDesktopView = 'patterns'; // dashboard, patterns, calendar, stats, settings
let currentMobileView = 'patterns';  // dashboard, patterns, calendar, stats, more

let desktopLayout = 'gallery'; // gallery, table
let mobileLayout = 'gallery';  // mobile only supports gallery

// Filter dropdown selections (shared/synced)
let filterBias = 'all';       // all, Bullish, Bearish, Both
let filterPattern = 'all';    // all, tag names
let sortOrder = 'newest';     // newest, oldest
let tablePFSortAsc = true;
let tableDateSortAsc = false; // default: newest first

let desktopSearchText = '';
let mobileSearchText = '';

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  // Sync Clock
  initPhoneClock();
  
  // Check storage path setup on launch
  checkStorageFolderSetup();

  // Load Theme
  initTheme();

  // Dialog attributes event listener
  const typeSelect = document.getElementById('new-attr-type');
  const optionsWrapper = document.getElementById('new-attr-options-wrapper');
  if (typeSelect && optionsWrapper) {
    typeSelect.addEventListener('change', () => {
      optionsWrapper.style.display = typeSelect.value === 'select' ? 'flex' : 'none';
    });
  }

  // Click-out detail tag dropdowns
  window.addEventListener('click', (e) => {
    const isDropdownTrigger = e.target.closest('.tag-multiselect-trigger');
    const isDropdown = e.target.closest('.tag-multiselect-dropdown');
    if (!isDropdownTrigger && !isDropdown) {
      document.querySelectorAll('.tag-multiselect-dropdown').forEach(d => d.classList.remove('open'));
    }
  });
});

// Sync Clock for phone mockup
function initPhoneClock() {
  const clockEl = document.getElementById('phone-clock');
  if (!clockEl) return;
  const updateClock = () => {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    hours = hours < 10 ? '0' + hours : hours;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    clockEl.textContent = `${hours}:${minutes}`;
  };
  updateClock();
  setInterval(updateClock, 60000);
}

// First-Run Directory Manager
function checkStorageFolderSetup() {
  const savedPath = localStorage.getItem('honey_journal_storage_path');
  const setupOverlay = document.getElementById('setup-screen');
  
  if (savedPath) {
    storagePath = savedPath;
    if (setupOverlay) setupOverlay.style.display = 'none';
    
    // Load Database & Render
    loadDatabase();
    renderAll();
  } else {
    // Show First-Run Directory Pick overlay
    if (setupOverlay) setupOverlay.style.display = 'flex';
  }
}

// Trigger directory open selection (Tauri invoke or fallback mockup prompts)
async function chooseStorageFolder() {
  const setupOverlay = document.getElementById('setup-screen');
  
  if (window.__TAURI__) {
    // Open native folder dialog using Rust pick_folder command
    const { invoke } = window.__TAURI__.tauri;
    try {
      const selected = await invoke('select_folder');
      if (selected) {
        setStoragePath(selected);
      }
    } catch (err) {
      console.error("Tauri dialog error:", err);
      // Fallback
      mockFolderPrompt();
    }
  } else {
    mockFolderPrompt();
  }
}

function mockFolderPrompt() {
  const defaultMockPath = "d:\\CODE\\Journal";
  const path = prompt("Enter a local directory path to store your journal files:", storagePath || defaultMockPath);
  if (path) {
    setStoragePath(path);
  }
}

function setStoragePath(path) {
  storagePath = path;
  localStorage.setItem('honey_journal_storage_path', path);
  
  const setupOverlay = document.getElementById('setup-screen');
  if (setupOverlay) setupOverlay.style.display = 'none';
  
  // Reload and draw UI
  loadDatabase();
  renderAll();
}

// Database Operations
function loadDatabase() {
  const localEntries = localStorage.getItem('honey_journal_entries');
  const localTags = localStorage.getItem('honey_journal_tags');
  const localCustomAttrs = localStorage.getItem('honey_journal_custom_attrs');

  const seeds = window.HoneyJournalSeeds;

  if (localEntries) {
    entries = JSON.parse(localEntries);
  } else {
    entries = seeds.initialEntries;
    localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
  }

  if (localTags) {
    tags = JSON.parse(localTags);
  } else {
    tags = seeds.initialTags;
    localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
  }

  if (localCustomAttrs) {
    customAttributes = JSON.parse(localCustomAttrs);
  } else {
    customAttributes = seeds.defaultCustomAttributes;
    localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
  }
}

function saveDatabase() {
  localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
  localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
  localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
}

// Theme Controls
function initTheme() {
  const savedTheme = localStorage.getItem('honey_journal_theme');
  let currentTheme = 'dark';
  if (savedTheme) {
    currentTheme = savedTheme;
  } else {
    localStorage.setItem('honey_journal_theme', 'dark');
  }
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.innerHTML = theme === 'light' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('honey_journal_theme', currentTheme);
  applyTheme(currentTheme);
}

// Layout Switcher
function setLayoutMode(mode) {
  const viewport = document.getElementById('main-viewport');
  const buttons = document.querySelectorAll('.layout-btn');
  
  viewport.className = 'prototype-viewport';
  buttons.forEach(b => b.classList.remove('active'));

  if (mode === 'split') {
    viewport.classList.add('layout-split');
    document.getElementById('btn-split').classList.add('active');
  } else if (mode === 'desktop-only') {
    viewport.classList.add('layout-desktop-only');
    document.getElementById('btn-desktop').classList.add('active');
  } else if (mode === 'mobile-only') {
    viewport.classList.add('layout-mobile-only');
    document.getElementById('btn-mobile').classList.add('active');
  }
  
  renderAll();
}

// Render Core Orchestrator
function renderAll() {
  // Check path setup (do not render list counts if missing folder)
  if (!storagePath) return;

  // Sync filter selectors list values
  syncFilterSelectors();
  
  // Populate filter dropdown patterns
  populatePatternFilterDropdowns();

  // Render Desktop Elements
  renderDesktopSidebar();
  renderDesktopContent();
  renderDesktopDetail();

  // Render Mobile Elements
  renderMobileContent();
  renderMobileDetail();
}

// Sync filter selections between desktop and mobile variables
function syncFilterSelectors() {
  const dBias = document.getElementById('desktop-filter-bias');
  const dPattern = document.getElementById('desktop-filter-pattern');
  const dSort = document.getElementById('desktop-sort-gallery');

  const mBias = document.getElementById('mobile-filter-bias');
  const mPattern = document.getElementById('mobile-filter-pattern');
  const mSort = document.getElementById('mobile-sort');

  if (dBias) dBias.value = filterBias;
  if (dPattern) dPattern.value = filterPattern;
  if (dSort) dSort.value = sortOrder;

  if (mBias) mBias.value = filterBias;
  if (mPattern) mPattern.value = filterPattern;
  if (mSort) mSort.value = sortOrder;
}

// Populate pattern dropdown options dynamically
function populatePatternFilterDropdowns() {
  const dPattern = document.getElementById('desktop-filter-pattern');
  const mPattern = document.getElementById('mobile-filter-pattern');

  if (!dPattern || !mPattern) return;

  const currentDValue = dPattern.value;
  const currentMValue = mPattern.value;

  dPattern.innerHTML = '<option value="all">All Patterns</option>';
  mPattern.innerHTML = '<option value="all">All Patterns</option>';

  tags.forEach(tag => {
    dPattern.innerHTML += `<option value="${tag.name}">${tag.name}</option>`;
    mPattern.innerHTML += `<option value="${tag.name}">${tag.name}</option>`;
  });

  // Preserve selections
  dPattern.value = currentDValue || 'all';
  mPattern.value = currentMValue || 'all';
}

// ==========================================================================
// DESKTOP CONTROLS & RENDERING
// ==========================================================================

function switchDesktopView(view) {
  currentDesktopView = view;
  
  const titleEl = document.getElementById('desktop-view-title');
  const tabsContainer = document.getElementById('desktop-tabs-container');
  const filtersGroup = document.getElementById('desktop-filters-group');
  const searchWrapper = document.getElementById('desktop-search-wrapper');
  const newBtn = document.querySelector('#desktop-header-controls .btn-primary');
  
  const galleryView = document.getElementById('desktop-gallery-view');
  const tableView = document.getElementById('desktop-table-view');
  const calendarView = document.getElementById('desktop-calendar-view');
  const statsView = document.getElementById('desktop-stats-view');
  const settingsView = document.getElementById('desktop-settings-view');

  // Hide header actions on dashboard/calendar/statistics/settings views to prevent clutter
  const isPatternsView = (view === 'patterns');
  if (tabsContainer) tabsContainer.style.display = isPatternsView ? 'flex' : 'none';
  if (filtersGroup) filtersGroup.style.display = isPatternsView ? 'flex' : 'none';
  if (searchWrapper) searchWrapper.style.display = isPatternsView ? 'flex' : 'none';
  if (newBtn) newBtn.style.display = isPatternsView ? 'flex' : 'none';

  // Hide all screens
  galleryView.style.display = 'none';
  tableView.style.display = 'none';
  calendarView.style.display = 'none';
  statsView.style.display = 'none';
  settingsView.style.display = 'none';

  titleEl.textContent = view.charAt(0).toUpperCase() + view.slice(1);

  if (view === 'patterns') {
    if (desktopLayout === 'gallery') {
      galleryView.style.display = 'grid';
    } else {
      tableView.style.display = 'block';
    }
  } else if (view === 'calendar') {
    calendarView.style.display = 'block';
    renderDesktopCalendar();
  } else if (view === 'stats') {
    titleEl.textContent = 'Performance Statistics';
    statsView.style.display = 'block';
    renderDesktopStats();
  } else if (view === 'settings') {
    settingsView.style.display = 'block';
    renderDesktopSettings();
  } else if (view === 'dashboard') {
    titleEl.textContent = 'Honey Journal Dashboard';
    statsView.style.display = 'block';
    renderDesktopStats(true); // Overview mode
  }

  renderDesktopSidebar();
}

function renderDesktopSidebar() {
  const items = document.querySelectorAll('.desktop-sidebar .sidebar-item');
  items.forEach(item => {
    item.classList.remove('active');
    const id = item.id;
    if (id === `nav-d-${currentDesktopView}`) {
      item.classList.add('active');
    }
  });
}

// Simple dropdown filters event handler
function handleFilterChange() {
  const dFieldBias = document.getElementById('desktop-filter-bias');
  const dFieldPattern = document.getElementById('desktop-filter-pattern');
  const mFieldBias = document.getElementById('mobile-filter-bias');
  const mFieldPattern = document.getElementById('mobile-filter-pattern');

  // Find which dropdown triggered change and synchronize selections
  if (document.activeElement === dFieldBias || document.activeElement === dFieldPattern) {
    filterBias = dFieldBias.value;
    filterPattern = dFieldPattern.value;
  } else if (document.activeElement === mFieldBias || document.activeElement === mFieldPattern) {
    filterBias = mFieldBias.value;
    filterPattern = mFieldPattern.value;
  }

  activeCalendarDate = null; // Clear calendar dates selection on generic filter search
  renderAll();
}

function handleSortChange(val) {
  sortOrder = val;
  renderAll();
}

function setDesktopLayout(layout) {
  desktopLayout = layout;
  
  document.getElementById('tab-d-gallery').classList.toggle('active', layout === 'gallery');
  document.getElementById('tab-d-table').classList.toggle('active', layout === 'table');

  const galleryView = document.getElementById('desktop-gallery-view');
  const tableView = document.getElementById('desktop-table-view');

  if (layout === 'gallery') {
    galleryView.style.display = 'grid';
    tableView.style.display = 'none';
  } else {
    galleryView.style.display = 'none';
    tableView.style.display = 'block';
  }
  
  renderDesktopContent();
}

function handleDesktopSearch() {
  desktopSearchText = document.getElementById('desktop-search').value.toLowerCase();
  renderDesktopContent();
}

// Clean filtering logic based on simplified attributes
function getProcessedEntries(searchText, calendarDate = null) {
  let list = [...entries];

  // Apply Calendar Date filter if selected
  if (calendarDate) {
    list = list.filter(e => e.date === calendarDate);
  }

  // Filter by Bias Select dropdown
  if (filterBias !== 'all') {
    list = list.filter(e => e.bias === filterBias);
  }

  // Filter by Pattern Select dropdown
  if (filterPattern !== 'all') {
    list = list.filter(e => e.patterns.includes(filterPattern));
  }

  // Apply Search input matching
  if (searchText) {
    list = list.filter(e => 
      e.title.toLowerCase().includes(searchText) || 
      e.notes.toLowerCase().includes(searchText) ||
      e.mistakes.toLowerCase().includes(searchText) ||
      e.bias.toLowerCase().includes(searchText)
    );
  }

  // Apply Sort
  list.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    if (sortOrder === 'newest') {
      return dateB - dateA;
    } else {
      return dateA - dateB;
    }
  });

  return list;
}

function renderDesktopContent() {
  const processedList = getProcessedEntries(desktopSearchText, activeCalendarDate);
  
  if (desktopLayout === 'gallery') {
    renderDesktopGallery(processedList);
  } else {
    renderDesktopTable(processedList);
  }
}

function renderDesktopGallery(list) {
  const container = document.getElementById('desktop-gallery-view');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No entries found matching filters.</div>`;
    return;
  }

  list.forEach(entry => {
    const card = document.createElement('div');
    card.className = `journal-card ${activeEntryId === entry.id ? 'active-border' : ''}`;
    card.onclick = () => openEntryDetail(entry.id);

    let biasColor = 'var(--color-neutral)';
    if (entry.bias === 'Bullish') biasColor = 'var(--color-bull)';
    else if (entry.bias === 'Bearish') biasColor = 'var(--color-bear)';
    else if (entry.bias === 'Both') biasColor = 'var(--color-both)';

    // Image & footer (no bookmark overlay buttons)
    card.innerHTML = `
      <div class="card-img-wrapper">
        <img src="${entry.image || 'Images/chart1.png'}" alt="${entry.title}" class="card-img">
      </div>
      <div class="card-content">
        <div class="card-title">${entry.title}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
          <div class="card-footer-left" style="font-size:11px; color:var(--text-secondary);">
            <i class="fa-solid fa-calendar" style="margin-right:4px;"></i>
            <span>${entry.date}</span>
          </div>
          <span class="tag-badge" style="background-color: ${biasColor}1A; color: ${biasColor}; border: 1px solid ${biasColor}33;">${entry.bias}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderDesktopTable(list) {
  const tbody = document.getElementById('desktop-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No entries found.</td></tr>`;
    return;
  }

  // Sort Table records locally based on click flags
  let tableList = [...list];
  tableList.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return tableDateSortAsc ? dateA - dateB : dateB - dateA;
  });

  tableList.forEach(entry => {
    const tr = document.createElement('tr');
    tr.onclick = () => openEntryDetail(entry.id);
    if (activeEntryId === entry.id) tr.style.backgroundColor = 'var(--bg-primary)';

    let tagsHtml = '';
    entry.patterns.forEach(pat => {
      const tagObj = tags.find(t => t.name === pat) || { color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' };
      tagsHtml += `<span class="tag-badge" style="color: ${tagObj.color}; background-color: ${tagObj.bg}; margin-right: 4px;">${pat}</span>`;
    });

    const pl = entry.customAttributes['P&L'] || '₹0';
    let plColor = 'inherit';
    if (pl.startsWith('-')) plColor = 'var(--color-bear)';
    else if (pl !== '₹0') plColor = 'var(--color-bull)';

    tr.innerHTML = `
      <td><img src="${entry.image}" class="table-img"></td>
      <td style="font-weight:600;">${entry.title}</td>
      <td><span class="tag-badge" style="background-color: var(--bg-tertiary);">${entry.bias}</span></td>
      <td>${tagsHtml}</td>
      <td style="font-family: var(--font-display); font-weight:600; color: ${plColor};">${pl}</td>
      <td class="status-${entry.status.toLowerCase()}">${entry.status}</td>
      <td style="color: var(--text-secondary);">${entry.date}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Table Sort Helpers
function toggleTableDateSort() {
  tableDateSortAsc = !tableDateSortAsc;
  renderDesktopContent();
}

function toggleTablePFSort() {
  // Sorts by passed status
  tablePFSortAsc = !tablePFSortAsc;
  entries.sort((a, b) => {
    return tablePFSortAsc ? a.status.localeCompare(b.status) : b.status.localeCompare(a.status);
  });
  renderDesktopContent();
}

// Desktop Calendar - Render compact grid heights
function renderDesktopCalendar() {
  const container = document.getElementById('desktop-calendar-view');
  if (!container) return;
  container.innerHTML = '';
  const calendarHtml = generateCalendarHTML(2026, 4); // May 2026
  container.innerHTML = calendarHtml;
}

function generateCalendarHTML(year, monthIndex) {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const date = new Date(year, monthIndex, 1);
  const firstDayIndex = date.getDay();
  const numDays = new Date(year, monthIndex + 1, 0).getDate();

  let cellsHtml = '';
  for (let i = 0; i < firstDayIndex; i++) {
    cellsHtml += `<div class="calendar-day-cell empty"></div>`;
  }

  for (let day = 1; day <= numDays; day++) {
    const currentMonthString = (monthIndex + 1) < 10 ? '0' + (monthIndex + 1) : (monthIndex + 1);
    const currentDayString = day < 10 ? '0' + day : day;
    const dateString = `${year}-${currentMonthString}-${currentDayString}`;

    const dayEntries = entries.filter(e => e.date === dateString);
    
    let dotsHtml = '';
    dayEntries.forEach(entry => {
      const statusClass = entry.status === 'PASSED' ? 'passed' : 'failed';
      dotsHtml += `<span class="calendar-trade-dot ${statusClass}" title="${entry.title} (${entry.bias})"></span>`;
    });

    const isToday = (day === 2 && monthIndex === 5 && year === 2026) ? 'style="border-color: var(--accent-gold);"' : '';
    const isSelected = activeCalendarDate === dateString ? 'style="border-color: var(--accent-olive); background-color: var(--accent-olive-light);"' : '';

    cellsHtml += `
      <div class="calendar-day-cell" ${isToday || isSelected} onclick="handleCalendarDateClick('${dateString}')">
        <span class="calendar-day-number">${day}</span>
        <div style="display: flex; gap: 4px; margin-top: 4px;">
          ${dotsHtml}
        </div>
      </div>
    `;
  }

  return `
    <div class="calendar-header">
      <div class="calendar-header-title">${monthNames[monthIndex]} ${year}</div>
      <div>
        <button class="btn-icon" style="display: inline-flex;" onclick="alert('Previous month clicked')"><i class="fa-solid fa-chevron-left"></i></button>
        <button class="btn-icon" style="display: inline-flex;" onclick="alert('Next month clicked')"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
    <div class="calendar-days-grid">
      <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
    </div>
    <div class="calendar-dates-grid">
      ${cellsHtml}
    </div>
  `;
}

// Stats & Dashboard
function renderDesktopStats(isDashboard = false) {
  const container = document.getElementById('desktop-stats-view');
  if (!container) return;

  const totalTrades = entries.length;
  const passedTrades = entries.filter(e => e.status === 'PASSED').length;
  const winRate = totalTrades > 0 ? ((passedTrades / totalTrades) * 100).toFixed(1) : 0;

  if (isDashboard) {
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-card-title">Total Setups</span>
          <span class="stat-card-val">${totalTrades}</span>
          <span class="stat-card-label">Logged setups in library</span>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">Win Rate</span>
          <span class="stat-card-val success">${winRate}%</span>
          <span class="stat-card-label">Setups marked as PASSED</span>
        </div>
      </div>
      
      <div class="stat-list">
        <h3 style="padding: 10px 0; font-size: 14px; color: var(--text-secondary);">Setup Insights</h3>
        <div class="stat-list-item">
          <span class="stat-list-label">Most Profitable Pattern</span>
          <span class="stat-list-val" style="color: var(--color-bull);">VWAP Support (+₹800)</span>
        </div>
        <div class="stat-list-item">
          <span class="stat-list-label">Worst Performing Pattern</span>
          <span class="stat-list-val" style="color: var(--color-bear);">VWAP Rejection (Failed -₹250)</span>
        </div>
        <div class="stat-list-item">
          <span class="stat-list-label">Syncthing Folder Sync</span>
          <span class="stat-list-val" style="color: var(--color-bull);"><i class="fa-solid fa-rotate"></i> Synced to Android</span>
        </div>
      </div>
    `;
  } else {
    // Generate Pattern rank lists
    const bullishCounts = {};
    const bearishCounts = {};

    entries.forEach(entry => {
      entry.patterns.forEach(pat => {
        const tagObj = tags.find(t => t.name === pat);
        const tagType = tagObj ? tagObj.type : 'Both';
        
        if (tagType === 'Bullish') {
          bullishCounts[pat] = (bullishCounts[pat] || 0) + 1;
        } else if (tagType === 'Bearish') {
          bearishCounts[pat] = (bearishCounts[pat] || 0) + 1;
        } else {
          if (entry.bias === 'Bullish') bullishCounts[pat] = (bullishCounts[pat] || 0) + 1;
          else if (entry.bias === 'Bearish') bearishCounts[pat] = (bearishCounts[pat] || 0) + 1;
          else {
            bullishCounts[pat] = (bullishCounts[pat] || 0) + 1;
            bearishCounts[pat] = (bearishCounts[pat] || 0) + 1;
          }
        }
      });
    });

    const sortedBullish = Object.entries(bullishCounts).sort((a, b) => b[1] - a[1]);
    const sortedBearish = Object.entries(bearishCounts).sort((a, b) => b[1] - a[1]);

    let bullHtml = '';
    sortedBullish.forEach(([name, count], index) => {
      bullHtml += `
        <div class="stats-rank-item">
          <div class="stats-rank-label">
            <span class="stats-rank-number">${index + 1}.</span>
            <span>${name}</span>
          </div>
          <span class="stats-rank-badge">${count} setups</span>
        </div>
      `;
    });
    if (sortedBullish.length === 0) bullHtml = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">No bullish patterns logged.</div>';

    let bearHtml = '';
    sortedBearish.forEach(([name, count], index) => {
      bearHtml += `
        <div class="stats-rank-item">
          <div class="stats-rank-label">
            <span class="stats-rank-number">${index + 1}.</span>
            <span>${name}</span>
          </div>
          <span class="stats-rank-badge" style="background-color: rgba(239, 68, 68, 0.15); color: var(--color-bear);">${count} setups</span>
        </div>
      `;
    });
    if (sortedBearish.length === 0) bearHtml = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">No bearish patterns logged.</div>';

    container.innerHTML = `
      <div style="padding: 24px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px;">
        <div>
          <h3 style="font-family: var(--font-display); font-size: 16px; margin-bottom: 12px; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-arrow-trend-up" style="color:var(--color-bull);"></i> Bullish Setups Usage</h3>
          <div class="stats-rank-list">
            ${bullHtml}
          </div>
        </div>
        
        <div>
          <h3 style="font-family: var(--font-display); font-size: 16px; margin-bottom: 12px; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-arrow-trend-down" style="color:var(--color-bear);"></i> Bearish Setups Usage</h3>
          <div class="stats-rank-list">
            ${bearHtml}
          </div>
        </div>
      </div>
    `;
  }
}

// Settings View - render storagePath dynamically
function renderDesktopSettings() {
  const container = document.getElementById('desktop-settings-view');
  if (!container) return;
  container.innerHTML = `
    <div class="settings-card">
      <span class="settings-card-title">Local Folder Connections</span>
      <div class="settings-row">
        <div class="settings-row-label">
          <span>Journal Folder Path</span>
          <span class="settings-row-sub">SQLite database and images folder location</span>
        </div>
        <code style="background-color: var(--bg-secondary); padding: 6px 12px; border-radius: var(--radius-md); font-size: 12px;">${storagePath || 'Not Configured'}</code>
      </div>
      
      <div class="settings-row" style="margin-top: 8px;">
        <div class="settings-row-label">
          <span>Change working directory</span>
          <span class="settings-row-sub">Relocate the database and synced items</span>
        </div>
        <button class="btn-secondary" onclick="chooseStorageFolder()"><i class="fa-solid fa-folder-open"></i> Change Folder</button>
      </div>

      <div class="settings-row" style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <div class="settings-row-label">
          <span>Syncthing Sync Peer</span>
          <span class="settings-row-sub">Auto updates local files with Android device</span>
        </div>
        <span style="font-weight:600; color: var(--color-bull);"><i class="fa-solid fa-circle-check"></i> Connected with Mobile peer</span>
      </div>
    </div>
  `;
}

// Notion Detail Draw Panel (Desktop)
function openEntryDetail(id) {
  activeEntryId = id;
  
  // Show Panel
  document.getElementById('desktop-detail-pane').classList.remove('closed');
  
  // Mobile detail slide-up
  const mobileDetail = document.getElementById('mobile-detail-pane');
  if (mobileDetail) mobileDetail.classList.add('open');

  renderAll();
}

function closeDesktopDetail() {
  document.getElementById('desktop-detail-pane').classList.add('closed');
  activeEntryId = null;
  renderAll();
}

function renderDesktopDetail() {
  const pane = document.getElementById('desktop-detail-pane');
  if (pane.classList.contains('closed') || !activeEntryId) return;

  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  document.getElementById('detail-chart-img').src = entry.image || 'Images/chart1.png';
  document.getElementById('detail-title').value = entry.title;
  document.getElementById('detail-notes').value = entry.notes;
  document.getElementById('detail-mistakes').value = entry.mistakes;

  // Render Attributes List (Builtin + Dynamic Custom)
  const attrList = document.getElementById('detail-attributes-list');
  attrList.innerHTML = '';

  // Bias
  const biasRow = createAttributeRowHTML('Bias', `<select class="input-select" onchange="saveCurrentField('bias', this.value)">
    <option value="Bullish" ${entry.bias === 'Bullish' ? 'selected' : ''}>Bullish</option>
    <option value="Bearish" ${entry.bias === 'Bearish' ? 'selected' : ''}>Bearish</option>
    <option value="Both" ${entry.bias === 'Both' ? 'selected' : ''}>Both</option>
  </select>`, 'fa-solid fa-arrows-up-down');
  attrList.appendChild(biasRow);

  // Date
  const dateRow = createAttributeRowHTML('Date', `<input type="date" class="input-text" value="${entry.date}" onchange="saveCurrentField('date', this.value)">`, 'fa-solid fa-calendar');
  attrList.appendChild(dateRow);

  // Patterns tags
  const tagSelectorHTML = generateTagMultiSelectHTML(entry.patterns);
  const patternRow = createAttributeRowHTML('Patterns', tagSelectorHTML, 'fa-solid fa-tags');
  attrList.appendChild(patternRow);

  // P&F Status
  const statusRow = createAttributeRowHTML('P/F Status', `<select class="input-select" onchange="saveCurrentField('status', this.value)">
    <option value="PASSED" ${entry.status === 'PASSED' ? 'selected' : ''}>PASSED</option>
    <option value="FAILED" ${entry.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
  </select>`, 'fa-solid fa-circle-check');
  attrList.appendChild(statusRow);

  // Secondary Custom Attributes (Market, P&L, plus new additions with trash bins)
  customAttributes.forEach(attr => {
    let inputHTML = '';
    const currentVal = entry.customAttributes[attr.name] !== undefined ? entry.customAttributes[attr.name] : attr.defaultValue;
    
    if (attr.name === 'Market') {
      inputHTML = `<input type="text" list="market-datalist" class="input-text" value="${currentVal}" onchange="saveCustomAttribute('Market', this.value)">
        <datalist id="market-datalist">
          <option value="Nifty 50">
          <option value="Bank Nifty">
          <option value="Futures">
          <option value="Gold">
          <option value="Crude Oil">
        </datalist>`;
    } else if (attr.type === 'select') {
      let optionsHtml = '';
      attr.options.forEach(opt => {
        optionsHtml += `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || 'Optional'}</option>`;
      });
      inputHTML = `<select class="input-select" onchange="saveCustomAttribute('${attr.name}', this.value)">${optionsHtml}</select>`;
    } else if (attr.type === 'number') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="Optional" onchange="saveCustomAttribute('${attr.name}', this.value)">`;
    } else {
      inputHTML = `<input type="text" class="input-text" value="${currentVal}" placeholder="e.g. ₹350" onchange="saveCustomAttribute('${attr.name}', this.value)">`;
    }

    const isSystemAttribute = (attr.name === 'Market' || attr.name === 'P&L');
    const customRow = createAttributeRowHTML(attr.name, inputHTML, 'fa-solid fa-cube', !isSystemAttribute);
    attrList.appendChild(customRow);
  });

  // Add Dynamic attribute button
  const addBtn = document.createElement('button');
  addBtn.className = 'add-attribute-btn';
  addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Add Custom Field`;
  addBtn.onclick = openAddAttributeDialog;
  attrList.appendChild(addBtn);

  // Setup timestamps
  document.getElementById('detail-created-time').textContent = `Created: Apr 27, 2026 09:45 AM`;
  document.getElementById('detail-updated-time').textContent = `Updated: Jun 02, 2026 12:30 PM`;
}

function createAttributeRowHTML(label, innerHTML, iconClass, isCustom = false) {
  const row = document.createElement('div');
  row.className = 'attribute-row';
  row.innerHTML = `
    <div class="attribute-label" title="${label}">
      <i class="${iconClass}" style="margin-right: 6px;"></i>
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px;">${label}</span>
      ${isCustom ? `<i class="fa-solid fa-trash-can" onclick="deleteCustomAttributeField('${label}')" title="Delete custom field"></i>` : ''}
    </div>
    <div class="attribute-value">
      ${innerHTML}
    </div>
  `;
  return row;
}

function generateTagMultiSelectHTML(selectedPatterns) {
  let selectedBadgesHtml = '';
  selectedPatterns.forEach(pat => {
    const tagObj = tags.find(t => t.name === pat) || { color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' };
    selectedBadgesHtml += `<span class="tag-badge" style="color: ${tagObj.color}; background-color: ${tagObj.bg};">${pat}</span>`;
  });

  if (selectedPatterns.length === 0) {
    selectedBadgesHtml = `<span style="color: var(--text-muted); font-size:12px;">+ Select Tags</span>`;
  }

  let dropdownItemsHtml = '';
  tags.forEach(t => {
    const isSelected = selectedPatterns.includes(t.name);
    dropdownItemsHtml += `
      <div class="tag-dropdown-item ${isSelected ? 'selected' : ''}" onclick="togglePatternTag('${t.name}')">
        <span class="tag-badge" style="color: ${t.color}; background-color: ${t.bg};">${t.name}</span>
        ${isSelected ? '<i class="fa-solid fa-check" style="font-size:10px;"></i>' : ''}
      </div>
    `;
  });

  return `
    <div class="tag-multiselect-container">
      <div class="tag-multiselect-trigger" onclick="toggleTagDropdown(this)">
        ${selectedBadgesHtml}
      </div>
      <div class="tag-multiselect-dropdown">
        ${dropdownItemsHtml}
        <button class="tag-create-btn" onclick="openAddTagDialog()"><i class="fa-solid fa-plus"></i> Add New Tag</button>
      </div>
    </div>
  `;
}

function toggleTagDropdown(trigger) {
  const dropdown = trigger.nextElementSibling;
  dropdown.classList.toggle('open');
}

function togglePatternTag(tagName) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  const idx = entry.patterns.indexOf(tagName);
  if (idx > -1) {
    entry.patterns.splice(idx, 1);
  } else {
    entry.patterns.push(tagName);
  }

  saveDatabase();
  renderAll();
}

function saveCurrentField(field, val) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  entry[field] = val;
  saveDatabase();
  
  // Re-render grids
  const processedList = getProcessedEntries(desktopSearchText, activeCalendarDate);
  if (desktopLayout === 'gallery') {
    renderDesktopGallery(processedList);
  } else {
    renderDesktopTable(processedList);
  }

  renderMobileContent();
}

// Save Custom Attributes
function saveCustomAttribute(attrName, val) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  entry.customAttributes[attrName] = val;
  saveDatabase();

  renderAll();
}

// Dialog boxes (custom attribute popup UI)
function openAddAttributeDialog() {
  document.getElementById('dialog-add-attribute').classList.add('open');
}

function closeAddAttributeDialog() {
  document.getElementById('dialog-add-attribute').classList.remove('open');
}

function submitAddAttribute() {
  const nameInput = document.getElementById('new-attr-name');
  const typeSelect = document.getElementById('new-attr-type');
  const optionsInput = document.getElementById('new-attr-options');

  const name = nameInput.value.trim();
  const type = typeSelect.value;
  let options = [];

  if (!name) {
    alert("Attribute name is required!");
    return;
  }

  if (customAttributes.find(a => a.name.toLowerCase() === name.toLowerCase())) {
    alert("An attribute with this name already exists!");
    return;
  }

  if (type === 'select') {
    options = optionsInput.value.split(',').map(o => o.trim()).filter(o => o.length > 0);
    if (options.length === 0) {
      alert("Dropdown options are required!");
      return;
    }
    options.unshift("");
  }

  const newAttr = { name, type, options, defaultValue: type === 'select' ? options[0] : '' };
  customAttributes.push(newAttr);
  saveDatabase();

  // Populate dynamic default value in entries list
  entries.forEach(e => {
    if (e.customAttributes[name] === undefined) {
      e.customAttributes[name] = newAttr.defaultValue;
    }
  });
  saveDatabase();

  nameInput.value = '';
  optionsInput.value = '';
  
  closeAddAttributeDialog();
  renderAll();
}

// Functional dynamic attribute deletion (Delete custom fields on click)
function deleteCustomAttributeField(attrName) {
  if (confirm(`Are you sure you want to delete the custom attribute "${attrName}"? Data will be deleted from all entries.`)) {
    customAttributes = customAttributes.filter(a => a.name !== attrName);
    entries.forEach(e => {
      delete e.customAttributes[attrName];
    });
    saveDatabase();
    renderAll();
  }
}

// Custom tags
function openAddTagDialog() {
  document.getElementById('dialog-add-tag').classList.add('open');
}

function closeAddTagDialog() {
  document.getElementById('dialog-add-tag').classList.remove('open');
}

function submitAddTag() {
  const nameEl = document.getElementById('new-tag-name');
  const biasEl = document.getElementById('new-tag-bias-group');

  const name = nameEl.value.trim();
  const biasGroup = biasEl.value;

  if (!name) {
    alert("Tag name is required!");
    return;
  }

  let color = '#3b82f6';
  if (biasGroup === 'Bullish') color = '#10b981';
  else if (biasGroup === 'Bearish') color = '#ef4444';

  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const bg = `rgba(${r}, ${g}, ${b}, 0.15)`;

  tags.push({ name, color, bg, type: biasGroup });
  saveDatabase();

  if (activeEntryId) {
    const entry = entries.find(e => e.id === activeEntryId);
    if (entry && !entry.patterns.includes(name)) {
      entry.patterns.push(name);
      saveDatabase();
    }
  }

  nameEl.value = '';
  closeAddTagDialog();
  renderAll();
}

// Toggling bookmarks
function toggleBookmark(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  entry.bookmarked = !entry.bookmarked;
  saveDatabase();
  renderAll();
}

// Create new setup
function createNewEntry() {
  const newId = 'entry-' + Date.now();
  const today = new Date().toISOString().split('T')[0];

  const newEntry = {
    id: newId,
    title: "Untitled Candle Setup",
    bias: "Bullish",
    date: today,
    patterns: [],
    status: "PASSED",
    image: "Images/chart1.png",
    notes: "",
    mistakes: "",
    customAttributes: {},
    bookmarked: false
  };

  // Populate custom fields defaults
  customAttributes.forEach(attr => {
    newEntry.customAttributes[attr.name] = attr.defaultValue || '';
  });

  entries.push(newEntry);
  saveDatabase();

  openEntryDetail(newId);
}

function deleteActiveEntry() {
  if (!activeEntryId) return;
  
  if (confirm("Are you sure you want to delete this trading journal entry?")) {
    entries = entries.filter(e => e.id !== activeEntryId);
    saveDatabase();
    closeDesktopDetail();
    closeMobileDetail();
    renderAll();
  }
}

// Clipboard uploads
function triggerImageUpload(platform) {
  const fileInput = document.getElementById(platform === 'desktop' ? 'desktop-chart-file' : 'mobile-chart-file');
  if (fileInput) fileInput.click();
}

function handleImageFileSelect(input, platform) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const entry = entries.find(e => e.id === activeEntryId);
    if (entry) {
      entry.image = e.target.result;
      saveDatabase();
      renderAll();
    }
  };
  reader.readAsDataURL(file);
}

function clearDatabase() {
  if (confirm("Are you sure you want to reset all entries to the default demo data?")) {
    localStorage.removeItem('honey_journal_entries');
    localStorage.removeItem('honey_journal_tags');
    localStorage.removeItem('honey_journal_custom_attrs');
    loadDatabase();
    activeEntryId = null;
    activeCalendarDate = null;
    renderAll();
  }
}

// ==========================================================================
// MOBILE CONTROLS & RENDERING
// ==========================================================================

function switchMobileView(view) {
  currentMobileView = view;
  
  const items = document.querySelectorAll('.phone-bottom-nav .phone-nav-item');
  items.forEach(item => {
    item.classList.remove('active');
    if (item.id === `nav-m-${view}`) {
      item.classList.add('active');
    }
  });

  const headerTitle = document.getElementById('mobile-view-title');
  const filterBar = document.getElementById('mobile-filter-bar');
  const searchIcon = document.querySelector('.phone-header .fa-magnifying-glass');
  
  const gallery = document.getElementById('mobile-gallery-view');
  const calendar = document.getElementById('mobile-calendar-view');
  const stats = document.getElementById('mobile-stats-view');
  const dashboard = document.getElementById('mobile-dashboard-view');
  const more = document.getElementById('mobile-more-view');
  const fab = document.getElementById('mobile-fab');

  // Hide mobile header options for non-patterns views
  const isPatternsView = (view === 'patterns');
  if (filterBar) filterBar.style.display = isPatternsView ? 'flex' : 'none';
  if (fab) fab.style.display = isPatternsView ? 'flex' : 'none';
  if (searchIcon) searchIcon.style.display = isPatternsView ? 'block' : 'none';

  // Hide all screens
  gallery.style.display = 'none';
  calendar.style.display = 'none';
  stats.style.display = 'none';
  dashboard.style.display = 'none';
  more.style.display = 'none';

  headerTitle.textContent = view.charAt(0).toUpperCase() + view.slice(1);

  if (view === 'patterns') {
    gallery.style.display = 'grid'; // Force mobile Grid layout
    renderMobileContent();
  } else if (view === 'calendar') {
    calendar.style.display = 'block';
    renderMobileCalendar();
  } else if (view === 'stats') {
    headerTitle.textContent = 'Statistics';
    stats.style.display = 'block';
    renderMobileStats();
  } else if (view === 'dashboard') {
    headerTitle.textContent = 'Overview';
    dashboard.style.display = 'block';
    renderMobileDashboard();
  } else if (view === 'more') {
    headerTitle.textContent = 'More Options';
    more.style.display = 'block';
    renderMobileMore();
  }
}

function setMobileFilter(filter) {
  mobileFilter = filter;
  activeCalendarDate = null;
  renderMobileContent();
}

function toggleMobileSearch() {
  const wrapper = document.getElementById('mobile-search-wrapper');
  if (wrapper) wrapper.style.display = wrapper.style.display === 'none' ? 'block' : 'none';
}

function toggleMobileSort() {
  mobileSortAsc = !mobileSortAsc;
  renderMobileContent();
}

function handleMobileSearch() {
  mobileSearchText = document.getElementById('mobile-search').value.toLowerCase();
  renderMobileContent();
}

function renderMobileContent() {
  const processedList = getProcessedEntries(mobileSearchText, activeCalendarDate);
  renderMobileGallery(processedList);
}

// 2-Column mobile card layout
function renderMobileGallery(list) {
  const container = document.getElementById('mobile-gallery-view');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding: 40px; color: var(--text-muted); font-size:12px; width:100%;">No setups found.</div>`;
    return;
  }

  list.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'phone-card';
    card.onclick = () => openEntryDetail(entry.id);

    let biasColor = 'var(--color-neutral)';
    if (entry.bias === 'Bullish') biasColor = 'var(--color-bull)';
    else if (entry.bias === 'Bearish') biasColor = 'var(--color-bear)';
    else if (entry.bias === 'Both') biasColor = 'var(--color-both)';

    card.innerHTML = `
      <div class="phone-card-img-wrapper">
        <img src="${entry.image}" alt="${entry.title}" class="phone-card-img">
      </div>
      <div class="phone-card-header">
        <span class="phone-card-title">${entry.title}</span>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
          <span class="phone-card-date">${entry.date}</span>
          <span class="tag-badge" style="font-size:9px; padding: 1px 4px; color: ${biasColor}; background-color: ${biasColor}1A; border: 1px solid ${biasColor}33;">${entry.bias}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Mobile Details close arrow trigger
function closeMobileDetail() {
  const mobileDetail = document.getElementById('mobile-detail-pane');
  if (mobileDetail) mobileDetail.classList.remove('open');
  activeEntryId = null;
  renderAll();
}

function renderMobileDetail() {
  const pane = document.getElementById('mobile-detail-pane');
  if (!pane || !pane.classList.contains('open') || !activeEntryId) return;

  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  // Chart Screenshot Top positioning setup
  document.getElementById('mobile-detail-chart-img').src = entry.image;
  document.getElementById('mobile-detail-title').value = entry.title;
  document.getElementById('mobile-detail-notes').value = entry.notes;
  document.getElementById('mobile-detail-mistakes').value = entry.mistakes;

  // Header title sync
  document.getElementById('mobile-detail-title-header').textContent = entry.title;

  // Render Mobile attributes list
  const attrList = document.getElementById('mobile-detail-attributes-list');
  attrList.innerHTML = '';

  // Bias
  const biasRow = createAttributeRowHTML('Bias', `<select class="input-select" onchange="saveCurrentField('bias', this.value)">
    <option value="Bullish" ${entry.bias === 'Bullish' ? 'selected' : ''}>Bullish</option>
    <option value="Bearish" ${entry.bias === 'Bearish' ? 'selected' : ''}>Bearish</option>
    <option value="Both" ${entry.bias === 'Both' ? 'selected' : ''}>Both</option>
  </select>`, 'fa-solid fa-arrows-up-down');
  attrList.appendChild(biasRow);

  // Date
  const dateRow = createAttributeRowHTML('Date', `<input type="date" class="input-text" value="${entry.date}" onchange="saveCurrentField('date', this.value)">`, 'fa-solid fa-calendar');
  attrList.appendChild(dateRow);

  // Candle Patterns
  const tagSelectorHTML = generateTagMultiSelectHTML(entry.patterns);
  const patternRow = createAttributeRowHTML('Patterns', tagSelectorHTML, 'fa-solid fa-tags');
  attrList.appendChild(patternRow);

  // P&F Status
  const statusRow = createAttributeRowHTML('P/F Status', `<select class="input-select" onchange="saveCurrentField('status', this.value)">
    <option value="PASSED" ${entry.status === 'PASSED' ? 'selected' : ''}>PASSED</option>
    <option value="FAILED" ${entry.status === 'FAILED' ? 'selected' : ''}>FAILED</option>
  </select>`, 'fa-solid fa-circle-check');
  attrList.appendChild(statusRow);

  // Custom attributes (Market, P&L, plus new additions with trash bins)
  customAttributes.forEach(attr => {
    let inputHTML = '';
    const currentVal = entry.customAttributes[attr.name] !== undefined ? entry.customAttributes[attr.name] : attr.defaultValue;
    
    if (attr.name === 'Market') {
      inputHTML = `<input type="text" list="market-datalist-mob" class="input-text" value="${currentVal}" onchange="saveCustomAttribute('Market', this.value)">
        <datalist id="market-datalist-mob">
          <option value="Nifty 50">
          <option value="Bank Nifty">
          <option value="Futures">
          <option value="Gold">
          <option value="Crude Oil">
        </datalist>`;
    } else if (attr.type === 'select') {
      let optionsHtml = '';
      attr.options.forEach(opt => {
        optionsHtml += `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || 'Optional'}</option>`;
      });
      inputHTML = `<select class="input-select" onchange="saveCustomAttribute('${attr.name}', this.value)">${optionsHtml}</select>`;
    } else if (attr.type === 'number') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="Optional" onchange="saveCustomAttribute('${attr.name}', this.value)">`;
    } else {
      inputHTML = `<input type="text" class="input-text" value="${currentVal}" placeholder="e.g. ₹350" onchange="saveCustomAttribute('${attr.name}', this.value)">`;
    }

    const isSystemAttribute = (attr.name === 'Market' || attr.name === 'P&L');
    const customRow = createAttributeRowHTML(attr.name, inputHTML, 'fa-solid fa-cube', !isSystemAttribute);
    attrList.appendChild(customRow);
  });
}

// Mobile Calendar View
function renderMobileCalendar() {
  const container = document.getElementById('mobile-calendar-view');
  if (!container) return;
  container.innerHTML = '';
  const calendarHtml = generateCalendarHTML(2026, 4); // May 2026
  container.innerHTML = calendarHtml;
}

// Mobile Stats Rankings List (Pattern Names & Counts)
function renderMobileStats() {
  const container = document.getElementById('mobile-stats-view');
  if (!container) return;

  const bullishCounts = {};
  const bearishCounts = {};

  entries.forEach(entry => {
    entry.patterns.forEach(pat => {
      const tagObj = tags.find(t => t.name === pat);
      const tagType = tagObj ? tagObj.type : 'Both';
      
      if (tagType === 'Bullish') {
        bullishCounts[pat] = (bullishCounts[pat] || 0) + 1;
      } else if (tagType === 'Bearish') {
        bearishCounts[pat] = (bearishCounts[pat] || 0) + 1;
      } else {
        if (entry.bias === 'Bullish') bullishCounts[pat] = (bullishCounts[pat] || 0) + 1;
        else if (entry.bias === 'Bearish') bearishCounts[pat] = (bearishCounts[pat] || 0) + 1;
      }
    });
  });

  const sortedBullish = Object.entries(bullishCounts).sort((a, b) => b[1] - a[1]);
  const sortedBearish = Object.entries(bearishCounts).sort((a, b) => b[1] - a[1]);

  let bullHtml = '';
  sortedBullish.forEach(([name, count], index) => {
    bullHtml += `
      <div class="stats-rank-item" style="padding:6px 10px; font-size:11px;">
        <div class="stats-rank-label">
          <span class="stats-rank-number">${index + 1}.</span>
          <span>${name}</span>
        </div>
        <span class="stats-rank-badge" style="font-size:9px; padding:1px 6px;">${count}</span>
      </div>
    `;
  });
  if (sortedBullish.length === 0) bullHtml = '<div style="color:var(--text-muted); font-size:11px; padding:6px;">No bullish patterns.</div>';

  let bearHtml = '';
  sortedBearish.forEach(([name, count], index) => {
    bearHtml += `
      <div class="stats-rank-item" style="padding:6px 10px; font-size:11px;">
        <div class="stats-rank-label">
          <span class="stats-rank-number">${index + 1}.</span>
          <span>${name}</span>
        </div>
        <span class="stats-rank-badge" style="background-color: rgba(239, 68, 68, 0.15); color: var(--color-bear); font-size:9px; padding:1px 6px;">${count}</span>
      </div>
    `;
  });
  if (sortedBearish.length === 0) bearHtml = '<div style="color:var(--text-muted); font-size:11px; padding:6px;">No bearish patterns.</div>';

  container.innerHTML = `
    <div style="padding: 10px;">
      <div style="margin-bottom: 16px;">
        <h3 style="font-family: var(--font-display); font-size: 13px; margin-bottom: 8px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-arrow-trend-up" style="color:var(--color-bull);"></i> Bullish Usage</h3>
        <div class="stats-rank-list" style="gap:4px; margin-bottom:10px;">
          ${bullHtml}
        </div>
      </div>
      
      <div>
        <h3 style="font-family: var(--font-display); font-size: 13px; margin-bottom: 8px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-arrow-trend-down" style="color:var(--color-bear);"></i> Bearish Usage</h3>
        <div class="stats-rank-list" style="gap:4px; margin-bottom:10px;">
          ${bearHtml}
        </div>
      </div>
    </div>
  `;
}

// Mobile Dashboard Page
function renderMobileDashboard() {
  const container = document.getElementById('mobile-dashboard-view');
  if (!container) return;

  const totalTrades = entries.length;
  const passedTrades = entries.filter(e => e.status === 'PASSED').length;
  const winRate = totalTrades > 0 ? ((passedTrades / totalTrades) * 100).toFixed(0) : 0;

  container.innerHTML = `
    <div class="stats-grid" style="grid-template-columns: 1fr; gap: 8px; padding: 12px;">
      <div class="stat-card" style="padding:10px;">
        <span class="stat-card-title" style="font-size:10px;">Total Setups</span>
        <span class="stat-card-val" style="font-size:18px;">${totalTrades}</span>
      </div>
      <div class="stat-card" style="padding:10px;">
        <span class="stat-card-title" style="font-size:10px;">Win Rate</span>
        <span class="stat-card-val success" style="font-size:18px;">${winRate}%</span>
      </div>
    </div>
    <div class="stat-list" style="padding:12px; gap:6px;">
      <div class="stat-list-item" style="padding:8px 12px; font-size:11px;">
        <span class="stat-list-label">Most Profitable</span>
        <span class="stat-list-val" style="color:var(--color-bull);">VWAP Support (+₹800)</span>
      </div>
      <div class="stat-list-item" style="padding:8px 12px; font-size:11px;">
        <span class="stat-list-label">Worst Performing</span>
        <span class="stat-list-val" style="color:var(--color-bear);">VWAP Rejection (-₹250)</span>
      </div>
      <div class="stat-list-item" style="padding:8px 12px; font-size:11px;">
        <span class="stat-list-label">Syncthing Connection</span>
        <span class="stat-list-val" style="color:var(--color-bull);"><i class="fa-solid fa-rotate"></i> Active</span>
      </div>
    </div>
  `;
}

// Mobile Settings / More options
function renderMobileMore() {
  const container = document.getElementById('mobile-more-view');
  if (!container) return;

  container.innerHTML = `
    <div class="settings-card" style="padding:12px; gap:8px;">
      <span class="settings-card-title" style="font-size:13px; padding-bottom:6px;">App Settings</span>
      
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
        <span>Theme Control</span>
        <button class="btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="toggleTheme()">Swap Theme</button>
      </div>

      <div style="font-size:11px; word-break:break-all; margin-top:8px;">
        <strong>Sync Folder:</strong> <code>${storagePath || 'Not Configured'}</code>
      </div>
      
      <button class="btn-secondary" style="font-size:10px; padding:4px 8px; margin-top:4px;" onclick="chooseStorageFolder()">Change Folder</button>

      <div style="font-size:11px; color:var(--color-bull); font-weight:600; margin-top:8px; border-top:1px solid var(--border-color); padding-top:8px;">
        <i class="fa-solid fa-rotate-right"></i> Synced by Syncthing
      </div>
    </div>

    <div class="settings-card" style="padding:12px; gap:8px; margin-top:12px;">
      <span class="settings-card-title" style="font-size:13px; padding-bottom:6px;">Local Actions</span>
      <button class="btn-secondary" style="width:100%; font-size:11px; padding:6px;" onclick="clearDatabase()">Reset Demo Entries</button>
      <button class="btn-secondary" style="width:100%; font-size:11px; padding:6px; margin-top:4px;" onclick="alert('Exported SQLite database schema mock (database.db)')">Backup db file</button>
    </div>
  `;
}
