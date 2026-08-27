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

// Multi-profile state
let currentProfile = localStorage.getItem('honey_journal_current_profile') || null;
let profilesList = JSON.parse(localStorage.getItem('honey_journal_profiles_list') || '["NIFTY"]');
let isPortalManageMode = false; // Tracks if we are in delete-profiles mode

// Mamba AI & Gemini API State (synced via Syncthing)
let aiConfig = {
  apiKey: localStorage.getItem('honey_journal_gemini_api_key') || '',
  model: localStorage.getItem('honey_journal_gemini_model') || 'gemini-3.5-flash-lite',
  customModel: localStorage.getItem('honey_journal_gemini_custom_model') || '',
  persona: 'mamba'
};
let aiChatHistory = [];
let isAITyping = false;

function getProfilePath(...parts) {
  if (storagePath) {
    if (currentProfile) {
      return joinPath(storagePath, 'profiles', currentProfile, ...parts);
    }
    return joinPath(storagePath, ...parts);
  }
  return '';
}

async function saveProfilesListToDisk() {
  localStorage.setItem('honey_journal_profiles_list', JSON.stringify(profilesList));
  if (window.__TAURI__ && storagePath) {
    const invoke = getTauriInvoke();
    await invoke('fs_write_text_file', {
      path: joinPath(storagePath, 'profiles.json'),
      content: JSON.stringify(profilesList, null, 2)
    }).catch(err => console.error('Failed to save profiles.json to disk:', err));
  }
}

async function loadProfilesListFromDisk() {
  if (window.__TAURI__ && storagePath) {
    const invoke = getTauriInvoke();
    try {
      const content = await invoke('fs_read_text_file', { path: joinPath(storagePath, 'profiles.json') });
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        profilesList = parsed;
        localStorage.setItem('honey_journal_profiles_list', JSON.stringify(profilesList));
      }
    } catch (err) {
      console.log('No profiles.json found on disk, fallback to localStorage/default.');
      await saveProfilesListToDisk();
    }
  }
}

let activeImageIndex = 0;
let activePatternSubGallery = null;
let currentSubGalleryImages = [];
let activeLightboxIndex = 0;
const animatedDesktopEntryIds = new Set();
const animatedMobileEntryIds = new Set();

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
let currentStatsPeriod = 'daily';
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
    try {
      localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
      localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
      localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
    } catch (e) {
      // Quota exceeded on unload — not critical, disk is the source of truth
      console.warn('localStorage write on unload failed:', e);
    }
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

    const isScrollAtTop = (target = null) => {
      if (currentMobileView === 'coach' || (target && target.closest && target.closest('#mobile-coach-view'))) {
        return false; // Never trigger pull-to-refresh inside AI Coach chat view!
      }
      const contentArea = document.getElementById('mobile-content-area');
      if (contentArea) {
        return contentArea.scrollTop === 0;
      }
      return true;
    };

    phoneScreen.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1 && isScrollAtTop(e.target)) {
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

    await loadProfilesListFromDisk();

    if (currentProfile) {
      await loadDatabase();
      const activeProfNameEl = document.getElementById('desktop-active-profile-name');
      if (activeProfNameEl) activeProfNameEl.textContent = currentProfile;

      switchDesktopView(currentDesktopView);
      switchMobileView(currentMobileView);
    } else {
      // Force profile selection
      showProfilePortal();
    }
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

  await loadProfilesListFromDisk();

  if (currentProfile) {
    await loadDatabase();
    const activeProfNameEl = document.getElementById('desktop-active-profile-name');
    if (activeProfNameEl) activeProfNameEl.textContent = currentProfile;

    switchDesktopView(currentDesktopView);
    switchMobileView(currentMobileView);
  } else {
    showProfilePortal();
  }
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
      // 1. LEGACY MIGRATION CHECK:
      // If legacy root attributes.json or tags.json exists, migrate it to NIFTY profile
      let isLegacy = false;
      try {
        await invoke('fs_read_text_file', { path: joinPath(storagePath, 'attributes.json') });
        isLegacy = true;
      } catch {
        try {
          await invoke('fs_read_text_file', { path: joinPath(storagePath, 'tags.json') });
          isLegacy = true;
        } catch {}
      }

      if (isLegacy) {
        console.log('Legacy root data detected! Migrating to NIFTY profile...');
        
        // Ensure NIFTY profile directory structure exists
        const niftyEntriesPath = joinPath(storagePath, 'profiles', 'NIFTY', 'entries');
        await invoke('fs_create_dir', { path: niftyEntriesPath });

        // A. Migrate tags
        let legacyTags = seeds.initialTags;
        try {
          const content = await invoke('fs_read_text_file', { path: joinPath(storagePath, 'tags.json') });
          legacyTags = JSON.parse(content);
          await invoke('fs_write_text_file', {
            path: joinPath(storagePath, 'profiles', 'NIFTY', 'tags.json'),
            content: JSON.stringify(legacyTags, null, 2)
          });
          await invoke('fs_remove_file', { path: joinPath(storagePath, 'tags.json') }).catch(()=>{});
        } catch {}

        // B. Migrate custom attributes
        let legacyAttrs = seeds.defaultCustomAttributes;
        try {
          const content = await invoke('fs_read_text_file', { path: joinPath(storagePath, 'attributes.json') });
          legacyAttrs = JSON.parse(content);
          await invoke('fs_write_text_file', {
            path: joinPath(storagePath, 'profiles', 'NIFTY', 'attributes.json'),
            content: JSON.stringify(legacyAttrs, null, 2)
          });
          await invoke('fs_remove_file', { path: joinPath(storagePath, 'attributes.json') }).catch(()=>{});
        } catch {}

        // C. Migrate entries
        try {
          const filesContent = await invoke('fs_read_dir_json', { path: joinPath(storagePath, 'entries') });
          for (const content of filesContent) {
            try {
              const entryObj = JSON.parse(content);
              if (entryObj && entryObj.id) {
                await invoke('fs_write_text_file', {
                  path: joinPath(storagePath, 'profiles', 'NIFTY', 'entries', `entry-${entryObj.id}.json`),
                  content: JSON.stringify(entryObj, null, 2)
                });
                await invoke('fs_remove_file', { path: joinPath(storagePath, 'entries', `entry-${entryObj.id}.json`) }).catch(()=>{});
              }
            } catch {}
          }
        } catch {}

        // Set default profile parameters
        currentProfile = 'NIFTY';
        localStorage.setItem('honey_journal_current_profile', 'NIFTY');
        if (!profilesList.includes('NIFTY')) {
          profilesList.push('NIFTY');
          await saveProfilesListToDisk();
        }
        console.log('Legacy migration to NIFTY completed successfully!');
      }

      // If we don't have currentProfile selected yet, do not load data yet!
      if (!currentProfile) {
        console.log('No active profile chosen. Halting database load until selected.');
        return;
      }

      // Create entries sub-directory inside active profile path
      await invoke('fs_create_dir', { path: getProfilePath('entries') });

      // Load tags.json
      try {
        const tagsContent = await invoke('fs_read_text_file', { path: getProfilePath('tags.json') });
        tags = JSON.parse(tagsContent);
      } catch {
        console.log(`No tags.json found for profile ${currentProfile}, seeding...`);
        tags = seeds.initialTags;
        await saveTagsToDisk();
      }

      // Load attributes.json
      try {
        const attrsContent = await invoke('fs_read_text_file', { path: getProfilePath('attributes.json') });
        customAttributes = JSON.parse(attrsContent);
      } catch {
        console.log(`No attributes.json found for profile ${currentProfile}, seeding...`);
        customAttributes = seeds.defaultCustomAttributes;
        await saveAttributesToDisk();
      }

      // Load all entry files
      try {
        const filesContent = await invoke('fs_read_dir_json', { path: getProfilePath('entries') });
        const diskEntries = [];
        for (const content of filesContent) {
          try { diskEntries.push(JSON.parse(content)); } catch { /* skip corrupt file */ }
        }

        // Recover unsaved changes from localStorage if any
        const prefix = `honey_profile_${currentProfile}_`;
        const localEntriesStr = localStorage.getItem(prefix + 'entries');
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
          if (!e.primaryImages) {
            e.primaryImages = (e.images && e.images.length > 0) ? [0] : [];
          }
          updateEntryStatus(e);
          e._saved = true;
        });
      } catch (err) {
        console.error('Error reading entries directory:', err);
        entries = [];
      }

      // Mirror to localStorage as a fast-read cache.
      const prefix = `honey_profile_${currentProfile}_`;
      try {
        localStorage.setItem(prefix + 'entries', JSON.stringify(entries));
        localStorage.setItem(prefix + 'tags', JSON.stringify(tags));
        localStorage.setItem(prefix + 'custom_attrs', JSON.stringify(customAttributes));
      } catch (quotaErr) {
        // Quota exceeded — cache a slim version without images (disk is source of truth)
        try {
          const slim = entries.map(e => { const c = Object.assign({}, e); c.images = []; return c; });
          localStorage.setItem(prefix + 'entries', JSON.stringify(slim));
          localStorage.setItem(prefix + 'tags', JSON.stringify(tags));
          localStorage.setItem(prefix + 'custom_attrs', JSON.stringify(customAttributes));
        } catch (e2) {
          console.warn('localStorage full even after image strip on load mirror:', e2);
        }
      }

      // Load Syncthing-synced AI config and chat history
      await loadAIConfigFromDisk();
      await loadAIChatHistoryFromDisk();
      return;

    } catch (err) {
      console.error('Tauri filesystem error, falling back to localStorage:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // FALLBACK: browser localStorage (web preview / mockup mode only)
  // ---------------------------------------------------------------------------
  if (!currentProfile) {
    console.log('No active profile chosen in browser fallback. Halting database load.');
    return;
  }
  const prefix = `honey_profile_${currentProfile}_`;
  const localEntries   = localStorage.getItem(prefix + 'entries');
  const localTags      = localStorage.getItem(prefix + 'tags');
  const localCustomAttrs = localStorage.getItem(prefix + 'custom_attrs');

  entries         = localEntries      ? JSON.parse(localEntries)      : seeds.initialEntries;
  tags            = localTags         ? JSON.parse(localTags)         : seeds.initialTags;
  customAttributes = localCustomAttrs ? JSON.parse(localCustomAttrs)  : seeds.defaultCustomAttributes;

  if (!localEntries)      localStorage.setItem(prefix + 'entries', JSON.stringify(entries));
  if (!localTags)         localStorage.setItem(prefix + 'tags', JSON.stringify(tags));
  if (!localCustomAttrs)  localStorage.setItem(prefix + 'custom_attrs', JSON.stringify(customAttributes));

  await loadAIConfigFromDisk();
  await loadAIChatHistoryFromDisk();

  // Migrate entries: old single-image string → images array, and status based on P&L
  entries.forEach(e => {
    if (!e.images) e.images = e.image ? [e.image] : [];
    if (!e.primaryImages) {
      e.primaryImages = (e.images && e.images.length > 0) ? [0] : [];
    }
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
  // Write to localStorage as a backup cache.
  const prefix = currentProfile ? `honey_profile_${currentProfile}_` : 'honey_journal_';
  try {
    localStorage.setItem(prefix + 'entries', JSON.stringify(entries));
    localStorage.setItem(prefix + 'tags', JSON.stringify(tags));
    localStorage.setItem(prefix + 'custom_attrs', JSON.stringify(customAttributes));
  } catch (e) {
    // Quota exceeded — strip images from cache copy only (disk copy keeps them)
    try {
      const slim = entries.map(e => { const c = Object.assign({}, e); c.images = []; return c; });
      localStorage.setItem(prefix + 'entries', JSON.stringify(slim));
      localStorage.setItem(prefix + 'tags', JSON.stringify(tags));
      localStorage.setItem(prefix + 'custom_attrs', JSON.stringify(customAttributes));
    } catch (e2) {
      console.warn('localStorage full even after image strip — skipping cache write:', e2);
    }
  }

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
      try {
        await saveTagsToDisk();
        await saveAttributesToDisk();
        const promises = [];
        for (const id of entriesToSave) {
          const entry = entries.find(e => e.id === id);
          if (entry) promises.push(saveEntryToDisk(entry));
        }
        await Promise.all(promises);
        entriesToSave.clear();
      } catch (diskErr) {
        console.error('Disk write failed:', diskErr);
        showToast('Save failed: ' + diskErr, 'error');
      }
    };

    if (saveTimeout) clearTimeout(saveTimeout);
    if (immediate) await performSave();
    else saveTimeout = setTimeout(performSave, 300);
  }
}

async function saveTagsToDisk() {
  if (!window.__TAURI__ || !storagePath || !currentProfile) return;
  const invoke = getTauriInvoke();
  await invoke('fs_write_text_file', {
    path: getProfilePath('tags.json'),
    content: JSON.stringify(tags, null, 2)
  }).catch(err => console.error('Failed to save tags.json:', err));
}

async function saveAttributesToDisk() {
  if (!window.__TAURI__ || !storagePath || !currentProfile) return;
  const invoke = getTauriInvoke();
  await invoke('fs_write_text_file', {
    path: getProfilePath('attributes.json'),
    content: JSON.stringify(customAttributes, null, 2)
  }).catch(err => console.error('Failed to save attributes.json:', err));
}

async function saveEntryToDisk(entry) {
  if (!window.__TAURI__ || !storagePath || !currentProfile) return;
  const invoke = getTauriInvoke();
  await invoke('fs_write_text_file', {
    path: getProfilePath('entries', `entry-${entry.id}.json`),
    content: JSON.stringify(entry, null, 2)
  }).catch(err => console.error(`Failed to save entry ${entry.id}:`, err));
}

async function removeEntryFromDisk(entryId) {
  if (!window.__TAURI__ || !storagePath || !currentProfile) return;
  const invoke = getTauriInvoke();
  await invoke('fs_remove_file', {
    path: getProfilePath('entries', `entry-${entryId}.json`)
  }).catch(err => console.error(`Failed to delete entry ${entryId}:`, err));
}


// ──────────────────────────────────────────────────────────────────────────
// PREMIUM PROFILE WORKSPACE MANAGEMENT PORTAL
// ──────────────────────────────────────────────────────────────────────────

function getProfileEntriesCount(profileName) {
  try {
    const cached = localStorage.getItem(`honey_profile_${profileName}_entries`);
    if (cached) {
      const arr = JSON.parse(cached);
      return Array.isArray(arr) ? arr.length : 0;
    }
  } catch {}
  return 0;
}

function showProfilePortal() {
  const portalScreen = document.getElementById('profile-portal-screen');
  if (!portalScreen) return;

  isPortalManageMode = false;
  const portalContainer = portalScreen.querySelector('.portal-container');
  if (portalContainer) portalContainer.classList.remove('manage-mode');
  
  const manageBtnText = document.getElementById('portal-manage-btn-text');
  if (manageBtnText) manageBtnText.textContent = 'Manage Portfolios';

  // Toggle close button visibility based on whether a profile is active
  const closeBtn = document.getElementById('portal-close-btn');
  if (closeBtn) {
    closeBtn.style.display = currentProfile ? 'flex' : 'none';
  }

  const cardsContainer = document.getElementById('portal-cards-container');
  if (!cardsContainer) return;

  let html = '';
  profilesList.forEach(prof => {
    const count = getProfileEntriesCount(prof);
    let avatarClass = 'avatar-generic';
    let iconClass = 'fa-solid fa-chart-pie';
    
    if (prof.toUpperCase() === 'NIFTY') {
      avatarClass = 'avatar-nifty';
      iconClass = 'fa-solid fa-chart-line';
    } else if (prof.toUpperCase() === 'NASDAQ') {
      avatarClass = 'avatar-nasdaq';
      iconClass = 'fa-solid fa-chart-area';
    }

    html += `
      <div class="portal-card" onclick="handlePortalCardClick('${prof}')">
        <div class="portal-card-delete-badge" onclick="event.stopPropagation(); deleteProfile('${prof}')" title="Delete Portfolio">
          <i class="fa-solid fa-trash-can"></i>
        </div>
        <div class="portal-card-avatar ${avatarClass}">
          <i class="${iconClass}"></i>
        </div>
        <div class="portal-card-name">${prof}</div>
        <div class="portal-card-meta">${count} setup${count !== 1 ? 's' : ''}</div>
      </div>
    `;
  });

  // Add Portfolio Card
  html += `
    <div class="portal-card add-card" onclick="promptCreateProfile()">
      <div class="portal-card-avatar avatar-add">
        <i class="fa-solid fa-plus"></i>
      </div>
      <div class="portal-card-name">Add Portfolio</div>
      <div class="portal-card-meta">Create new</div>
    </div>
  `;

  cardsContainer.innerHTML = html;
  portalScreen.style.display = 'flex';
  
  // Make sure loading overlay is hidden
  const loader = document.getElementById('profile-loading-overlay');
  if (loader) loader.style.display = 'none';
}

function closeProfilePortal() {
  const portalScreen = document.getElementById('profile-portal-screen');
  if (portalScreen) {
    portalScreen.style.display = 'none';
  }
}

function handlePortalCardClick(profileName) {
  if (isPortalManageMode) {
    deleteProfile(profileName);
  } else {
    selectProfile(profileName);
  }
}

async function selectProfile(profileName) {
  const loader = document.getElementById('profile-loading-overlay');
  const statusText = document.getElementById('loader-status-text');
  if (loader) {
    statusText.textContent = `Loading ${profileName} Portfolio...`;
    loader.style.opacity = '1';
    loader.style.display = 'flex';
  }

  const portalScreen = document.getElementById('profile-portal-screen');
  if (portalScreen) portalScreen.style.opacity = '0';

  // Wait 850ms to play the premium load animation
  setTimeout(async () => {
    try {
      currentProfile = profileName;
      localStorage.setItem('honey_journal_current_profile', profileName);

      await loadDatabase();

      // Reset filters and states
      activeEntryId = null;
      activeCalendarDate = null;
      activePatternSubGallery = null;
      desktopSearchText = '';
      mobileSearchText = '';

      // Update Header active label
      const activeProfNameEl = document.getElementById('desktop-active-profile-name');
      if (activeProfNameEl) activeProfNameEl.textContent = currentProfile;

      // Re-initialize views
      switchDesktopView(currentDesktopView);
      switchMobileView(currentMobileView);

      if (currentDesktopView === 'settings') renderDesktopSettings();
      if (currentMobileView === 'more') renderMobileMore();

      showToast(`Loaded ${profileName} Workspace`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Error loading workspace', 'error');
    } finally {
      if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
          loader.style.display = 'none';
          if (portalScreen) {
            portalScreen.style.display = 'none';
            portalScreen.style.opacity = '1';
          }
        }, 300);
      }
    }
  }, 850);
}

async function promptCreateProfile() {
  const name = prompt("Enter a name for the new Portfolio Workspace (e.g., Nasdaq, Crypto):");
  if (!name) return;

  const cleanName = name.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '');
  if (!cleanName) {
    alert("Invalid name.");
    return;
  }

  const existing = profilesList.find(p => p.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    alert("A portfolio with this name already exists.");
    return;
  }

  profilesList.push(cleanName);
  await saveProfilesListToDisk();
  
  selectProfile(cleanName);
}

async function deleteProfile(profileName) {
  if (profilesList.length <= 1) {
    alert("You must keep at least one portfolio workspace.");
    return;
  }

  const confirmMsg = `Are you sure you want to permanently delete the portfolio "${profileName}"? This will delete all setups, attributes, and image references under this workspace.`;
  if (!confirm(confirmMsg)) return;

  // Clean up directory if Tauri
  if (window.__TAURI__ && storagePath) {
    const invoke = getTauriInvoke();
    try {
      await invoke('fs_remove_file', { path: joinPath(storagePath, 'profiles', profileName, 'attributes.json') }).catch(()=>{});
      await invoke('fs_remove_file', { path: joinPath(storagePath, 'profiles', profileName, 'tags.json') }).catch(()=>{});
      
      const cached = localStorage.getItem(`honey_profile_${profileName}_entries`);
      if (cached) {
        const arr = JSON.parse(cached);
        if (Array.isArray(arr)) {
          for (const e of arr) {
            await invoke('fs_remove_file', { path: joinPath(storagePath, 'profiles', profileName, 'entries', `entry-${e.id}.json`) }).catch(()=>{});
          }
        }
      }
    } catch (err) {
      console.error('Tauri folder cleanup failed:', err);
    }
  }

  profilesList = profilesList.filter(p => p !== profileName);
  await saveProfilesListToDisk();

  localStorage.removeItem(`honey_profile_${profileName}_entries`);
  localStorage.removeItem(`honey_profile_${profileName}_tags`);
  localStorage.removeItem(`honey_profile_${profileName}_custom_attrs`);

  if (currentProfile === profileName) {
    currentProfile = profilesList[0];
    localStorage.setItem('honey_journal_current_profile', currentProfile);
  }

  showToast(`Deleted ${profileName} Workspace`, 'info');
  showProfilePortal();
}

function togglePortalManageMode() {
  const portalScreen = document.getElementById('profile-portal-screen');
  if (!portalScreen) return;
  const portalContainer = portalScreen.querySelector('.portal-container');
  if (!portalContainer) return;

  isPortalManageMode = !isPortalManageMode;
  if (isPortalManageMode) {
    portalContainer.classList.add('manage-mode');
    document.getElementById('portal-manage-btn-text').textContent = 'Exit Manage Mode';
  } else {
    portalContainer.classList.remove('manage-mode');
    document.getElementById('portal-manage-btn-text').textContent = 'Manage Portfolios';
  }
}



// Theme Controls

function setAccentTheme(themeName) {
  const validThemes = ['honey-gold', 'emerald-bull', 'cyber-neon', 'obsidian-minimal'];
  if (!validThemes.includes(themeName)) themeName = 'honey-gold';
  localStorage.setItem('honey_journal_accent_theme', themeName);
  document.documentElement.setAttribute('data-accent-theme', themeName);

  document.querySelectorAll('.compact-accent-pill').forEach(pill => {
    if (pill.getAttribute('data-preset') === themeName) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

function getCompactAccentPickerHTML() {
  const activeAccent = localStorage.getItem('honey_journal_accent_theme') || 'honey-gold';
  return `
    <div class="compact-accent-picker">
      <button class="compact-accent-pill ${activeAccent === 'honey-gold' ? 'active' : ''}" data-preset="honey-gold" onclick="setAccentTheme('honey-gold')">
        <span class="compact-swatch-dots">
          <span class="compact-swatch-dot" style="background:#FFB703;"></span>
          <span class="compact-swatch-dot" style="background:#A2E048;"></span>
        </span>
        <span>Honey Gold</span>
      </button>
      <button class="compact-accent-pill ${activeAccent === 'emerald-bull' ? 'active' : ''}" data-preset="emerald-bull" onclick="setAccentTheme('emerald-bull')">
        <span class="compact-swatch-dots">
          <span class="compact-swatch-dot" style="background:#10B981;"></span>
          <span class="compact-swatch-dot" style="background:#34D399;"></span>
        </span>
        <span>Emerald</span>
      </button>
      <button class="compact-accent-pill ${activeAccent === 'cyber-neon' ? 'active' : ''}" data-preset="cyber-neon" onclick="setAccentTheme('cyber-neon')">
        <span class="compact-swatch-dots">
          <span class="compact-swatch-dot" style="background:#06B6D4;"></span>
          <span class="compact-swatch-dot" style="background:#F43F5E;"></span>
        </span>
        <span>Cyber</span>
      </button>
      <button class="compact-accent-pill ${activeAccent === 'obsidian-minimal' ? 'active' : ''}" data-preset="obsidian-minimal" onclick="setAccentTheme('obsidian-minimal')">
        <span class="compact-swatch-dots">
          <span class="compact-swatch-dot" style="background:#38BDF8;"></span>
          <span class="compact-swatch-dot" style="background:#94A3B8;"></span>
        </span>
        <span>Minimal</span>
      </button>
    </div>
  `;
}

function initTheme() {
  const savedTheme = localStorage.getItem('honey_journal_theme') || 'dark';
  applyTheme(savedTheme);

  const savedAccent = localStorage.getItem('honey_journal_accent_theme') || 'honey-gold';
  setAccentTheme(savedAccent);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.innerHTML = theme === 'light' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }
  const mobileSwitch = document.getElementById('mobile-theme-switch');
  if (mobileSwitch) {
    mobileSwitch.checked = (theme === 'dark');
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
  document.querySelectorAll('.apple-dropdown-menu.open, .custom-sort-menu.open').forEach(menu => {
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
  const sortDropdown = document.getElementById('desktop-sort-dropdown-container');
  const newBtn = document.querySelector('#desktop-header-controls .btn-primary');
  
  const galleryView = document.getElementById('desktop-gallery-view');
  const tableView = document.getElementById('desktop-table-view');
  const calendarView = document.getElementById('desktop-calendar-view');
  const statsView = document.getElementById('desktop-stats-view');
  const settingsView = document.getElementById('desktop-settings-view');
  const coachView = document.getElementById('desktop-coach-view');

  // Hide header actions on dashboard/calendar/statistics/settings/coach views to prevent clutter
  const isPatternsView = (view === 'patterns');
  if (tabsContainer) tabsContainer.style.display = isPatternsView ? 'flex' : 'none';
  if (sortDropdown) sortDropdown.style.display = isPatternsView ? 'inline-block' : 'none';
  if (newBtn) newBtn.style.display = isPatternsView ? 'flex' : 'none';

  // Hide all screens
  galleryView.style.display = 'none';
  tableView.style.display = 'none';
  calendarView.style.display = 'none';
  statsView.style.display = 'none';
  settingsView.style.display = 'none';
  if (coachView) coachView.style.display = 'none';
  
  const subGalleryView = document.getElementById('desktop-pattern-subgallery-view');
  if (subGalleryView) subGalleryView.style.display = 'none';
  activePatternSubGallery = null;

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
  } else if (view === 'coach') {
    titleEl.textContent = 'Mamba AI Mentor';
    if (coachView) {
      coachView.style.display = 'flex';
      renderDesktopCoach();
    }
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

// Custom Sort Dropdown Handler
function toggleSortMenu(device, event) {
  if (event) event.stopPropagation();
  const menuId = device === 'desktop' ? 'desktop-sort-menu' : 'mobile-sort-menu';
  const menu = document.getElementById(menuId);
  if (!menu) return;

  // Close any other open menus
  document.querySelectorAll('.custom-sort-menu, .apple-dropdown-menu').forEach(openMenu => {
    if (openMenu !== menu) openMenu.classList.remove('open');
  });

  menu.classList.toggle('open');
}

function selectSortOption(val, device) {
  sortOrder = val;

  // Update active class in both menus
  document.querySelectorAll('#desktop-sort-menu .custom-sort-item, #mobile-sort-menu .custom-sort-item').forEach(item => {
    const isVal = item.getAttribute('data-value') === val;
    item.classList.toggle('active', isVal);
  });

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

// Clean filtering logic based on simplified attributes
function getProcessedEntries(searchText = null, calendarDate = null) {
  let list = [...entries];

  // Apply Calendar Date filter if selected
  if (calendarDate) {
    list = list.filter(e => e.date === calendarDate);
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
  const processedList = getProcessedEntries(null, activeCalendarDate);
  
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
    const isNew = !animatedDesktopEntryIds.has(entry.id);
    const animateClass = isNew ? 'should-animate' : '';
    if (isNew) {
      animatedDesktopEntryIds.add(entry.id);
    }
    card.className = `journal-card ${activeEntryId === entry.id ? 'active-border' : ''} ${animateClass}`.trim();
    card.onclick = () => openEntryDetail(entry.id);
    card.style.animationDelay = `${Math.min(index, 10) * 40}ms`;
    if (isNew) {
      card.addEventListener('animationend', () => {
        card.classList.remove('should-animate');
      }, { once: true });
    }

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

    const primaryIdx = entry.primaryImages && entry.primaryImages.length > 0 ? entry.primaryImages[0] : 0;
    const firstImage = entry.images && entry.images.length > 0 ? (entry.images[primaryIdx] || entry.images[0]) : '';
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

    const primaryIdx = entry.primaryImages && entry.primaryImages.length > 0 ? entry.primaryImages[0] : 0;
    const firstImage = entry.images && entry.images.length > 0 ? (entry.images[primaryIdx] || entry.images[0]) : '';

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

      const primaryIdx = entry.primaryImages && entry.primaryImages.length > 0 ? entry.primaryImages[0] : 0;
      const firstImage = entry.images && entry.images.length > 0 ? (entry.images[primaryIdx] || entry.images[0]) : '';
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

      const maxBullCount = sortedBullish.length > 0 ? Math.max(...sortedBullish.map(item => item[1].total)) : 0;
      const maxBearCount = sortedBearish.length > 0 ? Math.max(...sortedBearish.map(item => item[1].total)) : 0;
      
      const bullChartHtml = generateSetupBarChartHTML(sortedBullish, maxBullCount, '--color-bull');
      const bearChartHtml = generateSetupBarChartHTML(sortedBearish, maxBearCount, '--color-bear');

      statsContent = `
        <div style="padding: 24px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px;">
          <div>
            <h3 style="font-family: var(--font-display); font-size: 16px; margin-bottom: 12px; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-arrow-trend-up" style="color:var(--color-bull);"></i> Bullish Setups Usage</h3>
            <div class="stats-rank-list">
              ${bullHtml}
            </div>
            ${bullChartHtml}
          </div>
          
          <div>
            <h3 style="font-family: var(--font-display); font-size: 16px; margin-bottom: 12px; display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-arrow-trend-down" style="color:var(--color-bear);"></i> Bearish Setups Usage</h3>
            <div class="stats-rank-list">
              ${bearHtml}
            </div>
            ${bearChartHtml}
          </div>
        </div>
      `;
    } else {
      statsContent = renderJournalStatsTab(false);
    }

    let control = document.getElementById('desktop-stats-segmented-control');
    if (!control) {
      container.innerHTML = `
        <div class="stats-segmented-control" id="desktop-stats-segmented-control">
          <span class="stats-pill" aria-hidden="true"></span>
          <button class="stats-tab-btn ${activeSetup}" onclick="switchStatsTab('setup')">Setup Statistics</button>
          <button class="stats-tab-btn ${activeJournal}" onclick="switchStatsTab('journal')">Journal Statistics</button>
        </div>
        <div id="stats-tab-content" style="margin-top: 16px;">
          ${statsContent}
        </div>
      `;
      control = document.getElementById('desktop-stats-segmented-control');
    } else {
      const btns = control.querySelectorAll('.stats-tab-btn');
      btns.forEach(btn => {
        if (btn.textContent.includes('Setup')) {
          btn.className = `stats-tab-btn ${activeSetup}`.trim();
        } else {
          btn.className = `stats-tab-btn ${activeJournal}`.trim();
        }
      });
      const contentDiv = document.getElementById('stats-tab-content');
      if (contentDiv) {
        contentDiv.innerHTML = statsContent;
      }
    }

    requestAnimationFrame(() => {
      const isNew = container.getAttribute('data-loaded') !== 'true';
      if (isNew) {
        container.setAttribute('data-loaded', 'true');
      }
      updateStatsTabPill('desktop', isNew);
      animateSetupBarCharts();
    });
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

  const passedCount = executedEntries.filter(e => e.status === 'PASSED').length;
  const failedCount = executedEntries.filter(e => e.status === 'FAILED').length;

  return {
    totalEntries, executedCount, missedCount,
    passedCount, failedCount,
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

// Generate visual horizontal bar chart HTML for setups
function generateSetupBarChartHTML(sortedList, maxCount, colorVar) {
  if (sortedList.length === 0) {
    return `<div style="color:var(--text-muted); font-size:12px; padding:10px 0; text-align:center;">No setup data available</div>`;
  }
  
  let html = `<div class="setup-barchart-container">`;
  sortedList.forEach(([name, stats]) => {
    const total = stats.total || 0;
    const percentage = maxCount > 0 ? (total / maxCount) * 100 : 0;
    html += `
      <div class="setup-barchart-row" title="${name}: ${total} logs (${stats.passed} Passed, ${stats.missed} Missed, ${stats.failed} Failed)">
        <div class="setup-barchart-label">${name}</div>
        <div class="setup-barchart-bar-wrapper">
          <div class="setup-barchart-bar" style="width: 0%; background-color: var(${colorVar});" data-width="${percentage.toFixed(1)}%"></div>
        </div>
        <div class="setup-barchart-value">${total}</div>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

// Animate setup bar charts by translating width from 0 to target percentage
function animateSetupBarCharts() {
  requestAnimationFrame(() => {
    const bars = document.querySelectorAll('.setup-barchart-bar');
    bars.forEach(bar => {
      const targetWidth = bar.getAttribute('data-width');
      if (targetWidth) {
        bar.style.width = targetWidth;
      }
    });
  });
}

function switchStatsTab(tab) {
  currentStatsTab = tab;
  renderDesktopStats();
  renderMobileStats();
}

function changeStatsCalendarMonth(offset) {
  if (currentStatsPeriod === 'daily') {
    statsCalendarMonth += offset;
    if (statsCalendarMonth < 0) {
      statsCalendarMonth = 11;
      statsCalendarYear--;
    } else if (statsCalendarMonth > 11) {
      statsCalendarMonth = 0;
      statsCalendarYear++;
    }
  } else if (currentStatsPeriod !== 'yearly') {
    // monthly, quarterly
    statsCalendarYear += offset;
  }
  
  const desktopCal = document.getElementById('desktop-stats-calendar-wrapper');
  const mobileCal = document.getElementById('mobile-stats-calendar-wrapper');
  const html = generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth);
  if (desktopCal) desktopCal.innerHTML = html;
  if (mobileCal) mobileCal.innerHTML = html;

  const defaultDetail = `
    <div class="stats-day-detail" style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:13px; text-align:center;">
      Click any cell on the calendar to view trade details here.
    </div>
  `;
  const desktopDetail = document.getElementById('desktop-stats-day-detail-wrapper');
  const mobileDetail = document.getElementById('mobile-stats-day-detail-wrapper');
  if (desktopDetail) desktopDetail.innerHTML = defaultDetail;
  if (mobileDetail) mobileDetail.innerHTML = defaultDetail;
}

// Helper to get week number representation
function getEntryWeekStr(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const yStr = dateStr.slice(0, 4);
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const pastDaysOfYear = (d - startOfYear) / 86400000;
  const wNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
  return `${yStr}-W${String(wNum).padStart(2, '0')}`;
}

// Helper to get month name
function getMonthName(monthStr) {
  const parts = monthStr.split('-');
  if (parts.length === 2) {
    const monthIndex = parseInt(parts[1], 10) - 1;
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[monthIndex]} ${parts[0]}`;
  }
  return monthStr;
}

function switchCalendarPeriod(period) {
  currentStatsPeriod = period;
  
  // Re-render the calendar components
  const wrapperD = document.getElementById('desktop-stats-calendar-wrapper');
  if (wrapperD) wrapperD.innerHTML = generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth);
  const wrapperM = document.getElementById('mobile-stats-calendar-wrapper');
  if (wrapperM) wrapperM.innerHTML = generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth);

  // Reset detail wrappers
  const defaultDetail = `
    <div class="stats-day-detail" style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:13px; text-align:center;">
      Click any cell on the calendar to view trade details here.
    </div>
  `;
  const desktopDetail = document.getElementById('desktop-stats-day-detail-wrapper');
  const mobileDetail = document.getElementById('mobile-stats-day-detail-wrapper');
  if (desktopDetail) desktopDetail.innerHTML = defaultDetail;
  if (mobileDetail) mobileDetail.innerHTML = defaultDetail;
}

function selectStatsCalendarPeriod(period, key) {
  statsSelectedDate = key;
  currentStatsPeriod = period;

  // Re-render calendar so selection outline is updated
  const wrapperD = document.getElementById('desktop-stats-calendar-wrapper');
  if (wrapperD) wrapperD.innerHTML = generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth);
  const wrapperM = document.getElementById('mobile-stats-calendar-wrapper');
  if (wrapperM) wrapperM.innerHTML = generateStatsCalendarHTML(statsCalendarYear, statsCalendarMonth);

  let periodEntries = [];
  let headerTitle = '';
  let isDetailed = true;

  if (period === 'daily') {
    periodEntries = entries.filter(e => e.date === key);
    headerTitle = `Entries on ${key}`;
  } else if (period === 'weekly') {
    periodEntries = entries.filter(e => getEntryWeekStr(e.date) === key);
    const wkNum = key.includes('-W') ? key.split('-W')[1] : key;
    headerTitle = `Week ${wkNum} (${key.slice(0, 4)}) Trades`;
  } else {
    isDetailed = false;
    if (period === 'monthly') {
      periodEntries = entries.filter(e => e.date.slice(0, 7) === key);
      headerTitle = `${getMonthName(key)} Summary`;
    } else if (period === 'quarterly') {
      periodEntries = entries.filter(e => {
        const d = new Date(e.date);
        if (isNaN(d.getTime())) return false;
        const yStr = e.date.slice(0, 4);
        const q = Math.ceil((d.getMonth() + 1) / 3);
        return `${yStr}-Q${q}` === key;
      });
      const qNum = key.includes('-Q') ? key.split('-Q')[1] : key;
      headerTitle = `Quarter ${qNum} (${key.slice(0, 4)}) Summary`;
    } else if (period === 'yearly') {
      periodEntries = entries.filter(e => e.date.slice(0, 4) === key);
      headerTitle = `Year ${key} Summary`;
    }
  }

  const getDetailHTML = () => {
    if (periodEntries.length === 0) {
      return `
        <div class="stats-day-detail">
          <div style="font-size:13px; color:var(--text-muted); text-align:center;">No entries for this period</div>
        </div>
      `;
    }

    if (!isDetailed) {
      let periodPL = 0;
      let passedCount = 0;
      let failedCount = 0;
      let missedCount = 0;
      let executedCount = 0;

      periodEntries.forEach(entry => {
        if (entry.status === 'PASSED' || entry.status === 'FAILED') {
          const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
          periodPL += typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
          executedCount++;
          if (entry.status === 'PASSED') passedCount++;
          else failedCount++;
        } else {
          missedCount++;
        }
      });

      const winRate = executedCount > 0 ? (passedCount / executedCount) * 100 : 0;
      const plClass = periodPL >= 0 ? 'bull' : 'bear';

      return `
        <div class="stats-day-detail" style="display:flex; flex-direction:column; gap:12px;">
          <div style="font-size:12px; font-weight:600; color:var(--text-muted); border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">
            ${headerTitle}
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:var(--text-secondary); font-weight:600;">Net P&L</span>
              <span class="${plClass}" style="font-size:14px; font-weight:800; font-family:var(--font-display);">₹${periodPL >= 0 ? '+' : ''}${periodPL.toLocaleString()}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.02); padding-top:8px;">
              <span style="font-size:11px; color:var(--text-secondary); font-weight:600;">Trades Logged</span>
              <span style="font-size:12px; font-weight:700; color:var(--text-main); font-family:var(--font-display);">${periodEntries.length} total</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.02); padding-top:8px;">
              <span style="font-size:11px; color:var(--text-secondary); font-weight:600;">Win Rate</span>
              <span class="bull" style="font-size:12px; font-weight:700; font-family:var(--font-display);">${winRate.toFixed(1)}%</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.02); padding-top:8px;">
              <span style="font-size:11px; color:var(--text-secondary); font-weight:600;">Executed vs Missed</span>
              <span style="font-size:11px; color:var(--text-main); font-weight:600;">${executedCount} Executed / ${missedCount} Missed</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid rgba(255,255,255,0.02); padding-top:8px;">
              <span style="font-size:11px; color:var(--text-secondary); font-weight:600;">Win / Loss Ratio</span>
              <span style="font-size:11px; color:var(--text-main); font-weight:600;"><span class="bull">${passedCount} Wins</span> / <span class="bear">${failedCount} Losses</span></span>
            </div>
          </div>
        </div>
      `;
    }

    let html = `
      <div class="stats-day-detail" style="display: flex; flex-direction: column; max-height: 380px;">
        <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px; flex-shrink: 0;">
          ${headerTitle}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; overflow-y:auto; flex-grow:1; padding-right:2px; max-height: 300px;">
    `;

    periodEntries.forEach(entry => {
      const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
      const plValue = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
      const statusClass = entry.status === 'PASSED' ? 'status-passed' : (entry.status === 'MISSED' ? 'status-missed' : 'status-failed');
      
      html += `
        <div class="stats-day-entry-row" onclick="openEntryDetail('${entry.id}')" style="cursor:pointer;">
          <div style="display:flex; flex-direction:column; gap:3px; max-width: 65%;">
            <div style="font-size:13px; font-weight:600; color:var(--text-main); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${getDisplayName(entry)}">${getDisplayName(entry)}</div>
            <div style="font-size:11px; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${entry.patterns.join(', ') || 'No patterns'}">${entry.patterns.join(', ') || 'No patterns'}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px; font-weight:700;" class="${plValue >= 0 ? 'bull' : 'bear'}">
              ₹${plValue >= 0 ? '+' : ''}${plValue.toLocaleString()}
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

// Backward compatibility wrapper
function selectStatsCalendarDate(dateStr) {
  selectStatsCalendarPeriod('daily', dateStr);
}

function generateStatsCalendarHTML(year, month) {
  const stats = calculateJournalStats();
  
  // Render Mode Selector and Navigation
  let navHtml = '';
  if (currentStatsPeriod === 'daily' || currentStatsPeriod === 'weekly') {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    navHtml = `
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn-icon-sm" onclick="changeStatsCalendarMonth(-1)" style="border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); cursor:pointer;"><i class="fa-solid fa-chevron-left" style="font-size:11px;"></i></button>
        <div style="font-family:var(--font-display); font-size:14px; font-weight:700; color:var(--text-main); min-width:100px; text-align:center;">${monthNames[month]} ${year}</div>
        <button class="btn-icon-sm" onclick="changeStatsCalendarMonth(1)" style="border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); cursor:pointer;"><i class="fa-solid fa-chevron-right" style="font-size:11px;"></i></button>
      </div>
    `;
  } else if (currentStatsPeriod === 'yearly') {
    navHtml = `<div style="font-family:var(--font-display); font-size:14px; font-weight:700; color:var(--text-main);">All Years</div>`;
  } else {
    // monthly, quarterly
    navHtml = `
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn-icon-sm" onclick="changeStatsCalendarMonth(-1)" style="border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); cursor:pointer;"><i class="fa-solid fa-chevron-left" style="font-size:11px;"></i></button>
        <div style="font-family:var(--font-display); font-size:14px; font-weight:700; color:var(--text-main); min-width:80px; text-align:center;">Year ${year}</div>
        <button class="btn-icon-sm" onclick="changeStatsCalendarMonth(1)" style="border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color); cursor:pointer;"><i class="fa-solid fa-chevron-right" style="font-size:11px;"></i></button>
      </div>
    `;
  }

  const pModes = ['daily', 'monthly', 'quarterly', 'yearly'];
  let modeSelector = `<div class="calendar-period-control">`;
  pModes.forEach(p => {
    const activeClass = (currentStatsPeriod === p || (p === 'daily' && currentStatsPeriod === 'weekly')) ? 'active' : '';
    modeSelector += `<button class="calendar-period-btn ${activeClass}" onclick="switchCalendarPeriod('${p}')">${p.toUpperCase()}</button>`;
  });
  modeSelector += `</div>`;

  let bodyHtml = '';
  if (currentStatsPeriod === 'daily' || currentStatsPeriod === 'weekly') {
    bodyHtml = generateDailyCalendarHTML(year, month, stats);
  } else if (currentStatsPeriod === 'monthly') {
    bodyHtml = generateMonthlyCalendarHTML(year, stats);
  } else if (currentStatsPeriod === 'quarterly') {
    bodyHtml = generateQuarterlyCalendarHTML(year, stats);
  } else if (currentStatsPeriod === 'yearly') {
    bodyHtml = generateYearlyCalendarHTML(stats);
  }

  return `
    <div class="calendar-mode-header">
      ${modeSelector}
      ${navHtml}
    </div>
    <div style="margin-top:16px;">
      ${bodyHtml}
    </div>
  `;
}

function generateDailyCalendarHTML(year, month, stats) {
  const firstDay = new Date(year, month, 1).getDay();
  const numDays = new Date(year, month + 1, 0).getDate();

  let html = `
    <div style="display:grid; grid-template-columns: repeat(8, 1fr); gap:6px; text-align:center; font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:6px; border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom:6px;">
      <div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div>
      <div style="border-left:1px dashed var(--glass-border); padding-left:4px; color:var(--text-main);">Wk</div>
    </div>
    <div class="stats-cal-grid-8">
  `;

  const weeks = [];
  let currentWeek = [];
  
  for (let i = 0; i < firstDay; i++) {
    currentWeek.push(null);
  }
  
  for (let day = 1; day <= numDays; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  weeks.forEach(week => {
    let weekPL = 0;
    let weekTradeCount = 0;
    let hasWeekTrades = false;

    // Render day cells
    week.forEach(day => {
      if (day === null) {
        html += `<div style="aspect-ratio:1; border-radius:8px; border: 1px solid transparent;"></div>`;
      } else {
        const curMonthStr = String(month + 1).padStart(2, '0');
        const curDayStr = String(day).padStart(2, '0');
        const dateStr = `${year}-${curMonthStr}-${curDayStr}`;

        const dayEntries = entries.filter(e => e.date === dateStr);
        let cellClass = 'stats-cal-cell-empty';
        let plHtml = '';
        let dailyPL = 0;
        let dayTradeCount = 0;

        if (dayEntries.length > 0) {
          const executed = dayEntries.filter(e => e.status === 'PASSED' || e.status === 'FAILED');
          const missed = dayEntries.filter(e => e.status === 'MISSED');
          
          executed.forEach(entry => {
            const plRaw = entry.customAttributes ? entry.customAttributes['P&L'] : 0;
            dailyPL += typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));
            dayTradeCount++;
          });

          if (executed.length > 0) {
            hasWeekTrades = true;
            weekPL += dailyPL;
            weekTradeCount += dayTradeCount;

            const formattedPL = dailyPL >= 0 ? `+₹${Math.round(dailyPL).toLocaleString()}` : `-₹${Math.round(Math.abs(dailyPL)).toLocaleString()}`;
            plHtml = `<span class="stats-cal-cell-pl ${dailyPL >= 0 ? 'bull' : 'bear'}" style="font-size: 7.5px;">${formattedPL}</span>`;
            cellClass = dailyPL >= 0 ? 'stats-cal-cell-profit' : 'stats-cal-cell-loss';
          } else if (missed.length > 0) {
            cellClass = 'stats-cal-cell-missed';
          }
        }

        const isSelected = statsSelectedDate === dateStr && currentStatsPeriod === 'daily' ? 'selected' : '';

        html += `
          <div class="stats-cal-cell ${cellClass} ${isSelected}" data-date="${dateStr}" onclick="selectStatsCalendarPeriod('daily', '${dateStr}')">
            <span class="stats-cal-cell-daynum">${day}</span>
            ${plHtml}
          </div>
        `;
      }
    });

    // Render week summary cell (8th column)
    const firstActiveDay = week.find(d => d !== null);
    const curMonthStr = String(month + 1).padStart(2, '0');
    const firstDateStr = `${year}-${curMonthStr}-${String(firstActiveDay).padStart(2, '0')}`;
    const weekKey = getEntryWeekStr(firstDateStr);
    const isSelected = statsSelectedDate === weekKey && currentStatsPeriod === 'weekly' ? 'selected' : '';

    if (hasWeekTrades) {
      const formattedWkPL = weekPL >= 0 ? `+₹${Math.round(weekPL).toLocaleString()}` : `-₹${Math.round(Math.abs(weekPL)).toLocaleString()}`;
      const wkClass = weekPL >= 0 ? 'profit' : 'loss';
      html += `
        <div class="stats-cal-cell stats-cal-cell-wk ${wkClass} ${isSelected}" onclick="selectStatsCalendarPeriod('weekly', '${weekKey}')" title="Weekly P&L (${weekTradeCount} trades)">
          <span style="font-size: 8.5px; font-weight: 700;">${formattedWkPL}</span>
        </div>
      `;
    } else {
      html += `
        <div class="stats-cal-cell stats-cal-cell-wk ${isSelected}" onclick="selectStatsCalendarPeriod('weekly', '${weekKey}')" title="No trades this week">
          <span style="font-size: 9px; color: var(--text-muted);">-</span>
        </div>
      `;
    }
  });

  html += `</div>`;
  return html;
}

function generateMonthlyCalendarHTML(year, stats) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let html = `<div class="stats-cal-grid-12">`;

  for (let m = 0; m < 12; m++) {
    const mStr = String(m + 1).padStart(2, '0');
    const key = `${year}-${mStr}`;

    const pl = stats.byMonth[key] || 0;
    const count = stats.monthTradeCount[key] || 0;
    const isSelected = statsSelectedDate === key && currentStatsPeriod === 'monthly' ? 'selected' : '';

    let plHtml = `<span style="color:var(--text-muted); font-size:11px;">No trades</span>`;
    if (count > 0) {
      const formattedPL = pl >= 0 ? `+₹${Math.round(pl).toLocaleString()}` : `-₹${Math.round(Math.abs(pl)).toLocaleString()}`;
      const plClass = pl >= 0 ? 'bull' : 'bear';
      plHtml = `<span class="stats-cal-period-pl ${plClass}">${formattedPL}</span>`;
    }

    html += `
      <div class="stats-cal-period-cell ${isSelected}" onclick="selectStatsCalendarPeriod('monthly', '${key}')">
        <div class="stats-cal-period-title">${monthNames[m]}</div>
        <div class="stats-cal-period-sub">${count} trades</div>
        ${plHtml}
      </div>
    `;
  }

  html += `</div>`;
  return html;
}

function generateQuarterlyCalendarHTML(year, stats) {
  const quarters = [
    { num: 1, label: 'Q1', months: 'Jan - Mar' },
    { num: 2, label: 'Q2', months: 'Apr - Jun' },
    { num: 3, label: 'Q3', months: 'Jul - Sep' },
    { num: 4, label: 'Q4', months: 'Oct - Dec' }
  ];

  let html = `<div class="stats-cal-grid-4">`;

  quarters.forEach(q => {
    const key = `${year}-Q${q.num}`;
    const pl = stats.byQuarter[key] || 0;
    const count = stats.quarterTradeCount[key] || 0;
    const isSelected = statsSelectedDate === key && currentStatsPeriod === 'quarterly' ? 'selected' : '';

    let plHtml = `<span style="color:var(--text-muted); font-size:11px;">No trades</span>`;
    if (count > 0) {
      const formattedPL = pl >= 0 ? `+₹${Math.round(pl).toLocaleString()}` : `-₹${Math.round(Math.abs(pl)).toLocaleString()}`;
      const plClass = pl >= 0 ? 'bull' : 'bear';
      plHtml = `<span class="stats-cal-period-pl ${plClass}">${formattedPL}</span>`;
    }

    html += `
      <div class="stats-cal-period-cell ${isSelected}" onclick="selectStatsCalendarPeriod('quarterly', '${key}')">
        <div class="stats-cal-period-title">${q.label} <span style="font-size:10px; font-weight:normal; color:var(--text-muted); margin-left:4px;">(${q.months})</span></div>
        <div class="stats-cal-period-sub">${count} trades</div>
        ${plHtml}
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

function generateYearlyCalendarHTML(stats) {
  const years = Object.keys(stats.byYear).sort().reverse();
  
  if (years.length === 0) {
    const curYear = new Date().getFullYear();
    years.push(String(curYear));
  }

  let html = `<div class="stats-cal-grid-years">`;

  years.forEach(y => {
    const pl = stats.byYear[y] || 0;
    const count = stats.yearTradeCount[y] || 0;
    const isSelected = statsSelectedDate === y && currentStatsPeriod === 'yearly' ? 'selected' : '';

    let plHtml = `<span style="color:var(--text-muted); font-size:11px;">No trades</span>`;
    if (count > 0) {
      const formattedPL = pl >= 0 ? `+₹${Math.round(pl).toLocaleString()}` : `-₹${Math.round(Math.abs(pl)).toLocaleString()}`;
      const plClass = pl >= 0 ? 'bull' : 'bear';
      plHtml = `<span class="stats-cal-period-pl ${plClass}">${formattedPL}</span>`;
    }

    html += `
      <div class="stats-cal-period-cell ${isSelected}" onclick="selectStatsCalendarPeriod('yearly', '${y}')">
        <div class="stats-cal-period-title">${y}</div>
        <div class="stats-cal-period-sub">${count} trades</div>
        ${plHtml}
      </div>
    `;
  });

  html += `</div>`;
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
  
  // Helper to parse YYYY-MM-DD as local date (00:00:00)
  const parseLocalDate = (dateStr) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        return new Date(y, m, d, 0, 0, 0, 0);
      }
    }
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
  };

  if (period === 'week') {
    // Current week's Sunday to Saturday
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();
    const currentDay = now.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    
    const sunday = new Date(currentYear, currentMonth, currentDate - currentDay, 0, 0, 0, 0);
    const saturday = new Date(currentYear, currentMonth, currentDate - currentDay + 6, 23, 59, 59, 999);
    
    filtered = filtered.filter(e => {
      const entryDate = parseLocalDate(e.date);
      return entryDate >= sunday && entryDate <= saturday;
    });
  } else if (period === 'month') {
    // Current month's 1st to end
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    const firstOfMonth = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
    const lastOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
    
    filtered = filtered.filter(e => {
      const entryDate = parseLocalDate(e.date);
      return entryDate >= firstOfMonth && entryDate <= lastOfMonth;
    });
  } else if (period === 'year') {
    // Current calendar year's first day to last day
    const currentYear = now.getFullYear();
    
    const firstOfYear = new Date(currentYear, 0, 1, 0, 0, 0, 0);
    const lastOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);
    
    filtered = filtered.filter(e => {
      const entryDate = parseLocalDate(e.date);
      return entryDate >= firstOfYear && entryDate <= lastOfYear;
    });
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

let currentCustomAttrStatField = null;

function calculateCustomAttributeStats(attrName) {
  const executedEntries = entries.filter(e => e.status === 'PASSED' || e.status === 'FAILED');
  const valueMap = {};

  executedEntries.forEach(entry => {
    if (!entry.customAttributes) return;
    const rawVal = entry.customAttributes[attrName];
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') return;

    const valStr = String(rawVal).trim();
    if (!valueMap[valStr]) {
      valueMap[valStr] = {
        name: valStr,
        count: 0,
        passed: 0,
        failed: 0,
        grossProfit: 0,
        grossLoss: 0,
        netPL: 0,
        winRate: 0,
        profitFactor: 0
      };
    }

    const item = valueMap[valStr];
    item.count += 1;

    const plRaw = entry.customAttributes['P&L'];
    const plVal = typeof plRaw === 'number' ? plRaw : parsePL(String(plRaw || ''));

    item.netPL += plVal;
    if (plVal > 0) {
      item.passed += 1;
      item.grossProfit += plVal;
    } else if (plVal < 0) {
      item.failed += 1;
      item.grossLoss += Math.abs(plVal);
    } else {
      if (entry.status === 'PASSED') item.passed += 1;
      if (entry.status === 'FAILED') item.failed += 1;
    }
  });

  const resultList = Object.values(valueMap).map(item => {
    item.winRate = item.count > 0 ? (item.passed / item.count) * 100 : 0;
    item.profitFactor = item.grossLoss !== 0 ? (item.grossProfit / item.grossLoss) : (item.grossProfit > 0 ? Infinity : 0);
    return item;
  });

  resultList.sort((a, b) => b.netPL - a.netPL || b.count - a.count);
  return resultList;
}

function generateCustomAttributeStatsHTML(isMobile = false) {
  const availableAttrs = customAttributes.filter(attr => {
    if (attr.name === 'Entry Price' || attr.name === 'Exit Price' || attr.name === 'Quantity' || attr.name === 'Charges' || attr.name === 'P&L') return false;
    return true;
  });

  if (availableAttrs.length === 0) return '';

  if (!currentCustomAttrStatField || !availableAttrs.some(a => a.name === currentCustomAttrStatField)) {
    const sessionAttr = availableAttrs.find(a => a.name.toLowerCase() === 'session');
    currentCustomAttrStatField = sessionAttr ? sessionAttr.name : availableAttrs[0].name;
  }

  const statList = calculateCustomAttributeStats(currentCustomAttrStatField);

  let optionsHtml = '';
  availableAttrs.forEach(attr => {
    const selected = attr.name === currentCustomAttrStatField ? 'selected' : '';
    optionsHtml += `<option value="${attr.name}" ${selected}>${attr.name}</option>`;
  });

  let rowsHtml = '';
  statList.forEach((item, idx) => {
    const plClass = item.netPL >= 0 ? 'bull' : 'bear';
    const pfStr = item.profitFactor === Infinity ? '∞' : (item.profitFactor > 0 ? item.profitFactor.toFixed(2) + 'x' : '0.00x');

    if (isMobile) {
      rowsHtml += `
        <div class="custom-attr-mobile-card" style="background: rgba(255, 255, 255, 0.025); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--text-muted); font-size: 11px; font-weight: 600;">#${idx + 1}</span>
              <span>${item.name}</span>
            </div>
            <div class="${plClass}" style="font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums;">
              ₹${item.netPL >= 0 ? '+' : ''}${item.netPL.toLocaleString()}
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; gap: 6px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="background: rgba(255, 255, 255, 0.05); padding: 2px 8px; border-radius: 6px; font-weight: 600; color: var(--text-main); border: 1px solid var(--border-color);">${item.count} trades</span>
              <span style="color: var(--text-muted); font-size: 10.5px;">(${item.passed}W / ${item.failed}L)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 11px; color: var(--text-muted);">PF: <strong style="color: var(--text-main);">${pfStr}</strong></span>
              <span style="background: rgba(16, 185, 129, 0.14); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 2px 8px; font-weight: 700; font-size: 11px;">${item.winRate.toFixed(1)}% WR</span>
            </div>
          </div>
          <div style="width: 100%; height: 4px; background: rgba(255, 255, 255, 0.06); border-radius: 2px; overflow: hidden;">
            <div style="width: ${item.winRate}%; height: 100%; background: linear-gradient(90deg, #10B981, #34D399); border-radius: 2px;"></div>
          </div>
        </div>
      `;
    } else {
      rowsHtml += `
        <tr>
          <td style="font-weight:700; color:var(--text-muted); width:40px;">#${idx + 1}</td>
          <td style="font-weight:600; color:var(--text-main);">${item.name}</td>
          <td class="${plClass}" style="font-weight:700; text-align:right; font-variant-numeric: tabular-nums;">₹${item.netPL >= 0 ? '+' : ''}${item.netPL.toLocaleString()}</td>
          <td style="text-align:right; color:var(--text-secondary);">${item.count} trades</td>
          <td style="text-align:right; color:var(--text-secondary);">${pfStr}</td>
          <td style="text-align:right;">
            <div style="display:inline-flex; flex-direction:column; align-items:flex-end; gap:3px;">
              <span style="font-weight:600; color:var(--color-bull);">${item.winRate.toFixed(1)}%</span>
              <div style="width:50px; height:3px; background:rgba(255,255,255,0.06); border-radius:1.5px; overflow:hidden;">
                <div style="width:${item.winRate}%; height:100%; background:var(--color-bull);"></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
  });

  if (statList.length === 0) {
    rowsHtml = isMobile 
      ? `<div style="text-align:center; color:var(--text-muted); font-size:12px; padding:16px;">No trade data logged for ${currentCustomAttrStatField}.</div>`
      : `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">No trade data logged for ${currentCustomAttrStatField}.</td></tr>`;
  }

  const tableBodyOrList = isMobile 
    ? rowsHtml 
    : `<table class="stats-leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>${currentCustomAttrStatField} Value</th>
            <th style="text-align:right;">Net P&L</th>
            <th style="text-align:right;">Trades</th>
            <th style="text-align:right;">Profit Factor</th>
            <th style="text-align:right;">Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>`;

  return `
    <div class="stats-section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; ${isMobile ? 'margin: 16px 0 10px;' : ''}">
      <span>Custom Attribute Performance</span>
      <div style="display:flex; align-items:center; gap:8px; ${isMobile ? 'width: 100%; justify-content: space-between;' : ''}">
        <span style="font-size:12px; font-weight:500; color:var(--text-muted);">Field:</span>
        <select class="input-select" style="font-size:12px; padding:5px 24px 5px 12px; width:auto; border-radius:6px; background:rgba(255,255,255,0.04); border:1px solid var(--border-color);" onchange="switchCustomAttrStatField(this.value)">
          ${optionsHtml}
        </select>
      </div>
    </div>
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '12px' : '20px'}; margin-bottom:${isMobile ? '16px' : '24px'}; ${isMobile ? '' : 'overflow-x:auto;'}">
      ${tableBodyOrList}
    </div>
  `;
}

function switchCustomAttrStatField(val) {
  currentCustomAttrStatField = val;
  if (currentDesktopView === 'stats' || currentDesktopView === 'dashboard') {
    renderDesktopStats();
  }
  const mobileStats = document.getElementById('mobile-stats-view');
  if (mobileStats && mobileStats.style.display !== 'none') {
    renderMobileStats();
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
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '16px' : '20px'}; margin-bottom: ${isMobile ? '16px' : '24px'};">
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
  
  const execPct = (stats.totalEntries > 0 ? (stats.executedCount / stats.totalEntries * 100) : 0);
  const passedPct = (stats.executedCount > 0 ? (stats.passedCount / stats.executedCount * 100) : 0);
  const missedPct = (stats.totalEntries > 0 ? (stats.missedCount / stats.totalEntries * 100) : 0);
  const failedPct = (stats.executedCount > 0 ? (stats.failedCount / stats.executedCount * 100) : 0);
  window.lastTotalSetups = stats.totalEntries;

  const pnlClass = stats.netPL >= 0 ? 'bull' : 'bear';
  const winDaysPct = (stats.winDaysCount / (stats.winDaysCount + stats.lossDaysCount) * 100) || 0;
  const activeDaysPct = (stats.tradingDays / (stats.tradingDays + stats.noTradeDays) * 100) || 0;
  const consistencyScore = (stats.winRate + winDaysPct + activeDaysPct) / 3;
  window.lastConsistencyScore = consistencyScore;

  const ratioVal = stats.avgLossDay !== 0 ? (stats.avgWinDay / Math.abs(stats.avgLossDay)).toFixed(2) + 'x' : 'N/A';
  const profitFactorVal = stats.profitFactor === Infinity ? 'Infinity' : (typeof stats.profitFactor === 'number' ? stats.profitFactor.toFixed(2) + 'x' : 'N/A');

  // Helper to parse best/worst day string nicely into value and date parts
  const parseBestWorst = (str) => {
    if (!str || str === 'N/A') return { value: 'N/A', sub: '' };
    const parts = str.split(' ');
    if (parts.length >= 2) {
      const datePart = parts[0];
      const valPart = parts.slice(1).join(' ').replace('(', '').replace(')', '');
      return { value: valPart, sub: datePart };
    }
    return { value: str, sub: '' };
  };
  const bestInfo = parseBestWorst(stats.bestDayStr);
  const worstInfo = parseBestWorst(stats.worstDayStr);

  const kpiHtml = `
    <div class="kpi-col">
      <!-- Chips row -->
      <div class="kpi-activity-chips">
        <div class="kpi-chip executed" title="Executed setups (Passed + Failed)"><i class="fa-solid fa-bolt"></i> ${stats.executedCount} Executed</div>
        <div class="kpi-chip missed" title="Missed trading setups"><i class="fa-solid fa-circle-minus"></i> ${stats.missedCount} Missed</div>
        <div class="kpi-chip passed" title="Passed (Win) setups"><i class="fa-solid fa-circle-check"></i> ${stats.passedCount} Passed</div>
        <div class="kpi-chip failed" title="Failed (Loss) setups"><i class="fa-solid fa-circle-xmark"></i> ${stats.failedCount} Failed</div>
      </div>

      <!-- Hero Row: Net P&L & Win Rate -->
      <div class="kpi-hero-row">
        <div class="kpi-hero-card">
          <div class="kpi-hero-label">Net P&L</div>
          <div class="kpi-hero-value ${pnlClass}">₹${stats.netPL >= 0 ? '+' : ''}${stats.netPL.toLocaleString()}</div>
          <div class="kpi-hero-sub">Gross Profit: <span class="bull">₹${stats.grossProfit.toLocaleString()}</span> | Loss: <span class="bear">₹${Math.abs(stats.grossLoss).toLocaleString()}</span></div>
        </div>
        <div class="kpi-hero-card">
          <div class="kpi-hero-label">Win Rate</div>
          <div class="kpi-hero-value bull">${stats.winRate.toFixed(1)}%</div>
          <div class="kpi-hero-sub">${stats.passedCount} Wins / ${stats.failedCount} Losses</div>
        </div>
      </div>

      <!-- Grid of Compact KPIs -->
      <div class="kpi-grid-compact">
        <div class="kpi-mini-card" title="Average gain on green trading days">
          <div class="kpi-mini-label">Avg Win Day</div>
          <div class="kpi-mini-value bull">+₹${stats.avgWinDay.toFixed(0)}</div>
          <div class="kpi-mini-sub">${stats.winDaysCount} green days</div>
        </div>
        <div class="kpi-mini-card" title="Average loss on red trading days">
          <div class="kpi-mini-label">Avg Loss Day</div>
          <div class="kpi-mini-value bear">-₹${Math.abs(stats.avgLossDay).toFixed(0)}</div>
          <div class="kpi-mini-sub">${stats.lossDaysCount} red days</div>
        </div>
        <div class="kpi-mini-card" title="Win Days / Total Trading Days">
          <div class="kpi-mini-label">Green Days %</div>
          <div class="kpi-mini-value">${winDaysPct.toFixed(1)}%</div>
          <div class="kpi-mini-sub">${stats.winDaysCount}W - ${stats.lossDaysCount}L</div>
        </div>
        <div class="kpi-mini-card" title="Active Trading Days / Total Weekdays">
          <div class="kpi-mini-label">Active Days %</div>
          <div class="kpi-mini-value">${activeDaysPct.toFixed(1)}%</div>
          <div class="kpi-mini-sub">${stats.tradingDays} active / ${stats.noTradeDays} idle</div>
        </div>
        <div class="kpi-mini-card" title="${stats.bestDayStr}">
          <div class="kpi-mini-label">Best Day</div>
          <div class="kpi-mini-value bull">${bestInfo.value}</div>
          <div class="kpi-mini-sub">${bestInfo.sub}</div>
        </div>
        <div class="kpi-mini-card" title="${stats.worstDayStr}">
          <div class="kpi-mini-label">Worst Day</div>
          <div class="kpi-mini-value bear">${worstInfo.value}</div>
          <div class="kpi-mini-sub">${worstInfo.sub}</div>
        </div>
      </div>
    </div>
  `;



  const calendarHtml = `
    <div class="stats-section-title">Performance Calendar</div>
    <div class="apple-dashboard-grid" style="grid-template-columns: ${isMobile ? '1fr' : '1.2fr 0.8fr'}; gap: ${isMobile ? '12px' : '20px'};">
      <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '16px' : '20px'};" id="${isMobile ? 'mobile' : 'desktop'}-stats-calendar-wrapper">
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
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '16px' : '20px'}; overflow-x:auto;">
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
      <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '16px' : '20px'};">
        <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">Day of Week Performance</div>
        <div>
          ${dowRows}
        </div>
      </div>
      <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '16px' : '20px'};">
        <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">Monthly Performance Trend</div>
        <div style="max-height: 250px; overflow-y: auto;">
          ${monthlyTrendRows}
        </div>
      </div>
    </div>
  `;

  const exportHtml = `
    <div class="stats-section-title">Export Options</div>
    <div style="background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:${isMobile ? '16px' : '14px'}; padding:${isMobile ? '16px' : '20px'};">
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Download journal entries and metrics for offline analysis or physical backup.</div>
      <div class="export-buttons-row">
        <button class="btn-primary" onclick="exportJournalCSV()" style="font-size:12px; padding:6px 14px; border-radius:100px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
        <button class="btn-secondary" onclick="exportJournalExcel()" style="font-size:12px; padding:6px 14px; border-radius:100px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-file-excel"></i> Export Excel</button>
        <button class="btn-secondary" onclick="exportJournalPDF()" style="font-size:12px; padding:6px 14px; border-radius:100px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-file-pdf"></i> Save PDF / Print</button>
      </div>
    </div>
  `;

  const customAttrHtml = generateCustomAttributeStatsHTML(isMobile);

  return `
    <div style="display:flex; flex-direction:column; gap:${isMobile ? '20px' : '32px'}; padding: ${isMobile ? '0 10px 24px' : '0 24px 40px'}; max-width:1200px; margin:0 auto;">
      ${equityCurveCardHtml}
      ${kpiHtml}
      ${calendarHtml}
      ${leaderboardHtml}
      ${customAttrHtml}
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
    <div class="apple-settings-group-title">Visual Appearance & Accent Theme</div>
    <div class="apple-settings-group" style="padding: 6px;">
      ${getCompactAccentPickerHTML()}
    </div>

    <div class="apple-settings-group-title">Trading Portfolios</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #5856d6;">
            <i class="fa-solid fa-folder-tree"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Active Portfolio Workspace</span>
            <span class="apple-settings-desc">Currently managing: <strong style="color:var(--accent-gold);">${currentProfile || 'None'}</strong></span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-primary" style="font-size: 11px; padding: 4px 12px; border-radius: 100px;" onclick="showProfilePortal()">Switch Workspace</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 4px;"></i>
        </div>
      </div>
    </div>

    <div class="apple-settings-group-title">Mamba AI Mentor & Gemini API</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row" style="flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="apple-settings-icon" style="background: linear-gradient(135deg, #c9a227, #f59e0b);">
              <i class="fa-solid fa-brain" style="color: #000;"></i>
            </div>
            <div class="apple-settings-info">
              <span class="apple-settings-title">Google Gemini API Key</span>
              <span class="apple-settings-desc">Private & Syncthing-synced for Kobe Bryant AI Coaching</span>
            </div>
          </div>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" style="font-size: 11px; color: var(--accent-gold); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
            Get Free Key <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 9px;"></i>
          </a>
        </div>
        
        <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
          <div style="position: relative; flex: 1;">
            <input type="password" id="desktop-gemini-api-key" class="input-text" style="width: 100%; font-family: monospace; font-size: 12px; padding-right: 36px;" placeholder="AIzaSy..." value="${escapeHtml(aiConfig.apiKey || '')}">
            <button type="button" onclick="toggleApiKeyVisibility('desktop-gemini-api-key', this)" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </div>

        <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-top: 4px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">Model:</span>
            <select id="desktop-gemini-model" class="input-select" style="font-size: 12px; padding: 4px 24px 4px 10px; width: auto;" onchange="handleModelSelectChange(this.value, 'desktop')">
              <option value="gemini-3.5-flash-lite" ${aiConfig.model === 'gemini-3.5-flash-lite' ? 'selected' : ''}>Gemini 3.5 Flash Lite (Recommended)</option>
              <option value="gemini-3.1-flash-lite" ${aiConfig.model === 'gemini-3.1-flash-lite' ? 'selected' : ''}>Gemini 3.1 Flash Lite</option>
              <option value="custom" ${aiConfig.model !== 'gemini-3.5-flash-lite' && aiConfig.model !== 'gemini-3.1-flash-lite' ? 'selected' : ''}>Custom Model ID...</option>
            </select>
          </div>
          
          <div id="desktop-custom-model-wrapper" style="display: ${aiConfig.model !== 'gemini-3.5-flash-lite' && aiConfig.model !== 'gemini-3.1-flash-lite' ? 'block' : 'none'};">
            <input type="text" id="desktop-gemini-custom-model" class="input-text" style="font-size: 12px; padding: 4px 10px; width: 180px;" placeholder="e.g. gemini-2.5-flash-lite" value="${escapeHtml(aiConfig.customModel || aiConfig.model || '')}">
          </div>

          <div style="display: flex; gap: 8px; align-items: center; margin-left: auto;">
            <button class="btn-secondary" style="font-size: 11px; padding: 4px 14px; border-radius: 100px;" id="desktop-test-api-btn" onclick="testGeminiConnection('desktop')">
              <i class="fa-solid fa-plug"></i> Test Connection
            </button>
            <button class="btn-primary" style="font-size: 11px; padding: 4px 16px; border-radius: 100px;" onclick="saveGeminiSettingsFromUI('desktop')">
              <i class="fa-solid fa-floppy-disk"></i> Save Key
            </button>
          </div>
        </div>

        <div id="desktop-api-test-status" style="font-size: 11.5px; display: none; margin-top: 4px; padding: 6px 10px; border-radius: 6px;"></div>
      </div>

      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #8e8e93;">
            <i class="fa-solid fa-trash-can"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Clear AI Chat History</span>
            <span class="apple-settings-desc">Reset Mamba AI conversation logs for workspace: <strong style="color:var(--accent-gold);">${currentProfile || 'Default'}</strong></span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 11px; padding: 4px 12px; border-radius: 100px; color: var(--color-bear);" onclick="clearAIChatHistoryWithConfirm()">Clear History</button>
        </div>
      </div>
    </div>

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
      // P&L is always numeric, but can be entered manually
      inputHTML = `<input type="number" id="desktop-input-pl" class="input-text" value="${currentVal}" placeholder="0" oninput="updateCalculationsRealTime('desktop')">`;
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

function reorderImages(entry, fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (!entry.images) return;

  const images = entry.images;
  const item = images[fromIdx];
  
  images.splice(fromIdx, 1);
  
  let adjustedToIdx = toIdx;
  if (fromIdx < toIdx) {
    adjustedToIdx = toIdx - 1;
  }
  
  images.splice(adjustedToIdx, 0, item);

  if (activeImageIndex === fromIdx) {
    activeImageIndex = adjustedToIdx;
  } else if (activeImageIndex > fromIdx && activeImageIndex <= adjustedToIdx) {
    activeImageIndex--;
  } else if (activeImageIndex < fromIdx && activeImageIndex >= adjustedToIdx) {
    activeImageIndex++;
  }

  if (entry.primaryImages && entry.primaryImages.length > 0) {
    const newPrimaries = [];
    entry.primaryImages.forEach(pIdx => {
      if (pIdx === fromIdx) {
        newPrimaries.push(adjustedToIdx);
      } else {
        let newIdx = pIdx;
        if (fromIdx < pIdx && pIdx <= adjustedToIdx) {
          newIdx = pIdx - 1;
        } else if (adjustedToIdx <= pIdx && pIdx < fromIdx) {
          newIdx = pIdx + 1;
        }
        newPrimaries.push(newIdx);
      }
    });
    entry.primaryImages = [...new Set(newPrimaries)].sort((a, b) => a - b);
  }

  entry.updatedAt = new Date().toISOString();
  saveDatabase(entry, false, true);
  renderDetailOnly();
}

function moveThumbnail(idx, direction) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry || !entry.images) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= entry.images.length) return;
  
  const toIdx = direction === -1 ? idx - 1 : idx + 2;
  reorderImages(entry, idx, toIdx);
}

function togglePrimaryImage(index) {
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) return;
  if (!entry.primaryImages) entry.primaryImages = [];
  
  const pos = entry.primaryImages.indexOf(index);
  if (pos >= 0) {
    entry.primaryImages.splice(pos, 1);
  } else {
    entry.primaryImages.push(index);
  }
  
  entry.updatedAt = new Date().toISOString();
  saveDatabase(entry, false, true);
  renderDetailOnly();
}

function focusRing(type, val, label) {
  const container = document.getElementById('concentric-rings-svg-container');
  if (container) {
    container.className = 'ring-svg-container';
    if (type === 'win-rate') container.classList.add('focus-win');
    else if (type === 'green-days') container.classList.add('focus-green');
    else if (type === 'active-days') container.classList.add('focus-active');
  }
  
  const legendItems = document.querySelectorAll('.ring-legend-item');
  legendItems.forEach(item => {
    if (item.getAttribute('data-ring') === type) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  const valEl = document.getElementById('consistency-center-value');
  const labelEl = document.getElementById('consistency-center-label');
  if (valEl && labelEl) {
    valEl.textContent = val;
    labelEl.textContent = label;
    valEl.style.transform = 'scale(1.1)';
    setTimeout(() => { valEl.style.transform = 'scale(1)'; }, 150);
  }
}

function resetRings() {
  const container = document.getElementById('concentric-rings-svg-container');
  if (container) {
    container.className = 'ring-svg-container';
  }
  
  const legendItems = document.querySelectorAll('.ring-legend-item');
  legendItems.forEach(item => item.classList.remove('active'));

  const valEl = document.getElementById('consistency-center-value');
  const labelEl = document.getElementById('consistency-center-label');
  if (valEl && labelEl && window.lastConsistencyScore !== undefined) {
    valEl.textContent = window.lastConsistencyScore.toFixed(0) + '%';
    labelEl.textContent = 'Consistency';
  }
}

function focusActivityRing(type, val, label) {
  const container = document.getElementById('activity-rings-svg-container');
  if (container) {
    container.className = 'ring-svg-container';
    if (type === 'total') container.classList.add('focus-total');
    else if (type === 'executed') container.classList.add('focus-executed');
    else if (type === 'passed') container.classList.add('focus-passed');
  }
  
  const legendItems = document.querySelectorAll('.activity-legend-item');
  legendItems.forEach(item => {
    if (item.getAttribute('data-ring') === type) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  const valEl = document.getElementById('activity-center-value');
  const labelEl = document.getElementById('activity-center-label');
  if (valEl && labelEl) {
    valEl.textContent = val;
    labelEl.textContent = label;
    valEl.style.transform = 'scale(1.1)';
    setTimeout(() => { valEl.style.transform = 'scale(1)'; }, 150);
  }
}

function resetActivityRings() {
  const container = document.getElementById('activity-rings-svg-container');
  if (container) {
    container.className = 'ring-svg-container';
  }
  
  const legendItems = document.querySelectorAll('.activity-legend-item');
  legendItems.forEach(item => item.classList.remove('active'));

  const valEl = document.getElementById('activity-center-value');
  const labelEl = document.getElementById('activity-center-label');
  if (valEl && labelEl && window.lastTotalSetups !== undefined) {
    valEl.textContent = window.lastTotalSetups;
    labelEl.textContent = 'Total Setups';
  }
}

// Touch & Click Interactions for SVGs/Rings
let isTouchDevice = false;
window.addEventListener('touchstart', () => {
  isTouchDevice = true;
}, { passive: true });

let clickedRingState = null; // { type, val, label, isActivity }

function focusRingHover(type, val, label) {
  if (isTouchDevice) return;
  focusRing(type, val, label);
}

function resetRingsHover() {
  if (isTouchDevice) return;
  if (clickedRingState && !clickedRingState.isActivity) {
    focusRing(clickedRingState.type, clickedRingState.val, clickedRingState.label);
  } else {
    resetRings();
  }
}

function focusActivityRingHover(type, val, label) {
  if (isTouchDevice) return;
  focusActivityRing(type, val, label);
}

function resetActivityRingsHover() {
  if (isTouchDevice) return;
  if (clickedRingState && clickedRingState.isActivity) {
    focusActivityRing(clickedRingState.type, clickedRingState.val, clickedRingState.label);
  } else {
    resetActivityRings();
  }
}

function handleLegendItemClick(type, val, label, isActivity = false) {
  if (clickedRingState && clickedRingState.type === type) {
    clickedRingState = null;
    if (isActivity) {
      resetActivityRings();
    } else {
      resetRings();
    }
  } else {
    clickedRingState = { type, val, label, isActivity };
    if (isActivity) {
      focusActivityRing(type, val, label);
    } else {
      focusRing(type, val, label);
    }
  }
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
    const roundedPL = Math.round((computedPL + Number.EPSILON) * 100) / 100;
    const currentPL = entry.customAttributes['P&L'];
    if (currentPL === '' || currentPL === undefined || currentPL === null || Number(currentPL) === roundedPL) {
      entry.customAttributes['P&L'] = roundedPL;
    }
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

  const isEditingPL = (document.activeElement === plEl);

  if (!isEditingPL && ep !== '' && xp !== '' && qty !== '' && chg !== '') {
    const computedPL = (Number(xp) - Number(ep)) * Number(qty) - Number(chg);
    const roundedPL = Math.round((computedPL + Number.EPSILON) * 100) / 100;
    plEl.value = roundedPL;
    
    if (container) {
      const badge = container.querySelector('.status-passed, .status-failed, .status-missed');
      if (badge) {
        badge.className = 'tag-badge ' + (roundedPL > 0 ? 'status-passed' : 'status-failed');
        badge.textContent = roundedPL > 0 ? 'PASSED' : 'FAILED';
      }
    }
  } else {
    // Keep current P&L value (manual or calculated) and update badge
    const plValStr = plEl.value;
    if (container) {
      const badge = container.querySelector('.status-passed, .status-failed, .status-missed');
      if (badge) {
        if (plValStr !== '') {
          const plVal = Number(plValStr);
          if (plVal === 0) {
            badge.className = 'tag-badge status-missed';
            badge.textContent = 'MISSED';
          } else {
            badge.className = 'tag-badge ' + (plVal > 0 ? 'status-passed' : 'status-failed');
            badge.textContent = plVal > 0 ? 'PASSED' : 'FAILED';
          }
        } else {
          badge.className = 'tag-badge status-missed';
          badge.textContent = 'MISSED';
        }
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
      if (attrKey === 'P&L' && val !== '') {
        val = Math.round((Number(val) + Number.EPSILON) * 100) / 100;
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
      if (attrKey === 'P&L' && val !== '') {
        val = Math.round((Number(val) + Number.EPSILON) * 100) / 100;
      }
      entry.customAttributes[attrKey] = val;
    });
  }

  // Recalculate P&L if all 4 are filled and not manually overridden
  const ep = entry.customAttributes['Entry Price'];
  const xp = entry.customAttributes['Exit Price'];
  const qty = entry.customAttributes['Quantity'];
  const chg = entry.customAttributes['Charges'];

  if (ep !== '' && ep !== undefined && ep !== null &&
      xp !== '' && xp !== undefined && xp !== null &&
      qty !== '' && qty !== undefined && qty !== null &&
      chg !== '' && chg !== undefined && chg !== null) {
    const computedPL = (Number(xp) - Number(ep)) * Number(qty) - Number(chg);
    const roundedPL = Math.round((computedPL + Number.EPSILON) * 100) / 100;
    
    // Only overwrite if the current P&L matches computed PL or is empty/null
    const currentPL = entry.customAttributes['P&L'];
    if (currentPL === '' || currentPL === undefined || currentPL === null || Number(currentPL) === roundedPL) {
      entry.customAttributes['P&L'] = roundedPL;
    }
  }

  // Recalculate status
  updateEntryStatus(entry);

  if (isManualClick) {
    entry._saved = true;
  }

  entry.updatedAt = new Date().toISOString();

  // Save synchronously to localStorage (guarded — images may exceed quota)
  try {
    localStorage.setItem('honey_journal_entries', JSON.stringify(entries));
    localStorage.setItem('honey_journal_tags', JSON.stringify(tags));
    localStorage.setItem('honey_journal_custom_attrs', JSON.stringify(customAttributes));
  } catch (e) {
    console.warn('localStorage write in saveFromDOM failed (quota):', e);
  }

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
    primaryImages: [],
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

  if (entry.primaryImages) {
    const pos = entry.primaryImages.indexOf(activeImageIndex);
    if (pos >= 0) entry.primaryImages.splice(pos, 1);
    entry.primaryImages = entry.primaryImages.map(pIdx => pIdx > activeImageIndex ? pIdx - 1 : pIdx);
  }
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

  if (entry.primaryImages) {
    const pos = entry.primaryImages.indexOf(index);
    if (pos >= 0) entry.primaryImages.splice(pos, 1);
    entry.primaryImages = entry.primaryImages.map(pIdx => pIdx > index ? pIdx - 1 : pIdx);
  }
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
    const isPrimary = entry.primaryImages && entry.primaryImages.includes(idx);
    thumb.className = `thumbnail-item ${idx === activeImageIndex ? 'active' : ''} ${isPrimary ? 'is-primary' : ''}`;
    thumb.onclick = () => {
      activeImageIndex = idx;
      renderDetailOnly();
    };
    
    // HTML5 drag and drop (Desktop)
    thumb.draggable = true;
    
    thumb.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', idx);
      thumb.classList.add('dragging');
    });

    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = thumb.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      if (relX < rect.width / 2) {
        thumb.classList.add('drag-over-left');
        thumb.classList.remove('drag-over-right');
      } else {
        thumb.classList.add('drag-over-right');
        thumb.classList.remove('drag-over-left');
      }
    });

    thumb.addEventListener('dragleave', () => {
      thumb.classList.remove('drag-over-left', 'drag-over-right');
    });

    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging', 'drag-over-left', 'drag-over-right');
    });

    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      thumb.classList.remove('drag-over-left', 'drag-over-right');
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIndex) || fromIndex === idx) return;

      const rect = thumb.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      let targetIndex = idx;
      if (relX >= rect.width / 2) {
        targetIndex = idx + 1;
      }
      reorderImages(entry, fromIndex, targetIndex);
    });

    // Touch drag and drop (Mobile / WebView)
    let touchStartIdx = -1;
    
    thumb.addEventListener('touchstart', (e) => {
      touchStartIdx = idx;
      thumb.classList.add('dragging');
    }, { passive: true });

    thumb.addEventListener('touchmove', (e) => {
      if (touchStartIdx !== idx) return;
      if (e.cancelable) e.preventDefault(); // Prevent scrolling while dragging
      
      const touch = e.touches[0];
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetThumb = element ? element.closest('.thumbnail-item') : null;
      
      const allThumbs = container.querySelectorAll('.thumbnail-item');
      allThumbs.forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
      
      if (targetThumb && targetThumb !== thumb) {
        const rect = targetThumb.getBoundingClientRect();
        const relX = touch.clientX - rect.left;
        if (relX < rect.width / 2) {
          targetThumb.classList.add('drag-over-left');
        } else {
          targetThumb.classList.add('drag-over-right');
        }
      }
    });

    thumb.addEventListener('touchend', (e) => {
      if (touchStartIdx !== idx) return;
      thumb.classList.remove('dragging');
      
      const touch = e.changedTouches[0];
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetThumb = element ? element.closest('.thumbnail-item') : null;
      
      if (targetThumb && targetThumb !== thumb) {
        const allThumbs = Array.from(container.querySelectorAll('.thumbnail-item'));
        const targetIdx = allThumbs.indexOf(targetThumb);
        
        if (targetIdx !== -1) {
          const rect = targetThumb.getBoundingClientRect();
          const relX = touch.clientX - rect.left;
          let targetIndex = targetIdx;
          if (relX >= rect.width / 2) {
            targetIndex = targetIdx + 1;
          }
          reorderImages(entry, touchStartIdx, targetIndex);
        }
      }
      
      const allThumbs = container.querySelectorAll('.thumbnail-item');
      allThumbs.forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
      touchStartIdx = -1;
    });

    thumb.innerHTML = `
      <img src="${imgSrc}" class="thumbnail-img">
      <button class="thumb-primary" onclick="event.stopPropagation(); togglePrimaryImage(${idx});" title="${isPrimary ? 'Remove primary star' : 'Mark as primary'}">
        <i class="${isPrimary ? 'fa-solid' : 'fa-regular'} fa-star"></i>
      </button>
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

// Helper to update the mobile bottom nav pill
function updateMobileNavPill(instantly = false) {
  const activeItem = document.querySelector('.phone-bottom-nav .phone-nav-item.active');
  const pill = document.querySelector('.phone-bottom-nav .phone-nav-pill');
  if (activeItem && pill) {
    if (instantly) {
      pill.style.transition = 'none';
    }
    pill.style.transform = `translateX(${activeItem.offsetLeft}px)`;
    pill.style.width = `${activeItem.offsetWidth}px`;
    if (instantly) {
      pill.offsetHeight; // Force reflow
      pill.style.transition = '';
    }
  }
}

// Helper to update the statistics tab pill
function updateStatsTabPill(platform, instantly = false) {
  const control = document.getElementById(`${platform}-stats-segmented-control`);
  if (!control) return;
  const activeBtn = control.querySelector('.stats-tab-btn.active');
  const pill = control.querySelector('.stats-pill');
  if (activeBtn && pill) {
    if (instantly) {
      pill.style.transition = 'none';
    }
    pill.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
    pill.style.width = `${activeBtn.offsetWidth}px`;
    if (instantly) {
      pill.offsetHeight; // Force reflow
      pill.style.transition = '';
    }
  }
}

// Listen for window resize to adjust all pills
window.addEventListener('resize', () => {
  updateMobileNavPill(true);
  updateStatsTabPill('desktop', true);
  updateStatsTabPill('mobile', true);
});

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

  // Slide navigation pill to the active item
  requestAnimationFrame(() => {
    const nav = document.querySelector('.phone-bottom-nav');
    const isFirstRun = nav && !nav.getAttribute('data-pill-initialized');
    if (isFirstRun) {
      nav.setAttribute('data-pill-initialized', 'true');
      updateMobileNavPill(true);
    } else {
      updateMobileNavPill();
    }
  });

  const headerTitle = document.getElementById('mobile-view-title');
  const sortDropdown = document.getElementById('mobile-sort-dropdown-container');
  
  const gallery = document.getElementById('mobile-gallery-view');
  const calendar = document.getElementById('mobile-calendar-view');
  const stats = document.getElementById('mobile-stats-view');
  const dashboard = document.getElementById('mobile-dashboard-view');
  const more = document.getElementById('mobile-more-view');
  const coach = document.getElementById('mobile-coach-view');
  const fab = document.getElementById('mobile-fab');

  // Hide mobile header options for non-patterns views
  const isPatternsView = (view === 'patterns');
  if (sortDropdown) sortDropdown.style.display = isPatternsView ? 'block' : 'none';
  if (fab) fab.style.display = isPatternsView ? 'flex' : 'none';

  // Hide all screens
  gallery.style.display = 'none';
  calendar.style.display = 'none';
  stats.style.display = 'none';
  dashboard.style.display = 'none';
  more.style.display = 'none';
  if (coach) coach.style.display = 'none';

  const subGalleryView = document.getElementById('mobile-pattern-subgallery-view');
  if (subGalleryView) subGalleryView.style.display = 'none';
  activePatternSubGallery = null;

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
  } else if (view === 'dashboard') {
    headerTitle.textContent = 'Dashboard';
    stats.style.display = 'block';
    renderMobileStats();
  } else if (view === 'more') {
    headerTitle.textContent = 'Settings';
    more.style.display = 'block';
    renderMobileMore();
  } else if (view === 'coach') {
    headerTitle.textContent = 'Mamba AI Mentor';
    if (coach) {
      coach.style.display = 'flex';
      renderMobileCoach();
    }
  }
}

function renderMobileContent() {
  const processedList = getProcessedEntries(null, activeCalendarDate);
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
    const isNew = !animatedMobileEntryIds.has(entry.id);
    const animateClass = isNew ? 'should-animate' : '';
    if (isNew) {
      animatedMobileEntryIds.add(entry.id);
    }
    card.className = `phone-card ${animateClass}`.trim();
    card.onclick = () => openEntryDetail(entry.id);
    card.style.animationDelay = `${Math.min(index, 8) * 30}ms`;
    if (isNew) {
      card.addEventListener('animationend', () => {
        card.classList.remove('should-animate');
      }, { once: true });
    }

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

    const primaryIdx = entry.primaryImages && entry.primaryImages.length > 0 ? entry.primaryImages[0] : 0;
    const firstImage = entry.images && entry.images.length > 0 ? (entry.images[primaryIdx] || entry.images[0]) : '';
    const hasImage = firstImage !== '';
    const transformStyle = hasImage && (entry.imageScale || entry.imageX || entry.imageY)
      ? `style="transform: scale(${entry.imageScale || 1}) translate(${entry.imageX || 0}px, ${entry.imageY || 0}px); transform-origin: center center;"`
      : '';

    // Format P&L display
    const plVal = entry.customAttributes ? entry.customAttributes['P&L'] : null;
    let plDisplay = '';
    if (plVal !== null && plVal !== undefined && plVal !== '' && plVal !== 0) {
      const numPl = typeof plVal === 'number' ? plVal : parsePL(String(plVal));
      if (numPl !== 0) {
        const plColor = numPl > 0 ? 'var(--color-bull)' : 'var(--color-bear)';
        plDisplay = `<span style="font-family: var(--font-display); font-weight: 700; font-size: 9px; color: ${plColor}; margin-left: 4px;">${numPl > 0 ? '+' : ''}₹${numPl}</span>`;
      }
    }

    card.innerHTML = `
      <div class="phone-card-img-wrapper">
        ${hasImage ? `<img src="${firstImage}" alt="${displayTitle}" class="phone-card-img" ${transformStyle}>` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-tertiary);"><i class="fa-solid fa-chart-line" style="color:var(--text-muted);"></i></div>`}
      </div>
      <div class="phone-card-header" style="padding: 6px; display: flex; flex-direction: column; gap: 4px;">
        <div class="phone-card-patterns" style="display: flex; flex-wrap: wrap; gap: 2px;">
          ${tagsHtml || `<span style="color: var(--text-muted); font-size: 9px;">No patterns</span>`}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
          <div style="display: flex; align-items: center;">
            <span class="phone-card-date" style="font-size: 8px;">${formatDateWithDay(entry.date)}</span>
            ${plDisplay}
          </div>
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
      inputHTML = `<input type="number" id="mobile-input-pl" class="input-text" value="${currentVal}" placeholder="0" oninput="updateCalculationsRealTime('mobile')">`;
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

    const maxBullCount = sortedBullish.length > 0 ? Math.max(...sortedBullish.map(item => item[1].total)) : 0;
    const maxBearCount = sortedBearish.length > 0 ? Math.max(...sortedBearish.map(item => item[1].total)) : 0;
    
    const bullChartHtml = generateSetupBarChartHTML(sortedBullish, maxBullCount, '--color-bull');
    const bearChartHtml = generateSetupBarChartHTML(sortedBearish, maxBearCount, '--color-bear');

    statsContent = `
      <div style="padding: 10px;">
        <div style="margin-bottom: 16px;">
          <h3 style="font-family: var(--font-display); font-size: 13px; margin-bottom: 8px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-arrow-trend-up" style="color:var(--color-bull);"></i> Bullish Usage</h3>
          <div class="stats-rank-list" style="gap:4px; margin-bottom:10px;">
            ${bullHtml}
          </div>
          ${bullChartHtml}
        </div>
        
        <div>
          <h3 style="font-family: var(--font-display); font-size: 13px; margin-bottom: 8px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-arrow-trend-down" style="color:var(--color-bear);"></i> Bearish Usage</h3>
          <div class="stats-rank-list" style="gap:4px; margin-bottom:10px;">
            ${bearHtml}
          </div>
          ${bearChartHtml}
        </div>
      </div>
    `;
  } else {
    statsContent = renderJournalStatsTab(true);
  }

  let control = document.getElementById('mobile-stats-segmented-control');
  if (!control) {
    container.innerHTML = `
      <div class="stats-segmented-control" id="mobile-stats-segmented-control" style="margin: 10px auto 0;">
        <span class="stats-pill" aria-hidden="true"></span>
        <button class="stats-tab-btn ${activeSetup}" style="font-size:11px; padding: 4px 12px;" onclick="switchStatsTab('setup')">Setup Stats</button>
        <button class="stats-tab-btn ${activeJournal}" style="font-size:11px; padding: 4px 12px;" onclick="switchStatsTab('journal')">Journal Stats</button>
      </div>
      <div id="stats-tab-content-mobile" style="margin-top: 10px;">
        ${statsContent}
      </div>
    `;
    control = document.getElementById('mobile-stats-segmented-control');
  } else {
    const btns = control.querySelectorAll('.stats-tab-btn');
    btns.forEach(btn => {
      if (btn.textContent.includes('Setup')) {
        btn.className = `stats-tab-btn ${activeSetup}`.trim();
      } else {
        btn.className = `stats-tab-btn ${activeJournal}`.trim();
      }
    });
    const contentDiv = document.getElementById('stats-tab-content-mobile');
    if (contentDiv) {
      contentDiv.innerHTML = statsContent;
    }
  }

  requestAnimationFrame(() => {
    const isNew = container.getAttribute('data-loaded') !== 'true';
    if (isNew) {
      container.setAttribute('data-loaded', 'true');
    }
    updateStatsTabPill('mobile', isNew);
    animateSetupBarCharts();
  });
}



// Mobile Settings / More options
function renderMobileMore() {
  const container = document.getElementById('mobile-more-view');
  if (!container) return;

  container.innerHTML = `
    <div class="apple-settings-group-title" style="margin-top: 8px;">Trading Portfolios</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #5856d6;">
            <i class="fa-solid fa-folder-tree"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title">Active Portfolio</span>
            <span class="apple-settings-desc">Managing: <strong style="color:var(--accent-gold);">${currentProfile || 'None'}</strong></span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-primary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px;" onclick="showProfilePortal()">Switch</button>
          <i class="fa-solid fa-chevron-right apple-settings-chevron" style="margin-left: 2px;"></i>
        </div>
      </div>
    </div>

    <div class="apple-settings-group-title">App Settings</div>
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
          <label class="apple-switch">
            <input type="checkbox" id="mobile-theme-switch" onchange="toggleTheme()" ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'checked' : ''}>
            <span class="apple-switch-slider"></span>
          </label>
        </div>
      </div>

      <div class="apple-settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <div class="apple-settings-info">
          <span class="apple-settings-title">Accent Theme</span>
          <span class="apple-settings-desc">Select accent color preset</span>
        </div>
        ${getCompactAccentPickerHTML()}
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

    <div class="apple-settings-group-title">Mamba AI & Gemini API</div>
    <div class="apple-settings-group">
      <div class="apple-settings-row" style="flex-direction: column; align-items: stretch; gap: 10px; padding: 12px 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="apple-settings-icon" style="background: linear-gradient(135deg, #c9a227, #f59e0b); width: 26px; height: 26px; font-size: 11px;">
              <i class="fa-solid fa-brain" style="color: #000;"></i>
            </div>
            <div class="apple-settings-info">
              <span class="apple-settings-title" style="font-size: 12px;">Gemini API Key</span>
              <span class="apple-settings-desc" style="font-size: 10px;">Synced via Syncthing</span>
            </div>
          </div>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" style="font-size: 10.5px; color: var(--accent-gold); text-decoration: none; font-weight: 600;">
            Free Key <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 8px;"></i>
          </a>
        </div>
        
        <div style="display: flex; gap: 6px; align-items: center; width: 100%;">
          <div style="position: relative; flex: 1;">
            <input type="password" id="mobile-gemini-api-key" class="input-text" style="width: 100%; font-family: monospace; font-size: 11.5px; padding-right: 32px;" placeholder="AIzaSy..." value="${escapeHtml(aiConfig.apiKey || '')}">
            <button type="button" onclick="toggleApiKeyVisibility('mobile-gemini-api-key', this)" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 2px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 11px; color: var(--text-secondary); font-weight: 500;">Model:</span>
            <select id="mobile-gemini-model" class="input-select" style="font-size: 11px; padding: 3px 20px 3px 8px; width: auto;" onchange="handleModelSelectChange(this.value, 'mobile')">
              <option value="gemini-3.5-flash-lite" ${aiConfig.model === 'gemini-3.5-flash-lite' ? 'selected' : ''}>Gemini 3.5 Flash Lite</option>
              <option value="gemini-3.1-flash-lite" ${aiConfig.model === 'gemini-3.1-flash-lite' ? 'selected' : ''}>Gemini 3.1 Flash Lite</option>
              <option value="custom" ${aiConfig.model !== 'gemini-3.5-flash-lite' && aiConfig.model !== 'gemini-3.1-flash-lite' ? 'selected' : ''}>Custom ID...</option>
            </select>
          </div>
          
          <div id="mobile-custom-model-wrapper" style="display: ${aiConfig.model !== 'gemini-3.5-flash-lite' && aiConfig.model !== 'gemini-3.1-flash-lite' ? 'block' : 'none'};">
            <input type="text" id="mobile-gemini-custom-model" class="input-text" style="font-size: 11px; padding: 4px 8px; width: 100%;" placeholder="e.g. gemini-2.5-flash-lite" value="${escapeHtml(aiConfig.customModel || aiConfig.model || '')}">
          </div>

          <div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px;">
            <button class="btn-secondary" style="font-size: 10px; padding: 4px 10px; border-radius: 100px;" id="mobile-test-api-btn" onclick="testGeminiConnection('mobile')">
              <i class="fa-solid fa-plug"></i> Test
            </button>
            <button class="btn-primary" style="font-size: 10px; padding: 4px 12px; border-radius: 100px;" onclick="saveGeminiSettingsFromUI('mobile')">
              <i class="fa-solid fa-floppy-disk"></i> Save
            </button>
          </div>
        </div>

        <div id="mobile-api-test-status" style="font-size: 11px; display: none; margin-top: 4px; padding: 5px 8px; border-radius: 6px;"></div>
      </div>

      <div class="apple-settings-row">
        <div class="apple-settings-row-left">
          <div class="apple-settings-icon" style="background-color: #8e8e93; width: 26px; height: 26px; font-size: 11px;">
            <i class="fa-solid fa-trash-can"></i>
          </div>
          <div class="apple-settings-info">
            <span class="apple-settings-title" style="font-size: 12px;">Clear Chat History</span>
            <span class="apple-settings-desc" style="font-size: 10px;">Reset Mamba logs for ${currentProfile || 'Default'}</span>
          </div>
        </div>
        <div class="apple-settings-row-right">
          <button class="btn-secondary" style="font-size: 10px; padding: 3px 8px; border-radius: 100px; color: var(--color-bear);" onclick="clearAIChatHistoryWithConfirm()">Clear</button>
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
    const primaryIndices = entry.primaryImages && entry.primaryImages.length > 0 
      ? entry.primaryImages 
      : [0];
    primaryIndices.forEach(imgIndex => {
      if (imgIndex < entry.images.length) {
        currentSubGalleryImages.push({
          src: entry.images[imgIndex],
          entry: entry,
          imageIndex: imgIndex
        });
      }
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
    lightbox.classList.add('closing');
    lightbox.classList.remove('open');
    const content = lightbox.querySelector('.lightbox-content');
    if (content) {
      content.classList.add('closing');
    }
    setTimeout(() => {
      lightbox.style.display = 'none';
      lightbox.classList.remove('closing');
      if (content) content.classList.remove('closing');
    }, 260); // Matches --dur-medium
  }
}

function openLightboxSlider(imagesList, startIndex) {
  currentSubGalleryImages = imagesList;
  activeLightboxIndex = startIndex;
  
  const lightbox = document.getElementById('image-lightbox');
  if (lightbox) {
    lightbox.style.display = 'flex';
    // Force a reflow to make sure opacity transitions
    lightbox.offsetHeight;
    lightbox.classList.add('open');
    lightbox.classList.remove('closing');
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

// ==========================================================================
// MAMBA AI COACH & GOOGLE GEMINI TRADING MENTOR ENGINE
// ==========================================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toggleApiKeyVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
  } else {
    input.type = 'password';
    btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
  }
}

function handleModelSelectChange(val, platform) {
  const wrapper = document.getElementById(`${platform}-custom-model-wrapper`);
  if (wrapper) {
    wrapper.style.display = val === 'custom' ? 'block' : 'none';
  }
}

async function loadAIConfigFromDisk() {
  if (window.__TAURI__ && storagePath) {
    const invoke = getTauriInvoke();
    try {
      const content = await invoke('fs_read_text_file', { path: joinPath(storagePath, 'ai_config.json') });
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        aiConfig = { ...aiConfig, ...parsed };
        if (aiConfig.apiKey) localStorage.setItem('honey_journal_gemini_api_key', aiConfig.apiKey);
        if (aiConfig.model) localStorage.setItem('honey_journal_gemini_model', aiConfig.model);
        if (aiConfig.customModel) localStorage.setItem('honey_journal_gemini_custom_model', aiConfig.customModel);
      }
    } catch {
      // Fall back to localStorage
    }
  }
}

async function saveAIConfigToDisk() {
  localStorage.setItem('honey_journal_gemini_api_key', aiConfig.apiKey || '');
  localStorage.setItem('honey_journal_gemini_model', aiConfig.model || 'gemini-3.5-flash-lite');
  localStorage.setItem('honey_journal_gemini_custom_model', aiConfig.customModel || '');
  if (window.__TAURI__ && storagePath) {
    const invoke = getTauriInvoke();
    await invoke('fs_write_text_file', {
      path: joinPath(storagePath, 'ai_config.json'),
      content: JSON.stringify(aiConfig, null, 2)
    }).catch(err => console.error('Failed to save ai_config.json to disk:', err));
  }
}

async function loadAIChatHistoryFromDisk() {
  const profileKey = currentProfile || 'default';
  const localSaved = localStorage.getItem(`honey_journal_ai_chats_${profileKey}`);
  if (localSaved) {
    try { aiChatHistory = JSON.parse(localSaved) || []; } catch { aiChatHistory = []; }
  } else {
    aiChatHistory = [];
  }
  
  if (window.__TAURI__ && storagePath && currentProfile) {
    const invoke = getTauriInvoke();
    try {
      const chatPath = getProfilePath('ai_chats.json');
      const content = await invoke('fs_read_text_file', { path: chatPath });
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        aiChatHistory = parsed;
        localStorage.setItem(`honey_journal_ai_chats_${profileKey}`, JSON.stringify(aiChatHistory));
      }
    } catch {
      // No chat history yet
    }
  }
}

async function saveAIChatHistoryToDisk() {
  const profileKey = currentProfile || 'default';
  localStorage.setItem(`honey_journal_ai_chats_${profileKey}`, JSON.stringify(aiChatHistory));
  if (window.__TAURI__ && storagePath && currentProfile) {
    const invoke = getTauriInvoke();
    const chatPath = getProfilePath('ai_chats.json');
    await invoke('fs_write_text_file', {
      path: chatPath,
      content: JSON.stringify(aiChatHistory, null, 2)
    }).catch(err => console.error('Failed to save ai_chats.json to disk:', err));
  }
}

async function saveGeminiSettingsFromUI(platform) {
  const keyInput = document.getElementById(`${platform}-gemini-api-key`);
  const modelSelect = document.getElementById(`${platform}-gemini-model`);
  const customModelInput = document.getElementById(`${platform}-gemini-custom-model`);
  
  if (!keyInput) return;
  const newKey = keyInput.value.trim();
  const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.5-flash-lite';
  const customModelVal = customModelInput ? customModelInput.value.trim() : '';

  aiConfig.apiKey = newKey;
  aiConfig.model = selectedModel === 'custom' ? (customModelVal || 'gemini-3.5-flash-lite') : selectedModel;
  aiConfig.customModel = customModelVal;

  await saveAIConfigToDisk();
  showToast('Gemini API configuration saved & synced!', 'success');
  
  if (currentDesktopView === 'settings') renderDesktopSettings();
  if (currentMobileView === 'more') renderMobileMore();
  if (currentDesktopView === 'coach') renderDesktopCoach();
  if (currentMobileView === 'coach') renderMobileCoach();
}

async function testGeminiApiKey(testKey, testModel) {
  const modelToUse = (testModel === 'custom' && aiConfig.customModel) 
    ? aiConfig.customModel.trim() 
    : (testModel || 'gemini-3.5-flash-lite');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(testKey.trim())}`;
  
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Respond in one short sentence as Kobe Bryant: Are you ready to coach trading with Mamba Mentality?' }]
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    const msg = errJson.error ? errJson.error.message : `HTTP ${response.status} ${response.statusText}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Connected successfully!';
  return text;
}

async function testGeminiConnection(platform) {
  const keyInput = document.getElementById(`${platform}-gemini-api-key`);
  const modelSelect = document.getElementById(`${platform}-gemini-model`);
  const customModelInput = document.getElementById(`${platform}-gemini-custom-model`);
  const statusEl = document.getElementById(`${platform}-api-test-status`);
  const testBtn = document.getElementById(`${platform}-test-api-btn`);

  if (!keyInput || !keyInput.value.trim()) {
    showToast('Please enter an API key first.', 'warning');
    return;
  }

  const testKey = keyInput.value.trim();
  const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.5-flash-lite';
  const testModel = selectedModel === 'custom' ? (customModelInput ? customModelInput.value.trim() : 'gemini-3.5-flash-lite') : selectedModel;

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(255, 255, 255, 0.05)';
    statusEl.style.color = 'var(--text-secondary)';
    statusEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting to ${testModel}...`;
  }

  try {
    const reply = await testGeminiApiKey(testKey, testModel);
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(16, 185, 129, 0.12)';
      statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      statusEl.style.color = 'var(--color-bull)';
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>Success!</strong> ${escapeHtml(reply)}`;
    }
    showToast('Gemini API connection verified!', 'success');
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239, 68, 68, 0.12)';
      statusEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      statusEl.style.color = 'var(--color-bear)';
      statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <strong>Connection Failed:</strong> ${escapeHtml(err.message)}`;
    }
    showToast('Connection failed: ' + err.message, 'error');
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Test Connection';
    }
  }
}

function clearAIChatHistoryWithConfirm() {
  if (confirm(`Clear all Mamba AI conversation history for workspace "${currentProfile || 'Default'}"?`)) {
    aiChatHistory = [];
    saveAIChatHistoryToDisk();
    showToast('AI Chat History cleared.', 'info');
    if (currentDesktopView === 'coach') renderDesktopCoach();
    if (currentMobileView === 'coach') renderMobileCoach();
  }
}

function formatAIMarkdown(rawText) {
  if (!rawText) return '';
  let text = escapeHtml(rawText);
  
  // Bold **text**
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic *text* or _text_
  text = text.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Inline code `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Headers ### text
  text = text.replace(/^### (.*$)/gim, '<h4 style="color:var(--text-main); margin:8px 0 4px; font-size:14px; font-weight:700;">$1</h4>');
  text = text.replace(/^## (.*$)/gim, '<h3 style="color:var(--accent-gold); margin:10px 0 4px; font-size:15px; font-weight:800;">$1</h3>');
  text = text.replace(/^# (.*$)/gim, '<h2 style="color:var(--accent-gold); margin:12px 0 6px; font-size:16px; font-weight:800;">$1</h2>');

  // Blockquotes > text
  text = text.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
  
  // Bullet lists (- or * )
  text = text.replace(/^\s*[\-\*]\s+(.*)$/gim, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');
  text = text.replace(/<\/ul>\s*<ul>/g, '');

  // Numbered lists
  text = text.replace(/^\s*(\d+)\.\s+(.*)$/gim, '<li>$2</li>');
  
  // Paragraphs / Newlines
  text = text.replace(/\n\n+/g, '</p><p>');
  text = text.replace(/\n/g, '<br>');
  
  return `<p>${text}</p>`;
}

function buildJournalAIContext(focusEntry = null) {
  const stats = calculateJournalStats();
  const executedEntries = entries.filter(e => e.status === 'PASSED' || e.status === 'FAILED');
  const missedEntries = entries.filter(e => e.status === 'MISSED');

  // Patterns breakdown with exact numbers
  const patternCounts = {};
  entries.forEach(e => {
    (e.patterns || []).forEach(p => {
      if (!patternCounts[p]) patternCounts[p] = { total: 0, passed: 0, failed: 0, missed: 0 };
      patternCounts[p].total++;
      if (e.status === 'PASSED') patternCounts[p].passed++;
      else if (e.status === 'FAILED') patternCounts[p].failed++;
      else patternCounts[p].missed++;
    });
  });
  const patternSummary = Object.entries(patternCounts)
    .map(([name, s]) => {
      const execTotal = s.passed + s.failed;
      const wr = execTotal > 0 ? ((s.passed / execTotal) * 100).toFixed(1) + '%' : 'N/A';
      return `• "${name}": Total ${s.total} logged (Passed: ${s.passed}, Failed: ${s.failed}, Missed: ${s.missed} | Win Rate: ${wr})`;
    })
    .join('\n');

  // Mistakes aggregation with exact frequencies
  const mistakeCounts = {};
  entries.forEach(e => {
    if (e.mistakes && e.mistakes.trim()) {
      const mist = e.mistakes.trim();
      mistakeCounts[mist] = (mistakeCounts[mist] || 0) + 1;
    }
  });
  const mistakesSummary = Object.entries(mistakeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([m, cnt]) => `• "${m}" (${cnt}x)`)
    .join('\n');

  // Custom Attributes list
  const customAttrKeys = (customAttributes || []).map(a => a.name).join(', ');

  // Complete setups database listing (token-efficient, factual records)
  const setupsList = entries.map((e, idx) => {
    const pl = e.customAttributes ? (e.customAttributes['P&L'] ?? '0') : '0';
    const extraAttrs = [];
    if (e.customAttributes) {
      Object.entries(e.customAttributes).forEach(([k, v]) => {
        if (k !== 'P&L' && v !== '' && v !== null && v !== undefined) {
          extraAttrs.push(`${k}: ${v}`);
        }
      });
    }
    const extraStr = extraAttrs.length > 0 ? ` | Attrs: [${extraAttrs.join(', ')}]` : '';
    const notesStr = e.notes ? ` | Notes: "${e.notes.replace(/\n/g, ' ').slice(0, 120)}"` : '';
    const mistStr = e.mistakes ? ` | Mistakes: "${e.mistakes.replace(/\n/g, ' ').slice(0, 120)}"` : '';
    return `${idx + 1}. [Date: ${e.date || 'N/A'}] Bias: ${e.bias || 'None'} | Patterns: ${(e.patterns || []).join(', ') || 'None'} | Status: ${e.status || 'MISSED'} | P&L: ₹${pl}${extraStr}${notesStr}${mistStr}`;
  }).join('\n');

  let ctx = `
=== REAL TRADER JOURNAL DATABASE (${currentProfile || 'Default Workspace'}) ===
- Total Logged Setups: ${entries.length}
- Executed Trades: ${executedEntries.length} (Passed/Wins: ${stats.winningTradesCount}, Failed/Losses: ${stats.losingTradesCount})
- Missed Setups: ${missedEntries.length}
- Overall Win Rate: ${stats.winRate.toFixed(1)}%
- Profit Factor: ${stats.profitFactor === Infinity ? 'Infinite (no losses)' : stats.profitFactor.toFixed(2)}
- Net P&L: ₹${stats.netPL.toLocaleString()} (Gross Profit: ₹${stats.grossProfit.toLocaleString()}, Gross Loss: ₹${stats.grossLoss.toLocaleString()})
- Custom Attribute Fields: ${customAttrKeys || 'None'}

=== PATTERNS LOGGED IN DATABASE ===
${patternSummary || 'No specific patterns tagged yet.'}

=== LOGGED MISTAKES IN DATABASE ===
${mistakesSummary || 'No specific mistakes logged yet.'}

=== COMPLETE INVENTORY OF LOGGED SETUPS (${entries.length} Total) ===
${setupsList || 'No trade setups logged in this workspace yet.'}
`;

  if (focusEntry) {
    const fpl = focusEntry.customAttributes ? (focusEntry.customAttributes['P&L'] ?? '0') : '0';
    ctx += `
=== FOCUSED TRADE SETUP BEING DIRECTLY REVIEWED ===
- Setup ID: ${focusEntry.id}
- Date: ${focusEntry.date || 'N/A'}
- Patterns: ${(focusEntry.patterns || []).join(', ') || 'None'}
- Bias: ${focusEntry.bias || 'N/A'}
- Status/Outcome: ${focusEntry.status || 'MISSED'}
- P&L: ₹${fpl}
- Notes: "${focusEntry.notes || 'None'}"
- Mistakes Logged: "${focusEntry.mistakes || 'None'}"
`;
  }

  return ctx.trim();
}

async function callGeminiAPI(messages, journalContext) {
  const modelToUse = (aiConfig.model === 'custom' && aiConfig.customModel) 
    ? aiConfig.customModel.trim() 
    : (aiConfig.model || 'gemini-3.5-flash-lite');

  const apiKey = aiConfig.apiKey ? aiConfig.apiKey.trim() : '';
  if (!apiKey) {
    throw new Error('Please configure and save your Gemini API key in Settings first.');
  }

  const systemPrompt = `You are Kobe Bryant — trading psychology mentor and master of execution. Your tone embodies the MAMBA MENTALITY: intense, disciplined, sharp, accountable, and focused 100% on the process over outcome.

### CRITICAL RULES (STRICT ANTI-HALLUCINATION & BREVITY):
1. **STRICT FACTUAL INTEGRITY (NO HALLUCINATIONS)**:
   - ONLY cite numbers, dates, patterns, metrics, sessions, notes, or mistakes that EXPLICITLY exist in the REAL TRADER JOURNAL DATABASE provided below.
   - NEVER invent or assume imaginary sessions (e.g. Asia/London if not in the data), fictional indicators (e.g. VWAP/hammers if not in the data), or fake trades.
   - If the user asks about something not found in the database, explicitly state: "That is not logged in your journal."
2. **BREVITY & PUNCHINESS (STRICT LENGTH LIMIT)**:
   - Keep responses concise: strictly 2 to 3 short paragraphs maximum (strictly under 140 words total).
   - No long preachy lectures or repetitive monologues.
   - 1 sharp diagnosis based on their actual logged numbers, 1 psychological truth, 1 actionable rule for the next trade.
3. **MAMBA VOICE**:
   - Speak in the first person as Kobe ("Look,", "Listen to me,", "Job's not finished.").
   - Bold critical punchlines. Tough love, zero excuses, process-obsessed.

### REAL TRADER JOURNAL DATABASE:
${journalContext}`;

  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));

  const payload = {
    contents: contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: 0.4,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: 500
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (netErr) {
    throw new Error(`Network error connecting to Gemini API: ${netErr.message}`);
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error ? errJson.error.message : JSON.stringify(errJson);
    } catch {
      errorDetail = `HTTP ${response.status} ${response.statusText}`;
    }
    
    // Fallback: If 400 because systemInstruction is unsupported, retry with system prompt injected in user message
    if (response.status === 400 && errorDetail.includes('systemInstruction')) {
      const fallbackContents = [
        {
          role: 'user',
          parts: [{ text: `[System Instructions from Kobe Bryant]:\n${systemPrompt}\n\n[User message]:\n${messages[messages.length - 1].text}` }]
        }
      ];
      const fallbackPayload = {
        contents: fallbackContents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
      };
      const fbResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackPayload)
      });
      if (fbResponse.ok) {
        const fbData = await fbResponse.json();
        const candidate = fbData.candidates && fbData.candidates[0];
        if (candidate && candidate.content && candidate.content.parts) {
          return candidate.content.parts.map(p => p.text).join('\n');
        }
      }
    }

    throw new Error(`Gemini API Error (${response.status}): ${errorDetail}`);
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  if (candidate && candidate.content && candidate.content.parts) {
    return candidate.content.parts.map(p => p.text).join('\n');
  }

  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error(`Response blocked by safety filter: ${data.promptFeedback.blockReason}`);
  }

  return "Job's not finished. Let's analyze the next play.";
}

async function sendCoachMessage(userText, focusEntry = null) {
  if (!userText || !userText.trim() || isAITyping) return;
  const cleanedText = userText.trim();
  
  if (!aiConfig.apiKey) {
    showToast('Please add and save your Gemini API key in Settings first.', 'warning');
    if (currentDesktopView === 'coach') switchDesktopView('settings');
    else switchMobileView('more');
    return;
  }

  // Append user message
  const userMsgObj = {
    role: 'user',
    text: cleanedText,
    timestamp: Date.now()
  };
  aiChatHistory.push(userMsgObj);
  await saveAIChatHistoryToDisk();

  isAITyping = true;
  renderCoachMessages();

  // Clear input
  const desktopInput = document.getElementById('desktop-coach-input');
  const mobileInput = document.getElementById('mobile-coach-input');
  if (desktopInput) desktopInput.value = '';
  if (mobileInput) mobileInput.value = '';

  try {
    const journalCtx = buildJournalAIContext(focusEntry);
    const recentChatContext = aiChatHistory.slice(-8);
    const replyText = await callGeminiAPI(recentChatContext, journalCtx);

    const mambaMsgObj = {
      role: 'model',
      text: replyText,
      timestamp: Date.now()
    };
    aiChatHistory.push(mambaMsgObj);
    await saveAIChatHistoryToDisk();
  } catch (err) {
    console.error('Gemini error:', err);
    const errorMsg = {
      role: 'model',
      text: `> ⚠️ **Mamba Coach Note:** Unable to connect to Gemini API.\n\n*Error details:* ${err.message}\n\nPlease verify your **Gemini API Key** in Settings and check your internet connection.`,
      timestamp: Date.now()
    };
    aiChatHistory.push(errorMsg);
    await saveAIChatHistoryToDisk();
  } finally {
    isAITyping = false;
    renderCoachMessages();
    scrollCoachToBottom();
  }
}

function triggerSendCoachMessage(platform) {
  const input = document.getElementById(`${platform}-coach-input`);
  if (!input) return;
  const val = input.value;
  if (!val || !val.trim()) return;
  sendCoachMessage(val);
}

function handleCoachInputKeydown(e, platform) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    triggerSendCoachMessage(platform);
  }
}

function autoResizeCoachTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 90) + 'px';
}

function scrollCoachToBottom(platform = null) {
  requestAnimationFrame(() => {
    ['desktop', 'mobile'].forEach(plat => {
      if (platform && plat !== platform) return;
      const scrollEl = document.getElementById(`${plat}-coach-chat-scroll`);
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
  });
}

function renderCoachMessages() {
  if (currentDesktopView === 'coach') renderDesktopCoach();
  if (currentMobileView === 'coach') renderMobileCoach();
}

function openAISettings(platform) {
  if (platform === 'desktop') {
    switchDesktopView('settings');
  } else {
    switchMobileView('more');
  }
}

function renderDesktopCoach() {
  const container = document.getElementById('desktop-coach-view');
  if (!container) return;
  renderCoachView(container, 'desktop');
}

function renderMobileCoach() {
  const container = document.getElementById('mobile-coach-view');
  if (!container) return;
  renderCoachView(container, 'mobile');
}

function renderCoachView(container, platform) {
  const stats = calculateJournalStats();
  const hasApiKey = Boolean(aiConfig.apiKey && aiConfig.apiKey.trim());

  let apiWarningHtml = '';
  if (!hasApiKey) {
    apiWarningHtml = `
      <div class="coach-api-notice">
        <div class="coach-api-notice-left">
          <i class="fa-solid fa-key" style="color: var(--accent-gold); font-size: 14px;"></i>
          <div>
            <strong>Gemini API Key Required</strong><br>
            <span style="color: var(--text-secondary); font-size: 11px;">Configure your API key in Settings to activate Kobe Bryant coaching.</span>
          </div>
        </div>
        <button class="btn-primary" style="font-size: 11px; padding: 4px 12px; border-radius: 100px; white-space: nowrap;" onclick="openAISettings('${platform}')">
          <i class="fa-solid fa-gear"></i> Settings
        </button>
      </div>
    `;
  }

  let welcomeHtml = '';
  if (aiChatHistory.length === 0) {
    welcomeHtml = `
      <div class="coach-welcome-card">
        <div class="coach-welcome-header">
          <div class="coach-welcome-avatar">
            <i class="fa-solid fa-brain"></i>
          </div>
          <div>
            <div class="coach-welcome-title">Mamba Mentality Trading Coach</div>
            <div class="coach-welcome-motto">"Job's Not Finished. Master The Tape."</div>
          </div>
        </div>
        <div class="coach-welcome-body">
          Connected to <strong>${escapeHtml(currentProfile || 'Default')}</strong> (${entries.length} setups, ${stats.winRate.toFixed(1)}% WR). Tell me how you're feeling, let's break down your execution, or review your tape.
        </div>
      </div>
    `;
  }

  let messagesHtml = '';
  aiChatHistory.forEach(msg => {
    const isUser = msg.role === 'user';
    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const avatarHtml = isUser 
      ? `<div class="coach-msg-avatar user-avatar"><i class="fa-solid fa-user"></i></div>`
      : `<div class="coach-msg-avatar mamba-avatar"><i class="fa-solid fa-brain"></i></div>`;

    const formattedContent = isUser ? escapeHtml(msg.text).replace(/\n/g, '<br>') : formatAIMarkdown(msg.text);

    messagesHtml += `
      <div class="coach-msg-row ${isUser ? 'user' : 'mamba'}">
        ${!isUser ? avatarHtml : ''}
        <div class="coach-msg-bubble">
          ${formattedContent}
          <span class="coach-msg-time">${timeStr}</span>
        </div>
        ${isUser ? avatarHtml : ''}
      </div>
    `;
  });

  if (isAITyping) {
    messagesHtml += `
      <div class="coach-msg-row mamba">
        <div class="coach-msg-avatar mamba-avatar"><i class="fa-solid fa-brain"></i></div>
        <div class="coach-typing-box">
          <div class="coach-typing-dot"></div>
          <div class="coach-typing-dot"></div>
          <div class="coach-typing-dot"></div>
        </div>
      </div>
    `;
  }

  const headerHtml = (platform === 'mobile') ? `
    <!-- Mobile Compact Toolbar -->
    <div class="coach-header-bar mobile-compact">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 10px; background: rgba(255, 183, 3, 0.15); color: var(--accent-gold); border: 1px solid rgba(255, 183, 3, 0.3); border-radius: 100px; padding: 2px 7px; font-weight: 700;">
          <i class="fa-solid fa-brain" style="font-size: 9px; margin-right: 2px;"></i>${escapeHtml(aiConfig.model || 'Gemini 3.5 Flash Lite')}
        </span>
      </div>
      <div class="coach-header-right" style="gap: 6px;">
        <span class="coach-hud-pill" style="font-size: 10px; padding: 2px 6px;">
          <strong style="color: var(--color-bull);">${stats.winRate.toFixed(1)}% WR</strong>
          <span style="color: var(--text-muted);">·</span>
          <span>${entries.length} Setups</span>
        </span>
        <button class="btn-icon" onclick="clearAIChatHistoryWithConfirm()" title="Clear Chat" style="padding: 4px 6px; font-size: 11px;">
          <i class="fa-solid fa-trash-can"></i>
        </button>
        <button class="btn-icon" onclick="openAISettings('mobile')" title="Settings" style="padding: 4px 6px; font-size: 11px;">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>
  ` : `
    <!-- Desktop Header -->
    <div class="coach-header-bar">
      <div class="coach-header-left">
        <div class="coach-mamba-badge">
          <i class="fa-solid fa-brain"></i>
        </div>
        <div class="coach-header-title-wrap">
          <div class="coach-header-title">
            Mamba AI Mentor 
            <span style="font-size: 10px; background: rgba(255, 183, 3, 0.15); color: var(--accent-gold); border: 1px solid rgba(255, 183, 3, 0.3); border-radius: 100px; padding: 1px 7px; font-weight: 700;">${escapeHtml(aiConfig.model || 'Gemini')}</span>
          </div>
          <div class="coach-header-subtitle">Kobe Bryant Trading Psychology & Tape Review</div>
        </div>
      </div>

      <div class="coach-header-right">
        <span class="coach-hud-pill">
          <i class="fa-solid fa-chart-pie" style="color: var(--accent-gold);"></i> 
          <span>${stats.winRate.toFixed(1)}% WR</span>
          <span style="color: var(--text-muted);">|</span>
          <span>${entries.length} Setups</span>
        </span>
        <button class="btn-icon" onclick="clearAIChatHistoryWithConfirm()" title="Clear Chat History" style="padding: 6px;">
          <i class="fa-solid fa-trash-can"></i>
        </button>
        <button class="btn-icon" onclick="openAISettings('desktop')" title="AI Settings" style="padding: 6px;">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>
  `;

  container.innerHTML = `
    <div class="coach-view-container">
      ${headerHtml}

      <!-- Chat Stream -->
      <div class="coach-chat-scroll" id="${platform}-coach-chat-scroll">
        ${apiWarningHtml}
        ${welcomeHtml}
        ${messagesHtml}
      </div>

      <!-- Input Area -->
      <div class="coach-input-container">
        <div class="coach-input-inner">
          <textarea 
            class="coach-textarea" 
            id="${platform}-coach-input" 
            placeholder="Talk to Kobe Bryant... (e.g. 'Why did I hesitate today?', 'Review my stats')" 
            rows="1"
            onkeydown="handleCoachInputKeydown(event, '${platform}')"
            oninput="autoResizeCoachTextarea(this)"></textarea>
          <button class="coach-send-btn" id="${platform}-coach-send-btn" onclick="triggerSendCoachMessage('${platform}')" title="Send to Mamba AI">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach mobile keyboard listeners
  if (platform === 'mobile') {
    const mobInput = document.getElementById('mobile-coach-input');
    const phoneContainer = document.querySelector('.phone-container');
    if (mobInput && phoneContainer) {
      mobInput.addEventListener('focus', () => {
        phoneContainer.classList.add('keyboard-active');
        setTimeout(() => scrollCoachToBottom('mobile'), 150);
      });
      mobInput.addEventListener('blur', () => {
        phoneContainer.classList.remove('keyboard-active');
      });
    }
  }

  scrollCoachToBottom(platform);
}

function analyzeActiveEntryWithAI(platform) {
  if (!activeEntryId) {
    showToast('No active setup selected to analyze.', 'warning');
    return;
  }
  const entry = entries.find(e => e.id === activeEntryId);
  if (!entry) {
    showToast('Setup not found.', 'error');
    return;
  }

  // Close the detail panel
  if (platform === 'desktop') closeDesktopDetail();
  else closeMobileDetail();

  // Switch to coach view
  if (platform === 'desktop') switchDesktopView('coach');
  else switchMobileView('coach');

  const plVal = entry.customAttributes ? (entry.customAttributes['P&L'] ?? 0) : 0;
  const promptText = `Kobe, I want you to review this specific trade setup with me like you're breaking down game tape.
- Setup Date: ${entry.date || 'N/A'}
- Bias: ${entry.bias || 'N/A'}
- Patterns: ${(entry.patterns || []).join(', ') || 'None'}
- Status / Outcome: ${entry.status || 'MISSED'}
- P&L: ₹${plVal}
- My Notes: "${entry.notes || 'None'}"
- Logged Mistakes: "${entry.mistakes || 'None'}"

Break down my execution with Mamba Mentality: Did I execute properly according to rules, where did my psychology fail or succeed, and what is the exact lesson I must take into the gym tomorrow?`;

  sendCoachMessage(promptText, entry);
}

