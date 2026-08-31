import { useState, useEffect, useRef, useMemo } from 'react';
import { isFirebaseConfigured, onAuth, saveGeneration, saveVideoGeneration, subscribeGenerations, subscribeFavorites, subscribeVideoParentIndex, updateFavorite, deleteGenerations, subscribeRankingRollups, fetchGenerationById, type AuthUser, type GenerationRecord, type GenerationParams, type LtxParams } from './firebase';
import { collectVideoParentCounts } from './utils/videoParentIndex';
import { resolveVideoSeed } from './utils/videoSeed';
import { createInitialVideoProgress, estimateComfyFractionByTime, loadLastComfyDurationSeconds, saveLastComfyDurationSeconds, DEFAULT_EXPECTED_COMFY_SECONDS, type VideoProgressState } from './utils/videoProgress';
import type { RankingRollup, RankedRecipe } from './utils/rankingAnalysis';
import { ToastContainer, type Toast } from './components/ToastContainer';
import { AppHeader, type HealthStatus } from './components/AppHeader';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { Lightbox } from './components/Lightbox';
import { BatchGenerationModal, type BatchJob } from './components/BatchGenerationModal';
import { VideoBatchGenerationModal } from './components/VideoBatchGenerationModal';
import { PreviewPanel } from './components/PreviewPanel';
import { HistoryGallery } from './components/HistoryGallery';
import { ControlPanel } from './components/ControlPanel';
import { GenerationBadge } from './components/GenerationBadge';
import { applyGalleryFilters, computeAspectRatio, deriveFilterOptions, type GalleryFilters } from './components/galleryFilters';
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
  type Architecture,
} from './components/presets';
import { computeLoadIntoFormState, inferSdArchitectureFromTitle, resolveSelectedModel } from './components/loadIntoFormState';
import { resolveLightboxKey } from './components/lightboxKeyboard';
import { nextSlideshowIndex } from './components/slideshowStep';
import { formatDownloadFilename, downloadImage } from './utils/download';
import { flushSync } from 'react-dom';
import {
  getNotificationSupport,
  requestNotificationPermission,
  loadNotificationPreference,
  saveNotificationPreference,
  sendNotification,
} from './utils/notifications';
import { t } from './i18n';

// View Transitions API (Baseline 2025-10); typed locally so it works regardless of lib.dom version.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void>; ready: Promise<void> };
};

// Slideshow tick presets. Cycled by right-clicking the Slideshow toggle in the
// lightbox toolbar; the current value drives the setInterval that advances the
// visible image. Kept at module scope so the presets are shared with the
// localStorage validator below and never re-allocated on render.
const SLIDESHOW_INTERVALS_MS = [5000, 10000, 15000, 30000, 60000] as const;

// Fixed prefixes prepended to every video generation's positive/negative
// prompt. They anchor the LTX-Video-2 image-to-video model to the source
// still image (positive) and steer it away from the still-image/text-overlay
// failure modes the model tends toward (negative). The server-side LM Studio
// system prompt (VIDEO_SYSTEM_PROMPT) knows the caller prepends these and
// deliberately omits them from its own output.
const VIDEO_POSITIVE_PREFIX = 'Use the provided start image exactly as the first frame.';
const VIDEO_NEGATIVE_PREFIX = 'still image, watermark, subtitles, text, 3D, VR';
// Whether the ComfyUI job takes width/height from the source image (with Hires
// scale applied, matching handleOpenVideoForm's dimension inheritance) or from
// the numeric inputs on the video form. Persisted so the choice survives page
// reloads.
type VideoDimensionMode = 'inherit' | 'fixed';
const VIDEO_DIMENSION_MODE_STORAGE_KEY = 'sumica.videoDimensionMode';
const DEFAULT_VIDEO_DIMENSION_MODE: VideoDimensionMode = 'inherit';
function loadVideoDimensionMode(): VideoDimensionMode {
  try {
    const raw = localStorage.getItem(VIDEO_DIMENSION_MODE_STORAGE_KEY);
    if (raw === 'inherit' || raw === 'fixed') return raw;
    return DEFAULT_VIDEO_DIMENSION_MODE;
  } catch {
    return DEFAULT_VIDEO_DIMENSION_MODE;
  }
}
const DEFAULT_SLIDESHOW_INTERVAL_MS = 5000;
const SLIDESHOW_INTERVAL_STORAGE_KEY = 'sumica.slideshow.intervalMs';

// Read a previously-saved slideshow interval from localStorage. Falls back to
// the default on any of: missing key, non-numeric value, value not in the
// preset list, or a localStorage that throws (private-mode Safari, disabled
// storage). Runs on initial render only via useState's lazy initializer.
function loadSlideshowIntervalMs(): number {
  try {
    const raw = localStorage.getItem(SLIDESHOW_INTERVAL_STORAGE_KEY);
    if (raw === null) return DEFAULT_SLIDESHOW_INTERVAL_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_SLIDESHOW_INTERVAL_MS;
    return (SLIDESHOW_INTERVALS_MS as readonly number[]).includes(parsed)
      ? parsed
      : DEFAULT_SLIDESHOW_INTERVAL_MS;
  } catch {
    return DEFAULT_SLIDESHOW_INTERVAL_MS;
  }
}

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
  // Ground-truth architecture from the user's toggle at generation time.
  // Absent on legacy records; loadIntoForm falls back to name/title heuristics.
  modelArchitecture?: Architecture;
  mediaType?: 'image' | 'video';
  parentId?: string;
  videoUrl?: string;
  videoStoragePath?: string;
  posterUrl?: string;
  posterStoragePath?: string;
  ltxParams?: LtxParams;
}




function App() {
  // Form input states
  const [prompt, setPrompt] = useState('');
  // Loaded enhanced prompt fields — populated by loadIntoForm when the user
  // clicks "フォームにロード" on a gallery/ranking item, and cleared by the
  // dedicated clear button in ControlPanel. When loadedPositive is truthy,
  // the generate pipeline skips the enhance step entirely and reuses this
  // exact positive/negative pair, letting the user reproduce the same image
  // bit-for-bit (given the same seed + all other params).
  const [loadedPositive, setLoadedPositive] = useState('');
  const [loadedNegative, setLoadedNegative] = useState('');
  const [randomMode, setRandomMode] = useState(false);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  // Slideshow tick interval, cycled between presets by right-clicking the
  // Slideshow toggle in the lightbox toolbar. Lazy-initialized from
  // localStorage so the last-picked pace survives reloads.
  const [slideshowIntervalMs, setSlideshowIntervalMs] = useState<number>(loadSlideshowIntervalMs);
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
  // parentId -> child video count. Feeds the 🎬 badge on image cards in the
  // gallery; must survive the date filter (a child video can live on a
  // different day than its parent), so it's populated from a separate
  // Firestore subscription in Firebase mode and derived from the local
  // history array in signed-out mode.
  const [videoParentCounts, setVideoParentCounts] = useState<Map<string, number>>(new Map());
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
  const [modelTypeFilter, setModelTypeFilter] = useState<Architecture>('sd15');
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
  // Which sub-view the left ControlPanel shows: the normal generation form,
  // or the favorite-recipe ranking list. Owned here (not inside ControlPanel)
  // to keep with the project's "all state lives in App.tsx" convention.
  const [activeControlTab, setActiveControlTab] = useState<'form' | 'ranking'>('form');
  // Favorite-recipe rollup counters (one entry per distinct 8-dim recipe hash).
  // Signed in: live Firestore subscription (see the useEffect near the history
  // subscription below). Signed out: fetched from GET /api/ranking-rollups at
  // mount and re-fetched after any local mutation that can change the counts
  // (save / favorite toggle / delete) — the server updates rankingRollups.json
  // synchronously as part of those requests, so a refetch always sees fresh data.
  const [rollups, setRollups] = useState<RankingRollup[]>([]);

  // Switch the left panel between the generation form and the ranking list.
  // Wrapped in a View Transition (same pattern as the batch modal's own
  // segmented mode tabs) so the panel's height smoothly interpolates instead
  // of jump-cutting when the two views differ in content height.
  const switchControlTab = (next: 'form' | 'ranking') => {
    if (activeControlTab === next) return;
    const apply = () => setActiveControlTab(next);
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (start) start.call(document, apply);
    else apply();
  };
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [galleryFilters, setGalleryFilters] = useState<GalleryFilters>({
    arch: null,
    model: null,
    sampler: null,
    aspectRatio: null,
    orientation: null,
    // Default to the Image tab so a fresh session opens on stills, not videos.
    mediaType: 'image',
    parentId: null,
  });
  // Short-lived flag toggled by `applyRecipeToGalleryFilter` so the stale-clear
  // useEffects below skip their nulling logic for ~600ms after a recipe is
  // pushed into the gallery filter. Prevents the transient case where the
  // freshly-set filter value is briefly absent from filterOptions (e.g., rollup
  // slightly ahead of live favorites) from clearing it before the user sees it.
  const staleClearSuspendedRef = useRef(false);
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
  // Base scope: existing date + favoritesOnly filters. Exposed so HistoryGallery
  // can distinguish "no data for this date" from "no data matches your gallery filters"
  // in the empty-state message.
  const baseScopedHistory = useMemo(() => {
    // Parent-only view overrides every base scope: show every child video of
    // the target image no matter the date or favorites state.
    if (galleryFilters.parentId) return history;
    if (favoritesOnly) return user ? history : history.filter((h) => !!h.isFavorite);
    return filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
  }, [history, favoritesOnly, filterDate, user, galleryFilters.parentId]);

  const displayedHistory = useMemo(
    () => applyGalleryFilters(baseScopedHistory, galleryFilters, sdModels),
    [baseScopedHistory, galleryFilters, sdModels],
  );

  // Arch-scoped view of the base scope. All non-arch filter option lists are
  // derived from THIS (not baseScopedHistory) so picking モデル種別=SDXL causes
  // the aspect ratio / orientation / sampler lists to shrink to what actually
  // exists in the SDXL subset. When arch is null, everything from the base
  // scope is visible.
  const archScopedHistory = useMemo(() => {
    if (!galleryFilters.arch) return baseScopedHistory;
    return baseScopedHistory.filter((it) => inferSdArchitectureFromTitle(it.model ?? '', sdModels) === galleryFilters.arch);
  }, [baseScopedHistory, galleryFilters.arch, sdModels]);

  // Distinct values from the arch-scoped scope, feeding the popover's dropdowns
  // and radios. Every non-arch axis auto-shrinks whenever arch changes.
  const filterOptions = useMemo(() => deriveFilterOptions(archScopedHistory), [archScopedHistory]);

  // Model dropdown mirrors filterOptions.models except when arch is null: in
  // that case we return [] so `showModel = length > 1` auto-hides the select
  // — mixing SDXL and SD1.5 models in one list is not useful.
  const availableModels = useMemo(() => {
    if (!galleryFilters.arch) return [];
    return filterOptions.models;
  }, [filterOptions.models, galleryFilters.arch]);

  // Count the child videos that would be cascaded deleted when deleting the
  // currently-selected generations. Used by the delete-confirm modal to show
  // a cascade-aware message when deleting a parent image.
  //
  // Deliberately scoped to `history` (the raw, un-gallery-filtered list) rather
  // than `displayedHistory`: the gallery defaults to the Image tab
  // (`galleryFilters.mediaType === 'image'`), which would otherwise exclude
  // every video record from this count and make the cascade message always
  // read "0 videos" even when child videos exist.
  const childVideoCount = useMemo(() => {
    const selected = new Set(deleteTargetIds);
    return history.filter((r) =>
      (r.mediaType ?? 'image') === 'video' && r.parentId && selected.has(r.parentId)
    ).length;
  }, [deleteTargetIds, history]);

  // Stale-value clearing: whenever the arch (and hence the option lists) shifts
  // such that a currently-selected value falls out of its options, null the
  // dangling filter so state and UI stay in sync.
  //
  // Guards:
  //   1. Each effect only clears when the option list is NON-empty. An empty
  //      list means "no records in scope" — not "the current value is invalid"
  //      — and can occur transiently between renders (e.g., signed-in mode
  //      wipes history to [] before the new subscription lands).
  //   2. `staleClearSuspendedRef` short-circuits every effect for ~600ms after
  //      `applyRecipeToGalleryFilter` sets the whole filter set. Without this,
  //      the specific case where the arch-scoped option list is non-empty but
  //      simply lacks the recipe's value (e.g., rollup slightly stale versus
  //      live favorites — landscape favorites exist but the ranked recipe is
  //      portrait) would silently null the field on the first click, forcing
  //      a second click to pick it back up.
  useEffect(() => {
    if (staleClearSuspendedRef.current) return;
    if (galleryFilters.model && availableModels.length > 0 && !availableModels.includes(galleryFilters.model)) {
      setGalleryFilters((f) => ({ ...f, model: null }));
    }
  }, [availableModels, galleryFilters.model]);
  useEffect(() => {
    if (staleClearSuspendedRef.current) return;
    if (galleryFilters.sampler && filterOptions.samplers.length > 0 && !filterOptions.samplers.includes(galleryFilters.sampler)) {
      setGalleryFilters((f) => ({ ...f, sampler: null }));
    }
  }, [filterOptions.samplers, galleryFilters.sampler]);
  useEffect(() => {
    if (staleClearSuspendedRef.current) return;
    if (galleryFilters.aspectRatio && filterOptions.aspectRatios.length > 0 && !filterOptions.aspectRatios.some((a) => a.ratio === galleryFilters.aspectRatio)) {
      setGalleryFilters((f) => ({ ...f, aspectRatio: null }));
    }
  }, [filterOptions.aspectRatios, galleryFilters.aspectRatio]);
  useEffect(() => {
    if (staleClearSuspendedRef.current) return;
    if (galleryFilters.orientation && filterOptions.orientations.length > 0 && !filterOptions.orientations.includes(galleryFilters.orientation)) {
      setGalleryFilters((f) => ({ ...f, orientation: null }));
    }
  }, [filterOptions.orientations, galleryFilters.orientation]);

  // Orientation is meaningless when aspectRatio === '1:1' (the shape is square).
  // Mirror the arch=null → model-null pattern: clear the orientation filter so
  // the (hidden) UI and filter state stay consistent.
  useEffect(() => {
    if (galleryFilters.aspectRatio === '1:1' && galleryFilters.orientation) {
      setGalleryFilters((f) => ({ ...f, orientation: null }));
    }
  }, [galleryFilters.aspectRatio, galleryFilters.orientation]);

  // When filters change and hide previously-selected items, prune the hidden
  // ids from selectedIds so a subsequent "delete selected" can't operate on
  // invisible rows. Sized-guarded so identical selection sets don't re-render.
  useEffect(() => {
    const visibleKeys = new Set(displayedHistory.map(itemKey));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (visibleKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [displayedHistory]);

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
  //
  // The optimistic update touches BOTH state slices that can render this item:
  // - `history[]` for the gallery grid and the lightbox
  // - `currentGeneration` for the preview panel (a separate slice; the preview
  //   is not derived from history, so failing to sync it here was the reason
  //   the preview-side ⭐ button previously appeared inert)
  const toggleFavorite = async (item: GenerationData) => {
    const id = item.id;
    if (!id) return;
    const next = !item.isFavorite;
    setHistory((prev) =>
      prev.map((h) => (h.id === id ? { ...h, isFavorite: next } : h)),
    );
    setCurrentGeneration((prev) =>
      prev && prev.id === id ? { ...prev, isFavorite: next } : prev,
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
        fetchRollups(); // server updated rankingRollups.json as part of the favorite request
      }
    } catch (e: any) {
      // Rollback the optimistic update on both slices before surfacing the toast.
      setHistory((prev) =>
        prev.map((h) => (h.id === id ? { ...h, isFavorite: !next } : h)),
      );
      setCurrentGeneration((prev) =>
        prev && prev.id === id ? { ...prev, isFavorite: !next } : prev,
      );
      addToast(t.toast.favoriteUpdateFailed(e.message), 'error');
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
        fetchRollups(); // server updated rankingRollups.json as part of the delete request
      }
      setSelectedIds((prev) => new Set([...prev].filter((id) => !deletedSet.has(id))));
      // Clear both preview slots if the item they show was just deleted —
      // either directly, or cascade-deleted as a video child of a parent
      // image the user removed. Both `currentGeneration` (image preview or
      // recalled video) and `latestResult` (freshly generated video) can
      // hold the disappearing record.
      const clearedByDelete = (item: GenerationData | null): boolean =>
        !!item && (deletedSet.has(itemKey(item)) || (typeof item.parentId === 'string' && deletedSet.has(item.parentId)));
      if (clearedByDelete(currentGeneration)) {
        setCurrentGeneration(null);
      }
      if (clearedByDelete(latestResult)) {
        setLatestResult(null);
      }
      // closeConfirm also resets deleteTargetIds after the exit animation.
      closeConfirm();
      addToast(t.toast.deleteSuccess(deleteTargetIds.length), 'success');
    } catch (error: any) {
      addToast(t.toast.deleteFailed(error.message), 'error');
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
    setShowLightboxInfo(false); // next open always starts with info hidden — users toggle it back with the Info button
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
    if (randomMode) {
      randomizeLightbox();
      return;
    }
    const idx = displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl);
    if (idx === -1) return;
    const next = idx + delta;
    if (next < 0 || next >= displayedHistory.length) return;
    const target = displayedHistory[next];
    setMorphSourceKey(itemKey(target));
    setLightboxUrl(target.imageUrl);
  };

  // Jump the lightbox to a random image in displayedHistory, deliberately
  // excluding the currently-shown one so the click always causes a visible
  // change. No-op when there are fewer than 2 candidates to choose between.
  const randomizeLightbox = () => {
    if (displayedHistory.length < 2) return;
    const idx = displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl);
    // Draw a uniform integer from [0, length-1] then bump it up by 1 iff it
    // collides with the current index — this yields uniform selection over
    // the (length - 1) "other" items without a rejection loop.
    let next = Math.floor(Math.random() * (displayedHistory.length - 1));
    if (next >= idx) next += 1;
    const target = displayedHistory[next];
    setMorphSourceKey(itemKey(target));
    setLightboxUrl(target.imageUrl);
  };

  // Trigger a browser download for the given gallery item. Signed-in items
  // carry a Firebase Storage `storagePath`; direct fetch from the browser to
  // firebasestorage.googleapis.com is blocked by CORS (the SDK's getBlob is
  // subject to the same policy — Firebase Storage buckets ship with no CORS
  // headers by default), so we route those via our /api/download-proxy which
  // tunnels the tokenized URL server-side. Signed-out items serve from
  // localhost:5000/api/outputs/* which the server's CORS config already
  // allows, so they go through the plain fetch path unchanged.
  const handleDownload = async (item: GenerationData) => {
    if (!item.imageUrl) return;
    // Video records store the .mp4 URL in imageUrl (see saveVideoGeneration),
    // so fetching item.imageUrl already grabs the right bytes — we only need
    // to switch the filename extension so the browser saves it as a video
    // instead of a broken .png.
    const filename = formatDownloadFilename(item.timestamp, item.mediaType === 'video' ? 'video' : 'image');
    const fetchUrl = item.storagePath
      ? `${API_BASE}/download-proxy?url=${encodeURIComponent(item.imageUrl)}`
      : item.imageUrl;
    try {
      await downloadImage(fetchUrl, filename);
      addToast(t.toast.imageDownloaded, 'success');
    } catch (e) {
      addToast(t.toast.imageDownloadFailed((e as Error).message), 'error');
    }
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
  const [showLightboxInfo, setShowLightboxInfo] = useState(false);

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

  // Count of child videos for whichever image is currently shown in the
  // Lightbox — feeds the 📼 動画一覧 button's enabled/disabled state and
  // tooltip count. Scoped to `history` (not `displayedHistory`) for the same
  // reason as the delete-confirm `childVideoCount` above: the gallery's
  // Image-tab default would otherwise hide every video record from the count.
  const lightboxChildVideoCount = useMemo(() => {
    if (!lightboxMeta?.id) return 0;
    return history.filter((r) =>
      (r.mediaType ?? 'image') === 'video' && r.parentId === lightboxMeta.id
    ).length;
  }, [history, lightboxMeta]);

  // --- Lightbox → video-mode navigation handlers (Task 7) ---

  // Called by the Lightbox's 🎬 動画にする button: snapshot the currently-shown
  // image as the video source, switch ControlPanel into Video mode (inheriting
  // the source's dimensions as sensible defaults), and close the lightbox so
  // the user immediately sees the video form.
  const handleOpenVideoForm = (item: GenerationData) => {
    // Push onto the source array (dedup by id — clicking 🎬 動画にする twice
    // on the same image is a no-op). Only the FIRST addition seeds the
    // dimensions and flips into video mode, so subsequent additions from
    // the gallery just append silently to the queue.
    const alreadyStaged = videoSourceImages.some((r) => r.id === item.id);
    addVideoSourceImage(item);
    if (videoSourceImages.length === 0 && !alreadyStaged) {
      setVideoMode(true);
      // Inherit the ACTUAL image dimensions, not the pre-Hires base resolution.
      // `record.width/height` is the SD payload's base; when enableHr is on, the
      // saved PNG is hrScale× larger — so the video must default to the same
      // dimensions the user actually sees, not the 512-ish base they typed.
      const scale = (item.enableHr && item.hrScale) ? item.hrScale : 1;
      setVideoWidth(Math.round(item.width * scale));
      setVideoHeight(Math.round(item.height * scale));
      switchControlTab('form');
    }
    // Keep the Lightbox / fullscreen open so the user can navigate to the
    // next image with ← / → and stage several sources in a row without
    // reopening anything. A toast confirms each successful stage; dedup
    // hits skip the toast because the thumbnail row already shows the
    // image is present, so a "動画生成の対象に追加しました" flash after a
    // no-op click would misrepresent what happened.
    if (!alreadyStaged) {
      addToast(t.toast.videoSourceStaged, 'success');
    }
  };

  // Preview panel's video-branch "動画を生成" — reload every knob that
  // produced `videoRecord` (parent image, LTX params, resolution) so the
  // user can regenerate the exact same run (or tweak it and try again).
  // Falls back to a Firestore fetch when the parent image is outside the
  // date-scoped subscription window, mirroring handleOpenParentImage.
  const handleReloadVideoRun = async (videoRecord: GenerationData) => {
    if (!videoRecord.parentId) return;
    let parent: GenerationData | undefined =
      displayedHistory.find((r) => r.id === videoRecord.parentId)
        ?? history.find((r) => r.id === videoRecord.parentId);
    if (!parent && user) {
      const fetched = await fetchGenerationById(user.uid, videoRecord.parentId);
      if (fetched) parent = fetched as unknown as GenerationData;
    }
    if (!parent) return;
    // "動画を生成" from a video record replaces the source list with the
    // parent image alone — reloading a single run's config, not stacking on
    // top of whatever the user was staging.
    setVideoSourceImages([parent]);
    setVideoMode(true);
    // Prefer the video record's own dimensions — they already reflect the
    // Hires-scaled resolution used at generation time — over deriving from
    // the parent again.
    setVideoWidth(videoRecord.width);
    setVideoHeight(videoRecord.height);
    // Restore every LTX knob so the run is fully reproducible.
    const ltx = videoRecord.ltxParams;
    if (ltx) {
      setVideoFidelity(ltx.fidelity);
      setVideoMotion(ltx.motion);
      setVideoIdentity(ltx.identity);
      setVideoLength(ltx.length);
      // New records store the original natural-language prompt; legacy
      // records don't and reload as empty (the enhanced positive/negative
      // pair on those records can't be reconstructed back to Japanese).
      setVideoPrompt(ltx.videoPrompt ?? '');
    }
    closeLightbox();
    switchControlTab('form');
  };

  // Called by the Lightbox's 📼 動画一覧 button: switch the gallery to the
  // Video tab filtered down to this image's children, switch to the gallery
  // right-column tab so the result is actually visible, then close the lightbox.
  // Also hard-resets every other gallery scope (arch/model/sampler/aspect/
  // orientation + favoritesOnly) so the parent-only view shows every child of
  // this image regardless of what filter the user last had active. The date
  // filter is preserved in state but is bypassed while parentId is set (see
  // baseScopedHistory and the Firestore subscription).
  const handleOpenChildVideos = (parentId: string) => {
    setGalleryFilters({
      arch: null,
      model: null,
      sampler: null,
      aspectRatio: null,
      orientation: null,
      mediaType: 'video',
      parentId,
    });
    setFavoritesOnly(false);
    setRightTab('gallery');
    closeLightbox();
  };

  // Called by the video Lightbox's 🖼️ 元画像を見る button: find the parent
  // image and reopen the lightbox on it. Checks `displayedHistory` first
  // (respects the active gallery filters) and falls back to the raw `history`
  // list so this still works even when the parent image is hidden by the
  // current mediaType/date/favorites filters.
  const handleOpenParentImage = async (parentId: string) => {
    // In-memory lookup first (matches the common case of the parent still
    // being in view). `history` is authoritative when subscribed but is
    // scoped to the currently-selected day, so a video and its parent
    // image often live on different days — fall back to a direct
    // Firestore fetch when signed in so that gap doesn't dead-end the
    // 「元画像を見る」button.
    let parent: GenerationData | undefined =
      displayedHistory.find((r) => r.id === parentId)
        ?? history.find((r) => r.id === parentId);
    if (!parent && user) {
      const fetched = await fetchGenerationById(user.uid, parentId);
      if (fetched) parent = fetched as unknown as GenerationData;
    }
    if (!parent) return;
    // Recall the parent image into the main preview...
    openInPreview(parent);
    // ...then dismiss the overlay. We inline the teardown instead of
    // reusing closeLightbox() because the latter's startViewTransition
    // tries to snapshot a video-side lightbox and a just-installed image
    // preview at the same time, and the browser bails without invoking
    // the callback — leaving `lightboxUrl` set and the overlay stuck.
    // Exit OS fullscreen (if any), then clear the lightbox state directly.
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* best effort */ }
    }
    setShowLightboxInfo(false);
    setLightboxUrl(null);
    setMorphSourceKey(null);
  };

  // Track the last valid lightboxIndex so we can recover the "next" item if
  // the currently-shown image drops out of displayedHistory (e.g. unfavorited
  // in favoritesOnly mode).
  const prevLightboxIndexRef = useRef(-1);
  useEffect(() => {
    if (lightboxIndex >= 0) prevLightboxIndexRef.current = lightboxIndex;
  }, [lightboxIndex]);

  // Slideshow: while slideshowPlaying is true and the lightbox is on a gallery-
  // backed item (lightboxIndex >= 0), advance to the next index every
  // slideshowIntervalMs. The `lightboxIndex` dep means any manual ← / → click
  // resets the timer for free (effect cleans up + re-runs with the new index).
  // The `slideshowIntervalMs` dep means right-click cycling the interval also
  // resets the timer immediately, so the user sees the new pace on the very
  // next tick instead of waiting out the old one. Sequential mode wraps at the
  // end; random mode uses the same rejection-free draw as randomizeLightbox.
  useEffect(() => {
    if (!slideshowPlaying) return;
    if (lightboxIndex < 0 || displayedHistory.length < 2) return;
    const id = setInterval(() => {
      const nextIdx = nextSlideshowIndex(lightboxIndex, displayedHistory.length, randomMode);
      if (nextIdx === lightboxIndex) return;
      const target = displayedHistory[nextIdx];
      setMorphSourceKey(itemKey(target));
      setLightboxUrl(target.imageUrl);
    }, slideshowIntervalMs);
    return () => clearInterval(id);
  }, [slideshowPlaying, lightboxIndex, randomMode, displayedHistory, slideshowIntervalMs]);

  // Any exit from the lightbox (Esc, close button, background click) pauses
  // the slideshow so it never keeps ticking on a hidden surface. The user
  // must explicitly restart it after reopening.
  useEffect(() => {
    if (!lightboxUrl && slideshowPlaying) {
      setSlideshowPlaying(false);
    }
  }, [lightboxUrl, slideshowPlaying]);

  // Persist the chosen slideshow pace across reloads. Wrapped in try/catch so
  // a disabled or over-quota localStorage never crashes the render — the app
  // just loses the "remember my pace" affordance in that session.
  useEffect(() => {
    try {
      localStorage.setItem(SLIDESHOW_INTERVAL_STORAGE_KEY, String(slideshowIntervalMs));
    } catch { /* ignore quota / disabled storage */ }
  }, [slideshowIntervalMs]);

  // Cycle through SLIDESHOW_INTERVALS_MS on right-click. Wraps back to the
  // first preset after the last, so repeated cycling is monotonic and
  // predictable rather than random. A value not in the preset list (should
  // never happen since state is guarded, but be defensive) resets to default.
  const cycleSlideshowInterval = () => {
    const idx = SLIDESHOW_INTERVALS_MS.indexOf(slideshowIntervalMs as typeof SLIDESHOW_INTERVALS_MS[number]);
    const nextIdx = idx < 0 ? 0 : (idx + 1) % SLIDESHOW_INTERVALS_MS.length;
    setSlideshowIntervalMs(SLIDESHOW_INTERVALS_MS[nextIdx]);
  };

  // Batch-level cancellation signal. Set by requestCancel(), checked at the
  // top of each batch iteration. Needed because the server's cancelRequested
  // flag is defensively reset at the start of every /api/generate call, so
  // a cancel that arrives during the inter-iteration gap (e.g. while the
  // client is uploading to Firebase and SD is idle) would otherwise be lost.
  const batchCancelledRef = useRef(false);
  // Same shape as batchCancelledRef but for the video batch loop; kept
  // separate so cancelling a video batch doesn't leak into a subsequent
  // image batch (or vice versa) if both are triggered in quick succession.
  const videoBatchCancelledRef = useRef(false);

  // OS notification opt-in. Loaded from localStorage on mount; the toggle in
  // the header updates both state and storage. `notify` is the fire-and-forget
  // helper used at generation-complete points below.
  const [notificationsEnabled, setNotificationsEnabled] = useState(loadNotificationPreference());
  const notify = (body: string) => {
    if (notificationsEnabled) sendNotification(t.notification.title, body);
  };
  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      saveNotificationPreference(false);
      return;
    }
    const support = getNotificationSupport();
    if (!support.supported) {
      addToast(t.toast.notifyNotSupported, 'error');
      return;
    }
    if (support.permission === 'denied') {
      addToast(t.toast.notifyBlocked, 'error');
      return;
    }
    if (support.permission === 'default') {
      const result = await requestNotificationPermission();
      if (result !== 'granted') {
        addToast(t.toast.notifyRejected, 'error');
        return;
      }
    }
    setNotificationsEnabled(true);
    saveNotificationPreference(true);
    addToast(t.toast.notifyEnabled, 'success');
  };

  // When the lightbox image is removed from displayedHistory (e.g. due to
  // unfavoriting in favoritesOnly mode), auto-advance to the item at the
  // previous index (clamped to the new list length), or close the lightbox
  // if the list is now empty. Preview-mode lightbox targets are decoupled
  // from displayedHistory on purpose — the preview may show an image that
  // does not belong to the currently-filtered gallery (e.g. an image parent
  // while the gallery is on the video tab). Skip this fallback in that case
  // so it never overwrites the preview target with an unrelated gallery item.
  useEffect(() => {
    if (!lightboxUrl) return;
    if (morphSourceKey === '__preview__') return;
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
  }, [displayedHistory, lightboxIndex, lightboxUrl, morphSourceKey]);
  type GenStatus = 'idle' | 'enhancing' | 'generating' | 'saving' | 'success' | 'error';
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sdProgress, setSdProgress] = useState<{ progress: number; etaRelative: number } | null>(null);

  // --- Video-mode (ComfyUI image-to-video) form state ---
  // Whether the left form is currently showing the video pipeline instead of
  // the image pipeline. Drives ControlPanel's mode toggle and PreviewPanel's
  // currentMediaType (which selects the process-tracker's step labels).
  const [videoMode, setVideoMode] = useState(false);
  // The source still image the video is generated from. Normally chosen via
  // the Lightbox's 🎬 動画にする action (handleOpenVideoForm); entering video
  // mode with nothing picked yet also defaults it to the current preview
  // image (see the effect below) so the pipeline is exercisable directly.
  // Ordered list of source images the video pipeline will iterate over. The
  // Lightbox's 「🎬 動画にする」 accumulates into this array (dedup by id) so
  // the user can stage N images without leaving the gallery. Single-image
  // runs and every legacy code path that used the old `videoSourceImage`
  // singular read videoSourceImages[0] and write via addVideoSourceImage /
  // setVideoSourceImages([single]). Empty means "no source picked yet".
  const [videoSourceImages, setVideoSourceImages] = useState<GenerationData[]>([]);
  const addVideoSourceImage = (item: GenerationData) => {
    setVideoSourceImages((prev) => (prev.some((r) => r.id === item.id) ? prev : [...prev, item]));
  };
  const removeVideoSourceImageAt = (idx: number) => {
    setVideoSourceImages((prev) => prev.filter((_, i) => i !== idx));
  };
  // Single natural-language input the user types in the video form. When empty
  // the video-generation flow skips LM Studio entirely and sends only
  // VIDEO_POSITIVE_PREFIX / VIDEO_NEGATIVE_PREFIX to ComfyUI. When non-empty
  // it is POSTed to /api/video/enhance and the returned positive/negative are
  // prepended with the fixed prefixes before being sent to /api/video/generate.
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoWidth, setVideoWidth] = useState(1024);
  const [videoHeight, setVideoHeight] = useState(1088);
  const [videoDimensionMode, setVideoDimensionMode] = useState<VideoDimensionMode>(loadVideoDimensionMode);
  useEffect(() => {
    try { localStorage.setItem(VIDEO_DIMENSION_MODE_STORAGE_KEY, videoDimensionMode); }
    catch { /* storage disabled — the choice just won't persist */ }
  }, [videoDimensionMode]);
  const [videoLength, setVideoLength] = useState(240);
  const [videoFidelity, setVideoFidelity] = useState(1.0);
  const [videoMotion, setVideoMotion] = useState(35);
  const [videoIdentity, setVideoIdentity] = useState(1.0);
  const [videoSeed, setVideoSeed] = useState(12345);
  const [videoSeedLocked, setVideoSeedLocked] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  // AbortController for the in-flight /api/video/generate fetch, so
  // handleVideoCancel can tear down the SSE read loop client-side.
  const videoAbortRef = useRef<AbortController | null>(null);
  // Raw SSE `stage` id from the most recent `event: progress` frame — consumed
  // by PreviewPanel's videoStageLabel() mapping.
  const [videoProgressStage, setVideoProgressStage] = useState('');
  // Fine-grained progress accumulated from ComfyUI's raw WS events forwarded
  // over SSE (executing → currentNode, progress → stepValue/stepMax). Null
  // outside a video-generation run. Used for the per-node label/step counter;
  // the pipeline-wide bar is time-based via videoComfyElapsedSeconds below.
  const [videoProgress, setVideoProgress] = useState<VideoProgressState | null>(null);
  // Wall-clock elapsed seconds since the comfy stage started (0 until the
  // pipeline actually enters ComfyUI). Feeds the time-based comfy fraction
  // that draws the pipeline-wide progress bar smoothly.
  const [videoComfyElapsedSeconds, setVideoComfyElapsedSeconds] = useState(0);
  // The most recent successful generation from either pipeline (image or
  // video), surfaced in PreviewPanel's top preview stage — it takes priority
  // over currentGeneration there whenever it holds a completed video.
  const [latestResult, setLatestResult] = useState<GenerationData | null>(null);

  // Entering video mode with nothing picked yet defaults the source image to
  // whatever is already on screen (the current preview image), so the pipeline
  // is exercisable without going through the Lightbox first. The Lightbox's
  // 🎬 動画にする button (handleOpenVideoForm) overrides this with any history item.
  useEffect(() => {
    if (videoMode && videoSourceImages.length === 0 && currentGeneration && (currentGeneration.mediaType ?? 'image') === 'image') {
      setVideoSourceImages([currentGeneration]);
    }
  }, [videoMode, videoSourceImages.length, currentGeneration]);

  // Batch generation state
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showVideoBatchModal, setShowVideoBatchModal] = useState(false);
  const [batchCount, setBatchCount] = useState(5);
  const [videoBatchCount, setVideoBatchCount] = useState(2);
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

  // Open/close the batch modal wrapped in a View Transition so the modal
  // appears to expand out of the "まとめて生成" button (and shrinks back into
  // it on close). The button and the modal panel share
  // `view-transition-name: batch-morph` — but only one of them may carry it
  // at any given snapshot moment, which is why ControlPanel takes
  // `batchModalOpen` and switches the name off while the modal is up.
  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels.filter((m) => m.type === modelTypeFilter).map((m) => m.title)));
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (!start) {
      setShowBatchModal(true);
      return;
    }
    start.call(document, () => {
      flushSync(() => setShowBatchModal(true)); // new snapshot: modal carries the name, button drops it
    });
  };
  const closeBatchModal = () => {
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (!start) {
      setShowBatchModal(false);
      return;
    }
    start.call(document, () => {
      flushSync(() => setShowBatchModal(false)); // new snapshot: button regains the name, modal gone
    });
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
  // Same reasoning for the *UserOverride flags read below (steps/cfg/sampler/
  // scheduler reset) — they must not retrigger this effect on every override change.
  useEffect(() => {
    // Rebind the selected model to the current sdModels entry for this arch.
    // Uses stripHashSuffix-based matching (via resolveSelectedModel) so a
    // history record whose "[hash]" drifted since save still resolves back to
    // the same base filename's current title — otherwise loadIntoForm's
    // setSelectedModel(item.model) would fall through to the first-of-arch
    // fallback on any hash mismatch.
    setSelectedModel((prev) => resolveSelectedModel(prev, modelTypeFilter, sdModels));

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

    if (modelTypeFilter === 'sd15') {
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Lightbox keyboard control. The key→action mapping lives in
  // `lightboxKeyboard.ts` as a pure function (unit-tested); this effect only
  // dispatches the resolved action back into React state.
  //
  // Bindings (all only while the lightbox is open):
  //   Escape       close (browser handles exit-fullscreen first when applicable)
  //   ArrowLeft/Right  step through the displayed gallery order
  //   Space        toggle selection on the current gallery item
  //   F / f        toggle favorite on the current gallery item
  //   R / r        jump to a random image (excluding the current one)
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      const action = resolveLightboxKey(e.key, e.code, !!document.fullscreenElement, lightboxIndex);
      if (!action) return;
      switch (action.type) {
        case 'close':
          closeLightbox();
          return;
        case 'navigate':
          e.preventDefault();
          navigateLightbox(action.delta);
          return;
        case 'toggleSelection':
          // Space would otherwise scroll the page underneath the lightbox; suppress it.
          e.preventDefault();
          toggleSelected(itemKey(displayedHistory[lightboxIndex]));
          return;
        case 'toggleFavorite':
          e.preventDefault();
          toggleFavorite(displayedHistory[lightboxIndex]);
          return;
        case 'toggleRandom':
          e.preventDefault();
          setRandomMode((v) => !v);
          return;
        case 'toggleSlideshow':
          e.preventDefault();
          setSlideshowPlaying((v) => !v);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl, morphSourceKey, displayedHistory, lightboxIndex, randomMode]);

  // "D" hotkey → same as clicking the gallery's 削除 button. Fires only when
  // the gallery tab is active, at least one image is selected, no lightbox /
  // confirm modal is open, and the user is not typing in an input. That last
  // guard is what keeps "d" inside the prompt textarea from wiping the day's
  // selection.
  useEffect(() => {
    if (rightTab !== 'gallery') return;
    if (selectedIds.size === 0) return;
    if (lightboxUrl) return;         // lightbox owns its own keymap
    if (showDeleteConfirm) return;   // don't re-trigger while the confirm modal is up
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
      requestDelete(Array.from(selectedIds));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rightTab, selectedIds, lightboxUrl, showDeleteConfirm]);

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

  // Signed-out mirror of the Firestore rollups subscription: GET /api/ranking-rollups
  // returns a Record<hash, rollup-without-hash> JSON object; reshape it into the
  // RankingRollup[] the RankingPanel/rankRecipes helpers expect.
  const fetchRollups = async () => {
    try {
      const res = await fetch(`${API_BASE}/ranking-rollups`);
      if (res.ok) {
        const data: Record<string, Omit<RankingRollup, 'hash'>> = await res.json();
        setRollups(Object.entries(data).map(([hash, v]) => ({ hash, ...v })));
      }
    } catch (error) {
      console.error('Failed to fetch ranking rollups:', error);
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
              addToast(t.toast.favoritesFetchFailed(detail), 'error');
            },
          )
        : subscribeGenerations(
            user.uid,
            // Parent-only view: subscribe without a date scope so every child
            // video of the target image loads regardless of when it was made.
            galleryFilters.parentId ? null : (filterDate || null),
            (records) => setHistory(records as unknown as GenerationData[]),
            (err) => {
              const e = err as unknown as { code?: string; message?: string };
              const detail = [e.code, e.message].filter(Boolean).join(' / ') || String(err);
              addToast(t.toast.historyFetchFailed(detail), 'error');
            },
          );
      return unsub;
    }
    fetchHistory();
    return undefined;
  }, [user, filterDate, favoritesOnly, galleryFilters.parentId]);

  // Favorite-recipe ranking rollups: live Firestore subscription when signed
  // in (cleaned up on unmount / uid change via the returned unsubscribe),
  // one-shot REST fetch on mount when signed out. Signed-out refetches after
  // mutations happen at each of the three call sites that can change a local
  // rollup count (save, favorite toggle, delete) — see fetchRollups() calls below.
  useEffect(() => {
    if (user) {
      return subscribeRankingRollups(user.uid, setRollups, (err) => {
        console.error('Ranking rollup subscription failed:', err);
      });
    }
    fetchRollups();
    return undefined;
  }, [user]);

  // Child-video index for the gallery's 🎬 badge on image cards. Only in
  // Firebase mode — the signed-out path derives its counts from local
  // history via the useMemo below.
  useEffect(() => {
    if (!user) return;
    return subscribeVideoParentIndex(user.uid, setVideoParentCounts);
  }, [user]);

  // Effective parent-count source. Signed-in reads the live subscription's
  // state (which spans all days). Signed-out derives from the current
  // history slice each time it changes — good enough because local mode
  // has no date scoping and history holds every record.
  const effectiveVideoParentCounts = useMemo(
    () => (user
      ? videoParentCounts
      : collectVideoParentCounts(history as unknown as Array<{ mediaType?: string; parentId?: string }>)),
    [user, history, videoParentCounts],
  );

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
    // Force the image control form to be visible — the user pressed
    // 画像フォームにロード, so leaving the video form open would silently
    // overwrite image state the user can't see. No-op when the image form
    // is already active.
    setVideoMode(false);
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
    // Rebind item.model (which carries the hash it had at save time) to the
    // currently-loaded sdModels title. See resolveSelectedModel's docstring.
    setSelectedModel(resolveSelectedModel(item.model || '', s.archToSet, sdModels));
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
    // If the user is currently on the Ranking tab, surface the freshly-populated
    // form so the applied settings are actually visible. No-op when already on
    // the form tab (switchControlTab early-returns on same-tab).
    switchControlTab('form');
    // Populate the loaded-enhanced-prompt fields from the pure function's
    // result. Empty strings when the item lacks enhancedPrompt/negativePrompt
    // (legacy records) — in that case the panel stays hidden and the next
    // generate falls back to the normal enhance flow, unchanged.
    setLoadedPositive(s.loadedPositive);
    setLoadedNegative(s.loadedNegative);
    addToast(t.toast.loadedIntoForm, 'success');
  };

  // Clear the loaded enhanced prompt fields. Called by ControlPanel's clear
  // button. After this, the next generate goes through the normal enhance
  // flow (LLM invoked, positive/negative re-derived from the current prompt).
  const clearLoadedEnhanced = () => {
    setLoadedPositive('');
    setLoadedNegative('');
  };
  // Apply a ranked favorite-recipe (from the Ranking tab, RankingPanel's "フォームに
  // 適用" button) back into the form. Mirrors loadIntoForm's architecture/dimension
  // resolution above, but the source is a rollup's NormalizedParams instead of a
  // GenerationData. ADR 24 expanded the recipe shape to cover every generation
  // form field except prompt and seed, so applying a recipe now fully restores
  // the form — nothing is left "sticky" from the previous form state.
  const applyRecipe = (recipe: RankedRecipe) => {
    const rp = recipe.params;
    const [wStr, hStr] = rp.size.split('x');
    const w = Number(wStr);
    const h = Number(hStr);
    const s = computeLoadIntoFormState({ width: w, height: h, model: rp.model }, sdModels);
    // Flip the SD/SDXL toggle BEFORE setting width/height, same ordering
    // reasoning as loadIntoForm: the modelTypeFilter effect resolves the
    // picker from whichever width/height land in the same render batch.
    if (s.archToSet) setModelTypeFilter(s.archToSet);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      setWidth(w);
      setHeight(h);
    }
    // Same-architecture apply doesn't retrigger the modelTypeFilter effect, so
    // sync the picker chips directly here too (see loadIntoForm's own comment).
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
    // rp.model is already stripped of its "[hash]" suffix (normalizeParams strips
    // it before hashing); resolve back to the currently-loaded checkpoint's full
    // title (with hash) so the model <select> shows a matching option. Uses the
    // shared resolveSelectedModel helper so any future hash-normalization tweaks
    // apply to loadIntoForm, applyRecipe, and the modelTypeFilter effect at once.
    setSelectedModel(resolveSelectedModel(rp.model, s.archToSet, sdModels));
    setSelectedSampler(rp.sampler);
    setSelectedScheduler(rp.scheduler);
    setSteps(rp.steps);
    setCfgScale(rp.cfg);
    setHiresFixEnabled(rp.hires);
    setSelectedUpscaler(rp.hiresUpscaler);
    setHiresScale(rp.hiresScale);
    setHiresSteps(rp.hiresSteps);
    setHiresDenoising(rp.hiresDenoising);
    setSelectedLoras(rp.loras.map((l) => ({ name: l.name, weight: l.weight })));
    setSelectedRefiner(rp.refiner);
    setRefinerSwitchAt(rp.refinerSwitchAt);
    setSelectedVae(rp.vae);
    switchControlTab('form'); // so the user sees the applied change land in the form
    addToast(t.ranking.applyToast, 'success');
  };

  // Push a ranked recipe into the gallery filter surface (as opposed to the
  // generation form). Maps the recipe's params → the 5 gallery filter axes,
  // flips favoritesOnly on so the search spans all-time favorites (a recipe
  // was ranked BY favorites, so this is the correct scope; sticking to the
  // current date would let the stale-clear effects null everything the
  // moment that date has no matching favorites), and switches the right pane
  // to the gallery so the newly-narrowed grid is immediately visible.
  const applyRecipeToGalleryFilter = (recipe: RankedRecipe) => {
    const rp = recipe.params;
    const [wStr, hStr] = rp.size.split('x');
    const w = Number(wStr);
    const h = Number(hStr);
    const inferredArch = inferSdArchitectureFromTitle(rp.model, sdModels);
    const arch: GalleryFilters['arch'] = inferredArch;
    const aspectRatio = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      ? computeAspectRatio(w, h)
      : null;
    // Square records don't participate in orientation — leave it null so 1:1
    // recipes match all orientations (which is a no-op given aspectRatio=1:1).
    const orientation: GalleryFilters['orientation'] =
      Number.isFinite(w) && Number.isFinite(h) && w > h
        ? 'landscape'
        : Number.isFinite(w) && Number.isFinite(h) && h > w
          ? 'portrait'
          : null;
    const nextFilters: GalleryFilters = {
      arch,
      model: rp.model || null,
      sampler: rp.sampler || null,
      aspectRatio,
      orientation,
      // Recipes are image-generation params only; leave the media-type tab
      // and parent-image filter untouched by this image-focused recipe apply.
      mediaType: galleryFilters.mediaType,
      parentId: galleryFilters.parentId,
    };
    // Suspend stale-clear effects for ~600ms so the freshly-set filter values
    // are not nulled by a transient filterOptions mismatch during the initial
    // renders (favorites subscribe/refetch, arch-scope recompute, etc.).
    staleClearSuspendedRef.current = true;
    setTimeout(() => { staleClearSuspendedRef.current = false; }, 600);
    // Force favoritesOnly=true so the search covers all-time favorites — the
    // recipe was ranked BY favorites in the first place, and staying on the
    // current date scope would clear the extra filters via the stale-clear
    // effects whenever that date has no matching favorites (~always for a
    // random rank click). favoritesOnly bypasses filterDate in
    // baseScopedHistory, giving the filters something to match against.
    setFavoritesOnly(true);
    setGalleryFilters(nextFilters);
    setRightTab('gallery');
    addToast(t.ranking.applyToFilterToast, 'success');
  };

  // Recall a history image into the Preview tab, treating it as if it was just
  // generated: same success-state transition as handleGenerate's success branch,
  // minus the toast. Ignored while a generation is in progress so the live
  // preview/progress isn't clobbered.
  const openInPreview = (item: GenerationData) => {
    if (genStatus === 'enhancing' || genStatus === 'generating' || genStatus === 'saving') return;
    setLatestResult(null); // Clear any stuck video preview so the image branch renders
    setCurrentGeneration(item);
    setGenStatus('success');
    setLoadingStep(3);
    setRightTab('preview');
    // Close any open lightbox and clear its morph source so a subsequent
    // openLightbox() call from the preview starts from a clean state.
    setLightboxUrl(null);
    setMorphSourceKey(null);
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
      body: JSON.stringify({ prompt: promptText, arch: modelTypeFilter })
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
        modelArchitecture: modelTypeFilter,
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
      // The server's clientPersist response doesn't carry modelArchitecture
      // (it never persists on that path) — the client already knows the
      // active architecture via modelTypeFilter, so merge it in here.
      const paramsWithArch: GenerationParams = { ...result.params, modelArchitecture: modelTypeFilter };
      return await saveGeneration(user.uid, result.image, paramsWithArch) as unknown as GenerationData;
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
      addToast(t.toast.cancelRequestFailed, 'error');
      setCancelling(false);
    }
  };

  // Formats a duration in seconds as "12秒" or, past a minute, "1分5秒" —
  // Hires.fix generations can run several minutes.
  const formatDuration = (totalSeconds: number): string => {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return t.preview.durationSeconds(s);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return t.preview.durationMinutesSeconds(m, rem);
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
    setCurrentGeneration(null); // Clear preview on start
    setLatestResult(null); // Clear any stuck video preview so the image branch renders
    // Only surface step 1 (enhancing) when actually calling the LLM. When
    // a loaded enhanced prompt is present we go straight to step 2 without
    // even flashing the "enhancing" status.
    if (!loadedPositive) {
      setGenStatus('enhancing');
      setLoadingStep(1); // Start Step 1: Prompt Enhancement
    }

    let currentStep = 1;

    try {
      // --- Step 1: Enhance prompt via LM Studio ---
      // If the user has previously loaded an enhanced prompt from a past
      // image, reuse it verbatim and skip the LM Studio round-trip entirely.
      // The generate pipeline's loadingStep is also nudged to step 2 directly
      // because step 1 (enhancing) is being skipped semantically.
      const { positive, negative } = loadedPositive
        ? { positive: loadedPositive, negative: loadedNegative }
        : await enhanceOnce(prompt);

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
          addToast(t.toast.cloudSaveFailed(saveErr.message), 'error');
          notify(t.notification.generateSuccessCloudFailed);
          return;
        }

        setCurrentGeneration(saved);
        setGenStatus('success');
        if (!user) { fetchHistory(); fetchRollups(); } // signed-in history/rollups update via onSnapshot (Task 5)
        addToast(t.toast.generateSuccess, 'success');
        notify(t.notification.generateSuccess);
      }
    } catch (error: any) {
      if (error instanceof GenerationCancelledError) {
        // Restore previous generation and return to idle — this is a deliberate
        // user action, not an error, so no error panel is shown.
        setCurrentGeneration(prevGen);
        setGenStatus('idle');
        addToast(t.toast.generateCancelled, 'success');
        return;
      }

      console.error(error);

      // Restore previous generation to keep it visible on error
      setCurrentGeneration(prevGen);

      // Use currentStep to freeze on the correct failed step
      setErrorStep(currentStep);
      setGenStatus('error');

      addToast(t.toast.generateFailed(error.message), 'error');
      notify(t.notification.generateFailed);
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
    setCurrentGeneration(null);
    setLatestResult(null); // Clear any stuck video preview so the image branch renders
    // Only surface step 1 (enhancing) when actually calling the LLM. When
    // a loaded enhanced prompt is present we go straight to step 2 without
    // even flashing the "enhancing" status.
    if (!loadedPositive) {
      setGenStatus('enhancing');
      setLoadingStep(1);
    }

    let currentStep = 1;

    try {
      // --- Step 1: enhance ONCE, reuse for every image ---
      // Batch generation: reuse loaded enhanced prompt across all jobs when
      // present. LM Studio is not called even once. When absent, the current
      // behavior (enhance once, reuse across jobs) is preserved unchanged.
      const { positive, negative } = loadedPositive
        ? { positive: loadedPositive, negative: loadedNegative }
        : await enhanceOnce(prompt);

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

      if (!user) { fetchHistory(); fetchRollups(); } // signed-in history/rollups update via onSnapshot

      if (cancelledInLoop) {
        setGenStatus(succeeded > 0 ? 'success' : 'idle');
        addToast(t.toast.batchCancelled(succeeded), 'success');
      } else if (succeeded === 0) {
        setErrorStep(2);
        setGenStatus('error');
        addToast(t.toast.batchPartial(jobs.length, succeeded, failed), 'error');
        notify(t.notification.batchAllFailed(jobs.length));
      } else {
        setGenStatus('success');
        if (failed === 0) {
          addToast(t.toast.batchAllSuccess(succeeded), 'success');
          notify(t.notification.batchAllSuccess(succeeded));
        } else {
          addToast(t.toast.batchPartial(jobs.length, succeeded, failed), 'error');
          notify(t.notification.batchPartial(jobs.length, succeeded, failed));
        }
      }
    } catch (error: any) {
      // enhanceOnce failed before the loop → abort like single generation.
      console.error(error);
      setErrorStep(currentStep);
      setGenStatus('error');
      addToast(t.toast.generateFailed(error.message), 'error');
      notify(t.notification.generateFailed);
    } finally {
      setLoading(false);
      setBatchProgress(null);
      setCancelling(false);
    }
  };

  // Fetch a history item's primary image and return its bytes as a base64
  // string (no "data:...;base64," prefix). Firebase-hosted URLs need the
  // server's /api/download-proxy tunnel (ADR-55) to sidestep browser CORS on
  // firebasestorage.googleapis.com; local-mode URLs are same-origin-enough
  // (CORS-allowed by the server) to fetch directly. Mirrors handleDownload's
  // existing storagePath-presence check for which mode an item is in.
  const fetchImageAsBase64 = async (item: GenerationData): Promise<string> => {
    const url = item.imageUrl;
    const fetchUrl = item.storagePath
      ? `${API_BASE}/download-proxy?url=${encodeURIComponent(url)}`
      : url;
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Strip the "data:<mime>;base64," prefix FileReader.readAsDataURL adds.
        const commaIdx = dataUrl.indexOf(',');
        resolve(dataUrl.slice(commaIdx + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Trigger a ComfyUI image-to-video generation. Opens the /api/video/generate
  // SSE stream via `fetch` + ReadableStream (browser EventSource is GET-only
  // and this endpoint is POST), parses each SSE frame by hand, and threads
  // progress/completion into the shared genStatus/latestResult state.
  // Resolve the width / height ComfyUI should render at, given the active
  // source image and the mode toggle. 'inherit' matches handleOpenVideoForm's
  // dimension-inheritance rule — the ACTUAL image dimensions (Hires-scaled
  // when the source used it), so the video sizes to what the user actually
  // sees rather than SD's pre-Hires base. 'fixed' returns the numeric inputs
  // verbatim so a user who intentionally set a specific size (e.g. matching a
  // downstream video canvas) still gets it, even across multi-source batches.
  const resolveVideoDimensions = (source: GenerationData, mode: VideoDimensionMode, fixedW: number, fixedH: number): { width: number; height: number } => {
    if (mode === 'fixed') return { width: fixedW, height: fixedH };
    const scale = (source.enableHr && source.hrScale) ? source.hrScale : 1;
    return { width: Math.round(source.width * scale), height: Math.round(source.height * scale) };
  };

  // Kick off a single ComfyUI image-to-video run. Normally called with no
  // arguments — enhance + seed are resolved from the current form state.
  // The video batch loop calls it with `overrides` so all N iterations share
  // one LM Studio call and get per-iteration seeds; when overrides is set the
  // caller (handleVideoBatchGenerate) owns videoLoading / genStatus lifecycle,
  // so this function skips its own setVideoLoading(false) in `finally`.
  const handleVideoGenerate = async (
    overrides?: { effectivePositive: string; effectiveNegative: string; videoPromptOriginal: string; seed: number; sourceImage?: GenerationData },
  ): Promise<{ success: boolean; cancelled: boolean } | void> => {
    // Which source image to feed ComfyUI. Batch / multi-image callers pin the
    // specific record via overrides.sourceImage; single-shot calls (no
    // overrides at all) fall back to the first staged image, matching the
    // previous singleton behavior when only one image is staged.
    const activeSource = overrides?.sourceImage ?? videoSourceImages[0];
    if (!activeSource || (videoLoading && !overrides)) return;

    if (!overrides) setVideoLoading(true);
    setErrorStep(null);
    setRightTab('preview');
    // Track outcome so batch callers can count success/fail and stop on cancel.
    let jobSucceeded = false;
    let jobCancelled = false;
    // Mirror the image-generation open: clear both preview slots so the
    // PreviewPanel falls through to its loading branch (which shows the
    // video-mode stage label + cancel button) instead of leaving a stale
    // image or video from a previous run visible while the new run runs.
    setCurrentGeneration(null);
    setLatestResult(null);
    setGenStatus('generating');
    // Start the 3-step indicator at step 1 (prompt enhance). Batch mode passes
    // overrides carrying the already-enhanced prompts, and empty-prompt runs
    // skip LM Studio, so both jump straight to step 2 below without flashing 1.
    if (!overrides && videoPrompt.trim() !== '') setLoadingStep(1);
    else setLoadingStep(2);
    setVideoProgressStage('preparing');
    setVideoProgress(null);

    // Live elapsed-seconds counter — mirrors runWithProgressTracking's
    // pattern so the shared "経過 X 秒" chip in PreviewPanel is animated
    // for video generation too (was frozen at 0 before).
    const videoStartTime = Date.now();
    // Set to a positive value once the pipeline reports its first `comfy`
    // stage — used as the anchor for the time-based comfy fraction below.
    let comfyStartTime: number | null = null;
    setElapsedSeconds(0);
    setVideoComfyElapsedSeconds(0);
    const videoElapsedTimer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - videoStartTime) / 1000));
      if (comfyStartTime !== null) {
        setVideoComfyElapsedSeconds(Math.floor((Date.now() - comfyStartTime) / 1000));
      }
    }, 1000);

    const abortController = new AbortController();
    videoAbortRef.current = abortController;

    try {
      // Fetch source image bytes as base64. Firebase mode routes through
      // /api/download-proxy; local mode fetches directly.
      const sourceBase64 = await fetchImageAsBase64(activeSource);

      // Resolve effective ComfyUI prompts. When the user leaves videoPrompt
      // empty we skip LM Studio entirely and hand ComfyUI only the fixed
      // prefixes — a "safe minimum" video generation. Otherwise we round-trip
      // through /api/video/enhance and prepend the fixed prefixes to what the
      // LLM emitted (VIDEO_SYSTEM_PROMPT deliberately omits them). Batch mode
      // passes overrides so a single enhance is reused across every iteration.
      let trimmedVideoPrompt: string;
      let effectivePositive: string;
      let effectiveNegative: string;
      if (overrides) {
        trimmedVideoPrompt = overrides.videoPromptOriginal;
        effectivePositive = overrides.effectivePositive;
        effectiveNegative = overrides.effectiveNegative;
      } else {
        trimmedVideoPrompt = videoPrompt.trim();
        if (trimmedVideoPrompt === '') {
          effectivePositive = VIDEO_POSITIVE_PREFIX;
          effectiveNegative = VIDEO_NEGATIVE_PREFIX;
        } else {
          const enhanceRes = await fetch(`${API_BASE}/video/enhance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: trimmedVideoPrompt }),
            signal: abortController.signal,
          });
          if (!enhanceRes.ok) {
            throw new Error(`video enhance HTTP ${enhanceRes.status} ${enhanceRes.statusText}`);
          }
          const enhanced = await enhanceRes.json() as { positive: string; negative: string };
          effectivePositive = `${VIDEO_POSITIVE_PREFIX} ${enhanced.positive}`;
          effectiveNegative = `${VIDEO_NEGATIVE_PREFIX}, ${enhanced.negative}`;
        }
      }

      // Prompt is ready — advance to the "generate" step of the 3-step indicator.
      setLoadingStep(2);

      const resolvedDims = resolveVideoDimensions(activeSource, videoDimensionMode, videoWidth, videoHeight);
      const body = {
        sourceImageBytesBase64: sourceBase64,
        sourceImageFilename: `sumica-source-${Date.now()}.png`,
        positivePrompt: effectivePositive,
        negativePrompt: effectiveNegative,
        videoPrompt: trimmedVideoPrompt || undefined,
        width: resolvedDims.width,
        height: resolvedDims.height,
        length: videoLength,
        fidelity: videoFidelity,
        motion: videoMotion,
        identity: videoIdentity,
        seed: overrides?.seed ?? resolveVideoSeed(videoSeed, videoSeedLocked),
        clientId: `sumica-${Date.now()}`,
        parentId: activeSource.id,
        params: user ? undefined : activeSource, // local mode: server inherits fields straight from the parent record
      };

      const res = await fetch(`${API_BASE}/video/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-persist': user ? 'true' : 'false',
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      // Manual SSE parser: frames are separated by a blank line ("\n\n"); each
      // frame is an "event: X" line followed by a "data: <json>" line. Frames
      // can arrive split across chunk boundaries, so partial trailing data is
      // buffered and re-prepended on the next read.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const frame of frames) {
          if (!frame.trim()) continue;
          const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!evLine || !dataLine) continue;
          const eventName = evLine.slice(7).trim();
          const dataJson = JSON.parse(dataLine.slice(6));

          if (eventName === 'progress') {
            setVideoProgressStage(dataJson.stage ?? '');
            // Anchor the time-based comfy fraction the first time we see
            // the pipeline enter ComfyUI. Everything before this stage
            // (upload/submit) is punctual and already advances the bar
            // via computeOverallProgress.
            if (dataJson.stage === 'comfy' && comfyStartTime === null) {
              comfyStartTime = Date.now();
            }
            // Server forwards ComfyUI's raw WS events as { stage: 'comfy',
            // evt: WsEvent }. We accumulate them here so PreviewPanel can
            // show the current node + N/M step counter next to the label.
            // The bar itself is driven by wall-clock time, not this state.
            if (dataJson.stage === 'comfy' && dataJson.evt) {
              const evt = dataJson.evt as { type: string; data?: { node?: string | null; value?: number; max?: number } };
              setVideoProgress((prev) => {
                const next = prev ?? createInitialVideoProgress();
                if (evt.type === 'executing') {
                  // Only the label/step display needs the active node; the
                  // pipeline-wide bar is time-based and doesn't count nodes.
                  return { ...next, currentNode: evt.data?.node ?? null, stepValue: 0, stepMax: 0 };
                }
                if (evt.type === 'progress') {
                  return {
                    ...next,
                    stepValue: evt.data?.value ?? next.stepValue,
                    stepMax: evt.data?.max ?? next.stepMax,
                  };
                }
                return next;
              });
            }
          } else if (eventName === 'complete') {
            // Signed-in: dataJson carries { videoBase64, posterBase64?, ltxParams } —
            // the client uploads the bytes to Firebase Storage itself.
            // Signed-out: dataJson carries { record } — the server already
            // persisted to server/outputs/, so the record is ready to display.
            if (user && dataJson.videoBase64) {
              setVideoProgressStage('saving');
              setLoadingStep(3);
              const saved = await saveVideoGeneration(user.uid, {
                parentId: body.parentId!,
                videoBase64: dataJson.videoBase64,
                posterBase64: dataJson.posterBase64,
                ltxParams: dataJson.ltxParams as LtxParams,
                timestamp: Date.now(),
                params: { ...activeSource, model: activeSource.model ?? null },
              });
              setLatestResult(saved as unknown as GenerationData);
            } else if (dataJson.record) {
              setLoadingStep(3);
              setLatestResult(dataJson.record as GenerationData);
              fetchHistory(); // signed-out history isn't a live subscription — refresh it
              fetchRollups();
            }
            // Clear the SSE stage now that we're done — otherwise, if the
            // loading UI is still on screen for any reason (transition
            // between panels, latestResult not yet reflected), it would keep
            // showing "保存中" long after saving finished. Image mode gets
            // this for free because its step ticks flip to success on
            // genStatus === 'success'.
            setVideoProgressStage('');
            jobSucceeded = true;
            // In batch mode the outer loop owns genStatus / success toast — a
            // per-iteration success toast would spam the user and the batch's
            // summary toast at the end covers it.
            if (!overrides) {
              setGenStatus('success');
              addToast(t.toast.videoGenerateSuccess, 'success');
            }
            // Persist how long this run's comfy stage took so the next run's
            // progress bar can crawl at the right pace from the very start.
            if (comfyStartTime !== null) {
              saveLastComfyDurationSeconds((Date.now() - comfyStartTime) / 1000);
            }
          } else if (eventName === 'error') {
            if (dataJson.cancelled) {
              jobCancelled = true;
              if (!overrides) {
                setGenStatus('idle');
                addToast(t.toast.videoGenerateCancelled, 'error');
              }
            } else {
              if (!overrides) {
                setGenStatus('error');
                addToast(t.toast.videoGenerateFailed(dataJson.message ?? 'unknown'), 'error');
              }
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        if (!overrides) {
          setGenStatus('error');
          addToast(t.toast.videoGenerateFailed((e as Error).message), 'error');
        }
      } else {
        jobCancelled = true;
        if (!overrides) setGenStatus('idle');
      }
    } finally {
      clearInterval(videoElapsedTimer);
      setElapsedSeconds(0);
      setVideoComfyElapsedSeconds(0);
      setVideoProgress(null);
      setVideoProgressStage('');
      // Batch mode owns videoLoading for the whole run; only single-shot mode
      // flips it back here so the button re-enables when this one job ends.
      if (!overrides) setVideoLoading(false);
      videoAbortRef.current = null;
    }
    if (overrides) return { success: jobSucceeded, cancelled: jobCancelled };
  };

  // Sequential-loop counterpart to handleBatchGenerate on the video side. The
  // count-only variant of the image batch (Q4 of the design chat: size/model
  // cross-product will land later); enhances the videoPrompt ONCE, then runs
  // N iterations of handleVideoGenerate with per-iteration seed (seed-lock
  // ON keeps them all identical on purpose; OFF randomizes each), sharing
  // the existing batchProgress state so PreviewPanel's "動画 i/N" chip works
  // without new plumbing. Continues on failure and summarizes via toast.
  // Full video-batch runner: outer image loop × inner count loop, so
  // total = videoSourceImages.length * countPerImage. Also drives the plain
  // "動画を生成する" single-shot button — that one just calls this with
  // countPerImage=1, so the array-of-N staging path is exercised by both
  // buttons and there is no separate 1-image-1-video code path to maintain.
  const handleVideoBatchGenerate = async (countPerImage: number) => {
    if (videoSourceImages.length === 0 || videoLoading || countPerImage < 1) return;
    const sources = videoSourceImages;
    const total = sources.length * countPerImage;
    videoBatchCancelledRef.current = false;
    setVideoLoading(true);
    setErrorStep(null);
    setRightTab('preview');
    setCurrentGeneration(null);
    setLatestResult(null);
    setGenStatus('generating');
    // Enhance step (1) is only visible while LM Studio is actually being
    // called. Otherwise jump straight to step 2 — same rule as the image
    // pipelines. Batch counter — always {current, total} — is what
    // PreviewPanel uses to render the "動画 i/N" chip.
    if (videoPrompt.trim() !== '') setLoadingStep(1);
    else setLoadingStep(2);

    try {
      // Enhance ONCE — same skip-if-empty rule as single-shot. The enhanced
      // prompt is reused for every image AND every iteration.
      const trimmedVideoPrompt = videoPrompt.trim();
      let effectivePositive: string;
      let effectiveNegative: string;
      if (trimmedVideoPrompt === '') {
        effectivePositive = VIDEO_POSITIVE_PREFIX;
        effectiveNegative = VIDEO_NEGATIVE_PREFIX;
      } else {
        const enhanceRes = await fetch(`${API_BASE}/video/enhance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmedVideoPrompt }),
        });
        if (!enhanceRes.ok) throw new Error(`video enhance HTTP ${enhanceRes.status} ${enhanceRes.statusText}`);
        const enhanced = await enhanceRes.json() as { positive: string; negative: string };
        effectivePositive = `${VIDEO_POSITIVE_PREFIX} ${enhanced.positive}`;
        effectiveNegative = `${VIDEO_NEGATIVE_PREFIX}, ${enhanced.negative}`;
      }
      // Enhance done — the double loop stays on step 2 until each iteration's
      // saving stage flips it to 3 inside handleVideoGenerate.
      setLoadingStep(2);

      let succeeded = 0;
      let failed = 0;
      let cancelledInLoop = false;
      let runningIndex = 0;
      outer: for (const src of sources) {
        for (let i = 0; i < countPerImage; i++) {
          if (videoBatchCancelledRef.current) { cancelledInLoop = true; break outer; }
          runningIndex++;
          setBatchProgress({ current: runningIndex, total });
          const seed = resolveVideoSeed(videoSeed, videoSeedLocked);
          const outcome = await handleVideoGenerate({
            effectivePositive,
            effectiveNegative,
            videoPromptOriginal: trimmedVideoPrompt,
            seed,
            sourceImage: src,
          });
          if (outcome?.cancelled) { cancelledInLoop = true; break outer; }
          if (outcome?.success) succeeded++;
          else failed++;
        }
      }

      if (cancelledInLoop) {
        setGenStatus(succeeded > 0 ? 'success' : 'idle');
        addToast(t.toast.videoBatchCancelled(succeeded), 'success');
      } else if (succeeded === 0) {
        setErrorStep(2);
        setGenStatus('error');
        addToast(t.toast.videoBatchPartial(total, succeeded, failed), 'error');
      } else if (failed === 0) {
        setGenStatus('success');
        // Single-video case falls through to the plain success toast so
        // nothing user-visible changes for a 1-source, 1-count run.
        if (total === 1) addToast(t.toast.videoGenerateSuccess, 'success');
        else addToast(t.toast.videoBatchAllSuccess(succeeded), 'success');
      } else {
        setGenStatus('success');
        addToast(t.toast.videoBatchPartial(total, succeeded, failed), 'error');
      }
    } catch (error: any) {
      // The one-time enhance failed before the loop even started.
      setErrorStep(1);
      setGenStatus('error');
      addToast(t.toast.videoGenerateFailed(error.message), 'error');
    } finally {
      setVideoLoading(false);
      setBatchProgress(null);
    }
  };

  // Cancel button for an in-flight video generation: best-effort interrupt on
  // the server (ComfyUI itself), then abort the client's own fetch/SSE read
  // so the loop above doesn't keep waiting on a stream the server may not
  // close promptly.
  const handleVideoCancel = async () => {
    // When a video batch is running, also raise the batch-level flag so the
    // outer loop stops between iterations instead of just interrupting the
    // current job and immediately queuing the next one. Mirrors ADR-17's
    // client-side cancel flag for image batches.
    if (batchProgress) {
      videoBatchCancelledRef.current = true;
    }
    try {
      await fetch(`${API_BASE}/video/generate/interrupt`, { method: 'POST' });
    } catch {
      // best effort — the fetch abort below still stops the client side regardless
    }
    videoAbortRef.current?.abort();
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppHeader
        user={user}
        cloudActive={cloudActive}
        health={health}
        healthChecking={healthChecking}
        onSignInError={(msg) => addToast(msg, 'error')}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={toggleNotifications}
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
          batchModalOpen={showBatchModal}
          onOpenVideoBatchModal={() => setShowVideoBatchModal(true)}
          videoBatchModalOpen={showVideoBatchModal}
          activeTab={activeControlTab}
          onTabChange={switchControlTab}
          rollups={rollups}
          onApplyRecipe={applyRecipe}
          onApplyRecipeToGalleryFilter={applyRecipeToGalleryFilter}
          loadedPositive={loadedPositive}
          loadedNegative={loadedNegative}
          onClearLoadedEnhanced={clearLoadedEnhanced}
          // Video-mode state and handlers (Task 5, Plan 2).
          videoMode={videoMode}
          setVideoMode={setVideoMode}
          videoSourceImages={videoSourceImages}
          onRemoveVideoSourceAt={removeVideoSourceImageAt}
          onClearVideoSources={() => setVideoSourceImages([])}
          videoDimensionMode={videoDimensionMode}
          setVideoDimensionMode={setVideoDimensionMode}
          videoPrompt={videoPrompt}
          setVideoPrompt={setVideoPrompt}
          videoWidth={videoWidth}
          setVideoWidth={setVideoWidth}
          videoHeight={videoHeight}
          setVideoHeight={setVideoHeight}
          videoLength={videoLength}
          setVideoLength={setVideoLength}
          videoFidelity={videoFidelity}
          setVideoFidelity={setVideoFidelity}
          videoMotion={videoMotion}
          setVideoMotion={setVideoMotion}
          videoIdentity={videoIdentity}
          setVideoIdentity={setVideoIdentity}
          videoSeed={videoSeed}
          setVideoSeed={setVideoSeed}
          videoSeedLocked={videoSeedLocked}
          setVideoSeedLocked={setVideoSeedLocked}
          onVideoGenerate={() => {
            // Single- and multi-image runs both flow through the batch
            // runner with countPerImage=1. A 1-source, 1-count call keeps
            // batchProgress at {1,1} and falls back to the plain single-
            // shot success toast, so nothing changes for the classic path.
            if (videoSourceImages.length === 1) handleVideoGenerate();
            else handleVideoBatchGenerate(1);
          }}
          videoLoading={videoLoading}
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
            {([['preview', t.tabs.preview], ['gallery', t.tabs.gallery(history.length)]] as const).map(([key, label]) => (
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
              isSelected={!!currentGeneration && !!currentGeneration.id && selectedIds.has(itemKey(currentGeneration))}
              onToggleSelect={(item) => {
                // The gallery selection set is keyed by itemKey (matching the
                // way HistoryGallery and Lightbox toggle selection). Pre-save
                // preview state has no id yet — silently no-op in that window
                // to mirror toggleFavorite's own id-guard.
                if (!item.id) return;
                toggleSelected(itemKey(item));
              }}
              onLoadIntoForm={loadIntoForm}
              onRequestDelete={requestDelete}
              itemKey={itemKey}
              onCancel={videoMode ? handleVideoCancel : requestCancel}
              latestResult={latestResult}
              currentMediaType={videoMode ? 'video' : 'image'}
              videoProgressStage={videoProgressStage}
              videoProgressComfyFraction={estimateComfyFractionByTime(
                videoComfyElapsedSeconds,
                loadLastComfyDurationSeconds() ?? DEFAULT_EXPECTED_COMFY_SECONDS,
              )}
              videoProgressNode={videoProgress?.currentNode ?? null}
              videoProgressStep={videoProgress ? { value: videoProgress.stepValue, max: videoProgress.stepMax } : null}
              onOpenVideoForm={handleOpenVideoForm}
              onOpenChildVideos={handleOpenChildVideos}
              childVideoCount={currentGeneration?.id ? (effectiveVideoParentCounts.get(currentGeneration.id) ?? 0) : 0}
              onOpenParentImage={handleOpenParentImage}
              onReloadVideoRun={handleReloadVideoRun}
            />
          )}

          {rightTab === 'gallery' && (
            <HistoryGallery
              historyLength={history.length}
              displayedHistory={displayedHistory}
              baseScopedHistory={baseScopedHistory}
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
              baseScopedHistoryLength={baseScopedHistory.length}
              galleryFilters={galleryFilters}
              onSetGalleryFilters={setGalleryFilters}
              availableModels={availableModels}
              availableSamplers={filterOptions.samplers}
              availableAspectRatios={filterOptions.aspectRatios}
              availableOrientations={filterOptions.orientations}
              videoParentCounts={effectiveVideoParentCounts}
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
        randomMode={randomMode}
        onToggleRandom={() => setRandomMode((v) => !v)}
        slideshowPlaying={slideshowPlaying}
        onToggleSlideshow={() => setSlideshowPlaying((v) => !v)}
        slideshowIntervalMs={slideshowIntervalMs}
        onCycleSlideshowInterval={cycleSlideshowInterval}
        onOpenInPreview={() => {
          const item = displayedHistory[lightboxIndex];
          if (!item) return;
          openInPreview(item);
          closeLightbox();
        }}
        openInPreviewDisabled={genStatus === 'enhancing' || genStatus === 'generating' || genStatus === 'saving'}
        onClose={closeLightbox}
        onDownload={() => { if (lightboxMeta) handleDownload(lightboxMeta); }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenVideoForm={() => { if (lightboxMeta) handleOpenVideoForm(lightboxMeta); }}
        onOpenChildVideos={handleOpenChildVideos}
        onOpenParentImage={handleOpenParentImage}
        childVideoCount={lightboxChildVideoCount}
      />

      <DeleteConfirmModal
        open={showDeleteConfirm}
        targetCount={deleteTargetIds.length}
        childVideoCount={childVideoCount}
        deleting={deleting}
        exiting={confirmExiting}
        onCancel={closeConfirm}
        onConfirm={handleDeleteSelected}
      />

      <BatchGenerationModal
        open={showBatchModal}
        onClose={closeBatchModal}
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
          addToast(t.toast.batchStarted, 'success');
          setShowBatchModal(false);
          handleBatchGenerate(jobs);
        }}
      />

      <VideoBatchGenerationModal
        open={showVideoBatchModal}
        onClose={() => setShowVideoBatchModal(false)}
        batchCount={videoBatchCount}
        setBatchCount={setVideoBatchCount}
        onStartBatch={() => {
          setShowVideoBatchModal(false);
          handleVideoBatchGenerate(videoBatchCount);
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
