// State variables
let entries = [];
let tags = [];
let customAttributes = [];

let activeEntryId = null;
let activeCalendarDate = null; // Filter setups by calendar date if set
let storagePath = null;        // Sync/storage folder path on local disk

let activeImageIndex = 0;
let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth();


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
window.addEventListener('DOMContentLoaded', async () => {
  // Sync Clock
  initPhoneClock();
  
  // Check storage path setup on launch
  await checkStorageFolderSetup();

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
async function checkStorageFolderSetup() {
  const savedPath = localStorage.getItem('honey_journal_storage_path');
  const setupOverlay = document.getElementById('setup-screen');
  
  if (savedPath) {
    storagePath = savedPath;
    if (setupOverlay) setupOverlay.style.display = 'none';
    
    // Load Database & Render
    await loadDatabase();
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

async function setStoragePath(path) {
  storagePath = path;
  localStorage.setItem('honey_journal_storage_path', path);
  
  const setupOverlay = document.getElementById('setup-screen');
  if (setupOverlay) setupOverlay.style.display = 'none';
  
  // Reload and draw UI
  await loadDatabase();
  renderAll();
}

// Database Operations
async function loadDatabase() {
  const seeds = window.HoneyJournalSeeds;

  if (window.__TAURI__ && storagePath) {
    const { invoke } = window.__TAURI__.tauri;
    try {
      // Create entries directory if not exists using native command
      await invoke('fs_create_dir', { path: `${storagePath}\\entries` });

      // Load tags.json
      try {
        const tagsContent = await invoke('fs_read_text_file', { path: `${storagePath}\\tags.json` });
        tags = JSON.parse(tagsContent);
      } catch (err) {
        console.log("No tags.json found, loading seeds...");
        tags = seeds.initialTags;
        await saveTagsToDisk();
      }

      // Load attributes.json
      try {
        const attrsContent = await invoke('fs_read_text_file', { path: `${storagePath}\\attributes.json` });
        customAttributes = JSON.parse(attrsContent);
      } catch (err) {
        console.log("No attributes.json found, loading seeds...");
        customAttributes = seeds.defaultCustomAttributes;
        await saveAttributesToDisk();
      }

      // Load all files from entries directory
      try {
        const filesContent = await invoke('fs_read_dir_json', { path: `${storagePath}\\entries` });
        const tempEntries = [];
        for (const content of filesContent) {
          try {
            tempEntries.push(JSON.parse(content));
          } catch (e) {
            console.error("Error parsing entry JSON:", e);
          }
        }
        
        // If directory has entries, use them; otherwise, start empty
        if (tempEntries.length > 0) {
          entries = tempEntries;
        } else {
          console.log("Empty folder, starting with empty journal entries.");
          entries = []; 
        }
      } catch (err) {
        console.error("Error reading entries directory:", err);
        entries = [];
      }
      
      // Save local cache backup
      localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
      localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
      localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
      return;
    } catch (err) {
      console.error("Tauri load error, falling back to localStorage:", err);
    }
  }

  // Fallback to localStorage (Web/Mockup mode)
  const localEntries = localStorage.getItem('honey_journal_entries');
  const localTags = localStorage.getItem('honey_journal_tags');
  const localCustomAttrs = localStorage.getItem('honey_journal_custom_attrs');

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

  // Migrate entries to support images array instead of single image string
  entries.forEach(e => {
    if (!e.images) {
      e.images = e.image ? [e.image] : [];
    }
  });
}

let saveTimeout = null;
const entriesToSave = new Set();

async function saveDatabase(specificEntry = null, saveAll = false) {
  localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
  localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
  localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));

  if (window.__TAURI__ && storagePath) {
    if (saveAll) {
      entries.forEach(e => entriesToSave.add(e.id));
    } else if (specificEntry) {
      entriesToSave.add(specificEntry.id);
    } else if (activeEntryId) {
      entriesToSave.add(activeEntryId);
    }

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await saveTagsToDisk();
      await saveAttributesToDisk();
      
      const promises = [];
      for (const id of entriesToSave) {
        const entry = entries.find(e => e.id === id);
        if (entry) {
          promises.push(saveEntryToDisk(entry));
        }
      }
      await Promise.all(promises);
      entriesToSave.clear();
    }, 300);
  }
}

async function saveTagsToDisk() {
  if (!window.__TAURI__ || !storagePath) return;
  const { invoke } = window.__TAURI__.tauri;
  await invoke('fs_write_text_file', {
    path: `${storagePath}\\tags.json`,
    content: JSON.stringify(tags, null, 2)
  }).catch(err => {
    console.error("Failed to save tags.json:", err);
  });
}

async function saveAttributesToDisk() {
  if (!window.__TAURI__ || !storagePath) return;
  const { invoke } = window.__TAURI__.tauri;
  await invoke('fs_write_text_file', {
    path: `${storagePath}\\attributes.json`,
    content: JSON.stringify(customAttributes, null, 2)
  }).catch(err => {
    console.error("Failed to save attributes.json:", err);
  });
}

async function saveEntryToDisk(entry) {
  if (!window.__TAURI__ || !storagePath) return;
  const { invoke } = window.__TAURI__.tauri;
  await invoke('fs_write_text_file', {
    path: `${storagePath}\\entries\\entry-${entry.id}.json`,
    content: JSON.stringify(entry, null, 2)
  }).catch(err => {
    console.error(`Failed to save entry ${entry.id}:`, err);
  });
}

async function removeEntryFromDisk(entryId) {
  if (!window.__TAURI__ || !storagePath) return;
  const { invoke } = window.__TAURI__.tauri;
  await invoke('fs_remove_file', {
    path: `${storagePath}\\entries\\entry-${entryId}.json`
  }).catch(err => {
    console.error(`Failed to delete entry ${entryId}:`, err);
  });
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

  // Close calendar drawer when leaving calendar view
  if (view !== 'calendar') {
    closeCalendarDrawer();
  }

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

  // Apply Search input matching (search patterns, notes, mistakes, bias)
  if (searchText) {
    list = list.filter(e => 
      (e.patterns && e.patterns.join(' ').toLowerCase().includes(searchText)) ||
      (e.notes && e.notes.toLowerCase().includes(searchText)) ||
      (e.mistakes && e.mistakes.toLowerCase().includes(searchText)) ||
      (e.bias && e.bias.toLowerCase().includes(searchText))
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

// Helper to build display name from patterns (no title field)
function getDisplayName(entry) {
  if (entry.patterns && entry.patterns.length > 0) {
    return entry.patterns.join(' · ');
  }
  return 'Untitled Setup';
}

function renderDesktopGallery(list) {
  const container = document.getElementById('desktop-gallery-view');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
      <i class="fa-solid fa-inbox" style="font-size: 32px; margin-bottom: 12px; display: block; opacity: 0.4;"></i>
      <div style="font-size: 14px; margin-bottom: 4px;">No setups found</div>
      <div style="font-size: 12px; opacity: 0.7;">Click <strong>+ New</strong> to create your first setup</div>
    </div>`;
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

    const displayTitle = getDisplayName(entry);

    let tagsHtml = '';
    if (entry.patterns && entry.patterns.length > 0) {
      entry.patterns.forEach(pat => {
        const tagObj = tags.find(t => t.name === pat) || { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' };
        tagsHtml += `<span class="tag-badge" style="color: ${tagObj.color}; background-color: ${tagObj.bg};">${pat}</span>`;
      });
    }

    const firstImage = entry.images && entry.images.length > 0 ? entry.images[0] : '';
    const hasImage = firstImage !== '';

    const imgHtml = hasImage 
      ? `<img src="${firstImage}" alt="${displayTitle}" class="card-img">`
      : `<div class="card-img-empty"><i class="fa-solid fa-chart-line"></i></div>`;

    // Format P&L display
    const plVal = entry.customAttributes ? entry.customAttributes['P&L'] : null;
    let plDisplay = '';
    if (plVal !== null && plVal !== undefined && plVal !== '' && plVal !== 0) {
      const numPl = typeof plVal === 'number' ? plVal : parsePL(String(plVal));
      if (numPl !== 0) {
        const plColor = numPl > 0 ? 'var(--color-bull)' : 'var(--color-bear)';
        plDisplay = `<span style="font-family: var(--font-display); font-weight: 700; font-size: 12px; color: ${plColor};">${numPl > 0 ? '+' : ''}₹${numPl}</span>`;
      }
    }

    card.innerHTML = `
      <div class="card-img-wrapper">
        ${imgHtml}
      </div>
      <div class="card-content">
        <div class="card-patterns" style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;">
          ${tagsHtml || `<span style="color: var(--text-muted); font-size: 11px;">No patterns</span>`}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size:11px; color:var(--text-muted);">
              <i class="fa-solid fa-calendar" style="margin-right:3px;"></i>${entry.date}
            </span>
            ${plDisplay}
          </div>
          <span class="tag-badge" style="background-color: ${biasColor}1A; color: ${biasColor}; border: 1px solid ${biasColor}33; font-size: 10px;">${entry.bias}</span>
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
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No entries found.</td></tr>`;
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

    // Numeric P&L handling
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plNum = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    let plColor = 'inherit';
    if (plNum < 0) plColor = 'var(--color-bear)';
    else if (plNum > 0) plColor = 'var(--color-bull)';
    const plDisplay = plNum !== 0 ? `${plNum > 0 ? '+' : ''}₹${plNum}` : '₹0';

    const firstImage = entry.images && entry.images.length > 0 ? entry.images[0] : '';

    tr.innerHTML = `
      <td>${firstImage ? `<img src="${firstImage}" class="table-img">` : `<div class="table-img" style="background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-chart-line" style="color:var(--text-muted); font-size:12px;"></i></div>`}</td>
      <td>${tagsHtml || '<span style="color:var(--text-muted);">No patterns</span>'}</td>
      <td><span class="tag-badge" style="background-color: var(--bg-tertiary);">${entry.bias}</span></td>
      <td style="font-family: var(--font-display); font-weight:600; color: ${plColor};">${plDisplay}</td>
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

function changeCalendarMonth(delta) {
  currentCalendarMonth += delta;
  if (currentCalendarMonth > 11) {
    currentCalendarMonth = 0;
    currentCalendarYear += 1;
  } else if (currentCalendarMonth < 0) {
    currentCalendarMonth = 11;
    currentCalendarYear -= 1;
  }
  
  if (currentDesktopView === 'calendar') {
    renderDesktopCalendar();
  }
  if (currentMobileView === 'calendar') {
    renderMobileCalendar();
  }
}

// Desktop Calendar - Render compact grid heights
function renderDesktopCalendar() {
  const container = document.getElementById('desktop-calendar-view');
  if (!container) return;
  container.innerHTML = '';
  const calendarHtml = generateCalendarHTML(currentCalendarYear, currentCalendarMonth);
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

  const todayObj = new Date();

  for (let day = 1; day <= numDays; day++) {
    const currentMonthString = (monthIndex + 1) < 10 ? '0' + (monthIndex + 1) : (monthIndex + 1);
    const currentDayString = day < 10 ? '0' + day : day;
    const dateString = `${year}-${currentMonthString}-${currentDayString}`;

    const dayEntries = entries.filter(e => e.date === dateString);
    
    let dotsHtml = '';
    dayEntries.forEach(entry => {
      const statusClass = entry.status === 'PASSED' ? 'passed' : 'failed';
      const displayTitle = getDisplayName(entry);
      dotsHtml += `<span class="calendar-trade-dot ${statusClass}" title="${displayTitle} (${entry.bias})"></span>`;
    });

    const isToday = (day === todayObj.getDate() && monthIndex === todayObj.getMonth() && year === todayObj.getFullYear()) 
      ? 'today' 
      : '';
    const isSelected = activeCalendarDate === dateString ? 'selected' : '';

    cellsHtml += `
      <div class="calendar-day-cell ${isToday} ${isSelected}" onclick="handleCalendarDateClick('${dateString}')">
        <span class="calendar-day-number">${day}</span>
        <div style="display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap;">
          ${dotsHtml}
        </div>
      </div>
    `;
  }

  return `
    <div class="calendar-header">
      <div class="calendar-header-title">${monthNames[monthIndex]} ${year}</div>
      <div>
        <button class="btn-icon" style="display: inline-flex;" onclick="changeCalendarMonth(-1)"><i class="fa-solid fa-chevron-left"></i></button>
        <button class="btn-icon" style="display: inline-flex;" onclick="changeCalendarMonth(1)"><i class="fa-solid fa-chevron-right"></i></button>
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

// Calendar click handler - opens date drawer panel instead of navigating
function handleCalendarDateClick(dateString) {
  if (activeCalendarDate === dateString) {
    // Toggle off if same date clicked
    activeCalendarDate = null;
    closeCalendarDrawer();
  } else {
    activeCalendarDate = dateString;
    openCalendarDrawer(dateString);
  }
  
  // Re-render calendars to highlight selected cell
  if (currentDesktopView === 'calendar') {
    renderDesktopCalendar();
  }
  if (currentMobileView === 'calendar') {
    renderMobileCalendar();
  }
}

// Calendar Drawer Panel Logic
function openCalendarDrawer(dateString) {
  const dateObj = new Date(dateString + 'T00:00:00');
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const formattedDate = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;

  const dayEntries = entries.filter(e => e.date === dateString);

  // Helper to build list of setup cards
  function buildDrawerBodyHtml() {
    if (dayEntries.length === 0) {
      return `
        <div class="calendar-drawer-empty">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 24px; margin-bottom: 10px; display: block; opacity: 0.5;"></i>
          No setups recorded for this date.
        </div>`;
    }
    
    let html = '';
    dayEntries.forEach(entry => {
      let biasColor = 'var(--color-neutral)';
      if (entry.bias === 'Bullish') biasColor = 'var(--color-bull)';
      else if (entry.bias === 'Bearish') biasColor = 'var(--color-bear)';
      else if (entry.bias === 'Both') biasColor = 'var(--color-both)';

      let tagsHtml = '';
      if (entry.patterns && entry.patterns.length > 0) {
        entry.patterns.forEach(pat => {
          const tagObj = tags.find(t => t.name === pat) || { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' };
          tagsHtml += `<span class="tag-badge" style="color: ${tagObj.color}; background-color: ${tagObj.bg}; font-size: 10px;">${pat}</span>`;
        });
      }

      const firstImage = entry.images && entry.images.length > 0 ? entry.images[0] : '';
      const imgHtml = firstImage 
        ? `<img src="${firstImage}" class="drawer-setup-img">`
        : `<div class="drawer-setup-img" style="display:flex; align-items:center; justify-content:center; background:var(--bg-tertiary);"><i class="fa-solid fa-chart-line" style="color:var(--text-muted); font-size:14px;"></i></div>`;

      html += `
        <div class="drawer-setup-card" onclick="openEntryDetail('${entry.id}')">
          ${imgHtml}
          <div class="drawer-setup-info">
            <div class="drawer-setup-patterns">${tagsHtml || '<span style="color: var(--text-muted); font-size: 11px;">No patterns</span>'}</div>
            <div class="drawer-setup-meta">
              <span class="tag-badge" style="font-size: 9px; padding: 1px 6px; background-color: ${biasColor}1A; color: ${biasColor};">${entry.bias}</span>
              <span class="status-${entry.status.toLowerCase()}" style="font-size: 10px;">${entry.status}</span>
            </div>
          </div>
        </div>
      `;
    });
    return html;
  }

  const drawerBodyHtml = buildDrawerBodyHtml();

  // Desktop Drawer
  const desktopDrawer = document.getElementById('desktop-calendar-drawer');
  if (desktopDrawer) {
    document.getElementById('calendar-drawer-date-title').textContent = formattedDate;
    document.getElementById('calendar-drawer-count').textContent = `${dayEntries.length} Setup${dayEntries.length !== 1 ? 's' : ''}`;
    document.getElementById('calendar-drawer-body').innerHTML = drawerBodyHtml;
    desktopDrawer.classList.add('open');
  }

  // Mobile Drawer
  const mobileDrawer = document.getElementById('mobile-calendar-drawer');
  if (mobileDrawer) {
    document.getElementById('mobile-calendar-drawer-date-title').textContent = formattedDate;
    document.getElementById('mobile-calendar-drawer-count').textContent = `${dayEntries.length} Setup${dayEntries.length !== 1 ? 's' : ''}`;
    document.getElementById('mobile-calendar-drawer-body').innerHTML = drawerBodyHtml;
    mobileDrawer.classList.add('open');
  }
}

function closeCalendarDrawer() {
  const desktopDrawer = document.getElementById('desktop-calendar-drawer');
  if (desktopDrawer) desktopDrawer.classList.remove('open');
  
  const mobileDrawer = document.getElementById('mobile-calendar-drawer');
  if (mobileDrawer) mobileDrawer.classList.remove('open');

  activeCalendarDate = null;
}

function closeMobileCalendarDrawer() {
  closeCalendarDrawer();
  // Re-render mobile calendar to remove date highlighting
  if (currentMobileView === 'calendar') {
    renderMobileCalendar();
  }
}

function parsePL(plStr) {
  if (!plStr) return 0;
  const normalized = plStr.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(normalized);
  if (isNaN(parsed)) return 0;
  if (plStr.includes('-')) {
    return -Math.abs(parsed);
  }
  return parsed;
}

function calculatePatternStats() {
  const patternProfit = {};
  const patternCount = {};

  entries.forEach(entry => {
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    const entryPatterns = entry.patterns || [];
    
    entryPatterns.forEach(pat => {
      patternProfit[pat] = (patternProfit[pat] || 0) + plValue;
      patternCount[pat] = (patternCount[pat] || 0) + 1;
    });
  });

  let bestPattern = 'None';
  let bestProfit = -Infinity;
  let worstPattern = 'None';
  let worstProfit = Infinity;

  Object.entries(patternProfit).forEach(([pat, profit]) => {
    if (profit > bestProfit) {
      bestProfit = profit;
      bestPattern = pat;
    }
    if (profit < worstProfit) {
      worstProfit = profit;
      worstPattern = pat;
    }
  });

  return {
    bestPattern: bestPattern !== 'None' ? `${bestPattern} (${bestProfit >= 0 ? '+' : ''}₹${bestProfit})` : 'N/A',
    worstPattern: worstPattern !== 'None' ? `${worstPattern} (${worstProfit >= 0 ? '+' : ''}₹${worstProfit})` : 'N/A'
  };
}

// Stats & Dashboard
function renderDesktopStats(isDashboard = false) {
  const container = document.getElementById('desktop-stats-view');
  if (!container) return;

  const totalTrades = entries.length;
  const passedTrades = entries.filter(e => e.status === 'PASSED').length;
  const winRate = totalTrades > 0 ? ((passedTrades / totalTrades) * 100).toFixed(1) : 0;

  if (isDashboard) {
    const statsObj = calculatePatternStats();
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
          <span class="stat-list-val" style="color: var(--color-bull);">${statsObj.bestPattern}</span>
        </div>
        <div class="stat-list-item">
          <span class="stat-list-label">Worst Performing Pattern</span>
          <span class="stat-list-val" style="color: var(--color-bear);">${statsObj.worstPattern}</span>
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
          <span class="settings-row-sub">Directory where journal entries and image assets are stored</span>
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
    </div>
  `;
}

// Notion Detail Draw Panel (Desktop)
function openEntryDetail(id) {
  activeEntryId = id;
  activeImageIndex = 0; // Reset active image viewer to the first image
  
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

  const imgs = entry.images || [];
  const mainImgEl = document.getElementById('detail-chart-img');
  const mainWrapper = document.getElementById('desktop-main-image-wrapper');

  if (mainImgEl) {
    if (imgs.length > 0) {
      mainImgEl.src = imgs[activeImageIndex];
      mainImgEl.style.display = 'block';
      if (mainWrapper) mainWrapper.classList.remove('empty-placeholder');
    } else {
      mainImgEl.src = '';
      mainImgEl.style.display = 'none';
      if (mainWrapper) mainWrapper.classList.add('empty-placeholder');
    }
  }

  // Render dynamic thumbnail strip
  renderThumbnailStrip(entry, 'desktop');

  document.getElementById('detail-notes').value = entry.notes || '';
  document.getElementById('detail-mistakes').value = entry.mistakes || '';

  // Render Attributes List (Builtin + Dynamic Custom)
  const attrList = document.getElementById('detail-attributes-list');
  attrList.innerHTML = '';

  // Bias - color chips instead of dropdown
  const biasChipsHTML = `
    <div class="bias-chips-container">
      <div class="bias-chip ${entry.bias === 'Bullish' ? 'active-bull' : ''}" onclick="saveCurrentField('bias', 'Bullish'); renderAll();">
        <span class="bias-chip-dot" style="background: var(--color-bull);"></span> Bullish
      </div>
      <div class="bias-chip ${entry.bias === 'Bearish' ? 'active-bear' : ''}" onclick="saveCurrentField('bias', 'Bearish'); renderAll();">
        <span class="bias-chip-dot" style="background: var(--color-bear);"></span> Bearish
      </div>
      <div class="bias-chip ${entry.bias === 'Both' ? 'active-both' : ''}" onclick="saveCurrentField('bias', 'Both'); renderAll();">
        <span class="bias-chip-dot" style="background: var(--color-both);"></span> Both
      </div>
    </div>
  `;
  const biasRow = createAttributeRowHTML('Bias', biasChipsHTML, 'fa-solid fa-arrows-up-down');
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

  // Secondary Custom Attributes (Market, P&L as number, plus new additions with trash bins)
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
    } else if (attr.name === 'P&L') {
      // P&L is always numeric
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="0" onchange="saveCustomAttribute('P&L', Number(this.value))">`;
    } else if (attr.type === 'select') {
      let optionsHtml = '';
      attr.options.forEach(opt => {
        optionsHtml += `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || 'Optional'}</option>`;
      });
      inputHTML = `<select class="input-select" onchange="saveCustomAttribute('${attr.name}', this.value)">${optionsHtml}</select>`;
    } else if (attr.type === 'number') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="0" onchange="saveCustomAttribute('${attr.name}', Number(this.value))">`;
    } else {
      inputHTML = `<input type="text" class="input-text" value="${currentVal}" placeholder="Optional" onchange="saveCustomAttribute('${attr.name}', this.value)">`;
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
  const createdDate = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown';
  const updatedDate = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Unknown';
  document.getElementById('detail-created-time').textContent = `Created: ${createdDate}`;
  document.getElementById('detail-updated-time').textContent = `Updated: ${updatedDate}`;
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
        <button class="tag-create-btn" onclick="openAddTagDialog()"><i class="fa-solid fa-plus"></i> Add New Pattern</button>
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
  entry.updatedAt = new Date().toISOString();
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
  entry.updatedAt = new Date().toISOString();
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

  const defaultValue = type === 'number' ? 0 : (type === 'select' ? options[0] : '');
  const newAttr = { name, type, options, defaultValue };
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

// Custom tags - uses bias chips now
function openAddTagDialog() {
  // Reset bias chips to default (Bullish)
  const chipsGroup = document.getElementById('bias-chips-group');
  if (chipsGroup) {
    chipsGroup.querySelectorAll('.bias-chip').forEach(c => {
      c.classList.remove('active-bull', 'active-bear', 'active-both');
    });
    const firstChip = chipsGroup.querySelector('[data-bias="Bullish"]');
    if (firstChip) firstChip.classList.add('active-bull');
  }
  document.getElementById('dialog-add-tag').classList.add('open');
}

function closeAddTagDialog() {
  document.getElementById('dialog-add-tag').classList.remove('open');
}

// Bias chip selection handler
function selectBiasChip(chipEl) {
  const container = chipEl.closest('.bias-chips-container');
  container.querySelectorAll('.bias-chip').forEach(c => {
    c.classList.remove('active-bull', 'active-bear', 'active-both');
  });
  const bias = chipEl.dataset.bias;
  if (bias === 'Bullish') chipEl.classList.add('active-bull');
  else if (bias === 'Bearish') chipEl.classList.add('active-bear');
  else chipEl.classList.add('active-both');
}

function submitAddTag() {
  const nameEl = document.getElementById('new-tag-name');
  // Get selected bias from chips
  const chipsGroup = document.getElementById('bias-chips-group');
  let biasGroup = 'Bullish';
  const activeChip = chipsGroup.querySelector('.active-bull, .active-bear, .active-both');
  if (activeChip) {
    biasGroup = activeChip.dataset.bias;
  }

  const name = nameEl.value.trim();

  if (!name) {
    alert("Pattern name is required!");
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
  saveDatabase(entry);
  renderAll();
}

// Create new setup
function createNewEntry() {
  const newId = 'entry-' + Date.now();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const newEntry = {
    id: newId,
    bias: "Bullish",
    date: today,
    patterns: [],
    status: "PASSED",
    images: [],
    notes: "",
    mistakes: "",
    customAttributes: {},
    bookmarked: false,
    createdAt: now,
    updatedAt: now
  };

  // Populate custom fields defaults
  customAttributes.forEach(attr => {
    newEntry.customAttributes[attr.name] = attr.defaultValue !== undefined ? attr.defaultValue : '';
  });

  entries.push(newEntry);
  saveDatabase(newEntry);

  openEntryDetail(newId);
}

function deleteActiveEntry() {
  if (!activeEntryId) return;
  
  if (confirm("Are you sure you want to delete this trading journal entry?")) {
    const deletedId = activeEntryId;
    entries = entries.filter(e => e.id !== deletedId);
    saveDatabase();
    if (window.__TAURI__ && storagePath) {
      removeEntryFromDisk(deletedId);
    }
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
      if (!entry.images) entry.images = [];
      entry.images.push(e.target.result);
      activeImageIndex = entry.images.length - 1; // set new image as active
      entry.updatedAt = new Date().toISOString();
      saveDatabase(entry);
      renderAll();
    }
  };
  reader.readAsDataURL(file);
  input.value = ""; // clear input
}

function deleteActiveImage(platform) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry || !entry.images || entry.images.length === 0) return;

  entry.images.splice(activeImageIndex, 1);
  if (activeImageIndex >= entry.images.length) {
    activeImageIndex = Math.max(0, entry.images.length - 1);
  }
  entry.updatedAt = new Date().toISOString();
  saveDatabase(entry);
  renderAll();
}

// Delete a specific image by index from thumbnail strip
function deleteImageByIndex(index) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry || !entry.images || index < 0 || index >= entry.images.length) return;

  entry.images.splice(index, 1);
  if (activeImageIndex >= entry.images.length) {
    activeImageIndex = Math.max(0, entry.images.length - 1);
  }
  entry.updatedAt = new Date().toISOString();
  saveDatabase(entry);
  renderAll();
}

function renderThumbnailStrip(entry, platform) {
  const containerId = platform === 'desktop' ? 'desktop-thumbnail-strip' : 'mobile-thumbnail-strip';
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  const imgs = entry.images || [];

  imgs.forEach((imgSrc, idx) => {
    const thumb = document.createElement('div');
    thumb.className = `thumbnail-item ${idx === activeImageIndex ? 'active' : ''}`;
    thumb.onclick = () => {
      activeImageIndex = idx;
      renderAll();
    };
    thumb.innerHTML = `
      <img src="${imgSrc}" class="thumbnail-img">
      <button class="thumb-delete" onclick="event.stopPropagation(); deleteImageByIndex(${idx});" title="Remove image"><i class="fa-solid fa-xmark"></i></button>
    `;
    container.appendChild(thumb);
  });

  const addBtn = document.createElement('div');
  addBtn.className = 'thumbnail-item add-btn';
  addBtn.onclick = () => triggerImageUpload(platform);
  addBtn.innerHTML = `<i class="fa-solid fa-plus"></i>`;
  container.appendChild(addBtn);
}

function clearDatabase() {
  if (confirm("Are you sure you want to reset all data? This will delete all entries, patterns, and custom attributes.")) {
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

  if (view !== 'calendar') {
    closeCalendarDrawer();
  }

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

    const displayTitle = getDisplayName(entry);

    let tagsHtml = '';
    if (entry.patterns && entry.patterns.length > 0) {
      entry.patterns.forEach(pat => {
        const tagObj = tags.find(t => t.name === pat) || { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' };
        tagsHtml += `<span class="tag-badge" style="color: ${tagObj.color}; background-color: ${tagObj.bg}; margin-right: 2px; font-size: 8px; padding: 1px 4px; scale: 0.95;">${pat}</span>`;
      });
    }

    const firstImage = entry.images && entry.images.length > 0 ? entry.images[0] : '';

    card.innerHTML = `
      <div class="phone-card-img-wrapper">
        ${firstImage ? `<img src="${firstImage}" alt="${displayTitle}" class="phone-card-img">` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-tertiary);"><i class="fa-solid fa-chart-line" style="color:var(--text-muted);"></i></div>`}
      </div>
      <div class="phone-card-header" style="padding: 6px; display: flex; flex-direction: column; gap: 4px;">
        <div class="phone-card-patterns" style="display: flex; flex-wrap: wrap; gap: 2px;">
          ${tagsHtml || `<span style="color: var(--text-muted); font-size: 9px;">No patterns</span>`}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
          <span class="phone-card-date" style="font-size: 8px;">${entry.date}</span>
          <span class="tag-badge" style="font-size:8px; padding: 1px 4px; color: ${biasColor}; background-color: ${biasColor}1A; border: 1px solid ${biasColor}33;">${entry.bias}</span>
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

  const imgs = entry.images || [];
  const mainImgEl = document.getElementById('mobile-detail-chart-img');
  const mainWrapper = document.getElementById('mobile-main-image-wrapper');

  if (mainImgEl) {
    if (imgs.length > 0) {
      mainImgEl.src = imgs[activeImageIndex];
      mainImgEl.style.display = 'block';
      if (mainWrapper) mainWrapper.classList.remove('empty-placeholder');
    } else {
      mainImgEl.src = '';
      mainImgEl.style.display = 'none';
      if (mainWrapper) mainWrapper.classList.add('empty-placeholder');
    }
  }

  // Render dynamic thumbnail strip for mobile
  renderThumbnailStrip(entry, 'mobile');

  document.getElementById('mobile-detail-notes').value = entry.notes || '';
  document.getElementById('mobile-detail-mistakes').value = entry.mistakes || '';

  // Header title sync - show patterns instead of title
  const displayName = getDisplayName(entry);
  document.getElementById('mobile-detail-title-header').textContent = displayName;

  // Render Mobile attributes list
  const attrList = document.getElementById('mobile-detail-attributes-list');
  attrList.innerHTML = '';

  // Bias - color chips
  const biasChipsHTML = `
    <div class="bias-chips-container">
      <div class="bias-chip ${entry.bias === 'Bullish' ? 'active-bull' : ''}" onclick="saveCurrentField('bias', 'Bullish'); renderAll();">
        <span class="bias-chip-dot" style="background: var(--color-bull);"></span> Bullish
      </div>
      <div class="bias-chip ${entry.bias === 'Bearish' ? 'active-bear' : ''}" onclick="saveCurrentField('bias', 'Bearish'); renderAll();">
        <span class="bias-chip-dot" style="background: var(--color-bear);"></span> Bearish
      </div>
      <div class="bias-chip ${entry.bias === 'Both' ? 'active-both' : ''}" onclick="saveCurrentField('bias', 'Both'); renderAll();">
        <span class="bias-chip-dot" style="background: var(--color-both);"></span> Both
      </div>
    </div>
  `;
  const biasRow = createAttributeRowHTML('Bias', biasChipsHTML, 'fa-solid fa-arrows-up-down');
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

  // Custom attributes (Market, P&L as number, plus new additions with trash bins)
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
    } else if (attr.name === 'P&L') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="0" onchange="saveCustomAttribute('P&L', Number(this.value))">`;
    } else if (attr.type === 'select') {
      let optionsHtml = '';
      attr.options.forEach(opt => {
        optionsHtml += `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || 'Optional'}</option>`;
      });
      inputHTML = `<select class="input-select" onchange="saveCustomAttribute('${attr.name}', this.value)">${optionsHtml}</select>`;
    } else if (attr.type === 'number') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="0" onchange="saveCustomAttribute('${attr.name}', Number(this.value))">`;
    } else {
      inputHTML = `<input type="text" class="input-text" value="${currentVal}" placeholder="Optional" onchange="saveCustomAttribute('${attr.name}', this.value)">`;
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
  const calendarHtml = generateCalendarHTML(currentCalendarYear, currentCalendarMonth);
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
  const statsObj = calculatePatternStats();

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
        <span class="stat-list-val" style="color:var(--color-bull);">${statsObj.bestPattern}</span>
      </div>
      <div class="stat-list-item" style="padding:8px 12px; font-size:11px;">
        <span class="stat-list-label">Worst Performing</span>
        <span class="stat-list-val" style="color:var(--color-bear);">${statsObj.worstPattern}</span>
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
    </div>

    <div class="settings-card" style="padding:12px; gap:8px; margin-top:12px;">
      <span class="settings-card-title" style="font-size:13px; padding-bottom:6px;">Data</span>
      <button class="btn-secondary" style="width:100%; font-size:11px; padding:6px;" onclick="clearDatabase()">Reset All Data</button>
    </div>
  `;
}
