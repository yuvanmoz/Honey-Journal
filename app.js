// Tauri v1/v2 compatibility helper
function getTauriInvoke() {
  if (window.__TAURI__) {
    if (window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke;
    } else if (window.__TAURI__.tauri && window.__TAURI__.tauri.invoke) {
      return window.__TAURI__.tauri.invoke;
    }
  }
  return null;
}

// State variables
let entries = [];
let tags = [];
let customAttributes = [];

let activeEntryId = null;
let activeCalendarDate = null; // Filter setups by calendar date if set
let storagePath = null;        // Sync/storage folder path on local disk
let originalEntryState = null; // Revert checkpoint for unsaved edits in existing setups

let activeImageIndex = 0;
let activePatternSubGallery = null;
let currentSubGalleryImages = [];
let activeLightboxIndex = 0;

// Date Formatting Helper (local timezone safe)
function formatDateWithDay(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const dateObj = new Date(year, month, day);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${dateStr} (${days[dateObj.getDay()]})`;
}

let currentCalendarYear = new Date().getFullYear();
let currentCalendarMonth = new Date().getMonth();


// View state
let currentDesktopView = 'dashboard'; // dashboard, patterns, calendar, settings
let currentMobileView = 'dashboard';  // dashboard, patterns, calendar, more
let lastMobileView = 'dashboard';
let currentStatsTab = 'setup';
let currentEquityPeriod = 'all';
let statsCalendarYear = new Date().getFullYear();
let statsCalendarMonth = new Date().getMonth();
let currentStatsPeriod = 'monthly';
let statsSelectedDate = null;
let editingTagName = null;

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

  // Restore collapsible sidebar state
  const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  const sidebar = document.querySelector('.desktop-sidebar');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  if (isCollapsed && sidebar) {
    sidebar.classList.add('collapsed');
    if (collapseBtn) {
      collapseBtn.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
      collapseBtn.title = 'Expand Sidebar';
    }
  }

  // Android Back Key Interceptor
  if (isAndroid()) {
    history.pushState({ page: 'main' }, '');
    window.addEventListener('popstate', handleAndroidBack);
  }

  // Dialog attributes event listener
  const typeSelect = document.getElementById('new-attr-type');
  const optionsWrapper = document.getElementById('new-attr-options-wrapper');
  if (typeSelect && optionsWrapper) {
    typeSelect.addEventListener('change', () => {
      optionsWrapper.style.display = typeSelect.value === 'select' ? 'flex' : 'none';
    });
  }




  // No blur save bindings needed for pure manual save model

  // Auto-save on page refresh/unload
  window.addEventListener('beforeunload', () => {
    // Discard any unsaved entries from memory so they don't persist
    entries = entries.filter(e => e._saved);
    localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
    localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
    localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
  });

  // Wheel scroll zoom for desktop repositioning
  const desktopWrapper = document.getElementById('desktop-main-image-wrapper');
  if (desktopWrapper) {
    desktopWrapper.addEventListener('wheel', (e) => {
      if (!repositionState.isActive || repositionState.platform !== 'desktop') return;
      e.preventDefault();
      const zoomSpeed = 0.05;
      const delta = e.deltaY < 0 ? 1 : -1;
      let newScale = repositionState.currentScale + delta * zoomSpeed;
      newScale = Math.max(1.0, Math.min(5.0, newScale));
      repositionState.currentScale = newScale;
      updateRepositionTransform();
    }, { passive: false });
  }

  // Mobile swipe gestures & pinch-to-zoom
  const mobileWrapper = document.getElementById('mobile-main-image-wrapper');
  if (mobileWrapper) {
    let touchStartX = 0;
    let touchStartY = 0;

    mobileWrapper.addEventListener('touchstart', (e) => {
      if (!repositionState.isActive) {
        // Swipe gesture start
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      } else if (repositionState.platform === 'mobile') {
        // Pinch gesture start
        if (e.touches.length === 2) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          repositionState.startTouchDistance = Math.sqrt(dx * dx + dy * dy);
          repositionState.startTouchScale = repositionState.currentScale;
        }
      }
    }, { passive: false });

    mobileWrapper.addEventListener('touchmove', (e) => {
      if (repositionState.isActive && repositionState.platform === 'mobile') {
        if (e.touches.length === 2 && repositionState.startTouchDistance) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const currentDistance = Math.sqrt(dx * dx + dy * dy);
          const factor = currentDistance / repositionState.startTouchDistance;
          let newScale = repositionState.startTouchScale * factor;
          newScale = Math.max(1.0, Math.min(5.0, newScale));
          repositionState.currentScale = newScale;
          updateRepositionTransform();
        }
      }
    }, { passive: false });

    mobileWrapper.addEventListener('touchend', (e) => {
      if (!repositionState.isActive) {
        // Swipe gesture end
        if (e.changedTouches.length === 1) {
          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;
          
          const minSwipeDistance = 50; // pixels
          if (Math.abs(diffX) > minSwipeDistance && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0) {
              prevImage('mobile');
            } else {
              nextImage('mobile');
            }
          }
        }
      } else if (repositionState.platform === 'mobile') {
        repositionState.startTouchDistance = null;
        repositionState.startTouchScale = null;
      }
    }, { passive: true });
  }

  // --- Upgraded Lightbox Zoom & Drag Event Listeners ---
  const lightboxOverlay = document.getElementById('image-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  
  if (lightboxOverlay && lightboxImg) {
    // 1. Mouse wheel zoom on lightbox
    lightboxOverlay.addEventListener('wheel', (e) => {
      if (lightboxOverlay.style.display !== 'flex') return;
      e.preventDefault();
      
      const zoomSpeed = 0.1;
      const delta = e.deltaY < 0 ? 1 : -1;
      let newScale = lightboxZoomState.scale + delta * zoomSpeed;
      newScale = Math.max(1.0, Math.min(5.0, newScale));
      
      if (newScale === 1.0) {
        lightboxZoomState.translateX = 0;
        lightboxZoomState.translateY = 0;
      }
      
      lightboxZoomState.scale = newScale;
      applyLightboxZoomTransform();
    }, { passive: false });

    // 2. Mouse Drag & Touch Pan
    const startDrag = (clientX, clientY) => {
      if (lightboxZoomState.scale > 1.0) {
        lightboxZoomState.isDragging = true;
        lightboxZoomState.dragStartX = clientX - lightboxZoomState.translateX;
        lightboxZoomState.dragStartY = clientY - lightboxZoomState.translateY;
        lightboxZoomState.draggedDuringThisClick = false;
        clickStartCoords.x = clientX;
        clickStartCoords.y = clientY;
      }
    };

    let clickStartCoords = { x: 0, y: 0 };

    const moveDrag = (clientX, clientY) => {
      if (lightboxZoomState.isDragging) {
        const dx = clientX - clickStartCoords.x;
        const dy = clientY - clickStartCoords.y;
        if (Math.hypot(dx, dy) > 5) {
          lightboxZoomState.draggedDuringThisClick = true;
        }
        lightboxZoomState.translateX = clientX - lightboxZoomState.dragStartX;
        lightboxZoomState.translateY = clientY - lightboxZoomState.dragStartY;
        applyLightboxZoomTransform();
      }
    };

    const endDrag = () => {
      lightboxZoomState.isDragging = false;
    };

    lightboxOverlay.addEventListener('mousedown', (e) => {
      const isInteractive = e.target.closest('button') || e.target.closest('.lightbox-notes-drawer') || e.target.closest('.lightbox-close') || e.target.closest('#lightbox-hud');
      if (isInteractive) return;

      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (lightboxOverlay.style.display === 'flex') {
        moveDrag(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      if (lightboxOverlay.style.display === 'flex') {
        endDrag();
      }
    });

    // Touch events for mobile zooming & panning
    lightboxOverlay.addEventListener('touchstart', (e) => {
      const isInteractive = e.target.closest('button') || e.target.closest('.lightbox-notes-drawer') || e.target.closest('.lightbox-close') || e.target.closest('#lightbox-hud');
      if (isInteractive) return;

      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lightboxZoomState.initialDistance = Math.hypot(dx, dy);
        lightboxZoomState.initialScale = lightboxZoomState.scale;
      }
    }, { passive: false });

    lightboxOverlay.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.hypot(dx, dy);
        if (lightboxZoomState.initialDistance > 0) {
          let newScale = lightboxZoomState.initialScale * (distance / lightboxZoomState.initialDistance);
          newScale = Math.max(1.0, Math.min(5.0, newScale));
          if (newScale === 1.0) {
            lightboxZoomState.translateX = 0;
            lightboxZoomState.translateY = 0;
          }
          lightboxZoomState.scale = newScale;
          applyLightboxZoomTransform();
        }
      }
    }, { passive: false });

    lightboxOverlay.addEventListener('touchend', (e) => {
      endDrag();
      lightboxZoomState.initialDistance = 0;
    });

    // Double tap/click to zoom toggle
    lightboxImg.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (lightboxZoomState.scale > 1.0) {
        lightboxZoomState.scale = 1.0;
        lightboxZoomState.translateX = 0;
        lightboxZoomState.translateY = 0;
      } else {
        lightboxZoomState.scale = 2.5;
        lightboxZoomState.translateX = 0;
        lightboxZoomState.translateY = 0;
      }
      applyLightboxZoomTransform();
    });
  }

  // Clipboard paste listener
  window.addEventListener('paste', handleClipboardPaste);

  // Swipe to Refresh gesture for Mobile
  const phoneScreen = document.getElementById('phone-screen-pane');
  const pullToRefresh = document.getElementById('pull-to-refresh');
  const pullToRefreshText = document.getElementById('pull-to-refresh-text');
  const spinner = pullToRefresh?.querySelector('.spinner-ref');

  if (phoneScreen && pullToRefresh) {
    let pullStartY = 0;
    let isPulling = false;

    const isScrollAtTop = () => {
      const contentArea = document.getElementById('mobile-content-area');
      if (contentArea) {
        return contentArea.scrollTop === 0;
      }
      return true;
    };

    phoneScreen.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1 && isScrollAtTop()) {
        pullStartY = e.touches[0].clientY;
        isPulling = true;
      }
    }, { passive: true });

    phoneScreen.addEventListener('touchmove', (e) => {
      if (!isPulling) return;
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - pullStartY;

      if (deltaY < 0) {
        // User scrolled up (scrolling content down), cancel pull-to-refresh
        isPulling = false;
        pullToRefresh.style.height = '0px';
        return;
      }

      if (deltaY > 0) {
        e.preventDefault();
        const height = Math.min(deltaY * 0.45, 60);
        pullToRefresh.style.height = `${height}px`;

        if (height >= 50) {
          pullToRefreshText.textContent = 'Release to refresh...';
        } else {
          pullToRefreshText.textContent = 'Pull to refresh...';
        }
      }
    }, { passive: false });

    phoneScreen.addEventListener('touchend', async () => {
      if (!isPulling) return;
      isPulling = false;
      const currentHeight = parseFloat(pullToRefresh.style.height) || 0;

      if (currentHeight >= 50) {
        pullToRefresh.style.height = '45px';
        pullToRefreshText.textContent = 'Refreshing...';
        spinner?.classList.add('spinning');

        await loadDatabase().catch(() => {});
        renderAll();

        // Stop spinning and change text to Refreshed! with checkmark icon
        pullToRefreshText.textContent = 'Refreshed!';
        spinner?.classList.remove('spinning');
        if (spinner) {
          spinner.className = 'fa-solid fa-circle-check spinner-ref';
        }

        setTimeout(() => {
          pullToRefresh.style.height = '0px';
          // Restore spinner icon class after sliding out
          setTimeout(() => {
            if (spinner) {
              spinner.className = 'fa-solid fa-arrows-rotate spinner-ref';
            }
          }, 200);
        }, 800);
      } else {
        pullToRefresh.style.height = '0px';
      }
    }, { passive: true });
  }

  // Hide boot splash
  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.visibility = 'hidden';
    setTimeout(() => {
      splash.remove();
    }, 400);
  }
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

// ---------------------------------------------------------------------------
// PATH HELPER
// Always use forward slashes — Rust's Path::new() handles them on Windows too
// and they are the only valid separator on Android.
// ---------------------------------------------------------------------------
function joinPath(...parts) {
  // Normalise any existing backslashes from saved desktop paths, then join
  return parts
    .map(p => p.replace(/\\/g, '/').replace(/\/+$/, ''))
    .join('/');
}

// ---------------------------------------------------------------------------
// DETECT PLATFORM
// window.__TAURI__ is present in ALL Tauri builds (desktop + mobile).
// We detect mobile by checking the user-agent for Android at runtime.
// ---------------------------------------------------------------------------
function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

// ---------------------------------------------------------------------------
// FIRST-RUN SETUP — entry point called from DOMContentLoaded
// ---------------------------------------------------------------------------
async function checkStorageFolderSetup() {
  const savedPath = localStorage.getItem('honey_journal_storage_path');
  const setupOverlay = document.getElementById('setup-screen');

  if (savedPath) {
    storagePath = savedPath;
    if (setupOverlay) setupOverlay.style.display = 'none';
    await loadDatabase();
    switchDesktopView(currentDesktopView);
    switchMobileView(currentMobileView);
    return;
  }

  // No path saved yet — show first-run setup
  if (setupOverlay) setupOverlay.style.display = 'flex';

  if (window.__TAURI__ && isAndroid()) {
    // MOBILE path: check permission first, then auto-create folder
    showSetupStep('permission');
    const invoke = getTauriInvoke();
    const alreadyGranted = await invoke('check_storage_permission').catch(() => false);
    if (alreadyGranted) {
      // Permission was already granted (re-install scenario) — skip straight to ready
      showSetupStep('ready');
    }
  } else {
    // DESKTOP path: show normal folder picker
    showSetupStep('desktop');
  }
}

// Show one of the three setup sub-panels
function showSetupStep(step) {
  ['permission', 'ready', 'desktop'].forEach(id => {
    const el = document.getElementById(`setup-step-${id}`);
    if (el) el.style.display = (id === step) ? 'flex' : 'none';
  });
}

// ── Android: open the system "All files access" settings page ──────────────
async function grantAndroidStoragePermission() {
  if (!window.__TAURI__) return;
  const invoke = getTauriInvoke();
  try {
    await invoke('request_storage_permission');
    // Hide any previous error
    const errEl = document.getElementById('setup-permission-error');
    if (errEl) errEl.style.display = 'none';
  } catch (err) {
    console.error('Could not open settings:', err);
  }
}

// ── Android: user says they have granted — verify and proceed ──────────────
async function continueAfterPermissionGranted() {
  if (!window.__TAURI__) return;
  const invoke = getTauriInvoke();
  const granted = await invoke('check_storage_permission').catch(() => false);
  if (granted) {
    showSetupStep('ready');
    const errEl = document.getElementById('setup-permission-error');
    if (errEl) errEl.style.display = 'none';
  } else {
    const errEl = document.getElementById('setup-permission-error');
    if (errEl) errEl.style.display = 'block';
  }
}

// ── Android: user taps "Open Honey Journal" after permission is confirmed ──
async function finalizeAndroidSetup() {
  const path = '/storage/emulated/0/HoneyJournal';
  await setStoragePath(path);
}

// ── Desktop: native folder picker ─────────────────────────────────────────
async function chooseStorageFolder() {
  if (window.__TAURI__) {
    const invoke = getTauriInvoke();
    try {
      const selected = await invoke('select_folder');
      if (selected) {
        await setStoragePath(selected);
      }
    } catch (err) {
      console.error('Tauri dialog error:', err);
      mockFolderPrompt();
    }
  } else {
    mockFolderPrompt();
  }
}

function mockFolderPrompt() {
  const defaultMockPath = 'd:/CODE/Journal';
  const path = prompt('Enter a local directory path to store your journal files:', storagePath || defaultMockPath);
  if (path) {
    setStoragePath(path);
  }
}

async function setStoragePath(path) {
  // Normalise to forward slashes
  storagePath = path.replace(/\\/g, '/');
  localStorage.setItem('honey_journal_storage_path', storagePath);

  const setupOverlay = document.getElementById('setup-screen');
  if (setupOverlay) setupOverlay.style.display = 'none';

  await loadDatabase();
  switchDesktopView(currentDesktopView);
  switchMobileView(currentMobileView);
}

// ---------------------------------------------------------------------------
// DATABASE OPERATIONS
// All paths use joinPath() which always produces forward-slash strings.
// ---------------------------------------------------------------------------
async function loadDatabase() {
  const seeds = window.HoneyJournalSeeds;

  if (window.__TAURI__ && storagePath) {
    const invoke = getTauriInvoke();
    try {
      // Create entries sub-directory
      await invoke('fs_create_dir', { path: joinPath(storagePath, 'entries') });

      // Load tags.json
      try {
        const tagsContent = await invoke('fs_read_text_file', { path: joinPath(storagePath, 'tags.json') });
        tags = JSON.parse(tagsContent);
      } catch {
        console.log('No tags.json found, seeding...');
        tags = seeds.initialTags;
        await saveTagsToDisk();
      }

      // Load attributes.json
      try {
        const attrsContent = await invoke('fs_read_text_file', { path: joinPath(storagePath, 'attributes.json') });
        customAttributes = JSON.parse(attrsContent);
      } catch {
        console.log('No attributes.json found, seeding...');
        customAttributes = seeds.defaultCustomAttributes;
        await saveAttributesToDisk();
      }

      // Load all entry files
      try {
        const filesContent = await invoke('fs_read_dir_json', { path: joinPath(storagePath, 'entries') });
        const diskEntries = [];
        for (const content of filesContent) {
          try { diskEntries.push(JSON.parse(content)); } catch { /* skip corrupt file */ }
        }

        // Recover unsaved changes from localStorage if any
        const localEntriesStr = localStorage.getItem('honey_journal_entries');
        if (localEntriesStr) {
          try {
            const localEntries = JSON.parse(localEntriesStr);
            const recoveredEntries = [...diskEntries];
            let needsSync = false;

            localEntries.forEach(localEntry => {
              const diskEntry = diskEntries.find(de => de.id === localEntry.id);
              if (!diskEntry) {
                // Entry exists in localStorage but not on disk. Check if it's empty.
                if (!isEntryEmpty(localEntry)) {
                  recoveredEntries.push(localEntry);
                  needsSync = true;
                  console.log(`Recovered unsaved entry ${localEntry.id} from localStorage`);
                }
              } else {
                // Entry exists in both. Compare updatedAt.
                const localTime = new Date(localEntry.updatedAt || 0).getTime();
                const diskTime = new Date(diskEntry.updatedAt || 0).getTime();
                if (localTime > diskTime) {
                  const idx = recoveredEntries.findIndex(re => re.id === localEntry.id);
                  if (idx !== -1) {
                    recoveredEntries[idx] = localEntry;
                    needsSync = true;
                    console.log(`Recovered newer version of entry ${localEntry.id} from localStorage`);
                  }
                }
              }
            });

            entries = recoveredEntries;

            if (needsSync) {
              saveDatabase(null, true, false);
            }
          } catch (e) {
            console.error('Failed to parse localEntries for recovery:', e);
            entries = diskEntries;
          }
        } else {
          entries = diskEntries;
        }

        // Migrate loaded entries
        entries.forEach(e => {
          if (!e.images) e.images = e.image ? [e.image] : [];
          updateEntryStatus(e);
          e._saved = true;
        });
      } catch (err) {
        console.error('Error reading entries directory:', err);
        entries = [];
      }

      // Mirror to localStorage as a fast-read cache
      localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
      localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
      localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
      return;

    } catch (err) {
      console.error('Tauri filesystem error, falling back to localStorage:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // FALLBACK: browser localStorage (web preview / mockup mode only)
  // ---------------------------------------------------------------------------
  const localEntries   = localStorage.getItem('honey_journal_entries');
  const localTags      = localStorage.getItem('honey_journal_tags');
  const localCustomAttrs = localStorage.getItem('honey_journal_custom_attrs');

  entries         = localEntries      ? JSON.parse(localEntries)      : seeds.initialEntries;
  tags            = localTags         ? JSON.parse(localTags)         : seeds.initialTags;
  customAttributes = localCustomAttrs ? JSON.parse(localCustomAttrs)  : seeds.defaultCustomAttributes;

  if (!localEntries)      localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
  if (!localTags)         localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
  if (!localCustomAttrs)  localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));

  // Migrate entries: old single-image string → images array, and status based on P&L
  entries.forEach(e => {
    if (!e.images) e.images = e.image ? [e.image] : [];
    updateEntryStatus(e);
    e._saved = true;
  });
}

function updateEntryStatus(entry) {
  if (!entry) return;
  if (!entry.customAttributes) {
    entry.customAttributes = {};
  }
  const plRaw = entry.customAttributes['P&L'];
  const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
  if (plValue === 0) {
    entry.status = 'MISSED';
  } else if (plValue > 0) {
    entry.status = 'PASSED';
  } else {
    entry.status = 'FAILED';
  }
}

function isEntryEmpty(entry) {
  if (!entry) return true;
  if (entry.patterns && entry.patterns.length > 0) return false;
  if (entry.images && entry.images.length > 0) return false;
  if (entry.notes && entry.notes.trim() !== '') return false;
  if (entry.mistakes && entry.mistakes.trim() !== '') return false;
  
  if (entry.customAttributes) {
    const keysToCheck = ['Market', 'P&L', 'Entry Price', 'Exit Price', 'Quantity', 'Charges'];
    for (const key of keysToCheck) {
      const val = entry.customAttributes[key];
      if (val !== undefined && val !== null && val !== '') {
        return false;
      }
    }
    for (const key in entry.customAttributes) {
      if (!keysToCheck.includes(key)) {
        const val = entry.customAttributes[key];
        if (val !== undefined && val !== null && val !== '') {
          return false;
        }
      }
    }
  }
  return true;
}

// discardEmptyEntryIfNecessary removed in favor of manual save _saved flag logic

let saveTimeout = null;
const entriesToSave = new Set();

async function saveDatabase(specificEntry = null, saveAll = false, immediate = false) {
  // Always write to localStorage as a backup cache
  localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
  localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
  localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));

  // Update revert checkpoint if the active entry is being saved
  if (activeEntryId) {
    const activeEntry = entries.find(e => e.id === activeEntryId);
    if (activeEntry && activeEntry._saved) {
      originalEntryState = JSON.parse(JSON.stringify(activeEntry));
    }
  }

  if (window.__TAURI__ && storagePath) {
    if (saveAll)          entries.forEach(e => entriesToSave.add(e.id));
    else if (specificEntry) entriesToSave.add(specificEntry.id);
    else if (activeEntryId) entriesToSave.add(activeEntryId);

    const performSave = async () => {
      await saveTagsToDisk();
      await saveAttributesToDisk();
      const promises = [];
      for (const id of entriesToSave) {
        const entry = entries.find(e => e.id === id);
        if (entry) promises.push(saveEntryToDisk(entry));
      }
      await Promise.all(promises);
      entriesToSave.clear();
    };

    if (saveTimeout) clearTimeout(saveTimeout);
    if (immediate) await performSave();
    else saveTimeout = setTimeout(performSave, 300);
  }
}

async function saveTagsToDisk() {
  if (!window.__TAURI__ || !storagePath) return;
  const invoke = getTauriInvoke();
  await invoke('fs_write_text_file', {
    path: joinPath(storagePath, 'tags.json'),
    content: JSON.stringify(tags, null, 2)
  }).catch(err => console.error('Failed to save tags.json:', err));
}

async function saveAttributesToDisk() {
  if (!window.__TAURI__ || !storagePath) return;
  const invoke = getTauriInvoke();
  await invoke('fs_write_text_file', {
    path: joinPath(storagePath, 'attributes.json'),
    content: JSON.stringify(customAttributes, null, 2)
  }).catch(err => console.error('Failed to save attributes.json:', err));
}

async function saveEntryToDisk(entry) {
  if (!window.__TAURI__ || !storagePath) return;
  const invoke = getTauriInvoke();
  await invoke('fs_write_text_file', {
    path: joinPath(storagePath, 'entries', `entry-${entry.id}.json`),
    content: JSON.stringify(entry, null, 2)
  }).catch(err => console.error(`Failed to save entry ${entry.id}:`, err));
}

async function removeEntryFromDisk(entryId) {
  if (!window.__TAURI__ || !storagePath) return;
  const invoke = getTauriInvoke();
  await invoke('fs_remove_file', {
    path: joinPath(storagePath, 'entries', `entry-${entryId}.json`)
  }).catch(err => console.error(`Failed to delete entry ${entryId}:`, err));
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

  // Dynamically refresh active pattern subgallery if open
  if (activePatternSubGallery) {
    const patternEntries = entries.filter(e => e.patterns.includes(activePatternSubGallery) && e.images && e.images.length > 0);
    currentSubGalleryImages = [];
    patternEntries.forEach(entry => {
      (entry.images || []).forEach((imgSrc, imgIndex) => {
        currentSubGalleryImages.push({
          src: imgSrc,
          entry: entry,
          imageIndex: imgIndex
        });
      });
    });
    renderPatternSubGallery('desktop');
    renderPatternSubGallery('mobile');
  }
  setupAppleDropdowns();
}

function renderDetailOnly() {
  renderDesktopDetail();
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

  if (mBias) {
    mBias.value = filterBias;
    mBias.classList.toggle('active-filter', filterBias !== 'all');
  }
  if (mPattern) {
    mPattern.value = filterPattern;
    mPattern.classList.toggle('active-filter', filterPattern !== 'all');
  }
  if (mSort) {
    mSort.value = sortOrder;
    mSort.classList.toggle('active-filter', sortOrder !== 'newest');
  }
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

  setupAppleDropdowns();
}

// Dynamic Custom Apple Select Dropdowns
function setupAppleDropdowns() {
  const selects = document.querySelectorAll('select.input-select, select.mobile-filter-select');
  selects.forEach(select => {
    // Check if container already exists
    let container = select.nextElementSibling;
    if (container && container.classList.contains('apple-dropdown-container')) {
      updateAppleDropdown(select);
      return;
    }
    
    // Hide native select
    select.style.display = 'none';
    
    // Create custom container
    container = document.createElement('div');
    container.className = 'apple-dropdown-container';
    
    // Maintain flex layout sizing on mobile
    if (select.classList.contains('mobile-filter-select')) {
      container.style.flex = '1';
    }
    
    const trigger = document.createElement('div');
    trigger.className = 'apple-dropdown-trigger';
    trigger.style.justifyContent = 'space-between';
    trigger.style.width = select.style.width || '100%';
    
    const triggerText = document.createElement('span');
    triggerText.className = 'trigger-text';
    triggerText.textContent = select.options[select.selectedIndex]?.text || '';
    
    const triggerIcon = document.createElement('i');
    triggerIcon.className = 'fa-solid fa-chevron-down';
    triggerIcon.style.fontSize = '9px';
    triggerIcon.style.opacity = '0.6';
    
    trigger.appendChild(triggerText);
    trigger.appendChild(triggerIcon);
    
    const menu = document.createElement('div');
    menu.className = 'apple-dropdown-menu';
    menu.style.width = select.style.width || '100%';
    
    buildDropdownOptions(select, menu, triggerText);
    
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.apple-dropdown-menu.open').forEach(openMenu => {
        if (openMenu !== menu) openMenu.classList.remove('open');
      });
      menu.classList.toggle('open');
    });
    
    container.appendChild(trigger);
    container.appendChild(menu);
    select.parentNode.insertBefore(container, select.nextSibling);
  });
}

function buildDropdownOptions(select, menu, triggerText) {
  menu.innerHTML = '';
  Array.from(select.options).forEach(opt => {
    const item = document.createElement('div');
    item.className = 'apple-dropdown-item';
    if (opt.selected) item.classList.add('active');
    item.textContent = opt.text;
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      select.value = opt.value;
      triggerText.textContent = opt.text;
      
      menu.querySelectorAll('.apple-dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      menu.classList.remove('open');
      
      select.dispatchEvent(new Event('change'));
    });
    
    menu.appendChild(item);
  });
}

function updateAppleDropdown(select) {
  const container = select.nextElementSibling;
  if (!container) return;
  const triggerText = container.querySelector('.trigger-text');
  const menu = container.querySelector('.apple-dropdown-menu');
  if (triggerText && menu) {
    triggerText.textContent = select.options[select.selectedIndex]?.text || '';
    buildDropdownOptions(select, menu, triggerText);
  }
}

// Global click listener to dismiss custom select menus on outside clicks
document.addEventListener('click', () => {
  document.querySelectorAll('.apple-dropdown-menu.open').forEach(menu => {
    menu.classList.remove('open');
  });
});

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
  
  const subGalleryView = document.getElementById('desktop-pattern-subgallery-view');
  if (subGalleryView) subGalleryView.style.display = 'none';
  activePatternSubGallery = null;

  // Close calendar drawer when leaving calendar view
  if (view !== 'calendar') {
    closeCalendarDrawer();
  }

  titleEl.textContent = view.charAt(0).toUpperCase() + view.slice(1);

  if (view === 'patterns') {
    populatePatternFilterDropdowns();
    syncFilterSelectors();
    if (desktopLayout === 'gallery') {
      galleryView.style.display = 'grid';
    } else {
      tableView.style.display = 'block';
    }
    renderDesktopContent();
  } else if (view === 'calendar') {
    calendarView.style.display = 'block';
    renderDesktopCalendar();
  } else if (view === 'settings') {
    settingsView.style.display = 'block';
    renderDesktopSettings();
  } else if (view === 'dashboard') {
    titleEl.textContent = 'Dashboard';
    statsView.style.display = 'block';
    renderDesktopStats();
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

  list.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = `journal-card ${activeEntryId === entry.id ? 'active-border' : ''}`;
    card.onclick = () => openEntryDetail(entry.id);
    card.style.animationDelay = `${index * 40}ms`;

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

    const transformStyle = hasImage && (entry.imageScale || entry.imageX || entry.imageY)
      ? `style="transform: scale(${entry.imageScale || 1}) translate(${entry.imageX || 0}px, ${entry.imageY || 0}px); transform-origin: center center;"`
      : '';

    const imgHtml = hasImage 
      ? `<img src="${firstImage}" alt="${displayTitle}" class="card-img" ${transformStyle}>`
      : `<div class="card-img-empty" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-secondary); color:var(--text-muted); font-size:24px;"><i class="fa-solid fa-chart-line"></i></div>`;

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
              <i class="fa-solid fa-calendar" style="margin-right:3px;"></i>${formatDateWithDay(entry.date)}
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
      <td style="color: var(--text-secondary);">${formatDateWithDay(entry.date)}</td>
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
      const statusClass = entry.status === 'PASSED' ? 'passed' : (entry.status === 'MISSED' ? 'missed' : 'failed');
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
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[dateObj.getDay()];
  const formattedDate = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()} (${dayName})`;

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
function renderDesktopStats() {
  const container = document.getElementById('desktop-stats-view');
  if (!container) return;

  const activeSetup = currentStatsTab === 'setup' ? 'active' : '';
  const activeJournal = currentStatsTab === 'journal' ? 'active' : '';
    
    let statsContent = '';
    
    if (currentStatsTab === 'setup') {
      const bullishCounts = {};
      const bearishCounts = {};

      const incrementCount = (counts, pat, status) => {
        if (!counts[pat]) {
          counts[pat] = { passed: 0, missed: 0, failed: 0, total: 0 };
        }
        counts[pat].total += 1;
        if (status === 'PASSED') counts[pat].passed += 1;
        else if (status === 'FAILED') counts[pat].failed += 1;
        else counts[pat].missed += 1;
      };

      entries.forEach(entry => {
        const status = entry.status || 'MISSED';
        entry.patterns.forEach(pat => {
          const tagObj = tags.find(t => t.name === pat);
          const tagType = tagObj ? tagObj.type : 'Both';
          
          if (tagType === 'Bullish') {
            incrementCount(bullishCounts, pat, status);
          } else if (tagType === 'Bearish') {
            incrementCount(bearishCounts, pat, status);
          } else {
            if (entry.bias === 'Bullish') {
              incrementCount(bullishCounts, pat, status);
            } else if (entry.bias === 'Bearish') {
              incrementCount(bearishCounts, pat, status);
            } else {
              incrementCount(bullishCounts, pat, status);
              incrementCount(bearishCounts, pat, status);
            }
          }
        });
      });

      const sortedBullish = Object.entries(bullishCounts).sort((a, b) => b[1].total - a[1].total);
      const sortedBearish = Object.entries(bearishCounts).sort((a, b) => b[1].total - a[1].total);

      let bullHtml = '';
      sortedBullish.forEach(([name, stats], index) => {
        bullHtml += `
          <div class="stats-rank-item" onclick="openPatternSubGallery('${name}')">
            <div class="stats-rank-label">
              <span class="stats-rank-number">${index + 1}.</span>
              <span>${name}</span>
            </div>
            <div class="stats-rank-badge-group" style="display: flex; gap: 6px;">
              <span class="stats-rank-badge" style="background-color: rgba(162, 224, 72, 0.15); color: var(--color-bull); border: 1px solid rgba(162, 224, 72, 0.3);">${stats.passed} Passed</span>
              <span class="stats-rank-badge" style="background-color: rgba(255, 183, 3, 0.15); color: var(--accent-gold); border: 1px solid rgba(255, 183, 3, 0.3);">${stats.missed} Missed</span>
              <span class="stats-rank-badge" style="background-color: rgba(255, 94, 94, 0.15); color: var(--color-bear); border: 1px solid rgba(255, 94, 94, 0.3);">${stats.failed} Failed</span>
            </div>
          </div>
        `;
      });
      if (sortedBullish.length === 0) bullHtml = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">No bullish patterns logged.</div>';

      let bearHtml = '';
      sortedBearish.forEach(([name, stats], index) => {
        bearHtml += `
          <div class="stats-rank-item" onclick="openPatternSubGallery('${name}')">
            <div class="stats-rank-label">
              <span class="stats-rank-number">${index + 1}.</span>
              <span>${name}</span>
            </div>
            <div class="stats-rank-badge-group" style="display: flex; gap: 6px;">
              <span class="stats-rank-badge" style="background-color: rgba(162, 224, 72, 0.15); color: var(--color-bull); border: 1px solid rgba(162, 224, 72, 0.3);">${stats.passed} Passed</span>
              <span class="stats-rank-badge" style="background-color: rgba(255, 183, 3, 0.15); color: var(--accent-gold); border: 1px solid rgba(255, 183, 3, 0.3);">${stats.missed} Missed</span>
              <span class="stats-rank-badge" style="background-color: rgba(255, 94, 94, 0.15); color: var(--color-bear); border: 1px solid rgba(255, 94, 94, 0.3);">${stats.failed} Failed</span>
            </div>
          </div>
        `;
      });
      if (sortedBearish.length === 0) bearHtml = '<div style="color:var(--text-muted); font-size:13px; padding:10px;">No bearish patterns logged.</div>';

      statsContent = `
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
    } else {
      statsContent = renderJournalStatsTab(false);
    }

    container.innerHTML = `
      <div class="stats-segmented-control">
        <button class="stats-tab-btn ${activeSetup}" onclick="switchStatsTab('setup')">Setup Statistics</button>
        <button class="stats-tab-btn ${activeJournal}" onclick="switchStatsTab('journal')">Journal Statistics</button>
      </div>
      <div id="stats-tab-content" style="margin-top: 16px;">
        ${statsContent}
      </div>
    `;
}

function calculateJournalStats() {
  const executedEntries = entries.filter(e => e.status === 'PASSED' || e.status === 'FAILED');
  const missedEntries = entries.filter(e => e.status === 'MISSED');

  const totalEntries = entries.length;
  const executedCount = executedEntries.length;
  const missedCount = missedEntries.length;

  const tradingDaysSet = new Set(executedEntries.map(e => e.date));
  const tradingDays = tradingDaysSet.size;

  let noTradeDays = 0;
  if (entries.length > 0) {
    const dates = entries.map(e => new Date(e.date).getTime()).filter(t => !isNaN(t));
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      let cur = new Date(minDate);
      while (cur <= maxDate) {
        const yyyy = cur.getFullYear();
        const mm = String(cur.getMonth() + 1).padStart(2, '0');
        const dd = String(cur.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const dayOfWeek = cur.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          if (!tradingDaysSet.has(dateStr)) {
            noTradeDays++;
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
  }

  let grossProfit = 0;
  let grossLoss = 0;
  let winDaysCount = 0;
  let lossDaysCount = 0;
  
  const byDate = {};
  executedEntries.forEach(entry => {
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    
    byDate[entry.date] = (byDate[entry.date] || 0) + plValue;
  });

  let bestDayVal = -Infinity;
  let bestDayDate = 'N/A';
  let worstDayVal = Infinity;
  let worstDayDate = 'N/A';

  Object.entries(byDate).forEach(([dateStr, dailyPL]) => {
    if (dailyPL > 0) {
      grossProfit += dailyPL;
      winDaysCount++;
    } else if (dailyPL < 0) {
      grossLoss += dailyPL;
      lossDaysCount++;
    }

    if (dailyPL > bestDayVal) {
      bestDayVal = dailyPL;
      bestDayDate = dateStr;
    }
    if (dailyPL < worstDayVal) {
      worstDayVal = dailyPL;
      worstDayDate = dateStr;
    }
  });

  const netPL = grossProfit + grossLoss;

  let tradeGrossProfit = 0;
  let tradeGrossLoss = 0;
  let winningTradesCount = 0;
  let losingTradesCount = 0;

  executedEntries.forEach(entry => {
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    if (plValue > 0) {
      tradeGrossProfit += plValue;
      winningTradesCount++;
    } else if (plValue < 0) {
      tradeGrossLoss += plValue;
      losingTradesCount++;
    }
  });

  const winRate = executedCount > 0 ? (winningTradesCount / executedCount) * 100 : 0;
  const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0);

  const avgWinTradePL = winningTradesCount > 0 ? tradeGrossProfit / winningTradesCount : 0;
  const avgLossTradePL = losingTradesCount > 0 ? tradeGrossLoss / losingTradesCount : 0;
  
  const avgWinDay = winDaysCount > 0 ? grossProfit / winDaysCount : 0;
  const avgLossDay = lossDaysCount > 0 ? grossLoss / lossDaysCount : 0;

  const expectancy = executedCount > 0 ? ((winningTradesCount / executedCount) * avgWinTradePL) + (((executedCount - winningTradesCount) / executedCount) * avgLossTradePL) : 0;

  const bestDayStr = bestDayVal !== -Infinity ? `${bestDayDate} (₹${bestDayVal >= 0 ? '+' : ''}${bestDayVal})` : 'N/A';
  const worstDayStr = worstDayVal !== Infinity ? `${worstDayDate} (₹${worstDayVal >= 0 ? '+' : ''}${worstDayVal})` : 'N/A';

  const byWeek = {};
  const weekTradeCount = {};
  const byMonth = {};
  const monthTradeCount = {};
  const byQuarter = {};
  const quarterTradeCount = {};
  const byYear = {};
  const yearTradeCount = {};
  const byDayOfWeek = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const dayOfWeekTradeCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  executedEntries.forEach(entry => {
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    
    const d = new Date(entry.date);
    if (isNaN(d.getTime())) return;

    const yStr = entry.date.slice(0, 4);
    byYear[yStr] = (byYear[yStr] || 0) + plValue;
    yearTradeCount[yStr] = (yearTradeCount[yStr] || 0) + 1;

    const mStr = entry.date.slice(0, 7);
    byMonth[mStr] = (byMonth[mStr] || 0) + plValue;
    monthTradeCount[mStr] = (monthTradeCount[mStr] || 0) + 1;

    const quarter = Math.ceil((d.getMonth() + 1) / 3);
    const qStr = `${yStr}-Q${quarter}`;
    byQuarter[qStr] = (byQuarter[qStr] || 0) + plValue;
    quarterTradeCount[qStr] = (quarterTradeCount[qStr] || 0) + 1;

    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const pastDaysOfYear = (d - startOfYear) / 86400000;
    const wNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
    const wStr = `${yStr}-W${String(wNum).padStart(2, '0')}`;
    byWeek[wStr] = (byWeek[wStr] || 0) + plValue;
    weekTradeCount[wStr] = (weekTradeCount[wStr] || 0) + 1;

    const dow = d.getDay();
    byDayOfWeek[dow] = (byDayOfWeek[dow] || 0) + plValue;
    dayOfWeekTradeCount[dow] = (dayOfWeekTradeCount[dow] || 0) + 1;
  });

  const patternLeaderboardMap = {};
  executedEntries.forEach(entry => {
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    const entryPatterns = entry.patterns || [];
    
    entryPatterns.forEach(pat => {
      if (!patternLeaderboardMap[pat]) {
        patternLeaderboardMap[pat] = { name: pat, totalPL: 0, count: 0, wins: 0 };
      }
      patternLeaderboardMap[pat].totalPL += plValue;
      patternLeaderboardMap[pat].count += 1;
      if (plValue > 0) {
        patternLeaderboardMap[pat].wins += 1;
      }
    });
  });

  const patternLeaderboard = Object.values(patternLeaderboardMap)
    .map(p => {
      p.winRate = p.count > 0 ? (p.wins / p.count) * 100 : 0;
      return p;
    })
    .sort((a, b) => b.totalPL - a.totalPL);

  return {
    totalEntries, executedCount, missedCount,
    tradingDays, noTradeDays,
    grossProfit, grossLoss, netPL,
    winRate, profitFactor, expectancy,
    winDaysCount, lossDaysCount,
    avgWinDay, avgLossDay, bestDayStr, worstDayStr,
    byDate, byWeek, byMonth, byQuarter, byYear, byDayOfWeek,
    weekTradeCount, monthTradeCount, quarterTradeCount, yearTradeCount, dayOfWeekTradeCount,
    patternLeaderboard
  };
}

function switchStatsTab(tab) {
  currentStatsTab = tab;
  renderDesktopStats();
  renderMobileStats();
}

function changeStatsCalendarMonth(offset) {
  statsCalendarMonth += offset;
  if (statsCalendarMonth < 0) {
    statsCalendarMonth = 11;
    statsCalendarYear--;
  } else if (statsCalendarMonth > 11) {
    statsCalendarMonth = 0;
    statsCalendarYear++;
  }
  
  const desktopCal = document.getElementById('desktop-stats-calendar-wrapper');
  const mobileCal = document.getElementById('mobile-stats-calendar-wrapper');
  const html = generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth);
  if (desktopCal) desktopCal.innerHTML = html;
  if (mobileCal) mobileCal.innerHTML = html;

  const defaultDetail = `
    <div class="stats-day-detail" style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:13px; text-align:center;">
      Click any date on the calendar to view trade details here.
    </div>
  `;
  const desktopDetail = document.getElementById('desktop-stats-day-detail-wrapper');
  const mobileDetail = document.getElementById('mobile-stats-day-detail-wrapper');
  if (desktopDetail) desktopDetail.innerHTML = defaultDetail;
  if (mobileDetail) mobileDetail.innerHTML = defaultDetail;
}

function selectStatsCalendarDate(dateStr) {
  statsSelectedDate = dateStr;

  document.querySelectorAll('.stats-cal-cell').forEach(cell => {
    cell.classList.remove('selected');
    if (cell.getAttribute('data-date') === dateStr) {
      cell.classList.add('selected');
    }
  });

  const dayEntries = entries.filter(e => e.date === dateStr);
  const getDetailHTML = () => {
    if (dayEntries.length === 0) {
      return `
        <div class="stats-day-detail">
          <div style="font-size:13px; color:var(--text-muted); text-align:center;">No entries for ${dateStr}</div>
        </div>
      `;
    }

    let html = `
      <div class="stats-day-detail">
        <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">
          Entries on ${dateStr}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
    `;

    dayEntries.forEach(entry => {
      const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
      const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
      const statusClass = entry.status === 'PASSED' ? 'status-passed' : (entry.status === 'MISSED' ? 'status-missed' : 'status-failed');
      
      html += `
        <div class="stats-day-entry-row" onclick="openEntryDetail('${entry.id}')">
          <div style="display:flex; flex-direction:column; gap:3px;">
            <div style="font-size:13px; font-weight:600; color:var(--text-main);">${getDisplayName(entry)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${entry.patterns.join(', ') || 'No patterns'}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px; font-weight:700;" class="${plValue >= 0 ? 'bull' : 'bear'}">
              ₹${plValue >= 0 ? '+' : ''}${plValue}
            </div>
            <span class="${statusClass}" style="font-size:10px; font-weight:700;">${entry.status}</span>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
    return html;
  };

  const desktopDetail = document.getElementById('desktop-stats-day-detail-wrapper');
  const mobileDetail = document.getElementById('mobile-stats-day-detail-wrapper');
  const detailHTML = getDetailHTML();
  
  if (desktopDetail) desktopDetail.innerHTML = detailHTML;
  if (mobileDetail) mobileDetail.innerHTML = detailHTML;
}

function switchStatsPeriod(period) {
  currentStatsPeriod = period;
  const stats = calculateJournalStats();
  
  const dTable = document.getElementById('desktop-pnl-timeline-table-wrapper');
  if (dTable) {
    dTable.innerHTML = generatePLTimelineTableHTML(stats, period);
  }
  const mTable = document.getElementById('mobile-pnl-timeline-table-wrapper');
  if (mTable) {
    mTable.innerHTML = generatePLTimelineTableHTML(stats, period);
  }

  // Update active classes for timeline period buttons
  const timelineSelectors = document.querySelectorAll('.timeline-period-selector .period-btn');
  timelineSelectors.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-period') === period) {
      btn.classList.add('active');
    }
  });
}

function generateStatsCalendarHTML(year, month) {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const firstDay = new Date(year, month, 1).getDay();
  const numDays = new Date(year, month + 1, 0).getDate();

  let html = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
      <button class="btn-icon-sm" onclick="changeStatsCalendarMonth(-1)" style="border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); cursor:pointer;"><i class="fa-solid fa-chevron-left" style="font-size:11px;"></i></button>
      <div style="font-family:var(--font-display); font-size:14px; font-weight:700; color:var(--text-main);">${monthNames[month]} ${year}</div>
      <button class="btn-icon-sm" onclick="changeStatsCalendarMonth(1)" style="border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); cursor:pointer;"><i class="fa-solid fa-chevron-right" style="font-size:11px;"></i></button>
    </div>
    <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px; text-align:center; font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:6px;">
      <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
    </div>
    <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px;">
  `;

  for (let i = 0; i < firstDay; i++) {
    html += `<div style="aspect-ratio:1; border-radius:8px; border: 1px solid transparent;"></div>`;
  }

  for (let day = 1; day <= numDays; day++) {
    const curMonthStr = String(month + 1).padStart(2, '0');
    const curDayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${curMonthStr}-${curDayStr}`;

    const dayEntries = entries.filter(e => e.date === dateStr);
    let cellClass = 'stats-cal-cell-empty';
    let cellStyle = 'aspect-ratio:1; border-radius:8px; border:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; font-size:12px; font-weight:600; position:relative;';

    if (dayEntries.length > 0) {
      const executed = dayEntries.filter(e => e.status === 'PASSED' || e.status === 'FAILED');
      const missed = dayEntries.filter(e => e.status === 'MISSED');
      
      let dailyPL = 0;
      executed.forEach(entry => {
        const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
        dailyPL += typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
      });

      if (executed.length > 0) {
        if (dailyPL > 0) {
          cellClass = 'stats-cal-cell-profit';
        } else if (dailyPL < 0) {
          cellClass = 'stats-cal-cell-loss';
        } else {
          cellClass = 'stats-cal-cell-profit';
        }
      } else if (missed.length > 0) {
        cellClass = 'stats-cal-cell-missed';
      }
    }

    const isSelected = statsSelectedDate === dateStr ? 'selected' : '';

    html += `
      <div class="stats-cal-cell ${cellClass} ${isSelected}" data-date="${dateStr}" onclick="selectStatsCalendarDate('${dateStr}')" style="${cellStyle}">
        ${day}
      </div>
    `;
  }

  html += `
    </div>
  `;

  return html;
}

function generatePLTimelineTableHTML(stats, period) {
  let dataObj = {};
  let tradeCounts = {};
  if (period === 'daily') {
    dataObj = stats.byDate;
    tradeCounts = {};
    entries.forEach(e => {
      if (e.status === 'PASSED' || e.status === 'FAILED') {
        tradeCounts[e.date] = (tradeCounts[e.date] || 0) + 1;
      }
    });
  } else if (period === 'weekly') {
    dataObj = stats.byWeek;
    tradeCounts = stats.weekTradeCount;
  } else if (period === 'monthly') {
    dataObj = stats.byMonth;
    tradeCounts = stats.monthTradeCount;
  } else if (period === 'quarterly') {
    dataObj = stats.byQuarter;
    tradeCounts = stats.quarterTradeCount;
  } else if (period === 'yearly') {
    dataObj = stats.byYear;
    tradeCounts = stats.yearTradeCount;
  }

  const sortedKeys = Object.keys(dataObj).sort().reverse();
  const values = Object.values(dataObj);
  const maxPl = values.length > 0 ? Math.max(...values.map(Math.abs)) : 1;

  let html = `
    <table class="pnl-timeline-table">
      <thead>
        <tr>
          <th>Period</th>
          <th>Trades</th>
          <th style="text-align:right;">P&L</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (sortedKeys.length === 0) {
    html += `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:16px;">No trading activity logged.</td></tr>`;
  } else {
    sortedKeys.forEach(key => {
      const pl = dataObj[key];
      const count = tradeCounts[key] || 0;
      const pct = maxPl > 0 ? (Math.abs(pl) / maxPl * 100) : 0;
      const rowClass = pl >= 0 ? 'pnl-row-profit' : 'pnl-row-loss';
      const barColor = pl >= 0 ? 'var(--color-bull)' : 'var(--color-bear)';
      
      html += `
        <tr class="${rowClass}">
          <td style="font-weight:600;">${key}</td>
          <td>${count} trades</td>
          <td style="text-align:right;">
            <div style="display:inline-flex; flex-direction:column; align-items:flex-end; gap:3px;">
              <span style="font-weight:700;">₹${pl >= 0 ? '+' : ''}${pl.toLocaleString()}</span>
              <div style="width:60px; height:3px; background:rgba(255,255,255,0.06); border-radius:2.5px; overflow:hidden;">
                <div style="width:${pct}%; height:100%; background:${barColor};"></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    });
  }

  html += `
      </tbody>
    </table>
  `;

  return html;
}

function renderMissedSetupsSection() {
  const missedEntries = entries.filter(e => e.status === 'MISSED');
  
  if (missedEntries.length === 0) {
    return `
      <div style="padding:20px; background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; text-align:center; color:var(--text-muted); font-size:13px;">
        No missed setups logged — great discipline! ✅
      </div>
    `;
  }

  let html = `<div class="missed-setups-grid">`;
  missedEntries.forEach(entry => {
    const firstImg = entry.images && entry.images.length > 0 ? entry.images[0] : '';
    const imgHtml = firstImg 
      ? `<img src="${firstImg}" class="missed-setup-thumb" />` 
      : `<div class="missed-setup-thumb" style="display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:24px; background:var(--bg-secondary);"><i class="fa-solid fa-chart-line"></i></div>`;
    
    html += `
      <div class="missed-setup-card" onclick="openEntryDetail('${entry.id}')">
        ${imgHtml}
        <div class="missed-setup-info">
          <div class="missed-date">${entry.date}</div>
          <div class="missed-tags" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.patterns.join(', ') || 'No Setup Name'}</div>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

function getEquityCurveData(period) {
  let filtered = entries.filter(e => e.status === 'PASSED' || e.status === 'FAILED');
  
  // Sort entries chronologically by date
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const now = new Date();
  if (period === 'week') {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(e => new Date(e.date) >= cutoff);
  } else if (period === 'month') {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(e => new Date(e.date) >= cutoff);
  } else if (period === 'year') {
    const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(e => new Date(e.date) >= cutoff);
  }
  
  let currentSum = 0;
  const dataPoints = [{ date: 'Start', pl: 0 }];
  filtered.forEach(entry => {
    const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    currentSum += plValue;
    dataPoints.push({ date: entry.date, pl: currentSum });
  });
  
  return dataPoints;
}

function generateEquityCurveSVG(dataPoints, width = 800, height = 200) {
  if (dataPoints.length <= 1) {
    return `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="background: rgba(255,255,255,0.02); border-radius: 12px;">
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="var(--text-muted)" font-size="13">No trade data available for this period</text>
      </svg>
    `;
  }
  
  const pls = dataPoints.map(d => d.pl);
  const maxPL = Math.max(...pls, 0);
  const minPL = Math.min(...pls, 0);
  const plRange = maxPL - minPL || 1;
  
  const padX = 50;
  const padY = 20;
  
  const points = dataPoints.map((d, i) => {
    const x = padX + (i / (dataPoints.length - 1)) * (width - 2 * padX);
    const y = padY + (1 - (d.pl - minPL) / plRange) * (height - 2 * padY);
    return { x, y, pl: d.pl, date: d.date };
  });
  
  // Zero line
  const zeroY = padY + (1 - (0 - minPL) / plRange) * (height - 2 * padY);
  
  // Create path (Bezier curve)
  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    
    const cp1x = p0.x + (p1.x - p0.x) / 3;
    const cp1y = p0.y;
    const cp2x = p0.x + 2 * (p1.x - p0.x) / 3;
    const cp2y = p1.y;
    
    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }
  
  // Create area path (for gradient fill)
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${height - padY} Z`;
  
  const isNetPositive = dataPoints[dataPoints.length - 1].pl >= 0;
  const strokeColor = isNetPositive ? 'var(--color-bull)' : 'var(--color-bear)';
  const gradId = `equity-grad-${Math.random().toString(36).substr(2, 9)}`;
  
  let gridLines = '';
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const val = minPL + (i / gridCount) * plRange;
    const y = padY + (1 - (val - minPL) / plRange) * (height - 2 * padY);
    gridLines += `
      <line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(255, 255, 255, 0.05)" stroke-width="1" stroke-dasharray="4 4" />
      <text x="${padX - 8}" y="${y + 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">₹${Math.round(val).toLocaleString()}</text>
    `;
  }

  let dots = '';
  points.forEach((p, idx) => {
    if (points.length < 50 || idx === 0 || idx === points.length - 1) {
      dots += `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="${strokeColor}" stroke="var(--bg-primary)" stroke-width="2">
          <title>${p.date}: ₹${p.pl.toLocaleString()}</title>
        </circle>
      `;
    }
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="overflow: visible;">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.2" />
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      
      ${gridLines}
      
      <line x1="${padX}" y1="${zeroY}" x2="${width - padX}" y2="${zeroY}" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />
      <text x="${width - padX + 8}" y="${zeroY + 4}" fill="var(--text-muted)" font-size="9" text-anchor="start">Breakeven</text>

      <path d="${areaD}" fill="url(#${gradId})" />
      
      <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      
      ${dots}
      
      <text x="${padX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="start">${dataPoints[0].date === 'Start' ? (dataPoints[1] ? dataPoints[1].date : '') : dataPoints[0].date}</text>
      <text x="${width - padX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">${dataPoints[dataPoints.length - 1].date}</text>
    </svg>
  `;
}

function switchEquityPeriod(period) {
  currentEquityPeriod = period;
  renderDesktopStats();
  renderMobileStats();
}

function toggleMissedSetupsAccordion(headerEl) {
  const content = headerEl.nextElementSibling;
  const chevron = headerEl.querySelector('.accordion-chevron');
  if (content.style.display === 'none') {
    content.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(90deg)';
  } else {
    content.style.display = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

function renderJournalStatsTab(isMobile = false) {
  const stats = calculateJournalStats();

  // 1. Equity Curve Section
  const equityData = getEquityCurveData(currentEquityPeriod);
  const latestPL = equityData.length > 0 ? equityData[equityData.length - 1].pl : 0;
  const equitySvg = generateEquityCurveSVG(equityData, isMobile ? 500 : 800, 200);
  
  const eqPeriods = ['week', 'month', 'year', 'all'];
  let equityToggleHtml = `<div class="period-selector equity-period-selector" style="margin: 0;">`;
  eqPeriods.forEach(p => {
    const activeClass = currentEquityPeriod === p ? 'active' : '';
    const label = p === 'all' ? 'ALL' : p.toUpperCase();
    equityToggleHtml += `<button class="period-btn ${activeClass}" onclick="switchEquityPeriod('${p}')">${label}</button>`;
  });
  equityToggleHtml += `</div>`;

  const equityCurveCardHtml = `
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'}; margin-bottom: ${isMobile ? '16px' : '24px'};">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Equity Curve</div>
          <div style="font-size:22px; font-weight:800; color:${latestPL >= 0 ? 'var(--color-bull)' : 'var(--color-bear)'}; margin-top:2px;">
            ₹${latestPL >= 0 ? '+' : ''}${latestPL.toLocaleString()}
          </div>
        </div>
        ${equityToggleHtml}
      </div>
      <div style="width:100%; overflow:hidden;">
        ${equitySvg}
      </div>
    </div>
  `;
  
  const activityHtml = `
    <div class="stats-section-title">Trade Activity</div>
    <div class="apple-dashboard-grid" style="grid-template-columns: repeat(${isMobile ? 1 : 2}, 1fr); gap: ${isMobile ? '12px' : '20px'};">
      <div class="apple-metric-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div class="apple-metric-label" style="font-size:12px; font-weight:600;">Trade Execution Ratio</div>
          <div style="font-size:13px; font-weight:700; color:var(--text-main);">${stats.executedCount} / ${stats.totalEntries} <span style="font-size:10px; color:var(--text-muted); font-weight:500;">Executed</span></div>
        </div>
        <div style="height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden; display:flex;">
          <div style="width:${(stats.executedCount / stats.totalEntries * 100) || 0}%; background:var(--color-both); border-radius:4px 0 0 4px;" title="Executed: ${stats.executedCount}"></div>
          <div style="width:${(stats.missedCount / stats.totalEntries * 100) || 0}%; background:var(--accent-gold); border-radius:0 4px 4px 0;" title="Missed: ${stats.missedCount}"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-top:6px; font-weight:500;">
          <span><i class="fa-solid fa-circle" style="color:var(--color-both); font-size:7px; margin-right:3px;"></i> Executed (${stats.executedCount})</span>
          <span><i class="fa-solid fa-circle" style="color:var(--accent-gold); font-size:7px; margin-right:3px;"></i> Missed (${stats.missedCount})</span>
        </div>
      </div>
      
      <div class="apple-metric-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div class="apple-metric-label" style="font-size:12px; font-weight:600;">Trading Days Activity</div>
          <div style="font-size:13px; font-weight:700; color:var(--text-main);">${stats.tradingDays} / ${stats.tradingDays + stats.noTradeDays} <span style="font-size:10px; color:var(--text-muted); font-weight:500;">Active</span></div>
        </div>
        <div style="height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden; display:flex;">
          <div style="width:${(stats.tradingDays / (stats.tradingDays + stats.noTradeDays) * 100) || 0}%; background:var(--color-bull); border-radius:4px 0 0 4px;" title="Active Days: ${stats.tradingDays}"></div>
          <div style="width:${(stats.noTradeDays / (stats.tradingDays + stats.noTradeDays) * 100) || 0}%; background:rgba(255,255,255,0.15); border-radius:0 4px 4px 0;" title="No-Trade Days: ${stats.noTradeDays}"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-top:6px; font-weight:500;">
          <span><i class="fa-solid fa-circle" style="color:var(--color-bull); font-size:7px; margin-right:3px;"></i> Active Days (${stats.tradingDays})</span>
          <span><i class="fa-solid fa-circle" style="color:rgba(255,255,255,0.3); font-size:7px; margin-right:3px;"></i> No-Trade Days (${stats.noTradeDays})</span>
        </div>
      </div>
    </div>
  `;

  const pnlClass = stats.netPL >= 0 ? 'bull' : 'bear';
  const metricsHtml = `
    <div class="stats-section-title">Performance Metrics</div>
    <div class="apple-dashboard-grid" style="grid-template-columns: repeat(${isMobile ? 2 : 4}, 1fr); gap: ${isMobile ? '12px' : '20px'}; margin-bottom: ${isMobile ? '12px' : '20px'};">
      <div class="apple-metric-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div class="apple-metric-label" style="font-size:12px; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
          <span>Net P&L</span>
          <i class="fa-solid ${stats.netPL >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}" style="color:${stats.netPL >= 0 ? 'var(--color-bull)' : 'var(--color-bear)'}; font-size:14px;"></i>
        </div>
        <div class="apple-metric-value ${pnlClass}" style="font-size:22px; font-weight:800; margin: 4px 0;">₹${stats.netPL >= 0 ? '+' : ''}${stats.netPL.toLocaleString()}</div>
        <div class="apple-metric-sub" style="font-size:10px; color:var(--text-muted);">
          Gross: <span style="color:var(--color-bull);">+₹${stats.grossProfit.toLocaleString()}</span> / <span style="color:var(--color-bear);">-₹${Math.abs(stats.grossLoss).toLocaleString()}</span>
        </div>
      </div>
      
      <div class="apple-metric-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div class="apple-metric-label" style="font-size:12px; font-weight:600;">Win Rate</div>
          <div class="win" style="font-size:15px; font-weight:800; color:var(--color-bull);">${stats.winRate.toFixed(1)}%</div>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; display:flex; margin: 6px 0;">
          <div style="width:${stats.winRate}%; background:var(--color-bull); border-radius:3px 0 0 3px;"></div>
          <div style="width:${100 - stats.winRate}%; background:var(--color-bear); border-radius:0 3px 3px 0;"></div>
        </div>
        <div class="apple-metric-sub" style="font-size:10px; color:var(--text-muted); text-align:right;">
          ${stats.winRate.toFixed(0)}% wins of ${stats.executedCount} trades
        </div>
      </div>
      
      <div class="apple-metric-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div class="apple-metric-label" style="font-size:12px; font-weight:600;">Profit vs Losing Days</div>
          <div style="font-size:14px; font-weight:800; color:var(--text-main);">${stats.winDaysCount}W - ${stats.lossDaysCount}L</div>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; display:flex; margin: 6px 0;">
          <div style="width:${(stats.winDaysCount / (stats.winDaysCount + stats.lossDaysCount) * 100) || 0}%; background:var(--color-bull); border-radius:3px 0 0 3px;"></div>
          <div style="width:${(stats.lossDaysCount / (stats.winDaysCount + stats.lossDaysCount) * 100) || 0}%; background:var(--color-bear); border-radius:0 3px 3px 0;"></div>
        </div>
        <div class="apple-metric-sub" style="font-size:10px; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span style="color:var(--color-bull); font-weight:600;">${stats.winDaysCount} Green</span>
          <span style="color:var(--color-bear); font-weight:600;">${stats.lossDaysCount} Red</span>
        </div>
      </div>

      <div class="apple-metric-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div class="apple-metric-label" style="font-size:12px; font-weight:600;">Avg Win/Loss Ratio</div>
          <div style="font-size:15px; font-weight:800; color:var(--text-main);">${stats.avgLossDay !== 0 ? (stats.avgWinDay / Math.abs(stats.avgLossDay)).toFixed(2) : 'N/A'}</div>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; display:flex; margin: 6px 0;">
          <div style="width:${(stats.avgWinDay / (stats.avgWinDay + Math.abs(stats.avgLossDay)) * 100) || 0}%; background:var(--color-bull); border-radius:3px 0 0 3px;"></div>
          <div style="width:${(Math.abs(stats.avgLossDay) / (stats.avgWinDay + Math.abs(stats.avgLossDay)) * 100) || 0}%; background:var(--color-bear); border-radius:0 3px 3px 0;"></div>
        </div>
        <div class="apple-metric-sub" style="font-size:10px; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span>Avg Win: +₹${stats.avgWinDay.toFixed(0)}</span>
          <span>Avg Loss: -₹${Math.abs(stats.avgLossDay).toFixed(0)}</span>
        </div>
      </div>
    </div>
    <div class="apple-dashboard-grid" style="grid-template-columns: repeat(${isMobile ? 1 : 2}, 1fr); gap: ${isMobile ? '12px' : '20px'};">
      <div class="apple-insight-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div class="apple-insight-title" style="font-size:11px;">Best Day / Average Winning Day</div>
        <div class="apple-insight-value bull" style="font-size:${isMobile ? '14px' : '16px'}; font-weight:700;">${stats.bestDayStr}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Average Win Day: ₹+${stats.avgWinDay.toFixed(0)}</div>
      </div>
      <div class="apple-insight-card" style="padding:${isMobile ? '12px' : '16px'}; margin:0;">
        <div class="apple-insight-title" style="font-size:11px;">Worst Day / Average Losing Day</div>
        <div class="apple-insight-value bear" style="font-size:${isMobile ? '14px' : '16px'}; font-weight:700;">${stats.worstDayStr}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Average Loss Day: ₹-${Math.abs(stats.avgLossDay).toFixed(0)}</div>
      </div>
    </div>
  `;

  const timelineHtml = `
    <div class="stats-section-title">P&L Timeline</div>
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'};">
      ${generateStatsPeriodSelectorHTML ? generateStatsPeriodSelectorHTML() : ''}
      <div id="${isMobile ? 'mobile' : 'desktop'}-pnl-timeline-table-wrapper" style="max-height: 250px; overflow-y: auto;">
        ${generatePLTimelineTableHTML(stats, currentStatsPeriod)}
      </div>
    </div>
  `;

  function generateStatsPeriodSelectorHTML() {
    const periods = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
    let periodSelectorHtml = `<div class="period-selector timeline-period-selector">`;
    periods.forEach(p => {
      const activeClass = currentStatsPeriod === p ? 'active' : '';
      periodSelectorHtml += `<button class="period-btn ${activeClass}" data-period="${p}" onclick="switchStatsPeriod('${p}')">${p.toUpperCase()}</button>`;
    });
    periodSelectorHtml += `</div>`;
    return periodSelectorHtml;
  }

  const calendarHtml = `
    <div class="stats-section-title">Performance Calendar</div>
    <div class="apple-dashboard-grid" style="grid-template-columns: ${isMobile ? '1fr' : '1.2fr 0.8fr'}; gap: ${isMobile ? '12px' : '20px'};">
      <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'};" id="${isMobile ? 'mobile' : 'desktop'}-stats-calendar-wrapper">
        ${generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth)}
      </div>
      <div id="${isMobile ? 'mobile' : 'desktop'}-stats-day-detail-wrapper" style="min-height: 100px;">
        <div class="stats-day-detail" style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:13px; text-align:center;">
          Click any date on the calendar to view trade details here.
        </div>
      </div>
    </div>
  `;

  let leaderboardRows = '';
  stats.patternLeaderboard.forEach((p, idx) => {
    leaderboardRows += `
      <tr onclick="openPatternSubGallery('${p.name}')">
        <td style="font-weight:700; color:var(--text-muted); width:40px;">#${idx + 1}</td>
        <td style="font-weight:600; color:var(--text-main);">${p.name}</td>
        <td class="${p.totalPL >= 0 ? 'bull' : 'bear'}" style="font-weight:700; text-align:right;">₹${p.totalPL >= 0 ? '+' : ''}${p.totalPL.toLocaleString()}</td>
        <td style="text-align:right; color:var(--text-secondary);">${p.count} trades</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; flex-direction:column; align-items:flex-end; gap:3px;">
            <span style="font-weight:600; color:var(--color-bull);">${p.winRate.toFixed(1)}%</span>
            <div style="width:40px; height:3px; background:rgba(255,255,255,0.06); border-radius:1.5px; overflow:hidden;">
              <div style="width:${p.winRate}%; height:100%; background:var(--color-bull);"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  });
  if (stats.patternLeaderboard.length === 0) {
    leaderboardRows = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">No patterns found.</td></tr>`;
  }

  const leaderboardHtml = `
    <div class="stats-section-title">Setup Performance Leaderboard</div>
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'}; overflow-x:auto;">
      <table class="stats-leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Setup Name</th>
            <th style="text-align:right;">Net P&L</th>
            <th style="text-align:right;">Trades</th>
            <th style="text-align:right;">Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${leaderboardRows}
        </tbody>
      </table>
    </div>
  `;

  // Missed Setups Accordion Section
  const missedEntries = entries.filter(e => e.status === 'MISSED');
  const missedCount = missedEntries.length;
  
  let missedContent = '';
  if (missedCount === 0) {
    missedContent = `
      <div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px;">
        No missed setups logged — great discipline! ✅
      </div>
    `;
  } else {
    let gridHtml = `<div class="missed-setups-grid" style="margin-top: 10px;">`;
    missedEntries.forEach(entry => {
      const firstImg = entry.images && entry.images.length > 0 ? entry.images[0] : '';
      const imgHtml = firstImg 
        ? `<img src="${firstImg}" class="missed-setup-thumb" />` 
        : `<div class="missed-setup-thumb" style="display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:24px; background:var(--bg-secondary);"><i class="fa-solid fa-chart-line"></i></div>`;
      
      gridHtml += `
        <div class="missed-setup-card" onclick="openEntryDetail('${entry.id}')">
          ${imgHtml}
          <div class="missed-setup-info">
            <div class="missed-date">${entry.date}</div>
            <div class="missed-tags" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${entry.patterns.join(', ') || 'No Setup Name'}</div>
          </div>
        </div>
      `;
    });
    gridHtml += `</div>`;
    missedContent = gridHtml;
  }

  const missedHtml = `
    <div class="stats-section-title">Missed Setup Analysis</div>
    <div class="missed-setups-accordion">
      <div class="missed-setups-header" onclick="toggleMissedSetupsAccordion(this)">
        <span style="font-weight: 600; display: flex; align-items: center; gap: 8px; color: var(--text-main); font-size: 14px;">
          <i class="fa-solid fa-chevron-right accordion-chevron" style="transition: transform 0.2s; color: var(--text-muted);"></i>
          Missed Setups (${missedCount})
        </span>
        <span style="font-size: 11px; color: var(--text-muted);">Click to expand/collapse</span>
      </div>
      <div class="missed-setups-content" style="display: none;">
        ${missedContent}
      </div>
    </div>
  `;

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let dowRows = '';
  let bestDow = -1, bestDowVal = -Infinity;
  let worstDow = -1, worstDowVal = Infinity;
  for (let i = 1; i <= 5; i++) {
    const val = stats.byDayOfWeek[i] || 0;
    if (val > bestDowVal) { bestDowVal = val; bestDow = i; }
    if (val < worstDowVal) { worstDowVal = val; worstDow = i; }
  }
  const maxDowVal = Math.max(...[1,2,3,4,5].map(i => Math.abs(stats.byDayOfWeek[i] || 0))) || 1;

  for (let i = 1; i <= 5; i++) {
    const val = stats.byDayOfWeek[i] || 0;
    const count = stats.dayOfWeekTradeCount[i] || 0;
    const highlightClass = val >= 0 ? 'bull' : 'bear';
    const pct = maxDowVal > 0 ? (Math.abs(val) / maxDowVal * 100) : 0;
    const barColor = val >= 0 ? 'var(--color-bull)' : 'var(--color-bear)';
    
    dowRows += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-weight:600; color:var(--text-secondary);">${daysOfWeek[i]}</span>
          <span style="font-size:10px; color:var(--text-muted);">${count} trades</span>
        </div>
        <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
          <span class="${highlightClass}" style="font-weight:700;">₹${val >= 0 ? '+' : ''}${val.toLocaleString()}</span>
          <div style="width:50px; height:3px; background:rgba(255,255,255,0.06); border-radius:1.5px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:${barColor};"></div>
          </div>
        </div>
      </div>
    `;
  }

  let monthlyTrendRows = '';
  const sortedMonths = Object.keys(stats.byMonth).sort();
  const maxMonthVal = sortedMonths.length > 0 ? Math.max(...sortedMonths.map(m => Math.abs(stats.byMonth[m]))) : 1;
  
  sortedMonths.forEach(m => {
    const val = stats.byMonth[m];
    const count = stats.monthTradeCount[m] || 0;
    const highlightClass = val >= 0 ? 'bull' : 'bear';
    const pct = maxMonthVal > 0 ? (Math.abs(val) / maxMonthVal * 100) : 0;
    const barColor = val >= 0 ? 'var(--color-bull)' : 'var(--color-bear)';
    
    monthlyTrendRows += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="font-weight:600; color:var(--text-secondary);">${m}</span>
          <span style="font-size:10px; color:var(--text-muted);">${count} trades</span>
        </div>
        <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
          <span class="${highlightClass}" style="font-weight:700;">₹${val >= 0 ? '+' : ''}${val.toLocaleString()}</span>
          <div style="width:50px; height:3px; background:rgba(255,255,255,0.06); border-radius:1.5px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:${barColor};"></div>
          </div>
        </div>
      </div>
    `;
  });
  if (sortedMonths.length === 0) {
    monthlyTrendRows = `<div style="text-align:center; color:var(--text-muted); padding:16px; font-size:13px;">No monthly data available.</div>`;
  }

  const timeAnalyticsHtml = `
    <div class="stats-section-title">Time-Based Analytics</div>
    <div class="apple-dashboard-grid" style="grid-template-columns: ${isMobile ? '1fr' : '1fr 1fr'}; gap: ${isMobile ? '12px' : '20px'};">
      <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'};">
        <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">Day of Week Performance</div>
        <div>
          ${dowRows}
        </div>
      </div>
      <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'};">
        <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">Monthly Performance Trend</div>
        <div style="max-height: 250px; overflow-y: auto;">
          ${monthlyTrendRows}
        </div>
      </div>
    </div>
  `;

  const exportHtml = `
    <div class="stats-section-title">Export Options</div>
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:14px; padding:${isMobile ? '12px' : '20px'};">
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Download journal entries and metrics for offline analysis or physical backup.</div>
      <div class="export-buttons-row">
        <button class="btn-primary" onclick="exportJournalCSV()" style="font-size:12px; padding:6px 14px; border-radius:100px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
        <button class="btn-secondary" onclick="exportJournalExcel()" style="font-size:12px; padding:6px 14px; border-radius:100px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-file-excel"></i> Export Excel</button>
        <button class="btn-secondary" onclick="exportJournalPDF()" style="font-size:12px; padding:6px 14px; border-radius:100px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-file-pdf"></i> Save PDF / Print</button>
      </div>
    </div>
  `;

  return `
    <div style="display:flex; flex-direction:column; gap:${isMobile ? '20px' : '32px'}; padding: ${isMobile ? '0 10px 24px' : '0 24px 40px'}; max-width:1200px; margin:0 auto;">
      ${equityCurveCardHtml}
      ${activityHtml}
      ${metricsHtml}
      ${timelineHtml}
      ${calendarHtml}
      ${leaderboardHtml}
      ${missedHtml}
      ${timeAnalyticsHtml}
      ${exportHtml}
    </div>
  `;
}

function exportJournalCSV() {
  let csvContent = "Date,Patterns,Bias,P&L,Status,Market,Notes,Mistakes\n";
  entries.forEach(e => {
    const plRaw = e.customAttributes ? e.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    const market = e.customAttributes ? (e.customAttributes['Market'] || '') : '';
    
    const escapeCsv = (str) => {
      if (!str) return '';
      const stringified = String(str).replace(/"/g, '""');
      return stringified.includes(',') || stringified.includes('\n') || stringified.includes('"') 
        ? `"${stringified}"` 
        : stringified;
    };

    csvContent += [
      escapeCsv(e.date),
      escapeCsv(e.patterns.join(';')),
      escapeCsv(e.bias),
      plValue,
      escapeCsv(e.status),
      escapeCsv(market),
      escapeCsv(e.notes || ''),
      escapeCsv(e.mistakes || '')
    ].join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `trading_journal_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportJournalExcel() {
  let csvContent = "\uFEFFDate,Patterns,Bias,P&L,Status,Market,Notes,Mistakes\n";
  entries.forEach(e => {
    const plRaw = e.customAttributes ? e.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    const market = e.customAttributes ? (e.customAttributes['Market'] || '') : '';
    
    const escapeCsv = (str) => {
      if (!str) return '';
      const stringified = String(str).replace(/"/g, '""');
      return stringified.includes(',') || stringified.includes('\n') || stringified.includes('"') 
        ? `"${stringified}"` 
        : stringified;
    };

    csvContent += [
      escapeCsv(e.date),
      escapeCsv(e.patterns.join(';')),
      escapeCsv(e.bias),
      plValue,
      escapeCsv(e.status),
      escapeCsv(market),
      escapeCsv(e.notes || ''),
      escapeCsv(e.mistakes || '')
    ].join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `trading_journal_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportJournalPDF() {
  const stats = calculateJournalStats();
  const printWindow = window.open('', '_blank');
  
  let leaderboardRows = '';
  stats.patternLeaderboard.forEach((p, idx) => {
    leaderboardRows += `
      <tr>
        <td>#${idx + 1}</td>
        <td>${p.name}</td>
        <td class="${p.totalPL >= 0 ? 'bull' : 'bear'}">₹${p.totalPL >= 0 ? '+' : ''}${p.totalPL.toLocaleString()}</td>
        <td>${p.count}</td>
        <td>${p.winRate.toFixed(1)}%</td>
      </tr>
    `;
  });

  let entryRows = '';
  entries.forEach(e => {
    const plRaw = e.customAttributes ? e.customAttributes['P&L'] : 0;
    const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
    entryRows += `
      <div class="entry-card">
        <div style="display:flex; justify-content:space-between; font-weight:bold; border-bottom:1px solid #ddd; padding-bottom:4px; margin-bottom:6px;">
          <span>${e.date} - ${e.patterns.join(', ') || 'No pattern'} (${e.bias})</span>
          <span class="${plValue >= 0 ? 'bull' : 'bear'}">₹${plValue >= 0 ? '+' : ''}${plValue.toLocaleString()} [${e.status}]</span>
        </div>
        <div style="font-size:12px; margin-bottom:4px;"><strong>Notes:</strong> ${e.notes || 'N/A'}</div>
        <div style="font-size:12px;"><strong>Mistakes:</strong> ${e.mistakes || 'N/A'}</div>
      </div>
    `;
  });

  printWindow.document.write(`
    <html>
      <head>
        <title>Trading Journal Performance Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; padding: 20px; line-height: 1.4; }
          h1, h2 { font-family: inherit; margin-bottom: 8px; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; }
          .metric-card { border: 1px solid #ccc; padding: 12px; border-radius: 8px; background: #fafafa; }
          .metric-label { font-size: 11px; text-transform: uppercase; color: #666; font-weight: 600; }
          .metric-value { font-size: 20px; font-weight: bold; margin-top: 4px; }
          .bull { color: #2e7d32; }
          .bear { color: #c62828; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
          th { background-color: #f5f5f5; }
          .entry-card { border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 12px; page-break-inside: avoid; }
        </style>
      </head>
      <body>
        <h1>Trading Journal Performance Report</h1>
        <p style="font-size:12px; color:#666; margin-bottom:20px;">Generated on ${new Date().toLocaleString()}</p>
        
        <div class="summary-grid">
          <div class="metric-card">
            <div class="metric-label">Total Entries</div>
            <div class="metric-value">${stats.totalEntries}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Executed Trades</div>
            <div class="metric-value">${stats.executedCount}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Net P&L</div>
            <div class="metric-value ${stats.netPL >= 0 ? 'bull' : 'bear'}">₹${stats.netPL >= 0 ? '+' : ''}${stats.netPL.toLocaleString()}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Win Rate</div>
            <div class="metric-value bull">${stats.winRate.toFixed(1)}%</div>
          </div>
        </div>

        <h2>Setup Leaderboard</h2>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Setup Name</th>
              <th>Net P&L</th>
              <th>Trades</th>
              <th>Win Rate</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboardRows}
          </tbody>
        </table>

        <h2>Detailed Trading Logs</h2>
        ${entryRows}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// Settings View - render storagePath dynamically with Apple Settings list layout
function renderDesktopSettings() {
  const container = document.getElementById('desktop-settings-view');
  if (!container) return;
  container.innerHTML = `
    <div class="apple-settings-group-title">Local Folder Connections</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #007aff;">
            <i class="fa-solid fa-folder"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Journal Folder Path</span>
            <span class="apple-settings-desc">Directory where journal entries and image assets are stored</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <span class="apple-settings-value" style="background-color: rgba(255,255,255,0.03); padding: 4px 8px; border-radius: 6px; font-size: 11px; border: 1px solid var(--border-color);">${storagePath || 'Not Configured'}</span>
        </div>
      </div>
      
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #34c759;">
            <i class="fa-solid fa-folder-open"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Change Working Directory</span>
            <span class="apple-settings-desc">Relocate the database and synced items</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 11px; padding: 4px 12px; border-radius: 100px;" onclick="chooseStorageFolder()">Change Folder</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 4px;"></i>
        </div>
      </div>
    </div>

    <div class="apple-settings-group-title">Backup & Restore</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #ff9500;">
            <i class="fa-solid fa-file-zipper"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Export Backup (.zip)</span>
            <span class="apple-settings-desc">Package all setups, screenshots, and custom attributes into a ZIP file</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-primary" style="font-size: 11px; padding: 4px 12px; border-radius: 100px;" onclick="exportBackupZip()">Export Data</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 4px;"></i>
        </div>
      </div>
      
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #ff3b30;">
            <i class="fa-solid fa-file-import"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Import Backup (.zip)</span>
            <span class="apple-settings-desc">Restore all setups and database from a previously exported ZIP file (Warning: Overwrites existing data)</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 11px; padding: 4px 12px; border-radius: 100px;" onclick="triggerImportZip()">Import Data</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 4px;"></i>
        </div>
      </div>
    </div>
    <div style="text-align: center; margin-top: 32px; padding-bottom: 16px;">
      <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">Version 1.0.1</span>
    </div>
  `;
}

// Notion Detail Draw Panel (Desktop)
function openEntryDetail(id) {
  // Revert or discard currently active entry before loading the new one
  if (activeEntryId && activeEntryId !== id) {
    const prevEntry = entries.find(e => e.id === activeEntryId);
    if (prevEntry) {
      if (!prevEntry._saved) {
        discardUnsavedNewEntry(prevEntry.id);
      } else if (originalEntryState && originalEntryState.id === prevEntry.id) {
        // Revert in-memory edits to the original loaded state
        const idx = entries.findIndex(e => e.id === prevEntry.id);
        if (idx !== -1) {
          entries[idx] = JSON.parse(JSON.stringify(originalEntryState));
        }
      }
    }
  }

  activeEntryId = id;
  activeImageIndex = 0; // Reset active image viewer to the first image

  // Save checkpoint for the newly opened entry
  const entry = entries.find(e => e.id === id);
  if (entry) {
    originalEntryState = JSON.parse(JSON.stringify(entry));
  } else {
    originalEntryState = null;
  }
  
  // Show Panel
  document.getElementById('desktop-detail-pane').classList.remove('closed');
  
  // Mobile detail slide-up
  const mobileDetail = document.getElementById('mobile-detail-pane');
  if (mobileDetail) mobileDetail.classList.add('open');

  renderAll();
}

function closeDesktopDetail() {
  const entry = entries.find(e => e.id === activeEntryId);
  if (entry) {
    if (!entry._saved) {
      discardUnsavedNewEntry(entry.id);
    } else if (originalEntryState && originalEntryState.id === entry.id) {
      // Revert in-memory edits to original state
      const idx = entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) {
        entries[idx] = JSON.parse(JSON.stringify(originalEntryState));
      }
    }
  }
  originalEntryState = null;
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
      mainImgEl.style.transform = `scale(${entry.imageScale || 1}) translate(${entry.imageX || 0}px, ${entry.imageY || 0}px)`;
      if (mainWrapper) mainWrapper.classList.remove('empty-placeholder');
      document.getElementById('desktop-image-actions').style.display = 'flex';
      document.getElementById('desktop-reposition-toggle').style.display = 'inline-flex';
      
      const hasNav = imgs.length > 1;
      document.getElementById('desktop-image-prev').style.display = hasNav ? 'flex' : 'none';
      document.getElementById('desktop-image-next').style.display = hasNav ? 'flex' : 'none';
    } else {
      mainImgEl.src = '';
      mainImgEl.style.display = 'none';
      mainImgEl.style.transform = 'none';
      if (mainWrapper) mainWrapper.classList.add('empty-placeholder');
      document.getElementById('desktop-image-actions').style.display = 'flex';
      document.getElementById('desktop-reposition-toggle').style.display = 'none';
      document.getElementById('desktop-reposition-done').style.display = 'none';
      document.getElementById('desktop-image-prev').style.display = 'none';
      document.getElementById('desktop-image-next').style.display = 'none';
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
      <div class="bias-chip ${entry.bias === 'Bullish' ? 'active-bull' : ''}" onclick="setBias('Bullish', this)">
        <span class="bias-chip-dot" style="background: var(--color-bull);"></span> Bullish
      </div>
      <div class="bias-chip ${entry.bias === 'Bearish' ? 'active-bear' : ''}" onclick="setBias('Bearish', this)">
        <span class="bias-chip-dot" style="background: var(--color-bear);"></span> Bearish
      </div>
      <div class="bias-chip ${entry.bias === 'Both' ? 'active-both' : ''}" onclick="setBias('Both', this)">
        <span class="bias-chip-dot" style="background: var(--color-both);"></span> Both
      </div>
    </div>
  `;
  const biasRow = createAttributeRowHTML('Bias', biasChipsHTML, 'fa-solid fa-arrows-up-down');
  attrList.appendChild(biasRow);

  // Date
  const dateRow = createAttributeRowHTML('Date', `<input type="date" class="input-text" value="${entry.date}" onchange="setEntryDate(this.value)">`, 'fa-solid fa-calendar');
  attrList.appendChild(dateRow);

  // Patterns tags
  const tagSelectorHTML = generateTagMultiSelectHTML(entry.patterns);
  const patternRow = createAttributeRowHTML('Patterns', tagSelectorHTML, 'fa-solid fa-tags');
  attrList.appendChild(patternRow);

  // Status
  let statusBadgeClass = 'status-missed';
  if (entry.status === 'PASSED') statusBadgeClass = 'status-passed';
  if (entry.status === 'FAILED') statusBadgeClass = 'status-failed';

  const statusRow = createAttributeRowHTML('Status', `
    <span class="tag-badge ${statusBadgeClass}" style="font-weight: 700; padding: 4px 12px; border-radius: 6px; font-size: 11px;">${entry.status}</span>
  `, 'fa-solid fa-circle-check');
  attrList.appendChild(statusRow);

  // Entry and Exit Price (side-by-side)
  const entryPriceVal = entry.customAttributes && entry.customAttributes['Entry Price'] !== undefined ? entry.customAttributes['Entry Price'] : '';
  const entryPriceRow = createAttributeRowHTML('Entry', `<input type="number" id="desktop-input-entry" class="input-text" value="${entryPriceVal}" placeholder="Optional" oninput="updateCalculationsRealTime('desktop')">`, 'fa-solid fa-dollar-sign');
  
  const exitPriceVal = entry.customAttributes && entry.customAttributes['Exit Price'] !== undefined ? entry.customAttributes['Exit Price'] : '';
  const exitPriceRow = createAttributeRowHTML('Exit', `<input type="number" id="desktop-input-exit" class="input-text" value="${exitPriceVal}" placeholder="Optional" oninput="updateCalculationsRealTime('desktop')">`, 'fa-solid fa-arrow-right-to-bracket');

  const pricePair = document.createElement('div');
  pricePair.className = 'attribute-row-pair';
  pricePair.appendChild(entryPriceRow);
  pricePair.appendChild(exitPriceRow);
  attrList.appendChild(pricePair);

  // Quantity and Charges (side-by-side)
  const quantityVal = entry.customAttributes && entry.customAttributes['Quantity'] !== undefined ? entry.customAttributes['Quantity'] : '';
  const quantityRow = createAttributeRowHTML('Qty', `<input type="number" id="desktop-input-qty" class="input-text" value="${quantityVal}" placeholder="Optional" oninput="updateCalculationsRealTime('desktop')">`, 'fa-solid fa-calculator');
  
  const chargesVal = entry.customAttributes && entry.customAttributes['Charges'] !== undefined ? entry.customAttributes['Charges'] : '';
  const chargesRow = createAttributeRowHTML('Charges', `<input type="number" id="desktop-input-charges" class="input-text" value="${chargesVal}" placeholder="Optional" oninput="updateCalculationsRealTime('desktop')">`, 'fa-solid fa-percent');

  const qtyChargesPair = document.createElement('div');
  qtyChargesPair.className = 'attribute-row-pair';
  qtyChargesPair.appendChild(quantityRow);
  qtyChargesPair.appendChild(chargesRow);
  attrList.appendChild(qtyChargesPair);

  // Secondary Custom Attributes (Market, P&L as number, plus new additions with trash bins)
  customAttributes.forEach(attr => {
    if (attr.name === 'Entry Price' || attr.name === 'Exit Price' || attr.name === 'Quantity' || attr.name === 'Charges') return;
    let inputHTML = '';
    const currentVal = entry.customAttributes[attr.name] !== undefined ? entry.customAttributes[attr.name] : attr.defaultValue;
    
    if (attr.name === 'Market') {
      inputHTML = `<input type="text" id="desktop-input-market" list="market-datalist" class="input-text" value="${currentVal}">
        <datalist id="market-datalist">
          <option value="Nifty 50">
          <option value="Bank Nifty">
          <option value="Futures">
          <option value="Gold">
          <option value="Crude Oil">
        </datalist>`;
    } else if (attr.name === 'P&L') {
      // P&L is always numeric
      inputHTML = `<input type="number" id="desktop-input-pl" class="input-text" value="${currentVal}" placeholder="0" readonly style="opacity: 0.8; cursor: not-allowed;">`;
    } else if (attr.type === 'select') {
      let optionsHtml = '';
      attr.options.forEach(opt => {
        optionsHtml += `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || 'Optional'}</option>`;
      });
      inputHTML = `<select class="input-select">${optionsHtml}</select>`;
    } else if (attr.type === 'number') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="0">`;
    } else {
      inputHTML = `<input type="text" class="input-text" value="${currentVal}" placeholder="Optional">`;
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
  // Build compact selected badges display
  let badgesHtml = '';
  selectedPatterns.forEach(pat => {
    const tagObj = tags.find(t => t.name === pat) || { color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' };
    badgesHtml += `<span class="tag-badge" style="color: ${tagObj.color}; background-color: ${tagObj.bg};">${pat}</span>`;
  });

  const emptyHint = selectedPatterns.length === 0
    ? `<span class="tag-picker-hint">Tap to add patterns</span>`
    : '';

  return `
    <div class="tag-picker-trigger" onclick="openTagPickerPopup(event, this)" title="Edit patterns">
      <div class="tag-picker-badges">
        ${badgesHtml}${emptyHint}
      </div>
      <i class="fa-solid fa-chevron-down tag-picker-chevron"></i>
    </div>
  `;
}

// ── Tag Picker Popup ────────────────────────────────────────────────────────
let _tagPickerAnchor = null;
let _selectedPopupColor = 'green';

function openTagPickerPopup(event, triggerEl) {
  event.stopPropagation();
  closeTagPickerPopup(); // close any existing

  _selectedPopupColor = 'green';
  _tagPickerAnchor = triggerEl;
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  const popup = document.createElement('div');
  popup.id = 'tag-picker-popup';
  popup.className = 'tag-picker-popup';
  popup.innerHTML = `
    <div class="tag-picker-search-row">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input type="text" class="tag-picker-input" placeholder="Search or create pattern..." value="" oninput="refreshTagPickerPopup(this.value)" onkeydown="handleTagPickerKey(event, this)">
    </div>
    <div class="tag-picker-list"></div>
    <div class="tag-picker-create-container"></div>
  `;
  document.body.appendChild(popup);

  // Position below trigger
  positionTagPickerPopup(triggerEl, popup);

  // Populate initial list
  refreshTagPickerPopup('');

  // Focus the input
  const input = popup.querySelector('.tag-picker-input');
  if (input) input.focus();

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', _tagPickerOutsideClick);
  }, 10);
}

function positionTagPickerPopup(triggerEl, popup) {
  const rect = triggerEl.getBoundingClientRect();
  const popW = 260;
  let left = rect.left;
  let top = rect.bottom + 4;

  // Prevent going off right edge
  if (left + popW > window.innerWidth - 8) {
    left = window.innerWidth - popW - 8;
  }
  // Prevent going off bottom
  const popH = 280;
  if (top + popH > window.innerHeight - 8) {
    top = rect.top - popH - 4;
  }

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.width = popW + 'px';
}

function refreshTagPickerPopup(query) {
  const popup = document.getElementById('tag-picker-popup');
  if (!popup) return;
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  const listContainer = popup.querySelector('.tag-picker-list');
  const createContainer = popup.querySelector('.tag-picker-create-container');
  if (!listContainer || !createContainer) return;

  const lq = query.toLowerCase().trim();
  const filtered = lq ? tags.filter(t => t.name.toLowerCase().includes(lq)) : tags;
  const exactMatch = tags.find(t => t.name.toLowerCase() === lq);

  // 1. Build List HTML
  let listHtml = '';
  if (filtered.length === 0 && !lq) {
    listHtml = `<div class="tag-picker-empty">No patterns yet. Type to create one.</div>`;
  } else {
    filtered.forEach(t => {
      const isSelected = entry.patterns.includes(t.name);
      listHtml += `
        <div class="tag-picker-item ${isSelected ? 'selected' : ''}" onclick="togglePatternTagFromPopup('${t.name}')">
          <span class="tag-badge" style="color: ${t.color}; background-color: ${t.bg};">${t.name}</span>
          ${isSelected ? '<i class="fa-solid fa-check tag-picker-check"></i>' : ''}
          <div class="tag-picker-item-actions">
            <button type="button" class="tag-picker-action-btn" onclick="startTagRenameFromPopup(event, '${t.name}')" title="Rename"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="tag-picker-action-btn del" onclick="deleteTagFromPopup(event, '${t.name}')" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>
      `;
    });
  }
  listContainer.innerHTML = listHtml;

  // 2. Build Create Row HTML
  let createHtml = '';
  if (lq && !exactMatch) {
    createHtml = `
      <div class="tag-picker-create-row">
        <span class="tag-picker-create-label">Create "${query}"</span>
        <div class="tag-picker-colors">
          <button type="button" class="tag-color-btn tag-color-green ${_selectedPopupColor === 'green' ? 'active' : ''}" data-color="green" onclick="selectPopupColor('green',this)" title="Bullish"></button>
          <button type="button" class="tag-color-btn tag-color-red ${_selectedPopupColor === 'red' ? 'active' : ''}" data-color="red" onclick="selectPopupColor('red',this)" title="Bearish"></button>
          <button type="button" class="tag-color-btn tag-color-blue ${_selectedPopupColor === 'blue' ? 'active' : ''}" data-color="blue" onclick="selectPopupColor('blue',this)" title="Both"></button>
        </div>
        <button type="button" class="tag-picker-add-btn" onclick="createTagFromPopup()" title="Add"><i class="fa-solid fa-plus"></i></button>
      </div>
    `;
  }
  createContainer.innerHTML = createHtml;
}

function handleTagPickerKey(event, inputEl) {
  if (event.key === 'Escape') { closeTagPickerPopup(); return; }
  if (event.key === 'Enter') {
    event.preventDefault();
    const popup = document.getElementById('tag-picker-popup');
    const createBtn = popup && popup.querySelector('.tag-picker-add-btn');
    if (createBtn) createBtn.click();
    else {
      // If Enter on exact existing tag, select it
      const lq = inputEl.value.toLowerCase().trim();
      const exact = tags.find(t => t.name.toLowerCase() === lq);
      if (exact) togglePatternTagFromPopup(exact.name);
    }
  }
}

function togglePatternTagFromPopup(tagName) {
  togglePatternTag(tagName);
  // Refresh popup list
  const popup = document.getElementById('tag-picker-popup');
  if (!popup) return;
  const input = popup.querySelector('.tag-picker-input');
  const query = input ? input.value : '';
  refreshTagPickerPopup(query);
}

function selectPopupColor(colorName, btnEl) {
  _selectedPopupColor = colorName;
  const group = btnEl.closest('.tag-picker-colors');
  if (group) {
    group.querySelectorAll('.tag-color-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }
}

function createTagFromPopup() {
  const popup = document.getElementById('tag-picker-popup');
  if (!popup) return;
  const input = popup.querySelector('.tag-picker-input');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) return;

  const activeColorBtn = popup.querySelector('.tag-picker-colors .tag-color-btn.active');
  const colorName = activeColorBtn ? activeColorBtn.dataset.color : _selectedPopupColor;
  let color = '#3b82f6', type = 'Both';
  if (colorName === 'green') { color = '#10b981'; type = 'Bullish'; }
  else if (colorName === 'red') { color = '#ef4444'; type = 'Bearish'; }

  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0,2),16), g = parseInt(hex.substring(2,4),16), b = parseInt(hex.substring(4,6),16);
  const bg = `rgba(${r},${g},${b},0.15)`;
  tags.push({ name, color, bg, type });

  const entry = entries.find(e => e.id === activeEntryId);
  if (entry && !entry.patterns.includes(name)) entry.patterns.push(name);

  saveDatabase(entry, false, true);
  renderAll();

  // Clear search input and refresh popup list
  if (input) {
    input.value = '';
    _selectedPopupColor = 'green';
    refreshTagPickerPopup('');
    input.focus();
  }
}

function startTagRenameFromPopup(event, tagName) {
  event.stopPropagation();
  const popup = document.getElementById('tag-picker-popup');
  if (!popup) return;
  const item = popup.querySelector(`.tag-picker-item[onclick*="'${tagName}'"]`);
  if (!item) return;

  item.innerHTML = `
    <input type="text" class="tag-picker-rename-input" value="${tagName}"
      onkeydown="finishTagRenameFromPopup(event, '${tagName}', this)"
      onclick="event.stopPropagation()">
    <button type="button" class="tag-picker-action-btn" onclick="event.stopPropagation(); finishTagRenameFromPopup({key:'Enter'}, '${tagName}', this.previousElementSibling)" title="Save"><i class="fa-solid fa-check"></i></button>
    <button type="button" class="tag-picker-action-btn" onclick="event.stopPropagation(); refreshTagPickerPopup(document.querySelector('.tag-picker-input')?.value || '')" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
  `;
  const renameInput = item.querySelector('.tag-picker-rename-input');
  if (renameInput) { renameInput.focus(); renameInput.select(); }
}

function finishTagRenameFromPopup(event, oldName, inputEl) {
  if (event.key && event.key !== 'Enter') return;
  event.preventDefault && event.preventDefault();
  const newName = inputEl.value.trim();
  if (!newName || newName === oldName) {
    refreshTagPickerPopup(document.querySelector('.tag-picker-input')?.value || '');
    return;
  }
  if (tags.some(t => t.name.toLowerCase() === newName.toLowerCase() && t.name !== oldName)) {
    alert('A pattern with that name already exists.');
    return;
  }
  const tag = tags.find(t => t.name === oldName);
  if (tag) tag.name = newName;
  entries.forEach(e => {
    if (e.patterns) {
      const idx = e.patterns.indexOf(oldName);
      if (idx > -1) e.patterns[idx] = newName;
    }
  });
  const activeEntry = entries.find(e => e.id === activeEntryId);
  saveDatabase(activeEntry, false, true);
  renderAll();

  // Refresh popup list
  refreshTagPickerPopup(document.querySelector('.tag-picker-input')?.value || '');
}

function deleteTagFromPopup(event, tagName) {
  event.stopPropagation();
  tags = tags.filter(t => t.name !== tagName);
  entries.forEach(e => { if (e.patterns) e.patterns = e.patterns.filter(p => p !== tagName); });
  const activeEntry = entries.find(e => e.id === activeEntryId);
  saveDatabase(activeEntry, false, true);
  renderAll();

  // Refresh popup list
  const popup = document.getElementById('tag-picker-popup');
  if (popup) {
    const input = popup.querySelector('.tag-picker-input');
    const query = input ? input.value : '';
    refreshTagPickerPopup(query);
  }
}

function closeTagPickerPopup() {
  const existing = document.getElementById('tag-picker-popup');
  if (existing) existing.remove();
  document.removeEventListener('click', _tagPickerOutsideClick);
}

function _tagPickerOutsideClick(e) {
  const popup = document.getElementById('tag-picker-popup');
  if (popup && !popup.contains(e.target) && !e.target.closest('.tag-picker-trigger')) {
    closeTagPickerPopup();
  }
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
  entry._saved = true;

  saveDatabase(entry, false, true); // Immediate save
  renderDetailOnly();
}

function saveCurrentField(field, val) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  entry[field] = val;
  entry._touched = true;
  entry.updatedAt = new Date().toISOString();
  
  const immediate = (field !== 'notes' && field !== 'mistakes');
  saveDatabase(entry, false, immediate);
  
  renderDetailOnly();
}

// Save Custom Attributes
function saveCustomAttribute(attrName, val) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  entry.customAttributes[attrName] = val;
  entry._touched = true;
  if (attrName === 'P&L') {
    updateEntryStatus(entry);
  }
  entry.updatedAt = new Date().toISOString();
  saveDatabase(entry, false, true);

  renderDetailOnly();
}

// Save and calculate fields (Entry Price, Exit Price, Quantity, Charges)
function saveCalculateAttribute(attrName, valStr) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  if (!entry.customAttributes) {
    entry.customAttributes = {};
  }

  const val = valStr === '' ? '' : Number(valStr);
  entry.customAttributes[attrName] = val;
  entry._touched = true;

  // Check if all 4 are filled
  const ep = entry.customAttributes['Entry Price'];
  const xp = entry.customAttributes['Exit Price'];
  const qty = entry.customAttributes['Quantity'];
  const chg = entry.customAttributes['Charges'];

  if (ep !== '' && ep !== undefined && ep !== null &&
      xp !== '' && xp !== undefined && xp !== null &&
      qty !== '' && qty !== undefined && qty !== null &&
      chg !== '' && chg !== undefined && chg !== null) {
    
    // Auto-calculate P&L = (Exit Price - Entry Price) * Quantity - Charges
    const computedPL = (Number(xp) - Number(ep)) * Number(qty) - Number(chg);
    entry.customAttributes['P&L'] = computedPL;
  } else if (attrName === 'Entry Price' || attrName === 'Exit Price' || attrName === 'Quantity' || attrName === 'Charges') {
    // If one of the 4 fields is cleared or incomplete, clear P&L
    entry.customAttributes['P&L'] = '';
  }

  // Always update status based on current P&L
  updateEntryStatus(entry);

  entry.updatedAt = new Date().toISOString();
  saveDatabase(entry, false, true);
  renderDetailOnly();
}

// Save active entry data directly from DOM values (used on close, blur, or manual save)
// Discard unsaved new entry from database and disk
function discardUnsavedNewEntry(entryId) {
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx !== -1) {
    entries.splice(idx, 1);
  }
  removeEntryFromDisk(entryId);
  saveDatabase(null, true, true);
}

// Set bias in memory and toggle UI active class without full re-render
function setBias(val, el) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;
  entry.bias = val;
  
  const container = el.closest('.bias-chips-container');
  if (container) {
    container.querySelectorAll('.bias-chip').forEach(c => {
      c.classList.remove('active-bull', 'active-bear', 'active-both');
    });
    if (val === 'Bullish') el.classList.add('active-bull');
    else if (val === 'Bearish') el.classList.add('active-bear');
    else if (val === 'Both') el.classList.add('active-both');
  }
}

// Set date in memory
function setEntryDate(val) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (entry) {
    entry.date = val;
  }
}

// Real-time calculations for P&L and Status badge (DOM only, no disk write, no focus loss)
function updateCalculationsRealTime(platform) {
  const epEl = document.getElementById(`${platform}-input-entry`);
  const xpEl = document.getElementById(`${platform}-input-exit`);
  const qtyEl = document.getElementById(`${platform}-input-qty`);
  const chgEl = document.getElementById(`${platform}-input-charges`);
  const plEl = document.getElementById(`${platform}-input-pl`);
  
  if (!epEl || !xpEl || !qtyEl || !chgEl || !plEl) return;

  const ep = epEl.value;
  const xp = xpEl.value;
  const qty = qtyEl.value;
  const chg = chgEl.value;

  const container = document.getElementById(platform === 'desktop' ? 'desktop-detail-pane' : 'mobile-detail-pane');

  if (ep !== '' && xp !== '' && qty !== '' && chg !== '') {
    const computedPL = (Number(xp) - Number(ep)) * Number(qty) - Number(chg);
    plEl.value = computedPL;
    
    if (container) {
      const badge = container.querySelector('.status-passed, .status-failed, .status-missed');
      if (badge) {
        badge.className = 'tag-badge ' + (computedPL > 0 ? 'status-passed' : 'status-failed');
        badge.textContent = computedPL > 0 ? 'PASSED' : 'FAILED';
      }
    }
  } else {
    plEl.value = '';
    if (container) {
      const badge = container.querySelector('.status-passed, .status-failed, .status-missed');
      if (badge) {
        badge.className = 'tag-badge status-missed';
        badge.textContent = 'MISSED';
      }
    }
  }
}

// Save active entry data directly from DOM values (used on close, blur, or manual save)
function saveFromDOM(isManualClick = false) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return Promise.resolve();

  if (!entry.customAttributes) {
    entry.customAttributes = {};
  }

  // Determine active view/platform
  const desktopPane = document.getElementById('desktop-detail-pane');
  const isDesktop = desktopPane && !desktopPane.classList.contains('closed');
  const mobilePane = document.getElementById('mobile-detail-pane');
  const isMobile = mobilePane && mobilePane.classList.contains('open');

  if (isDesktop) {
    const notesEl = document.getElementById('detail-notes');
    if (notesEl) entry.notes = notesEl.value;
    const mistakesEl = document.getElementById('detail-mistakes');
    if (mistakesEl) entry.mistakes = mistakesEl.value;

    const attrRows = document.querySelectorAll('#detail-attributes-list .attribute-row');
    attrRows.forEach(row => {
      const labelEl = row.querySelector('.attribute-label span');
      if (!labelEl) return;
      const label = labelEl.textContent.trim();
      const inputEl = row.querySelector('input, select');
      if (!inputEl) return;
      
      let attrKey = label;
      if (label === 'Entry') attrKey = 'Entry Price';
      else if (label === 'Exit') attrKey = 'Exit Price';
      else if (label === 'Qty') attrKey = 'Quantity';
      
      let val = inputEl.value;
      if (inputEl.type === 'number') {
        val = val === '' ? '' : Number(val);
      }
      entry.customAttributes[attrKey] = val;
    });
  } else if (isMobile) {
    const notesEl = document.getElementById('mobile-detail-notes');
    if (notesEl) entry.notes = notesEl.value;
    const mistakesEl = document.getElementById('mobile-detail-mistakes');
    if (mistakesEl) entry.mistakes = mistakesEl.value;

    const attrRows = document.querySelectorAll('#mobile-detail-attributes-list .attribute-row');
    attrRows.forEach(row => {
      const labelEl = row.querySelector('.attribute-label span');
      if (!labelEl) return;
      const label = labelEl.textContent.trim();
      const inputEl = row.querySelector('input, select');
      if (!inputEl) return;
      
      let attrKey = label;
      if (label === 'Entry') attrKey = 'Entry Price';
      else if (label === 'Exit') attrKey = 'Exit Price';
      else if (label === 'Qty') attrKey = 'Quantity';
      
      let val = inputEl.value;
      if (inputEl.type === 'number') {
        val = val === '' ? '' : Number(val);
      }
      entry.customAttributes[attrKey] = val;
    });
  }

  // Recalculate P&L if all 4 are filled
  const ep = entry.customAttributes['Entry Price'];
  const xp = entry.customAttributes['Exit Price'];
  const qty = entry.customAttributes['Quantity'];
  const chg = entry.customAttributes['Charges'];

  if (ep !== '' && ep !== undefined && ep !== null &&
      xp !== '' && xp !== undefined && xp !== null &&
      qty !== '' && qty !== undefined && qty !== null &&
      chg !== '' && chg !== undefined && chg !== null) {
    const computedPL = (Number(xp) - Number(ep)) * Number(qty) - Number(chg);
    entry.customAttributes['P&L'] = computedPL;
  }

  // Recalculate status
  updateEntryStatus(entry);

  if (isManualClick) {
    entry._saved = true;
  }

  entry.updatedAt = new Date().toISOString();

  // Save synchronously to localStorage
  localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
  localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
  localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));

  return saveDatabase(entry, false, true);
}

// Manual Save button trigger
function manualSave() {
  saveFromDOM(true).then(() => {
    showToast('Saved!', 'success');
    renderAll();
  });
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
  saveDatabase(null, true, true);

  // Populate dynamic default value in entries list
  entries.forEach(e => {
    if (e.customAttributes[name] === undefined) {
      e.customAttributes[name] = newAttr.defaultValue;
    }
  });
  saveDatabase(null, true, true);

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
    saveDatabase(null, true, true);
    renderAll();
  }
}

// Collapsible Sidebar Handler
function toggleSidebarCollapse() {
  const sidebar = document.querySelector('.desktop-sidebar');
  const btn = document.getElementById('sidebar-collapse-btn');
  if (!sidebar) return;
  
  const isCollapsed = sidebar.classList.toggle('collapsed');
  
  if (btn) {
    btn.innerHTML = isCollapsed 
      ? '<i class="fa-solid fa-angles-right"></i>' 
      : '<i class="fa-solid fa-angles-left"></i>';
    btn.title = isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
  }
  
  localStorage.setItem('sidebar_collapsed', isCollapsed ? 'true' : 'false');
}

// Inline Tag Manager Helpers
function selectInlineColor(colorName, btnEl) {
  const group = btnEl.closest('.inline-tag-colors');
  if (group) {
    group.querySelectorAll('.tag-color-btn').forEach(btn => {
      if (btn === btnEl) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

function submitInlineCreateTag(btnEl) {
  const row = btnEl.closest('.inline-tag-create-row');
  if (!row) return;
  
  const input = row.querySelector('.new-inline-tag-input');
  const activeColorBtn = row.querySelector('.tag-color-btn.active');
  
  if (!input || !activeColorBtn) return;
  
  const name = input.value.trim();
  if (!name) {
    alert("Pattern name is required!");
    return;
  }
  
  if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert("This pattern already exists!");
    return;
  }
  
  const colorName = activeColorBtn.dataset.color;
  let color = '#3b82f6';
  let type = 'Both';
  if (colorName === 'green') {
    color = '#10b981';
    type = 'Bullish';
  } else if (colorName === 'red') {
    color = '#ef4444';
    type = 'Bearish';
  }
  
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const bg = `rgba(${r}, ${g}, ${b}, 0.15)`;
  
  tags.push({ name, color, bg, type });
  
  const entry = entries.find(e => e.id === activeEntryId);
  if (entry && !entry.patterns.includes(name)) {
    entry.patterns.push(name);
  }
  
  saveDatabase(entry, false, true);
  renderAll();
}

function handleInlineTagKey(event, inputEl) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const row = inputEl.closest('.inline-tag-create-row');
    const addBtn = row?.querySelector('.inline-tag-add-btn');
    if (addBtn) {
      submitInlineCreateTag(addBtn);
    }
  }
}

function inlineDeleteTag(tagName) {
  tags = tags.filter(t => t.name !== tagName);
  
  entries.forEach(entry => {
    if (entry.patterns) {
      entry.patterns = entry.patterns.filter(p => p !== tagName);
    }
  });
  
  const activeEntry = entries.find(e => e.id === activeEntryId);
  saveDatabase(activeEntry, false, true);
  renderAll();
}

function startInlineRename(tagName) {
  editingTagName = tagName;
  renderAll();
}

function finishInlineRename(oldName, newName) {
  newName = newName.trim();
  if (!newName || oldName === newName) {
    editingTagName = null;
    renderAll();
    return;
  }
  
  if (tags.some(t => t.name.toLowerCase() === newName.toLowerCase() && t.name !== oldName)) {
    alert("A pattern with this name already exists.");
    editingTagName = null;
    renderAll();
    return;
  }
  
  const tag = tags.find(t => t.name === oldName);
  if (tag) {
    tag.name = newName;
  }
  
  entries.forEach(entry => {
    if (entry.patterns) {
      const idx = entry.patterns.indexOf(oldName);
      if (idx > -1) {
        entry.patterns[idx] = newName;
      }
    }
  });
  
  editingTagName = null;
  const activeEntry = entries.find(e => e.id === activeEntryId);
  saveDatabase(activeEntry, false, true);
  renderAll();
}

function cancelInlineRename() {
  editingTagName = null;
  renderAll();
}

function handleInlineRenameKey(event, oldName, inputEl) {
  if (event.key === 'Enter') {
    event.preventDefault();
    finishInlineRename(oldName, inputEl.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelInlineRename();
  }
}

function filterInlineTags(query) {
  const container = document.getElementById('inline-tag-list-container');
  if (!container) return;
  const normalizedQuery = query.toLowerCase().trim();
  const rows = container.querySelectorAll('.inline-tag-row');
  rows.forEach(row => {
    const tagName = row.dataset.tagName.toLowerCase();
    if (tagName.includes(normalizedQuery)) {
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
    }
  });
}

// Android Back Key Interceptor
function handleAndroidBack(event) {
  const lightbox = document.getElementById('image-lightbox');
  const lightboxOpen = lightbox && lightbox.style.display === 'flex';
  const detailPane = document.getElementById('mobile-detail-pane');
  const detailOpen = detailPane && detailPane.classList.contains('open');
  const setupOverlay = document.getElementById('setup-screen');
  const setupVisible = setupOverlay && setupOverlay.style.display !== 'none';
  const hasSavedPath = !!localStorage.getItem('honey_journal_storage_path');

  if (lightboxOpen) {
    closeLightbox();
  } else if (activePatternSubGallery !== null) {
    closePatternSubGallery();
  } else if (detailOpen) {
    closeMobileDetail();
  } else if (currentMobileView === 'more') {
    switchMobileView(lastMobileView || 'patterns');
  } else if (currentMobileView !== 'patterns') {
    switchMobileView('patterns');
  } else if (setupVisible && hasSavedPath) {
    if (setupOverlay) setupOverlay.style.display = 'none';
  } else {
    return;
  }

  history.pushState({ page: 'main' }, '');
}

// Toggling bookmarks
function toggleBookmark(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  entry.bookmarked = !entry.bookmarked;
  saveDatabase(entry, false, true);
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
    status: "MISSED",
    images: [],
    notes: "",
    mistakes: "",
    customAttributes: {},
    bookmarked: false,
    createdAt: now,
    updatedAt: now,
    _saved: false
  };

  // Populate custom fields defaults
  customAttributes.forEach(attr => {
    newEntry.customAttributes[attr.name] = attr.defaultValue !== undefined ? attr.defaultValue : '';
  });

  updateEntryStatus(newEntry);

  entries.push(newEntry);
  saveDatabase(newEntry, false, true);

  openEntryDetail(newId);
}

function deleteActiveEntry() {
  if (!activeEntryId) return;
  
  if (confirm("Are you sure you want to delete this trading journal entry?")) {
    const deletedId = activeEntryId;
    entries = entries.filter(e => e.id !== deletedId);
    saveDatabase(null, true, true);
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
      entry._saved = true;
      saveDatabase(entry, false, true);
      renderDetailOnly();
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
  saveDatabase(entry, false, true);
  renderDetailOnly();
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
  saveDatabase(entry, false, true);
  renderDetailOnly();
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
      renderDetailOnly();
    };
    thumb.innerHTML = `
      <img src="${imgSrc}" class="thumbnail-img">
      <button class="thumb-delete" onclick="event.stopPropagation(); deleteImageByIndex(${idx});" title="Remove image"><i class="fa-solid fa-xmark"></i></button>
    `;
    container.appendChild(thumb);
  });

  // removed addBtn button block
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
  if (currentMobileView !== 'more' && currentMobileView !== view) {
    lastMobileView = currentMobileView;
  }
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

  const subGalleryView = document.getElementById('mobile-pattern-subgallery-view');
  if (subGalleryView) subGalleryView.style.display = 'none';
  activePatternSubGallery = null;

  if (view !== 'calendar') {
    closeCalendarDrawer();
  }

  headerTitle.textContent = view.charAt(0).toUpperCase() + view.slice(1);

  if (view === 'patterns') {
    populatePatternFilterDropdowns();
    syncFilterSelectors();
    gallery.style.display = 'grid'; // Force mobile Grid layout
    renderMobileContent();
  } else if (view === 'calendar') {
    calendar.style.display = 'block';
    renderMobileCalendar();
  } else if (view === 'dashboard') {
    headerTitle.textContent = 'Dashboard';
    stats.style.display = 'block';
    renderMobileStats();
  } else if (view === 'more') {
    headerTitle.textContent = 'Settings';
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

  list.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = 'phone-card';
    card.onclick = () => openEntryDetail(entry.id);
    card.style.animationDelay = `${index * 40}ms`;

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
    const hasImage = firstImage !== '';
    const transformStyle = hasImage && (entry.imageScale || entry.imageX || entry.imageY)
      ? `style="transform: scale(${entry.imageScale || 1}) translate(${entry.imageX || 0}px, ${entry.imageY || 0}px); transform-origin: center center;"`
      : '';

    card.innerHTML = `
      <div class="phone-card-img-wrapper">
        ${hasImage ? `<img src="${firstImage}" alt="${displayTitle}" class="phone-card-img" ${transformStyle}>` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-tertiary);"><i class="fa-solid fa-chart-line" style="color:var(--text-muted);"></i></div>`}
      </div>
      <div class="phone-card-header" style="padding: 6px; display: flex; flex-direction: column; gap: 4px;">
        <div class="phone-card-patterns" style="display: flex; flex-wrap: wrap; gap: 2px;">
          ${tagsHtml || `<span style="color: var(--text-muted); font-size: 9px;">No patterns</span>`}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
          <span class="phone-card-date" style="font-size: 8px;">${formatDateWithDay(entry.date)}</span>
          <span class="tag-badge" style="font-size:8px; padding: 1px 4px; color: ${biasColor}; background-color: ${biasColor}1A; border: 1px solid ${biasColor}33;">${entry.bias}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Mobile Details close arrow trigger
function closeMobileDetail() {
  const entry = entries.find(e => e.id === activeEntryId);
  if (entry) {
    if (!entry._saved) {
      discardUnsavedNewEntry(entry.id);
    } else if (originalEntryState && originalEntryState.id === entry.id) {
      // Revert in-memory edits to original state
      const idx = entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) {
        entries[idx] = JSON.parse(JSON.stringify(originalEntryState));
      }
    }
  }
  originalEntryState = null;
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
      mainImgEl.style.transform = `scale(${entry.imageScale || 1}) translate(${entry.imageX || 0}px, ${entry.imageY || 0}px)`;
      if (mainWrapper) mainWrapper.classList.remove('empty-placeholder');
      document.getElementById('mobile-image-actions').style.display = 'flex';
      document.getElementById('mobile-reposition-toggle').style.display = 'inline-flex';
      
      const hasNav = imgs.length > 1;
      document.getElementById('mobile-image-prev').style.display = hasNav ? 'flex' : 'none';
      document.getElementById('mobile-image-next').style.display = hasNav ? 'flex' : 'none';
    } else {
      mainImgEl.src = '';
      mainImgEl.style.display = 'none';
      mainImgEl.style.transform = 'none';
      if (mainWrapper) mainWrapper.classList.add('empty-placeholder');
      document.getElementById('mobile-image-actions').style.display = 'flex';
      document.getElementById('mobile-reposition-toggle').style.display = 'none';
      document.getElementById('mobile-reposition-done').style.display = 'none';
      document.getElementById('mobile-image-prev').style.display = 'none';
      document.getElementById('mobile-image-next').style.display = 'none';
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
      <div class="bias-chip ${entry.bias === 'Bullish' ? 'active-bull' : ''}" onclick="setBias('Bullish', this)">
        <span class="bias-chip-dot" style="background: var(--color-bull);"></span> Bullish
      </div>
      <div class="bias-chip ${entry.bias === 'Bearish' ? 'active-bear' : ''}" onclick="setBias('Bearish', this)">
        <span class="bias-chip-dot" style="background: var(--color-bear);"></span> Bearish
      </div>
      <div class="bias-chip ${entry.bias === 'Both' ? 'active-both' : ''}" onclick="setBias('Both', this)">
        <span class="bias-chip-dot" style="background: var(--color-both);"></span> Both
      </div>
    </div>
  `;
  const biasRow = createAttributeRowHTML('Bias', biasChipsHTML, 'fa-solid fa-arrows-up-down');
  attrList.appendChild(biasRow);

  // Date
  const dateRow = createAttributeRowHTML('Date', `<input type="date" class="input-text" value="${entry.date}" onchange="setEntryDate(this.value)">`, 'fa-solid fa-calendar');
  attrList.appendChild(dateRow);

  // Candle Patterns
  const tagSelectorHTML = generateTagMultiSelectHTML(entry.patterns);
  const patternRow = createAttributeRowHTML('Patterns', tagSelectorHTML, 'fa-solid fa-tags');
  attrList.appendChild(patternRow);

  // Status
  let statusBadgeClass = 'status-missed';
  if (entry.status === 'PASSED') statusBadgeClass = 'status-passed';
  if (entry.status === 'FAILED') statusBadgeClass = 'status-failed';

  const statusRow = createAttributeRowHTML('Status', `
    <span class="tag-badge ${statusBadgeClass}" style="font-weight: 700; padding: 4px 12px; border-radius: 6px; font-size: 11px;">${entry.status}</span>
  `, 'fa-solid fa-circle-check');
  attrList.appendChild(statusRow);

  // Entry and Exit Price (side-by-side)
  const entryPriceVal = entry.customAttributes && entry.customAttributes['Entry Price'] !== undefined ? entry.customAttributes['Entry Price'] : '';
  const entryPriceRow = createAttributeRowHTML('Entry', `<input type="number" id="mobile-input-entry" class="input-text" value="${entryPriceVal}" placeholder="Optional" oninput="updateCalculationsRealTime('mobile')">`, 'fa-solid fa-dollar-sign');
  
  const exitPriceVal = entry.customAttributes && entry.customAttributes['Exit Price'] !== undefined ? entry.customAttributes['Exit Price'] : '';
  const exitPriceRow = createAttributeRowHTML('Exit', `<input type="number" id="mobile-input-exit" class="input-text" value="${exitPriceVal}" placeholder="Optional" oninput="updateCalculationsRealTime('mobile')">`, 'fa-solid fa-arrow-right-to-bracket');

  const pricePair = document.createElement('div');
  pricePair.className = 'attribute-row-pair';
  pricePair.appendChild(entryPriceRow);
  pricePair.appendChild(exitPriceRow);
  attrList.appendChild(pricePair);

  // Quantity and Charges (side-by-side)
  const quantityVal = entry.customAttributes && entry.customAttributes['Quantity'] !== undefined ? entry.customAttributes['Quantity'] : '';
  const quantityRow = createAttributeRowHTML('Qty', `<input type="number" id="mobile-input-qty" class="input-text" value="${quantityVal}" placeholder="Optional" oninput="updateCalculationsRealTime('mobile')">`, 'fa-solid fa-calculator');
  
  const chargesVal = entry.customAttributes && entry.customAttributes['Charges'] !== undefined ? entry.customAttributes['Charges'] : '';
  const chargesRow = createAttributeRowHTML('Charges', `<input type="number" id="mobile-input-charges" class="input-text" value="${chargesVal}" placeholder="Optional" oninput="updateCalculationsRealTime('mobile')">`, 'fa-solid fa-percent');

  const qtyChargesPair = document.createElement('div');
  qtyChargesPair.className = 'attribute-row-pair';
  qtyChargesPair.appendChild(quantityRow);
  qtyChargesPair.appendChild(chargesRow);
  attrList.appendChild(qtyChargesPair);

  // Custom attributes (Market, P&L as number, plus new additions with trash bins)
  customAttributes.forEach(attr => {
    if (attr.name === 'Entry Price' || attr.name === 'Exit Price' || attr.name === 'Quantity' || attr.name === 'Charges') return;
    let inputHTML = '';
    const currentVal = entry.customAttributes[attr.name] !== undefined ? entry.customAttributes[attr.name] : attr.defaultValue;
    
    if (attr.name === 'Market') {
      inputHTML = `<input type="text" id="mobile-input-market" list="market-datalist-mob" class="input-text" value="${currentVal}">
        <datalist id="market-datalist-mob">
          <option value="Nifty 50">
          <option value="Bank Nifty">
          <option value="Futures">
          <option value="Gold">
          <option value="Crude Oil">
        </datalist>`;
    } else if (attr.name === 'P&L') {
      inputHTML = `<input type="number" id="mobile-input-pl" class="input-text" value="${currentVal}" placeholder="0" readonly style="opacity: 0.8; cursor: not-allowed;">`;
    } else if (attr.type === 'select') {
      let optionsHtml = '';
      attr.options.forEach(opt => {
        optionsHtml += `<option value="${opt}" ${currentVal === opt ? 'selected' : ''}>${opt || 'Optional'}</option>`;
      });
      inputHTML = `<select class="input-select">${optionsHtml}</select>`;
    } else if (attr.type === 'number') {
      inputHTML = `<input type="number" class="input-text" value="${currentVal}" placeholder="0">`;
    } else {
      inputHTML = `<input type="text" class="input-text" value="${currentVal}" placeholder="Optional">`;
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

  const activeSetup = currentStatsTab === 'setup' ? 'active' : '';
  const activeJournal = currentStatsTab === 'journal' ? 'active' : '';

  let statsContent = '';

  if (currentStatsTab === 'setup') {
    const bullishCounts = {};
    const bearishCounts = {};

    const incrementCount = (counts, pat, status) => {
      if (!counts[pat]) {
        counts[pat] = { passed: 0, missed: 0, failed: 0, total: 0 };
      }
      counts[pat].total += 1;
      if (status === 'PASSED') counts[pat].passed += 1;
      else if (status === 'FAILED') counts[pat].failed += 1;
      else counts[pat].missed += 1;
    };

    entries.forEach(entry => {
      const status = entry.status || 'MISSED';
      entry.patterns.forEach(pat => {
        const tagObj = tags.find(t => t.name === pat);
        const tagType = tagObj ? tagObj.type : 'Both';
        
        if (tagType === 'Bullish') {
          incrementCount(bullishCounts, pat, status);
        } else if (tagType === 'Bearish') {
          incrementCount(bearishCounts, pat, status);
        } else {
          if (entry.bias === 'Bullish') {
            incrementCount(bullishCounts, pat, status);
          } else if (entry.bias === 'Bearish') {
            incrementCount(bearishCounts, pat, status);
          } else {
            incrementCount(bullishCounts, pat, status);
            incrementCount(bearishCounts, pat, status);
          }
        }
      });
    });

    const sortedBullish = Object.entries(bullishCounts).sort((a, b) => b[1].total - a[1].total);
    const sortedBearish = Object.entries(bearishCounts).sort((a, b) => b[1].total - a[1].total);

    let bullHtml = '';
    sortedBullish.forEach(([name, stats], index) => {
      bullHtml += `
        <div class="stats-rank-item" style="padding:6px 10px; font-size:11px;" onclick="openPatternSubGallery('${name}')">
          <div class="stats-rank-label">
            <span class="stats-rank-number">${index + 1}.</span>
            <span>${name}</span>
          </div>
          <div class="stats-rank-badge-group" style="display: flex; gap: 4px;">
            <span class="stats-rank-badge" style="background-color: rgba(162, 224, 72, 0.15); color: var(--color-bull); border: 1px solid rgba(162, 224, 72, 0.3); font-size: 9px; padding: 1px 6px;">${stats.passed}P</span>
            <span class="stats-rank-badge" style="background-color: rgba(255, 183, 3, 0.15); color: var(--accent-gold); border: 1px solid rgba(255, 183, 3, 0.3); font-size: 9px; padding: 1px 6px;">${stats.missed}M</span>
            <span class="stats-rank-badge" style="background-color: rgba(255, 94, 94, 0.15); color: var(--color-bear); border: 1px solid rgba(255, 94, 94, 0.3); font-size: 9px; padding: 1px 6px;">${stats.failed}F</span>
          </div>
        </div>
      `;
    });
    if (sortedBullish.length === 0) bullHtml = '<div style="color:var(--text-muted); font-size:11px; padding:6px;">No bullish patterns.</div>';

    let bearHtml = '';
    sortedBearish.forEach(([name, stats], index) => {
      bearHtml += `
        <div class="stats-rank-item" style="padding:6px 10px; font-size:11px;" onclick="openPatternSubGallery('${name}')">
          <div class="stats-rank-label">
            <span class="stats-rank-number">${index + 1}.</span>
            <span>${name}</span>
          </div>
          <div class="stats-rank-badge-group" style="display: flex; gap: 4px;">
            <span class="stats-rank-badge" style="background-color: rgba(162, 224, 72, 0.15); color: var(--color-bull); border: 1px solid rgba(162, 224, 72, 0.3); font-size: 9px; padding: 1px 6px;">${stats.passed}P</span>
            <span class="stats-rank-badge" style="background-color: rgba(255, 183, 3, 0.15); color: var(--accent-gold); border: 1px solid rgba(255, 183, 3, 0.3); font-size: 9px; padding: 1px 6px;">${stats.missed}M</span>
            <span class="stats-rank-badge" style="background-color: rgba(255, 94, 94, 0.15); color: var(--color-bear); border: 1px solid rgba(255, 94, 94, 0.3); font-size: 9px; padding: 1px 6px;">${stats.failed}F</span>
          </div>
        </div>
      `;
    });
    if (sortedBearish.length === 0) bearHtml = '<div style="color:var(--text-muted); font-size:11px; padding:6px;">No bearish patterns.</div>';

    statsContent = `
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
  } else {
    statsContent = renderJournalStatsTab(true);
  }

  container.innerHTML = `
    <div class="stats-segmented-control" style="margin: 10px 10px 0;">
      <button class="stats-tab-btn ${activeSetup}" style="font-size:11px; padding: 4px 12px;" onclick="switchStatsTab('setup')">Setup Stats</button>
      <button class="stats-tab-btn ${activeJournal}" style="font-size:11px; padding: 4px 12px;" onclick="switchStatsTab('journal')">Journal Stats</button>
    </div>
    <div id="stats-tab-content-mobile" style="margin-top: 10px;">
      ${statsContent}
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
    <div class="apple-dashboard-grid" style="grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px 20px; margin-top: 8px;">
      <div class="apple-metric-card" style="padding: 14px 16px; border-radius: 18px;">
        <div class="apple-metric-label" style="font-size: 9px; margin-bottom: 4px;">Total Setups</div>
        <div class="apple-metric-value" style="font-size: 26px; margin-bottom: 2px;">${totalTrades}</div>
      </div>
      <div class="apple-metric-card" style="padding: 14px 16px; border-radius: 18px;">
        <div class="apple-metric-label" style="font-size: 9px; margin-bottom: 4px;">Win Rate</div>
        <div class="apple-metric-value win" style="font-size: 26px; margin-bottom: 2px;">${winRate}%</div>
      </div>
    </div>
    <div class="apple-insights-section" style="padding: 12px 20px; margin-top: 6px;">
      <h2 class="apple-section-title" style="font-size: 15px; margin-bottom: 12px;">Setup Insights</h2>
      <div class="apple-insights-grid" style="grid-template-columns: 1fr; gap: 10px;">
        <div class="apple-insight-card" style="padding: 14px 16px; border-radius: 18px; min-height: 70px;">
          <div class="apple-insight-title" style="font-size: 9px; margin-bottom: 4px;">Most Profitable</div>
          <div class="apple-insight-value bull" style="font-size: 15px;">${statsObj.bestPattern || 'None'}</div>
        </div>
        <div class="apple-insight-card" style="padding: 14px 16px; border-radius: 18px; min-height: 70px;">
          <div class="apple-insight-title" style="font-size: 9px; margin-bottom: 4px;">Worst Performing</div>
          <div class="apple-insight-value bear" style="font-size: 15px;">${statsObj.worstPattern || 'None'}</div>
        </div>
      </div>
    </div>
  `;
}

// Mobile Settings / More options
function renderMobileMore() {
  const container = document.getElementById('mobile-more-view');
  if (!container) return;

  container.innerHTML = `
    <div class="apple-settings-group-title" style="margin-top: 8px;">App Settings</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #5856d6;">
            <i class="fa-solid fa-circle-half-stroke"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Theme Control</span>
            <span class="apple-settings-desc">Swap between light and dark modes</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px;" onclick="toggleTheme()">Swap Theme</button>
        </div>
      </div>

      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #007aff;">
            <i class="fa-solid fa-folder"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Sync Folder Path</span>
            <span class="apple-settings-desc" style="word-break: break-all; max-width: 170px;">${storagePath || 'Not Configured'}</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px;" onclick="chooseStorageFolder()">Change</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 2px;"></i>
        </div>
      </div>
    </div>

    <div class="apple-settings-group-title">Backup & Restore</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #ff9500;">
            <i class="fa-solid fa-file-zipper"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Export Backup (.zip)</span>
            <span class="apple-settings-desc">Package setups and images</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-primary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px;" onclick="exportBackupZip()">Export</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 2px;"></i>
        </div>
      </div>
      
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #ff3b30;">
            <i class="fa-solid fa-file-import"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Import Backup (.zip)</span>
            <span class="apple-settings-desc">Restore database from backup zip</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px;" onclick="triggerImportZip()">Import</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 2px;"></i>
        </div>
      </div>
    </div>

    <div class="apple-settings-group-title">Data Management</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #8e8e93;">
            <i class="fa-solid fa-trash-can"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Reset Database</span>
            <span class="apple-settings-desc">Wipe all entries and configurations</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px; color: var(--color-bear);" onclick="clearDatabase()">Reset</button>
        </div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 24px; padding-bottom: 12px;">
      <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">Version 1.0.1</span>
    </div>
  `;
}

// ==========================================================================
// STATS SUB-GALLERY & LIGHTBOX SLIDER UPGRADES
// ==========================================================================

function openPatternSubGallery(patternName) {
  activePatternSubGallery = patternName;
  
  // Render subgallery content
  // First, find all entries with this pattern and with images
  const patternEntries = entries.filter(e => e.patterns.includes(patternName) && e.images && e.images.length > 0);
  
  currentSubGalleryImages = [];
  patternEntries.forEach(entry => {
    (entry.images || []).forEach((imgSrc, imgIndex) => {
      currentSubGalleryImages.push({
        src: imgSrc,
        entry: entry,
        imageIndex: imgIndex
      });
    });
  });

  // Render for both desktop and mobile
  renderPatternSubGallery('desktop');
  renderPatternSubGallery('mobile');

  // Toggle display containers
  const dStatsView = document.getElementById('desktop-stats-view');
  const dSubView = document.getElementById('desktop-pattern-subgallery-view');
  if (dStatsView && dSubView) {
    dStatsView.style.display = 'none';
    dSubView.style.display = 'block';
  }

  const mStatsView = document.getElementById('mobile-stats-view');
  const mSubView = document.getElementById('mobile-pattern-subgallery-view');
  if (mStatsView && mSubView) {
    mStatsView.style.display = 'none';
    mSubView.style.display = 'block';
  }
}

function closePatternSubGallery() {
  activePatternSubGallery = null;

  // Restore main Stats views
  const dStatsView = document.getElementById('desktop-stats-view');
  const dSubView = document.getElementById('desktop-pattern-subgallery-view');
  if (dStatsView && dSubView) {
    if (currentDesktopView === 'stats' || currentDesktopView === 'dashboard') {
      dStatsView.style.display = 'block';
    }
    dSubView.style.display = 'none';
  }

  const mStatsView = document.getElementById('mobile-stats-view');
  const mSubView = document.getElementById('mobile-pattern-subgallery-view');
  if (mStatsView && mSubView) {
    if (currentMobileView === 'stats' || currentMobileView === 'dashboard') {
      mStatsView.style.display = 'block';
    }
    mSubView.style.display = 'none';
  }
}

function renderPatternSubGallery(platform) {
  const containerId = platform === 'desktop' ? 'desktop-pattern-subgallery-view' : 'mobile-pattern-subgallery-view';
  const container = document.getElementById(containerId);
  if (!container) return;

  const count = currentSubGalleryImages.length;
  
  let cardsHtml = '';
  if (count === 0) {
    cardsHtml = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted); grid-column: 1/-1;">
        <i class="fa-solid fa-image-portrait" style="font-size: 32px; margin-bottom: 12px; display: block; opacity: 0.4;"></i>
        <div style="font-size: 14px; margin-bottom: 4px;">No images logged for this pattern</div>
        <div style="font-size: 12px; opacity: 0.7;">Add setups with screenshots and tag them with this pattern to see them here.</div>
      </div>
    `;
  } else {
    currentSubGalleryImages.forEach((item, index) => {
      const entry = item.entry;
      let biasColor = 'var(--color-neutral)';
      if (entry.bias === 'Bullish') biasColor = 'var(--color-bull)';
      else if (entry.bias === 'Bearish') biasColor = 'var(--color-bear)';
      else if (entry.bias === 'Both') biasColor = 'var(--color-both)';

      cardsHtml += `
        <div class="subgallery-card" onclick="openLightboxSlider(currentSubGalleryImages, ${index})">
          <div class="subgallery-img-wrapper">
            <img src="${item.src}" class="subgallery-img" loading="lazy">
          </div>
          <div class="subgallery-card-content">
            <div class="subgallery-card-meta">
              <span class="subgallery-card-date">
                <i class="fa-solid fa-calendar"></i> ${formatDateWithDay(entry.date)}
              </span>
              <span class="tag-badge" style="background-color: ${biasColor}1A; color: ${biasColor}; border: 1px solid ${biasColor}33; font-size: 9px; padding: 1px 6px;">${entry.bias}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span class="tag-badge status-${entry.status.toLowerCase()}" style="font-size: 9px; padding: 1px 6px; font-weight: 700;">${entry.status}</span>
            </div>
          </div>
        </div>
      `;
    });
  }

  const backBtnHtml = platform === 'desktop'
    ? `<button class="btn-secondary" style="margin-bottom: 16px; border-radius: 100px;" onclick="closePatternSubGallery()"><i class="fa-solid fa-arrow-left"></i> Back to Statistics</button>`
    : `<button class="btn-icon" style="margin-bottom: 12px;" onclick="closePatternSubGallery()"><i class="fa-solid fa-arrow-left"></i></button>`;

  const titleHeaderHtml = platform === 'desktop'
    ? `
      <div class="subgallery-header">
        <div class="subgallery-header-left">
          <h1 class="subgallery-title">${activePatternSubGallery}</h1>
          <span class="subgallery-subtitle">Clutter-Free Visual Review &bull; ${count} screenshot${count !== 1 ? 's' : ''} found</span>
        </div>
      </div>
    `
    : `
      <div style="margin-bottom: 12px;">
        <h2 class="subgallery-title" style="font-size: 16px; margin: 0 0 4px 0;">${activePatternSubGallery}</h2>
        <span class="subgallery-subtitle" style="font-size: 11px;">Visual Review &bull; ${count} image${count !== 1 ? 's' : ''}</span>
      </div>
    `;

  // Fetch tag description
  const tagObj = tags.find(t => t.name === activePatternSubGallery);
  const description = tagObj ? (tagObj.description || '') : '';

  const playbookCardHtml = `
    <div class="subgallery-playbook-card">
      <div class="playbook-header">
        <span><i class="fa-solid fa-align-left" style="margin-right:6px; color:var(--apple-accent-blue);"></i> Description</span>
        <button id="${platform}-playbook-save-btn" class="playbook-save-btn" style="display:none;" onclick="savePlaybookDescription('${platform}')"><i class="fa-solid fa-check"></i> Save</button>
      </div>
      <div class="playbook-content">
        <textarea id="${platform}-playbook-textarea" class="playbook-inline-textarea" placeholder="Describe this setup..." oninput="handlePlaybookInput('${platform}')" onkeydown="if((event.ctrlKey || event.metaKey) && event.key === 'Enter') { savePlaybookDescription('${platform}'); event.preventDefault(); }">${description}</textarea>
      </div>
    </div>
  `;

  container.innerHTML = `
    ${backBtnHtml}
    ${titleHeaderHtml}
    ${playbookCardHtml}
    <div class="subgallery-grid">
      ${cardsHtml}
    </div>
  `;
}

let lightboxZoomState = {
  scale: 1.0,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  draggedDuringThisClick: false,
  initialDistance: 0,
  initialScale: 1.0
};

function resetLightboxZoom() {
  lightboxZoomState.scale = 1.0;
  lightboxZoomState.translateX = 0;
  lightboxZoomState.translateY = 0;
  lightboxZoomState.isDragging = false;
  lightboxZoomState.draggedDuringThisClick = false;
  applyLightboxZoomTransform();
}

function applyLightboxZoomTransform() {
  const img = document.getElementById('lightbox-img');
  if (img) {
    img.style.transform = `translate(${lightboxZoomState.translateX}px, ${lightboxZoomState.translateY}px) scale(${lightboxZoomState.scale})`;
    img.style.transition = lightboxZoomState.isDragging ? 'none' : 'transform 0.2s ease-out';
  }
}

function triggerLightboxZoom(src) {
  if (repositionState.isActive) return;
  
  // Try to find if this source belongs to any loaded entry image
  let allImageItems = [];
  
  // Create virtual slider from entries that have images
  entries.forEach(entry => {
    (entry.images || []).forEach((imgSrc, imgIndex) => {
      allImageItems.push({
        src: imgSrc,
        entry: entry,
        imageIndex: imgIndex
      });
    });
  });

  const matchedIndex = allImageItems.findIndex(item => item.src === src);
  if (matchedIndex !== -1) {
    openLightboxSlider(allImageItems, matchedIndex);
  } else {
    // Fallback: zoom single image without slider context
    openLightboxSlider([{ src: src }], 0);
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('image-lightbox');
  if (lightbox) {
    lightbox.style.display = 'none';
  }
}

function openLightboxSlider(imagesList, startIndex) {
  currentSubGalleryImages = imagesList;
  activeLightboxIndex = startIndex;
  
  const lightbox = document.getElementById('image-lightbox');
  if (lightbox) {
    lightbox.style.display = 'flex';
    renderActiveLightboxImage();
  }
}

function renderActiveLightboxImage() {
  const item = currentSubGalleryImages[activeLightboxIndex];
  if (!item) return;

  resetLightboxZoom();

  const lightboxImg = document.getElementById('lightbox-img');
  if (lightboxImg) {
    lightboxImg.src = item.src;
  }

  // Handle arrows visibility
  const prevBtn = document.getElementById('lightbox-prev-btn');
  const nextBtn = document.getElementById('lightbox-next-btn');
  const hasMultiple = currentSubGalleryImages.length > 1;
  if (prevBtn) prevBtn.style.display = hasMultiple ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = hasMultiple ? 'flex' : 'none';

  // Render HUD
  const hud = document.getElementById('lightbox-hud');
  const hudOutcome = document.getElementById('lightbox-hud-outcome');
  const hudBias = document.getElementById('lightbox-hud-bias');
  const hudDate = document.getElementById('lightbox-hud-date');

  if (item.entry) {
    const entry = item.entry;
    if (hud) hud.style.display = 'flex';
    if (hudOutcome) {
      hudOutcome.textContent = entry.status;
      hudOutcome.className = `hud-status ${entry.status.toLowerCase()}`;
    }
    if (hudBias) {
      hudBias.textContent = entry.bias;
      let biasColor = 'var(--color-neutral)';
      if (entry.bias === 'Bullish') biasColor = 'var(--color-bull)';
      else if (entry.bias === 'Bearish') biasColor = 'var(--color-bear)';
      else if (entry.bias === 'Both') biasColor = 'var(--color-both)';
      hudBias.style.borderColor = biasColor;
      hudBias.style.color = biasColor;
      hudBias.style.backgroundColor = biasColor + '1A';
    }
    if (hudDate) {
      hudDate.textContent = formatDateWithDay(entry.date);
    }

    // Render Drawer
    const drawer = document.getElementById('lightbox-notes-drawer');
    const drawerNotes = document.getElementById('lightbox-drawer-notes');
    const drawerMistakes = document.getElementById('lightbox-drawer-mistakes');

    if (drawer) {
      drawer.style.display = 'flex';
      // Start in collapsed state when switching images
      drawer.classList.remove('expanded');
      drawer.classList.add('collapsed');
      const toggleIcon = document.getElementById('lightbox-drawer-toggle-icon');
      if (toggleIcon) toggleIcon.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    }
    if (drawerNotes) drawerNotes.textContent = entry.notes || 'No notes recorded.';
    if (drawerMistakes) drawerMistakes.textContent = entry.mistakes || 'No mistakes recorded.';
  } else {
    // Hide HUD and drawer if no entry metadata (simple zoom)
    if (hud) hud.style.display = 'none';
    const drawer = document.getElementById('lightbox-notes-drawer');
    if (drawer) drawer.style.display = 'none';
  }
}

function navigateLightbox(direction, event) {
  if (event) event.stopPropagation();
  if (currentSubGalleryImages.length <= 1) return;

  activeLightboxIndex = (activeLightboxIndex + direction + currentSubGalleryImages.length) % currentSubGalleryImages.length;
  renderActiveLightboxImage();
}

function toggleLightboxDrawer(event) {
  if (event) event.stopPropagation();
  const drawer = document.getElementById('lightbox-notes-drawer');
  const toggleIcon = document.getElementById('lightbox-drawer-toggle-icon');
  if (drawer) {
    const isCollapsed = drawer.classList.contains('collapsed');
    if (isCollapsed) {
      drawer.classList.remove('collapsed');
      drawer.classList.add('expanded');
      if (toggleIcon) toggleIcon.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    } else {
      drawer.classList.remove('expanded');
      drawer.classList.add('collapsed');
      if (toggleIcon) toggleIcon.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    }
  }
}

function handleLightboxOverlayClick(event) {
  if (lightboxZoomState.draggedDuringThisClick) {
    lightboxZoomState.draggedDuringThisClick = false;
    return;
  }
  const isOverlay = event.target.id === 'image-lightbox' || event.target.classList.contains('lightbox-content-wrapper');
  if (isOverlay) {
    closeLightbox();
  }
}

// Mobile swipe touch gestures (only trigger when not zoomed)
let touchStartX = 0;
let touchEndX = 0;

function handleLightboxTouchStart(e) {
  if (lightboxZoomState.scale > 1.0) return;
  touchStartX = e.changedTouches[0].screenX;
}

function handleLightboxTouchEnd(e) {
  if (lightboxZoomState.scale > 1.0) return;
  touchEndX = e.changedTouches[0].screenX;
  handleLightboxSwipeGesture();
}

function handleLightboxSwipeGesture() {
  const threshold = 50;
  if (touchEndX < touchStartX - threshold) {
    navigateLightbox(1);
  } else if (touchEndX > touchStartX + threshold) {
    navigateLightbox(-1);
  }
}

// Global Keydown Handler for Lightbox Arrow Navigation
window.addEventListener('keydown', (e) => {
  const lightbox = document.getElementById('image-lightbox');
  if (lightbox && lightbox.style.display === 'flex') {
    if (e.key === 'ArrowLeft') {
      navigateLightbox(-1);
    } else if (e.key === 'ArrowRight') {
      navigateLightbox(1);
    } else if (e.key === 'Escape') {
      closeLightbox();
    }
  }
});

// ==========================================================================
// IMAGE REPOSITIONING CONTROL SYSTEM
// ==========================================================================
let repositionState = {
  isActive: false,
  platform: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  currentScale: 1.0,
  imgElement: null,
  wrapperElement: null,
  startTouchDistance: null,
  startTouchScale: null
};

function updateRepositionTransform() {
  if (!repositionState.isActive || !repositionState.imgElement) return;
  repositionState.imgElement.style.transform = `scale(${repositionState.currentScale}) translate(${repositionState.currentX}px, ${repositionState.currentY}px)`;
}

function toggleRepositionMode(platform) {
  if (repositionState.isActive) {
    saveReposition(platform);
    return;
  }

  const wrapperId = platform === 'desktop' ? 'desktop-main-image-wrapper' : 'mobile-main-image-wrapper';
  const imgId = platform === 'desktop' ? 'detail-chart-img' : 'mobile-detail-chart-img';
  
  const wrapper = document.getElementById(wrapperId);
  const img = document.getElementById(imgId);
  if (!wrapper || !img || !activeEntryId) return;

  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;

  repositionState.isActive = true;
  repositionState.platform = platform;
  repositionState.currentX = entry.imageX || 0;
  repositionState.currentY = entry.imageY || 0;
  repositionState.currentScale = entry.imageScale || 1.0;
  repositionState.imgElement = img;
  repositionState.wrapperElement = wrapper;

  wrapper.classList.add('repositioning-active');
  document.getElementById(`${platform}-reposition-instructions`).style.display = 'flex';
  document.getElementById(`${platform}-reposition-done`).style.display = 'inline-flex';

  wrapper.addEventListener('mousedown', handleRepositionStart);
  wrapper.addEventListener('touchstart', handleRepositionStart, { passive: false });
}

function handleRepositionStart(e) {
  if (e.touches && e.touches.length === 2) {
    // Ignore and let pinch listener handle it
    return;
  }
  e.preventDefault();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  repositionState.startX = clientX - repositionState.currentX;
  repositionState.startY = clientY - repositionState.currentY;

  window.addEventListener('mousemove', handleRepositionMove);
  window.addEventListener('mouseup', handleRepositionEnd);
  window.addEventListener('touchmove', handleRepositionMove, { passive: false });
  window.addEventListener('touchend', handleRepositionEnd);
}

function handleRepositionMove(e) {
  if (!repositionState.isActive) return;
  if (e.touches && e.touches.length === 2) {
    // Ignore drag panning when pinching
    return;
  }
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  const targetX = clientX - repositionState.startX;
  const targetY = clientY - repositionState.startY;

  repositionState.currentX = targetX;
  repositionState.currentY = targetY;

  updateRepositionTransform();
}

function handleRepositionEnd(e) {
  window.removeEventListener('mousemove', handleRepositionMove);
  window.removeEventListener('mouseup', handleRepositionEnd);
  window.removeEventListener('touchmove', handleRepositionMove);
  window.removeEventListener('touchend', handleRepositionEnd);
}

function saveReposition(platform) {
  if (!repositionState.isActive) return;

  const entry = entries.find(e => e.id === activeEntryId);
  if (entry) {
    entry.imageScale = repositionState.currentScale;
    entry.imageX = repositionState.currentX;
    entry.imageY = repositionState.currentY;
    saveDatabase(entry, false, true); // Immediate save
  }

  repositionState.isActive = false;
  
  const wrapper = repositionState.wrapperElement;
  if (wrapper) {
    wrapper.classList.remove('repositioning-active');
    wrapper.removeEventListener('mousedown', handleRepositionStart);
    wrapper.removeEventListener('touchstart', handleRepositionStart);
  }

  document.getElementById(`${platform}-reposition-instructions`).style.display = 'none';
  document.getElementById(`${platform}-reposition-done`).style.display = 'none';

  renderAll();
}

// ==========================================================================
// QUICK-ADD TAG SYSTEM IN MULTISELECT DROPDOWN
// ==========================================================================
function handleQuickAddTag(event, inputEl) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const tagName = inputEl.value.trim();
    if (!tagName) return;

    const duplicate = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
    if (duplicate) {
      const entry = entries.find(e => e.id === activeEntryId);
      if (entry && !entry.patterns.includes(duplicate.name)) {
        entry.patterns.push(duplicate.name);
        saveDatabase(entry, false, true);
        renderAll();
      }
      inputEl.value = '';
      return;
    }

    const defaultColor = '#3b82f6';
    const defaultBg = 'rgba(59, 130, 246, 0.15)';
    const newTagObj = {
      name: tagName,
      bias: 'Both',
      color: defaultColor,
      bg: defaultBg
    };

    tags.push(newTagObj);
    
    const entry = entries.find(e => e.id === activeEntryId);
    if (entry) {
      entry.patterns.push(tagName);
      saveDatabase(entry, false, true);
    } else {
      saveDatabase(null, false, true);
    }

    inputEl.value = '';
    renderAll();
  }
}

// ==========================================================================
// IMAGE NAVIGATION CAROUSEL METHODS
// ==========================================================================
function prevImage(platform) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry || !entry.images || entry.images.length <= 1) return;
  activeImageIndex = (activeImageIndex - 1 + entry.images.length) % entry.images.length;
  renderAll();
}

function nextImage(platform) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry || !entry.images || entry.images.length <= 1) return;
  activeImageIndex = (activeImageIndex + 1) % entry.images.length;
  renderAll();
}

// ==========================================================================
// BACKUP & RESTORE LOGIC (ZIP)
// ==========================================================================

function triggerImportZip() {
  const input = document.getElementById('import-file-input');
  if (input) input.click();
}

function getBase64Data(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const matches = dataUrl.match(/^data:(image\/[a-z0-9-+.]+);base64,(.+)$/i);
  if (!matches || matches.length < 3) return null;
  return {
    mimeType: matches[1],
    base64: matches[2]
  };
}

function exportBackupZip() {
  if (typeof JSZip === 'undefined') {
    alert("JSZip library is not loaded. Cannot perform ZIP export.");
    return;
  }

  const zip = new JSZip();
  zip.file('tags.json', JSON.stringify(tags, null, 2));
  zip.file('attributes.json', JSON.stringify(customAttributes, null, 2));

  const entriesFolder = zip.folder('entries');
  const imagesFolder = zip.folder('images');

  entries.forEach(e => {
    // Clone entry to avoid mutating original state
    const entryClone = JSON.parse(JSON.stringify(e));

    if (entryClone.images && entryClone.images.length > 0) {
      entryClone.images = entryClone.images.map((imgSrc, idx) => {
        const b64Info = getBase64Data(imgSrc);
        if (b64Info) {
          let ext = 'png';
          if (b64Info.mimeType.includes('jpeg') || b64Info.mimeType.includes('jpg')) ext = 'jpg';
          else if (b64Info.mimeType.includes('gif')) ext = 'gif';
          else if (b64Info.mimeType.includes('webp')) ext = 'webp';

          const imgFilename = `entry-${e.id}_image-${idx}.${ext}`;
          // Add binary file using the base64 content
          imagesFolder.file(imgFilename, b64Info.base64, { base64: true });
          // Map to relative path in ZIP folder structure
          return `images/${imgFilename}`;
        }
        return imgSrc;
      });
    }

    entriesFolder.file(`entry-${e.id}.json`, JSON.stringify(entryClone, null, 2));
  });

  zip.generateAsync({ type: 'blob' }).then(content => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `honey-journal-backup_${dateStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }).catch(err => {
    console.error('ZIP generation failed:', err);
    alert('Failed to generate backup ZIP: ' + err.message);
  });
}

async function handleImportZip(input) {
  if (typeof JSZip === 'undefined') {
    alert("JSZip library is not loaded. Cannot perform ZIP import.");
    input.value = '';
    return;
  }

  const file = input.files[0];
  if (!file) return;

  if (!confirm("Importing this backup will overwrite all existing setups, patterns, and custom attributes. Do you want to proceed?")) {
    input.value = '';
    return;
  }

  try {
    const zip = await JSZip.loadAsync(file);

    // 1. Read tags.json
    const tagsFile = zip.file('tags.json');
    let importedTags = null;
    if (tagsFile) {
      const content = await tagsFile.async('text');
      importedTags = JSON.parse(content);
    }

    // 2. Read attributes.json
    const attrsFile = zip.file('attributes.json');
    let importedAttrs = null;
    if (attrsFile) {
      const content = await attrsFile.async('text');
      importedAttrs = JSON.parse(content);
    }

    // 3. Read entries
    const entriesFolder = zip.folder('entries');
    const importedEntries = [];

    if (entriesFolder) {
      const filePromises = [];
      entriesFolder.forEach((relativePath, entryFile) => {
        if (entryFile.name.endsWith('.json')) {
          filePromises.push((async () => {
            const content = await entryFile.async('text');
            const entryObj = JSON.parse(content);
            importedEntries.push(entryObj);
          })());
        }
      });
      await Promise.all(filePromises);
    }

    if (!importedTags || !importedAttrs) {
      throw new Error("Missing tags.json or attributes.json inside the ZIP file. Invalid backup format.");
    }

    // 4. Restore base64 images from images/ folder
    const imagesFolder = zip.folder('images');
    if (imagesFolder && importedEntries.length > 0) {
      const imgPromises = [];
      importedEntries.forEach(entry => {
        if (entry.images && entry.images.length > 0) {
          entry.images.forEach((imgSrc, idx) => {
            if (typeof imgSrc === 'string' && imgSrc.startsWith('images/')) {
              const zipImgPath = imgSrc.replace('images/', '');
              const imgFile = imagesFolder.file(zipImgPath);
              if (imgFile) {
                imgPromises.push((async () => {
                  let mime = 'image/png';
                  if (zipImgPath.endsWith('.jpg') || zipImgPath.endsWith('.jpeg')) mime = 'image/jpeg';
                  else if (zipImgPath.endsWith('.gif')) mime = 'image/gif';
                  else if (zipImgPath.endsWith('.webp')) mime = 'image/webp';

                  const base64Content = await imgFile.async('base64');
                  entry.images[idx] = `data:${mime};base64,${base64Content}`;
                })());
              }
            }
          });
        }
      });
      await Promise.all(imgPromises);
    }

    // 5. Override state
    tags = importedTags;
    customAttributes = importedAttrs;
    entries = importedEntries;

    // 6. Save and reload
    await saveDatabase(null, true, true);
    renderAll();
    alert("Data successfully imported! " + entries.length + " setups restored.");

  } catch (err) {
    console.error("ZIP import failed:", err);
    alert("Failed to import ZIP backup: " + err.message);
  } finally {
    input.value = '';
  }
}

// ==========================================================================
// CLIPBOARD INTERFACE & TOAST ALERTS SYSTEM
// ==========================================================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  
  const icon = type === 'success' 
    ? '<i class="fa-solid fa-circle-check" style="color: var(--color-bull);"></i>'
    : '<i class="fa-solid fa-circle-xmark" style="color: var(--color-bear);"></i>';
    
  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  // Auto remove toast after animation ends
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

async function copyActiveImageToClipboard(platform) {
  if (!activeEntryId) return;
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry || !entry.images || entry.images.length === 0) {
    showToast('No screenshot to copy.', 'error');
    return;
  }

  // Use the active image index in detail pane
  const activeImgSrc = entry.images[activeImageIndex];
  if (!activeImgSrc) {
    showToast('No active image selected.', 'error');
    return;
  }

  try {
    const res = await fetch(activeImgSrc);
    const blob = await res.blob();
    
    // navigator.clipboard.write takes an array of ClipboardItems
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    showToast('Screenshot copied to clipboard!', 'success');
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    showToast('Failed to copy: ' + err.message, 'error');
  }
}

function handleClipboardPaste(e) {
  // Only handle paste if detail view pane is active and open
  const dPane = document.getElementById('desktop-detail-pane');
  const mPane = document.getElementById('mobile-detail-pane');
  
  const detailOpen = (dPane && !dPane.classList.contains('closed')) || (mPane && mPane.classList.contains('open'));
  if (!activeEntryId || !detailOpen) return;

  const items = e.clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        readAndAddPastedImage(file);
        break;
      }
    }
  }
}

function readAndAddPastedImage(file) {
  const reader = new FileReader();
  reader.onload = function(event) {
    const base64Src = event.target.result;
    const entry = entries.find(e => e.id === activeEntryId);
    if (entry) {
      if (!entry.images) entry.images = [];
      entry.images.push(base64Src);
      activeImageIndex = entry.images.length - 1; // Show the newly pasted image immediately
      entry.updatedAt = new Date().toISOString();
      saveDatabase(entry, false, true);
      renderAll();
      showToast('Clipboard image pasted successfully!', 'success');
    }
  };
  reader.readAsDataURL(file);
}

// Playbook / Setup Guidelines Toggles & Saves
function togglePlaybookCollapse(platform) {}
function enablePlaybookEdit(platform) {}
function cancelPlaybookEdit(platform) {}

function handlePlaybookInput(platform) {
  const textarea = document.getElementById(`${platform}-playbook-textarea`);
  if (!textarea) return;
  
  // Show save button
  const saveBtn = document.getElementById(`${platform}-playbook-save-btn`);
  if (saveBtn) {
    saveBtn.style.display = 'inline-flex';
  }
  
  // Keep the other platform's textarea value in sync
  const otherPlatform = platform === 'desktop' ? 'mobile' : 'desktop';
  const otherTextarea = document.getElementById(`${otherPlatform}-playbook-textarea`);
  if (otherTextarea) {
    otherTextarea.value = textarea.value;
  }
  
  // Also show the other platform's save button
  const otherSaveBtn = document.getElementById(`${otherPlatform}-playbook-save-btn`);
  if (otherSaveBtn) {
    otherSaveBtn.style.display = 'inline-flex';
  }
}

function savePlaybookDescription(platform) {
  const textarea = document.getElementById(`${platform}-playbook-textarea`);
  if (!textarea) return;
  const newDesc = textarea.value.trim();

  const tagIndex = tags.findIndex(t => t.name === activePatternSubGallery);
  if (tagIndex !== -1) {
    tags[tagIndex].description = newDesc;
    
    // Save to localStorage/Tauri
    saveDatabase(null, false, true);
    
    // Hide save buttons on both platforms
    ['desktop', 'mobile'].forEach(plat => {
      const btn = document.getElementById(`${plat}-playbook-save-btn`);
      if (btn) btn.style.display = 'none';
    });
    
    showToast('Description saved successfully!', 'success');
  }
}
