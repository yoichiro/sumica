import { useState, useEffect, useRef, useMemo } from 'react';
import { isFirebaseConfigured, onAuth, saveGeneration, subscribeGenerations, subscribeFavorites, updateFavorite, deleteGenerations, type AuthUser, type GenerationRecord, type GenerationParams } from './firebase';
import { ToastContainer, type Toast } from './components/ToastContainer';
import { AppHeader, type HealthStatus } from './components/AppHeader';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { Lightbox } from './components/Lightbox';
import { BatchGenerationModal, type BatchJob } from './components/BatchGenerationModal';
import { PreviewPanel } from './components/PreviewPanel';
import { HistoryGallery } from './components/HistoryGallery';
import { ControlPanel } from './components/ControlPanel';
import { GenerationBadge } from './components/GenerationBadge';
import {
  SDXL_PRESETS,
  SDXL_SIZES,
  SD15_PRESETS,
  resolveSdxlDimensions,
  resolveSd15Dimensions,
  findSdxlSelection,
  findSd15Selection,
  type SdxlRatio,
  type SdxlSize,
  type SdxlOrientation,
  type Sd15Ratio,
  type SdModel,
  type SdLora,
} from './components/presets';
import { computeLoadIntoFormState } from './components/loadIntoFormState';
import { flushSync } from 'react-dom';

// View Transitions API (Baseline 2025-10); typed locally so it works regardless of lib.dom version.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void>; ready: Promise<void> };
};

export interface GenerationData {
  id?: string;
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  model?: string | null;
  imageUrl: string;
  // Sidecar 256px WebP for the gallery grid. Optional for backwards-compat
  // with pre-thumbnail generations; consumers fall back to imageUrl.
  thumbnailUrl?: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
  storagePath?: string;
  thumbnailStoragePath?: string;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  enableHr?: boolean;
  hrUpscaler?: string;
  hrScale?: number;
  hrSecondPassSteps?: number;
  denoisingStrength?: number;
  loras?: { name: string; weight: number }[];
  // SDXL-only extras. Both absent means the pipeline ran without the refinement
  // pass / external VAE, identical to pre-feature generations.
  refiner?: string;
  refinerSwitchAt?: number;
  vae?: string;
  isFavorite?: boolean;
}




function App() {
  // Form input states
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7);
  const [seedLocked, setSeedLocked] = useState(false);
  const [seedValue, setSeedValue] = useState(0);

  // Toast notifications state
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: 'error' | 'success' = 'error') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000); // 6 seconds auto-close
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Auth state
  const [user, setUser] = useState<AuthUser | null>(null);

  // App system states
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<number>(0); // 0: Idle, 1: LM Studio Enhancing, 2: SD Generating, 3: Saving/Finishing
  const [history, setHistory] = useState<GenerationData[]>([]);
  const [currentGeneration, setCurrentGeneration] = useState<GenerationData | null>(null);
  
  // Config & Status states
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const healthInFlight = useRef(false);
  const [sdModels, setSdModels] = useState<SdModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [sdSamplers, setSdSamplers] = useState<string[]>([]);
  const [selectedSampler, setSelectedSampler] = useState('');
  const [sdSchedulers, setSdSchedulers] = useState<string[]>([]);
  const [selectedScheduler, setSelectedScheduler] = useState('');
  const [sdLoras, setSdLoras] = useState<SdLora[]>([]);
  // Which architecture the form is currently scoped to. Drives the model picker
  // filter, the width/height option sets, and which models "モデル切替" batch
  // mode cycles through. Initializes from SD's actual active checkpoint the
  // first time fetchSdModels() succeeds (see modelTypeInitialized below).
  const [modelTypeFilter, setModelTypeFilter] = useState<'sd15' | 'sdxl'>('sd15');
  const modelTypeInitialized = useRef(false);
  const [selectedLoras, setSelectedLoras] = useState<{ name: string; weight: number }[]>([]);
  const [sdUpscalers, setSdUpscalers] = useState<string[]>([]);
  const [hiresFixEnabled, setHiresFixEnabled] = useState(false);
  const [selectedUpscaler, setSelectedUpscaler] = useState('');
  const [hiresScale, setHiresScale] = useState(1.5);
  const [hiresSteps, setHiresSteps] = useState(0);
  const [hiresDenoising, setHiresDenoising] = useState(0.5);
  // SDXL-only extras: an optional Refiner checkpoint (second-pass model, active
  // for the final (1 − refinerSwitchAt) fraction of steps) and an optional
  // external VAE override. Both default to "not set" — the pipeline behaves
  // identically to before when nothing is picked.
  const [sdVaes, setSdVaes] = useState<string[]>([]);
  const [selectedRefiner, setSelectedRefiner] = useState('');
  const [refinerSwitchAt, setRefinerSwitchAt] = useState(0.8);
  const [selectedVae, setSelectedVae] = useState('');
  const [rightTab, setRightTab] = useState<'preview' | 'gallery'>('preview');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Date filter is always set; defaults to today (local YYYY-MM-DD).
  const [filterDate, setFilterDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);

  // Stable id for a history item (Firestore id or local timestamp).
  const itemKey = (it: GenerationData) => it.id ?? String(it.timestamp);

  // Local YYYY-MM-DD of a generation's timestamp, for matching the date filter input.
  const localYMD = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // History narrowed by the active view mode: the favorites-only toggle wins
  // over the date filter. Signed in + favoritesOnly: subscribeFavorites already
  // scoped the data, so just pass it through. Signed out + favoritesOnly: the
  // full history is loaded, filter client-side.
  const displayedHistory = useMemo(() => {
    if (favoritesOnly) {
      return user ? history : history.filter((h) => !!h.isFavorite);
    }
    return filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
  }, [history, favoritesOnly, filterDate, user]);

  // Cloud storage is active only when Firebase is configured AND the user is signed in.
  const cloudActive = isFirebaseConfigured && !!user;

  // Single-click toggles selection. Gallery thumbnails split their click surface:
  // clicking the image opens the lightbox; clicking the caption strip below recalls
  // the image into the preview tab (see HistoryGallery.tsx).
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  // Flip isFavorite on the given item. Items without a persisted id (transient
  // preview state before save completes) are a no-op.
  const toggleFavorite = async (item: GenerationData) => {
    const id = item.id;
    if (!id) return;
    const next = !item.isFavorite;
    // Optimistic UI update for snappy feedback. In signed-in mode, the next
    // Firestore onSnapshot will reconcile to the authoritative value moments
    // later; in signed-out mode, this IS the authoritative client state.
    setHistory((prev) =>
      prev.map((h) => (h.id === id ? { ...h, isFavorite: next } : h)),
    );
    try {
      if (user) {
        await updateFavorite(user.uid, id, next);
      } else {
        const res = await fetch(`${API_BASE}/generations/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, isFavorite: next }),
        });
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
      }
    } catch (e: any) {
      // Rollback the optimistic update before surfacing the error toast.
      setHistory((prev) =>
        prev.map((h) => (h.id === id ? { ...h, isFavorite: !next } : h)),
      );
      addToast(`お気に入りの更新に失敗しました: ${e.message}`, 'error');
    }
  };

  // Open the confirm modal for the given ids (gallery selection or a single preview image).
  const requestDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleteTargetIds(ids);
    setShowDeleteConfirm(true);
  };

  // Delete deleteTargetIds (only invoked after the confirm modal).
  const handleDeleteSelected = async () => {
    if (deleteTargetIds.length === 0) return;
    setDeleting(true);
    try {
      const deletedSet = new Set(deleteTargetIds);
      if (user) {
        // Signed in: delete from Firestore + Storage; onSnapshot refreshes the gallery.
        const records = history.filter((h) => deleteTargetIds.includes(itemKey(h)));
        await deleteGenerations(user.uid, records as unknown as GenerationRecord[]);
      } else {
        const res = await fetch(`${API_BASE}/generations/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: deleteTargetIds }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to delete');
        }
        await fetchHistory();
      }
      setSelectedIds((prev) => new Set([...prev].filter((id) => !deletedSet.has(id))));
      // Clear the preview if the image it shows was just deleted.
      if (currentGeneration && deletedSet.has(itemKey(currentGeneration))) {
        setCurrentGeneration(null);
      }
      // closeConfirm also resets deleteTargetIds after the exit animation.
      closeConfirm();
      addToast(`${deleteTargetIds.length}件の画像を削除しました 🗑️`, 'success');
    } catch (error: any) {
      addToast(`削除に失敗しました。\n\n詳細: ${error.message}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Open the lightbox, morphing from the clicked source image via a View Transition.
  // The source image and the lightbox image share `view-transition-name: lightbox-morph`;
  // morphSourceKey ensures exactly one element carries the name per snapshot.
  //
  // We preload the full-resolution URL BEFORE calling startViewTransition — otherwise
  // the "new" snapshot is captured while the lightbox <img> is still loading, so the
  // browser cross-fades from the gallery thumbnail to a blank element, and the actual
  // image pops in only after the animation finishes. That pop-in reads to the user as
  // a second expansion on top of the morph. Preloading guarantees the new snapshot has
  // real pixels the moment it is taken. onerror falls through so a broken URL doesn't
  // strand the transition; unlike a promise-based path there's no unhandled rejection
  // on rapid re-clicks.
  const openLightbox = (url: string, sourceKey: string) => {
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (!start) {
      setLightboxUrl(url);
      return;
    }
    const runTransition = () => {
      flushSync(() => setMorphSourceKey(sourceKey)); // old snapshot: source carries the name
      start.call(document, () => {
        flushSync(() => setLightboxUrl(url)); // new snapshot: lightbox image carries the name
      });
    };
    const preloader = new Image();
    preloader.src = url;
    if (preloader.complete && preloader.naturalWidth > 0) {
      runTransition();
    } else {
      preloader.onload = runTransition;
      preloader.onerror = runTransition;
    }
  };

  const closeLightbox = async () => {
    // If we're in OS fullscreen, we MUST await the exit before starting the
    // View Transition. Otherwise the transition snapshots the still-fullscreen
    // DOM and the user sees the image stuck at the maximized size for the
    // ~1s the browser takes to actually leave fullscreen. Awaiting the
    // Promise document.exitFullscreen() returns closes that race.
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // If exiting fails for some reason, fall through — the close still needs to happen.
      }
    }
    setShowLightboxInfo(true); // next open always starts with info visible
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (!start) {
      setLightboxUrl(null);
      setMorphSourceKey(null);
      return;
    }
    const transition = start.call(document, () => {
      flushSync(() => setLightboxUrl(null)); // new snapshot: source regains the name
    });
    transition.ready.catch(() => {}); // a skipped transition (e.g. rapid toggle) is harmless
    transition.finished.finally(() => setMorphSourceKey(null)); // cleanup temporary name
  };

  // Toggle OS fullscreen on the lightbox overlay (keeps the close/fullscreen controls visible).
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      lightboxRef.current?.requestFullscreen?.();
    }
  };

  // Step the lightbox to the prev/next image in the gallery's displayed order
  // (displayedHistory). Clamps at the ends; no-op if the current image isn't listed.
  const navigateLightbox = (delta: number) => {
    const idx = displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl);
    if (idx === -1) return;
    const next = idx + delta;
    if (next < 0 || next >= displayedHistory.length) return;
    const target = displayedHistory[next];
    setMorphSourceKey(itemKey(target));
    setLightboxUrl(target.imageUrl);
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // While the delete confirm dialog plays its exit animation, `showDeleteConfirm`
  // is still true (so the DOM stays mounted) but this flag flips the CSS to the
  // `.exiting` variant. The timeout below unmounts once the animation completes.
  const [confirmExiting, setConfirmExiting] = useState(false);
  const CONFIRM_EXIT_MS = 180; // keep in sync with dialogOverlayOut duration in index.css
  const [deleting, setDeleting] = useState(false);

  // Trigger the confirm dialog's exit animation, then unmount. Replaces every
  // in-line setShowDeleteConfirm(false) call.
  const closeConfirm = () => {
    setConfirmExiting(true);
    setTimeout(() => {
      setShowDeleteConfirm(false);
      setConfirmExiting(false);
      setDeleteTargetIds([]);
    }, CONFIRM_EXIT_MS);
  };
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [morphSourceKey, setMorphSourceKey] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Bottom overlay panel of image detail info. Shown by default each time the
  // lightbox opens (the info is the whole point of the ライトボックス拡大表示 —
  // hiding it every time forces an extra click); toggled by the Info button in
  // the top toolbar; kept across left/right navigation within the same open
  // lightbox session.
  const [showLightboxInfo, setShowLightboxInfo] = useState(true);

  // Index of the lightbox image within the displayed gallery order (-1 if not listed),
  // used to disable the prev/next buttons at the ends.
  const lightboxIndex = lightboxUrl
    ? displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl)
    : -1;

  // Metadata source for whichever image the lightbox currently shows. Gallery
  // images resolve via displayedHistory[lightboxIndex]; the preview tab's
  // current image (lightboxIndex === -1 with morphSourceKey === '__preview__')
  // resolves via currentGeneration. Null in any other unexpected case, which
  // hides the Info button and panel defensively.
  const lightboxMeta = lightboxIndex >= 0
    ? displayedHistory[lightboxIndex]
    : (morphSourceKey === '__preview__' ? currentGeneration : null);

  // Track the last valid lightboxIndex so we can recover the "next" item if
  // the currently-shown image drops out of displayedHistory (e.g. unfavorited
  // in favoritesOnly mode).
  const prevLightboxIndexRef = useRef(-1);
  useEffect(() => {
    if (lightboxIndex >= 0) prevLightboxIndexRef.current = lightboxIndex;
  }, [lightboxIndex]);

  // Batch-level cancellation signal. Set by requestCancel(), checked at the
  // top of each batch iteration. Needed because the server's cancelRequested
  // flag is defensively reset at the start of every /api/generate call, so
  // a cancel that arrives during the inter-iteration gap (e.g. while the
  // client is uploading to Firebase and SD is idle) would otherwise be lost.
  const batchCancelledRef = useRef(false);

  // When the lightbox image is removed from displayedHistory (e.g. due to
  // unfavoriting in favoritesOnly mode), auto-advance to the item at the
  // previous index (clamped to the new list length), or close the lightbox
  // if the list is now empty.
  useEffect(() => {
    if (!lightboxUrl) return;
    if (lightboxIndex >= 0) return; // current image still listed; nothing to do
    if (displayedHistory.length === 0) {
      closeLightbox();
      return;
    }
    const targetIdx = Math.min(
      prevLightboxIndexRef.current,
      displayedHistory.length - 1,
    );
    if (targetIdx < 0) return;
    const target = displayedHistory[targetIdx];
    setMorphSourceKey(itemKey(target));
    setLightboxUrl(target.imageUrl);
  }, [displayedHistory, lightboxIndex, lightboxUrl]);
  type GenStatus = 'idle' | 'enhancing' | 'generating' | 'saving' | 'success' | 'error';
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sdProgress, setSdProgress] = useState<{ progress: number; etaRelative: number } | null>(null);

  // Batch generation state
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchCount, setBatchCount] = useState(5);
  const [batchMode, setBatchMode] = useState<'count' | 'size' | 'model'>('count');
  // SDXL picker state (aspect ratio + orientation + size). Only used when
  // modelTypeFilter === 'sdxl'.
  const [selectedRatio, setSelectedRatio] = useState<SdxlRatio>('1:1');
  const [selectedOrientation, setSelectedOrientation] = useState<SdxlOrientation>('square');
  const [selectedSize, setSelectedSize] = useState<SdxlSize>('M');
  // SD1.5 picker state — parallel structure to the SDXL trio above but on a
  // smaller preset set. Size is only meaningful for 1:1; non-square SD1.5
  // ratios always resolve to their M spec regardless of `selectedSd15Size`.
  const [selectedSd15Ratio, setSelectedSd15Ratio] = useState<Sd15Ratio>('1:1');
  const [selectedSd15Orientation, setSelectedSd15Orientation] = useState<SdxlOrientation>('square');
  const [selectedSd15Size, setSelectedSd15Size] = useState<SdxlSize>('S');
  // SDXL batch dialog: three multi-select axes whose cross product forms BatchJob[].
  const [selectedBatchRatios, setSelectedBatchRatios] = useState<Set<SdxlRatio>>(new Set(SDXL_PRESETS.map(p => p.ratio)));
  // 'square' is implicit for 1:1 ratio and never appears in the UI toggle here;
  // the batch dialog only exposes landscape/portrait as user-toggleable orientations.
  const [selectedBatchOrientations, setSelectedBatchOrientations] = useState<Set<'landscape' | 'portrait'>>(new Set(['landscape', 'portrait']));
  const [selectedBatchSizes, setSelectedBatchSizes] = useState<Set<SdxlSize>>(new Set(SDXL_SIZES));
  // SD1.5 batch dialog: same 3-axis shape as SDXL's. Size axis only produces
  // extra jobs for 1:1 (non-square ratios collapse to their single M).
  const [selectedSd15BatchRatios, setSelectedSd15BatchRatios] = useState<Set<Sd15Ratio>>(new Set(SD15_PRESETS.map(p => p.ratio)));
  const [selectedSd15BatchOrientations, setSelectedSd15BatchOrientations] = useState<Set<'landscape' | 'portrait'>>(new Set(['landscape', 'portrait']));
  const [selectedSd15BatchSizes, setSelectedSd15BatchSizes] = useState<Set<SdxlSize>>(new Set(SDXL_SIZES));
  // Models picked for model-cycling batch. Reset to "all selected" each time the
  // modal opens (via openBatchModal) so the default is always the full available
  // list — the user opts OUT of specific models for that one batch.
  const [selectedBatchModels, setSelectedBatchModels] = useState<Set<string>>(new Set());

  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels.filter((m) => m.type === modelTypeFilter).map((m) => m.title)));
    setShowBatchModal(true);
  };
  const toggleBatchModel = (m: string) => {
    setSelectedBatchModels((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  // Talk to the API on the SAME hostname the page was loaded from, not a hardcoded
  // 127.0.0.1. Under WSL2, Windows->WSL forwarding can work for `localhost` but NOT for
  // `127.0.0.1`, so a hardcoded 127.0.0.1 makes every API call (health, history, generate)
  // fail from a Windows browser even though the page itself loaded fine.
  const API_BASE = `http://${window.location.hostname}:5000/api`;

  useEffect(() => {
    fetchHealth();
    fetchSdModels();
    fetchSdSamplers();
    fetchSdSchedulers();
    fetchSdLoras();
    fetchSdUpscalers();
    fetchSdVaes();
    // Re-check upstream connectivity every 20s so the badges stay fresh.
    const healthInterval = setInterval(fetchHealth, 20000);
    return () => clearInterval(healthInterval);
  }, []);

  // Subscribe to Firebase auth state (no-op when Firebase is unconfigured).
  useEffect(() => {
    return onAuth(setUser);
  }, []);

  // (Re)load the SD model list whenever Stable Diffusion becomes reachable,
  // so the picker populates even if SD started after the page loaded.
  useEffect(() => {
    if (health?.stableDiffusion.connected) {
      fetchSdModels();
      fetchSdSamplers();
      fetchSdSchedulers();
      fetchSdLoras();
      fetchSdUpscalers();
      fetchSdVaes();
    }
  }, [health?.stableDiffusion.connected]);

  // Re-validate everything that depends on the active architecture whenever the
  // toggle flips. sdModels is intentionally not a dependency here — this should
  // only run on an explicit toggle flip, not every time the model list happens
  // to refresh with the same toggle value still selected. width/height are read
  // via closure at the moment of the flip; they must not be dependencies or the
  // effect would fire on every dimension change and clobber the picker state.
  useEffect(() => {
    setSelectedModel((prev) => (sdModels.some((m) => m.type === modelTypeFilter && m.title === prev) ? prev : (sdModels.find((m) => m.type === modelTypeFilter)?.title ?? '')));

    if (modelTypeFilter === 'sdxl') {
      // Seed the SDXL picker from the current width/height if they map to a preset;
      // otherwise fall back to 1:1 M (1024×1024 — SDXL's central training bucket).
      const found = findSdxlSelection(width, height);
      if (found) {
        setSelectedRatio(found.ratio);
        setSelectedOrientation(found.orientation);
        setSelectedSize(found.size);
      } else {
        setSelectedRatio('1:1');
        setSelectedOrientation('square');
        setSelectedSize('M');
        setWidth(1024);
        setHeight(1024);
      }
      return;
    }

    // SD1.5 branch: seed the SD1.5 picker from the current width/height if they
    // map to a preset; otherwise fall back to 1:1 S (512×512, SD1.5's native).
    const foundSd15 = findSd15Selection(width, height);
    if (foundSd15) {
      setSelectedSd15Ratio(foundSd15.ratio);
      setSelectedSd15Orientation(foundSd15.orientation);
      setSelectedSd15Size(foundSd15.size);
    } else {
      setSelectedSd15Ratio('1:1');
      setSelectedSd15Orientation('square');
      setSelectedSd15Size('S');
      setWidth(512);
      setHeight(512);
    }
    // Refiner/VAE are SDXL-only concepts; clear them so a subsequent SD1.5
    // generation doesn't carry a stale SDXL refiner pick.
    setSelectedRefiner('');
    setSelectedVae('');
  }, [modelTypeFilter]);

  // SDXL picker → width/height projection. Whenever the ratio/orientation/size
  // selection changes (while SDXL is active), recompute the concrete pixel
  // dimensions that flow into the generation request.
  useEffect(() => {
    if (modelTypeFilter !== 'sdxl') return;
    const preset = SDXL_PRESETS.find(p => p.ratio === selectedRatio);
    if (!preset) return;
    const dims = resolveSdxlDimensions(preset, selectedOrientation, selectedSize);
    setWidth(dims.width);
    setHeight(dims.height);
  }, [modelTypeFilter, selectedRatio, selectedOrientation, selectedSize]);

  // SD1.5 picker → width/height projection. Same pattern as the SDXL effect above.
  useEffect(() => {
    if (modelTypeFilter !== 'sd15') return;
    const preset = SD15_PRESETS.find(p => p.ratio === selectedSd15Ratio);
    if (!preset) return;
    const dims = resolveSd15Dimensions(preset, selectedSd15Orientation, selectedSd15Size);
    setWidth(dims.width);
    setHeight(dims.height);
  }, [modelTypeFilter, selectedSd15Ratio, selectedSd15Orientation, selectedSd15Size]);

  // Handler for the SDXL ratio chip. Clicking 1:1 forces orientation to 'square';
  // clicking any other ratio from a square state defaults orientation to
  // 'landscape' so there's always a valid pair.
  const handleRatioChange = (ratio: SdxlRatio) => {
    setSelectedRatio(ratio);
    const preset = SDXL_PRESETS.find(p => p.ratio === ratio);
    if (preset?.isSquare) {
      setSelectedOrientation('square');
    } else if (selectedOrientation === 'square') {
      setSelectedOrientation('landscape');
    }
  };

  // Same handler shape for the SD1.5 picker.
  const handleSd15RatioChange = (ratio: Sd15Ratio) => {
    setSelectedSd15Ratio(ratio);
    const preset = SD15_PRESETS.find(p => p.ratio === ratio);
    if (preset?.isSquare) {
      setSelectedSd15Orientation('square');
    } else if (selectedSd15Orientation === 'square') {
      setSelectedSd15Orientation('landscape');
    }
  };

  // Lightbox keyboard control: Escape closes (unless in OS fullscreen — let the
  // browser exit fullscreen first); ArrowLeft/Right step through the gallery order;
  // Space toggles selection on the currently-shown gallery item.
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!document.fullscreenElement) closeLightbox();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateLightbox(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateLightbox(1);
      } else if (e.key === ' ' || e.code === 'Space') {
        // Space would otherwise scroll the page underneath the lightbox; suppress it.
        if (lightboxIndex >= 0) {
          e.preventDefault();
          toggleSelected(itemKey(displayedHistory[lightboxIndex]));
        }
      } else if (e.key === 'f' || e.key === 'F') {
        if (lightboxIndex >= 0) {
          e.preventDefault();
          toggleFavorite(displayedHistory[lightboxIndex]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl, morphSourceKey, displayedHistory, lightboxIndex]);

  // Track OS fullscreen state to swap the toggle icon.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/history`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setHistory(data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  };

  // History source follows auth: live Firestore subscription when signed in,
  // local REST fetch when signed out. The Firestore subscription branches on
  // `favoritesOnly`: when ON, `subscribeFavorites` runs a composite query
  // (where isFavorite==true + orderBy timestamp) and ignores `filterDate`;
  // when OFF, `subscribeGenerations` is scoped to the single local day from
  // `filterDate` so every image from that day comes back (no count cap).
  // Flipping either dep tears down the old subscription and opens a new one.
  useEffect(() => {
    if (user) {
      setHistory([]);
      const unsub = favoritesOnly
        ? subscribeFavorites(
            user.uid,
            (records) => setHistory(records as unknown as GenerationData[]),
            (err) => {
              const e = err as unknown as { code?: string; message?: string };
              const detail = [e.code, e.message].filter(Boolean).join(' / ') || String(err);
              addToast(
                `お気に入りの取得に失敗しました（Firestore のインデックス (isFavorite + timestamp) がデプロイされているか確認してください）: ${detail}`,
                'error',
              );
            },
          )
        : subscribeGenerations(
            user.uid,
            filterDate || null,
            (records) => setHistory(records as unknown as GenerationData[]),
            (err) => {
              const e = err as unknown as { code?: string; message?: string };
              const detail = [e.code, e.message].filter(Boolean).join(' / ') || String(err);
              addToast(`履歴の取得に失敗しました（Firestore のセキュリティルールがデプロイ済みか確認してください）: ${detail}`, 'error');
            },
          );
      return unsub;
    }
    fetchHistory();
    return undefined;
  }, [user, filterDate, favoritesOnly]);

  // Check LM Studio / Stable Diffusion connectivity. Guarded so overlapping
  // polls (or a poll racing a manual refresh) never run concurrently.
  const fetchHealth = async () => {
    if (healthInFlight.current) return;
    healthInFlight.current = true;
    setHealthChecking(true);
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch (error) {
      console.error('Failed to fetch connection health:', error);
    } finally {
      healthInFlight.current = false;
      setHealthChecking(false);
    }
  };

  // Fetch the Stable Diffusion checkpoint list. Defaults the selection to SD's
  // active model the first time, but preserves an explicit user choice afterwards.
  const fetchSdModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-models`);
      if (res.ok) {
        const data = await res.json();
        const models: SdModel[] = Array.isArray(data.models) ? data.models : [];
        setSdModels(models);
        setSelectedModel((prev) => prev || data.current || '');
        if (!modelTypeInitialized.current && data.current) {
          const currentType = models.find((m) => m.title === data.current)?.type;
          if (currentType) {
            setModelTypeFilter(currentType);
            modelTypeInitialized.current = true;
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch SD models:', error);
    }
  };

  const fetchSdSamplers = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-samplers`);
      if (res.ok) {
        const data = await res.json();
        const samplers: string[] = Array.isArray(data.samplers) ? data.samplers : [];
        setSdSamplers(samplers);
        setSelectedSampler((prev) => prev || 'Euler a');
      }
    } catch (error) {
      console.error('Failed to fetch SD samplers:', error);
    }
  };

  // Fetch SD's noise-schedule list. Older SD builds return [] (404 swallowed
  // server-side) — the UI hides the picker in that case.
  const fetchSdSchedulers = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-schedulers`);
      if (res.ok) {
        const data = await res.json();
        const schedulers: string[] = Array.isArray(data.schedulers) ? data.schedulers : [];
        setSdSchedulers(schedulers);
        // Default to the SD-standard "Automatic" label so the SD picks its own
        // scheduler unless the user explicitly overrides.
        setSelectedScheduler((prev) => prev || (schedulers.includes('Automatic') ? 'Automatic' : ''));
      }
    } catch (error) {
      console.error('Failed to fetch SD schedulers:', error);
    }
  };

  const fetchSdLoras = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-loras`);
      if (res.ok) {
        const data = await res.json();
        setSdLoras(Array.isArray(data.loras) ? data.loras : []);
      }
    } catch (error) {
      console.error('Failed to fetch SD LoRAs:', error);
    }
  };

  // Fetch SD's combined upscaler list (GAN upscalers + latent upscale modes) for
  // the Hires.fix picker. No "current" concept (like samplers) — stays empty
  // until the user picks one; SD falls back to its own default upscaler.
  const fetchSdUpscalers = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-upscalers`);
      if (res.ok) {
        const data = await res.json();
        setSdUpscalers(Array.isArray(data.upscalers) ? data.upscalers : []);
      }
    } catch (error) {
      console.error('Failed to fetch SD upscalers:', error);
    }
  };

  // Fetch SD's external VAE list (for the SDXL VAE picker). Empty until SD is
  // reachable; the picker itself always includes an "Automatic" sentinel option
  // so the user can opt out even before the list arrives.
  const fetchSdVaes = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-vaes`);
      if (res.ok) {
        const data = await res.json();
        setSdVaes(Array.isArray(data.vaes) ? data.vaes : []);
      }
    } catch (error) {
      console.error('Failed to fetch SD VAEs:', error);
    }
  };

  // LoRA stack helpers (default weight 0.8; applied as <lora:name:weight> at generation).
  const addLora = (name: string) => {
    if (!name) return;
    setSelectedLoras((prev) => (prev.some((l) => l.name === name) ? prev : [...prev, { name, weight: 0.8 }]));
  };
  const removeLora = (name: string) => setSelectedLoras((prev) => prev.filter((l) => l.name !== name));
  const setLoraWeight = (name: string, weight: number) =>
    setSelectedLoras((prev) => prev.map((l) => (l.name === name ? { ...l, weight } : l)));

  // Populate the left-panel form fields from a history item so the user can
  // tweak and regenerate. If the item carries a seed, lock the seed field to
  // that value so the same image can be reproduced; otherwise unlock it.
  //
  // The picker/dimension part of the transition is computed by the pure helper
  // in loadIntoFormState.ts (which has full unit-test coverage). This function
  // only wires the resulting state into the React setState calls.
  const loadIntoForm = (item: GenerationData) => {
    setPrompt(item.originalPrompt);
    const s = computeLoadIntoFormState(item, sdModels);
    // Flip the SD/SDXL toggle to match the loaded image's architecture BEFORE
    // setting width/height/model, so the modelTypeFilter useEffect resolves the
    // picker (ratio/orientation/size) from the loaded dimensions rather than
    // defaulting when the toggle stays on the wrong architecture.
    if (s.archToSet) setModelTypeFilter(s.archToSet);
    setWidth(s.width);
    setHeight(s.height);
    // Also sync the picker chips directly. The modelTypeFilter useEffect does
    // this when the architecture toggle actually flips, but same-architecture
    // reloads (e.g. clicking load on another SDXL image while already on SDXL)
    // don't retrigger that effect — the chips would stay on the previous
    // selection without this explicit sync.
    if (s.sdxlPicker) {
      setSelectedRatio(s.sdxlPicker.ratio);
      setSelectedOrientation(s.sdxlPicker.orientation);
      setSelectedSize(s.sdxlPicker.size);
    }
    if (s.sd15Picker) {
      setSelectedSd15Ratio(s.sd15Picker.ratio);
      setSelectedSd15Orientation(s.sd15Picker.orientation);
      setSelectedSd15Size(s.sd15Picker.size);
    }
    setSteps(item.steps);
    setCfgScale(item.cfgScale);
    setSelectedModel(item.model || '');
    setSelectedSampler(item.sampler || '');
    setSelectedScheduler(item.scheduler || '');
    setSelectedLoras(item.loras || []);
    setHiresFixEnabled(!!item.enableHr);
    setSelectedUpscaler(item.hrUpscaler || '');
    setHiresScale(item.hrScale ?? 2);
    setHiresSteps(item.hrSecondPassSteps ?? 0);
    setHiresDenoising(item.denoisingStrength ?? 0.7);
    setSelectedRefiner(item.refiner || '');
    setRefinerSwitchAt(item.refinerSwitchAt ?? 0.8);
    setSelectedVae(item.vae || '');
    // Copy the seed value (if present) so it's ready in the input field, but
    // leave the "Seedを固定する" checkbox unchecked — reloading a past image
    // usually means "regenerate with a fresh seed", so applying the old seed
    // by default would surprise users. They can flip the checkbox on if they
    // actually want to reproduce the exact same image.
    if (item.seed !== undefined) {
      setSeedValue(item.seed);
    }
    setSeedLocked(false);
    addToast('設定をフォームに読み込みました 📥', 'success');
  };

  // Recall a history image into the Preview tab, treating it as if it was just
  // generated: same success-state transition as handleGenerate's success branch,
  // minus the toast. Ignored while a generation is in progress so the live
  // preview/progress isn't clobbered.
  const openInPreview = (item: GenerationData) => {
    if (genStatus === 'enhancing' || genStatus === 'generating' || genStatus === 'saving') return;
    setCurrentGeneration(item);
    setGenStatus('success');
    setLoadingStep(3);
    setRightTab('preview');
  };

  // Raw result of POST /api/generate, before client-side persistence.
  // Signed in → server returns { success, image(base64), params }.
  // Signed out → server already saved locally and returns { success, data }.
  // cancelled → the user interrupted the generation; no image/data is present.
  type GenResult = {
    success: boolean;
    cancelled?: boolean;
    image?: string;
    params?: GenerationParams;
    data?: GenerationData;
  };

  // Thrown by the client generateImage() helper when the server reports the
  // generation was cancelled, so callers can distinguish it from a real failure.
  class GenerationCancelledError extends Error {}

  // Step 1: enhance a prompt via LM Studio. Throws on HTTP failure.
  const enhanceOnce = async (promptText: string): Promise<{ positive: string; negative: string }> => {
    const enhanceRes = await fetch(`${API_BASE}/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });
    if (!enhanceRes.ok) {
      const errData = await enhanceRes.json();
      throw new Error(errData.error || 'Failed to enhance prompt');
    }
    const enhanceResult = await enhanceRes.json();
    return { positive: enhanceResult.positive, negative: enhanceResult.negative };
  };

  // Step 2: request ONE image from Stable Diffusion at the given size. Throws on HTTP failure.
  const generateImage = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number,
    modelOverride?: string
  ): Promise<GenResult> => {
    const genRes = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: positive,
        negativePrompt: negative,
        originalPrompt,
        width,
        height,
        steps,
        cfgScale,
        // Per-job model (model-cycling batch) wins over the form's selectedModel.
        model: (modelOverride ?? selectedModel) || undefined, // Override SD checkpoint when one is selected
        skipEnhance: true, // Skip enhancement since we already did it!
        seed,
        sampler: selectedSampler || undefined,
        scheduler: selectedScheduler || undefined,
        loras: selectedLoras,
        enableHr: hiresFixEnabled,
        ...(hiresFixEnabled ? {
          hrUpscaler: selectedUpscaler || undefined,
          hrScale: hiresScale,
          hrSecondPassSteps: hiresSteps || undefined,
          denoisingStrength: hiresDenoising,
        } : {}),
        // SDXL-only extras — only forwarded when the toggle is on SDXL, so
        // flipping back to SD1.5 doesn't accidentally leak refiner/vae picks.
        ...(modelTypeFilter === 'sdxl' && selectedRefiner ? {
          refiner: selectedRefiner,
          refinerSwitchAt,
        } : {}),
        ...(modelTypeFilter === 'sdxl' && selectedVae ? { vae: selectedVae } : {}),
        clientPersist: !!user
      })
    });
    if (!genRes.ok) {
      const errData = await genRes.json();
      throw new Error(errData.error || 'Failed to generate image');
    }
    const result: GenResult = await genRes.json();
    if (result.cancelled) throw new GenerationCancelledError('Generation was cancelled');
    return result;
  };

  // Step 3: persist a generated image. Signed in → upload to Firebase; signed
  // out → the server already saved it, so just return its metadata.
  // Throws on cloud-save failure (caller decides recovery).
  const persistResult = async (result: GenResult): Promise<GenerationData> => {
    if (user && result.image && result.params) {
      return await saveGeneration(user.uid, result.image, result.params) as unknown as GenerationData;
    }
    return result.data as GenerationData;
  };

  // Convenience for batch: generate one image at the given size and persist it. Throws on any failure.
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number,
    modelOverride?: string
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed, width, height, modelOverride);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };

  // Tell the server to interrupt the current SD job, if any. The original
  // /api/generate request (still pending) resolves on its own once SD stops —
  // no AbortController is used here.
  const requestCancel = async () => {
    // Set the batch-level flag first so a cancel during the inter-iteration
    // gap (SD idle, client mid-persist) is still caught by handleBatchGenerate's
    // per-iteration check even if the server-side flag is later cleared by the
    // next /api/generate's defensive reset.
    batchCancelledRef.current = true;
    setCancelling(true);
    try {
      await fetch(`${API_BASE}/generate/interrupt`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to send cancel request:', error);
      addToast('生成の停止要求の送信に失敗しました。', 'error');
      setCancelling(false);
    }
  };

  // Formats a duration in seconds as "12秒" or, past a minute, "1分5秒" —
  // Hires.fix generations can run several minutes.
  const formatDuration = (totalSeconds: number): string => {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}分${rem}秒`;
  };

  // Wraps a single SD call with a live elapsed-time timer (client-side, no
  // network) and remaining-time/progress polling (GET /api/sd-progress,
  // which proxies SD's own progress estimate). Used by both single and batch
  // generation so each batch job gets its own reset elapsed/progress display.
  const runWithProgressTracking = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const startTime = Date.now();
    setElapsedSeconds(0);
    setSdProgress(null);

    const elapsedTimer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    const pollProgress = async () => {
      try {
        const res = await fetch(`${API_BASE}/sd-progress`);
        if (res.ok) {
          const data = await res.json();
          setSdProgress({
            progress: typeof data.progress === 'number' ? data.progress : 0,
            etaRelative: typeof data.etaRelative === 'number' ? data.etaRelative : 0,
          });
        }
      } catch {
        // best-effort — keep showing the last known progress rather than clearing it
      }
    };
    pollProgress(); // fire immediately so the first update doesn't wait a full interval
    const progressTimer = setInterval(pollProgress, 1500);

    try {
      return await fn();
    } finally {
      clearInterval(elapsedTimer);
      clearInterval(progressTimer);
      setElapsedSeconds(0);
      setSdProgress(null);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    // Backup current generation to restore on error
    const prevGen = currentGeneration;

    setLoading(true);
    setErrorStep(null);
    setRightTab('preview'); // Surface progress/result even if the gallery tab was open
    setGenStatus('enhancing');
    setCurrentGeneration(null); // Clear preview on start
    setLoadingStep(1); // Start Step 1: Prompt Enhancement

    let currentStep = 1;

    try {
      // --- Step 1: Enhance prompt via LM Studio ---
      const { positive, negative } = await enhanceOnce(prompt);

      // --- Transition to Step 2: Image Generation ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      const result = await runWithProgressTracking(() =>
        generateImage(positive, negative, prompt, seedLocked ? seedValue : -1, width, height)
      );

      if (result.success) {
        // --- Transition to Step 3: Saving ---
        currentStep = 3;
        setLoadingStep(3);
        setGenStatus('saving');

        let saved: GenerationData;
        try {
          saved = await persistResult(result);
        } catch (saveErr: any) {
          // Cloud save failed, but the image is already generated and in hand —
          // keep it displayed (per the design spec's error handling) rather than discarding it.
          const ts = Date.now();
          setCurrentGeneration({
            ...result.params,
            id: `unsaved_${ts}`,
            imageUrl: `data:image/png;base64,${result.image}`,
            backendMode: 'local',
            timestamp: ts,
            createdAt: new Date(ts).toISOString(),
          } as GenerationData);
          setGenStatus('success');
          addToast(`クラウド保存に失敗しました（画像は表示中）。\n\n詳細: ${saveErr.message}`, 'error');
          return;
        }

        setCurrentGeneration(saved);
        setGenStatus('success');
        if (!user) fetchHistory(); // signed-in history updates via onSnapshot (Task 5)
        addToast('画像を生成しました！🎨⚡️', 'success');
      }
    } catch (error: any) {
      if (error instanceof GenerationCancelledError) {
        // Restore previous generation and return to idle — this is a deliberate
        // user action, not an error, so no error panel is shown.
        setCurrentGeneration(prevGen);
        setGenStatus('idle');
        addToast('画像生成を止めました🛑', 'success');
        return;
      }

      console.error(error);

      // Restore previous generation to keep it visible on error
      setCurrentGeneration(prevGen);

      // Use currentStep to freeze on the correct failed step
      setErrorStep(currentStep);
      setGenStatus('error');

      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
      setCancelling(false);
    }
  };

  // Batch: enhance once, then generate one image per job, sequentially (one SD
  // call each — NOT SD's Batch Count). Each job carries its own width/height (and an
  // optional model), so count mode (N copies at the form size), size mode (width×height
  // cross product), and model mode (one image per available checkpoint) all share this
  // loop. A failed image is counted and skipped; the loop continues. The last completed
  // image stays in the preview.
  const handleBatchGenerate = async (jobs: BatchJob[]) => {
    if (!prompt.trim() || loading || jobs.length === 0) return;

    batchCancelledRef.current = false; // fresh batch — clear any stale cancel from a previous run
    setLoading(true);
    setErrorStep(null);
    setRightTab('preview');
    setGenStatus('enhancing');
    setCurrentGeneration(null);
    setLoadingStep(1);

    let currentStep = 1;

    try {
      // --- Step 1: enhance ONCE, reuse for every image ---
      const { positive, negative } = await enhanceOnce(prompt);

      // --- Step 2: generate sequentially, one image at a time ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      let succeeded = 0;
      let failed = 0;
      let cancelledInLoop = false;

      for (let i = 0; i < jobs.length; i++) {
        // Check the batch-level flag before starting each job so a cancel that
        // arrived during the inter-iteration gap (SD idle, Firebase persist in
        // flight) still stops the batch — the server's per-request defensive
        // reset would otherwise swallow that signal.
        if (batchCancelledRef.current) {
          cancelledInLoop = true;
          break;
        }
        const job = jobs[i];
        setBatchProgress({ current: i + 1, total: jobs.length });
        const seed = seedLocked ? seedValue : -1;
        try {
          const saved = await runWithProgressTracking(() =>
            generateAndPersist(positive, negative, prompt, seed, job.width, job.height, job.model)
          );
          succeeded++;
          setCurrentGeneration(saved); // live preview update
        } catch (genErr) {
          if (genErr instanceof GenerationCancelledError) {
            cancelledInLoop = true;
            break; // stop the batch entirely — don't run remaining jobs
          }
          failed++;
          console.error(genErr);
        }
      }

      if (!user) fetchHistory(); // signed-in history updates via onSnapshot

      if (cancelledInLoop) {
        setGenStatus(succeeded > 0 ? 'success' : 'idle');
        addToast(`${succeeded}枚生成した時点で止めました🛑`, 'success');
      } else if (succeeded === 0) {
        setErrorStep(2);
        setGenStatus('error');
        addToast(`${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
      } else {
        setGenStatus('success');
        if (failed === 0) {
          addToast(`${succeeded}枚の画像を生成しました！🎨⚡️`, 'success');
        } else {
          addToast(`${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
        }
      }
    } catch (error: any) {
      // enhanceOnce failed before the loop → abort like single generation.
      console.error(error);
      setErrorStep(currentStep);
      setGenStatus('error');
      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
      setBatchProgress(null);
      setCancelling(false);
    }
  };


  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppHeader
        user={user}
        cloudActive={cloudActive}
        health={health}
        healthChecking={healthChecking}
        onSignInError={(msg) => addToast(msg, 'error')}
      />

      {/* MAIN CONTAINER */}
      <main style={{ 
        flex: 1, 
        display: 'grid', 
        gridTemplateColumns: 'minmax(360px, 450px) 1fr', 
        gap: '24px', 
        padding: '0 20px 20px 20px',
        overflow: 'hidden',
        minHeight: 0
      }}>
        <ControlPanel
          prompt={prompt}
          setPrompt={setPrompt}
          loading={loading}
          modelTypeFilter={modelTypeFilter}
          setModelTypeFilter={setModelTypeFilter}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          sdModels={sdModels}
          selectedSampler={selectedSampler}
          setSelectedSampler={setSelectedSampler}
          sdSamplers={sdSamplers}
          selectedScheduler={selectedScheduler}
          setSelectedScheduler={setSelectedScheduler}
          sdSchedulers={sdSchedulers}
          selectedRatio={selectedRatio}
          handleRatioChange={handleRatioChange}
          selectedOrientation={selectedOrientation}
          setSelectedOrientation={setSelectedOrientation}
          selectedSize={selectedSize}
          setSelectedSize={setSelectedSize}
          selectedSd15Ratio={selectedSd15Ratio}
          handleSd15RatioChange={handleSd15RatioChange}
          selectedSd15Orientation={selectedSd15Orientation}
          setSelectedSd15Orientation={setSelectedSd15Orientation}
          selectedSd15Size={selectedSd15Size}
          setSelectedSd15Size={setSelectedSd15Size}
          width={width}
          height={height}
          steps={steps}
          setSteps={setSteps}
          cfgScale={cfgScale}
          setCfgScale={setCfgScale}
          hiresFixEnabled={hiresFixEnabled}
          setHiresFixEnabled={setHiresFixEnabled}
          selectedUpscaler={selectedUpscaler}
          setSelectedUpscaler={setSelectedUpscaler}
          sdUpscalers={sdUpscalers}
          hiresScale={hiresScale}
          setHiresScale={setHiresScale}
          hiresSteps={hiresSteps}
          setHiresSteps={setHiresSteps}
          hiresDenoising={hiresDenoising}
          setHiresDenoising={setHiresDenoising}
          sdLoras={sdLoras}
          selectedLoras={selectedLoras}
          addLora={addLora}
          removeLora={removeLora}
          setLoraWeight={setLoraWeight}
          selectedRefiner={selectedRefiner}
          setSelectedRefiner={setSelectedRefiner}
          refinerSwitchAt={refinerSwitchAt}
          setRefinerSwitchAt={setRefinerSwitchAt}
          selectedVae={selectedVae}
          setSelectedVae={setSelectedVae}
          sdVaes={sdVaes}
          seedLocked={seedLocked}
          setSeedLocked={setSeedLocked}
          seedValue={seedValue}
          setSeedValue={setSeedValue}
          onGenerate={handleGenerate}
          onOpenBatchModal={openBatchModal}
        />

        {/* RIGHT COLUMN: PREVIEW & HISTORY GRID (tabbed) */}
        <section style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden'
        }}>
          {/* TAB BAR */}
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginBottom: '16px', background: 'var(--panel-bg-sunk)', padding: '6px', borderRadius: '14px' }}>
            {([['preview', '🎨 プレビュー＆進捗'], ['gallery', `🖼️ 履歴ギャラリー (${history.length})`]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRightTab(key)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 800,
                  background: rightTab === key ? 'var(--panel-bg)' : 'transparent',
                  color: rightTab === key ? 'var(--pop-blue)' : 'var(--text-secondary)',
                  boxShadow: rightTab === key ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {label}
                {key === 'preview' && <GenerationBadge genStatus={genStatus} batchProgress={batchProgress} />}
              </button>
            ))}
          </div>

          {/* TAB CONTENT (scrollable). Symmetric horizontal padding gives the
              gallery's leftmost/rightmost tiles room to expand under their
              `.scale-hover:hover { transform: scale(1.02) }` effect without
              the outer container's implicit overflow-x clip cutting off the
              border. (overflowY: auto forces overflow-x to behave as auto too,
              so hover expansion needs breathing room here.) */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingLeft: '4px', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {rightTab === 'preview' && (
            <PreviewPanel
              currentGeneration={currentGeneration}
              morphSourceKey={morphSourceKey}
              lightboxUrl={lightboxUrl}
              genStatus={genStatus}
              loadingStep={loadingStep}
              errorStep={errorStep}
              sdProgress={sdProgress}
              elapsedSeconds={elapsedSeconds}
              batchProgress={batchProgress}
              cancelling={cancelling}
              formatDuration={formatDuration}
              onOpenLightbox={openLightbox}
              onToggleFavorite={toggleFavorite}
              onLoadIntoForm={loadIntoForm}
              onRequestDelete={requestDelete}
              itemKey={itemKey}
              onCancel={requestCancel}
            />
          )}

          {rightTab === 'gallery' && (
            <HistoryGallery
              historyLength={history.length}
              displayedHistory={displayedHistory}
              filterDate={filterDate}
              onSetFilterDate={setFilterDate}
              favoritesOnly={favoritesOnly}
              onSetFavoritesOnly={setFavoritesOnly}
              selectedIds={selectedIds}
              onSetSelectedIds={setSelectedIds}
              itemKey={itemKey}
              onToggleSelected={toggleSelected}
              onToggleFavorite={toggleFavorite}
              onRequestDelete={requestDelete}
              onOpenLightbox={openLightbox}
              onOpenInPreview={openInPreview}
              morphSourceKey={morphSourceKey}
              lightboxUrl={lightboxUrl}
            />
          )}
          </div>
        </section>
      </main>

      {/* LIGHTBOX: enlarged image */}
      <Lightbox
        url={lightboxUrl}
        containerRef={lightboxRef}
        meta={lightboxMeta}
        showInfo={showLightboxInfo}
        onToggleInfo={() => setShowLightboxInfo((v) => !v)}
        lightboxIndex={lightboxIndex}
        displayedHistory={displayedHistory}
        isItemSelected={(idx) => selectedIds.has(itemKey(displayedHistory[idx]))}
        onToggleSelect={(idx) => toggleSelected(itemKey(displayedHistory[idx]))}
        onToggleFavorite={(idx) => toggleFavorite(displayedHistory[idx])}
        onNavigate={navigateLightbox}
        onClose={closeLightbox}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      <DeleteConfirmModal
        open={showDeleteConfirm}
        targetCount={deleteTargetIds.length}
        deleting={deleting}
        exiting={confirmExiting}
        onCancel={closeConfirm}
        onConfirm={handleDeleteSelected}
      />

      <BatchGenerationModal
        open={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        modelTypeFilter={modelTypeFilter}
        sdModels={sdModels}
        width={width}
        height={height}
        batchMode={batchMode}
        setBatchMode={setBatchMode}
        batchCount={batchCount}
        setBatchCount={setBatchCount}
        selectedBatchRatios={selectedBatchRatios}
        setSelectedBatchRatios={setSelectedBatchRatios}
        selectedBatchOrientations={selectedBatchOrientations}
        setSelectedBatchOrientations={setSelectedBatchOrientations}
        selectedBatchSizes={selectedBatchSizes}
        setSelectedBatchSizes={setSelectedBatchSizes}
        selectedSd15BatchRatios={selectedSd15BatchRatios}
        setSelectedSd15BatchRatios={setSelectedSd15BatchRatios}
        selectedSd15BatchOrientations={selectedSd15BatchOrientations}
        setSelectedSd15BatchOrientations={setSelectedSd15BatchOrientations}
        selectedSd15BatchSizes={selectedSd15BatchSizes}
        setSelectedSd15BatchSizes={setSelectedSd15BatchSizes}
        selectedBatchModels={selectedBatchModels}
        setSelectedBatchModels={setSelectedBatchModels}
        toggleBatchModel={toggleBatchModel}
        onStartBatch={(jobs) => {
          // Give the user an immediate, unmistakable acknowledgement that
          // their click registered — enhanceOnce()'s LM Studio round trip
          // that handleBatchGenerate kicks off next can take several
          // seconds with no other visible feedback, which otherwise reads
          // as the screen having frozen.
          addToast('バッチ生成を開始しました⚡️', 'success');
          setShowBatchModal(false);
          handleBatchGenerate(jobs);
        }}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* SVG Gradient helper for icons */}
      <svg style={{ width: 0, height: 0, position: 'absolute' }}>
        <linearGradient id="cyan-purple-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--pop-blue)" />
          <stop offset="100%" stopColor="var(--pop-teal)" />
        </linearGradient>
      </svg>
    </div>
  );
}

export default App;
