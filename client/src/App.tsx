import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  Image as ImageIcon,
  RotateCw,
  Cloud,
  Folder,
  X,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Trash2,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Layers,
  Star,
} from 'lucide-react';
import { isFirebaseConfigured, onAuth, signInWithGoogle, signOutUser, saveGeneration, subscribeGenerations, subscribeFavorites, updateFavorite, deleteGenerations, type AuthUser, type GenerationRecord, type GenerationParams } from './firebase';
import { flushSync } from 'react-dom';

// View Transitions API (Baseline 2025-10); typed locally so it works regardless of lib.dom version.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void>; ready: Promise<void> };
};

interface GenerationData {
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
  isFavorite?: boolean;
}

interface HealthStatus {
  lmStudio: { connected: boolean; model: string | null; error: string | null };
  stableDiffusion: { connected: boolean; error: string | null };
}

// Top-right connection indicator for a single upstream service.
// checking → muted pulsing dot, connected → green (with optional model name), else → red.
function ServiceStatusBadge({ label, checking, connected, detail }: {
  label: string;
  checking: boolean;
  connected: boolean;
  detail?: string | null;
}) {
  const color = checking ? 'var(--text-muted)' : connected ? 'var(--pop-green)' : 'var(--danger)';
  // Long model names (e.g. "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF") would
  // blow out the status bar, so cap the shown detail at ~20 chars; full value stays on hover.
  const shownDetail = detail && detail.length > 20 ? `${detail.slice(0, 20)}...` : detail;
  const text = checking
    ? `${label} 確認中…`
    : connected
      ? `${label} 接続中${shownDetail ? ` (${shownDetail})` : ''}`
      : `${label} 未接続`;
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '6px', color, fontWeight: '700' }}
      title={connected && detail ? detail : undefined}
    >
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color,
        boxShadow: connected && !checking ? `0 0 6px ${color}` : 'none',
        animation: checking ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }}></span>
      <span>{text}</span>
    </div>
  );
}

// Bottom-right selection toggle overlaid on a gallery tile. Mirrors the
// lightbox's select-button design (CheckCircle2/Circle icons, blue when
// selected with white border + blue glow) so the two controls read as the
// same affordance. Uses a dark translucent unselected background instead of
// the lightbox's light one, since gallery tiles sit over arbitrary image
// content rather than the lightbox's dark backdrop.
function SelectButton({
  isSelected,
  onClick,
  size = 30,
}: {
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
}) {
  const iconSize = Math.round(size * 0.5);
  return (
    <button
      type="button"
      onClick={onClick}
      title={isSelected ? '選択を解除' : '選択'}
      className="scale-hover"
      style={{
        position: 'absolute',
        bottom: '8px',
        right: '8px',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: isSelected ? '2px solid #fff' : 'none',
        background: isSelected ? 'var(--pop-blue)' : 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: isSelected ? '0 0 0 3px rgba(51, 154, 240, 0.35)' : '0 2px 6px rgba(0,0,0,0.25)'
      }}
    >
      {isSelected ? <CheckCircle2 size={iconSize} /> : <Circle size={iconSize} />}
    </button>
  );
}

// Bottom-right "favorite" button overlaid on an image. Alone (stackedAbove=0)
// it sits at the baseline bottom:8px; when a sibling button of height N is
// pinned below, pass stackedAbove={N} to stack this one N+8px above it.
// OFF state shows an outline Star; ON state fills it yellow.
function FavoriteButton({
  isFavorite,
  onClick,
  size = 30,
  stackedAbove = 0,
}: {
  isFavorite: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  stackedAbove?: number;
}) {
  const iconSize = Math.round(size * 0.5);
  return (
    <button
      type="button"
      onClick={onClick}
      title={isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'}
      className="scale-hover"
      style={{
        position: 'absolute',
        bottom: stackedAbove > 0 ? `${8 + stackedAbove + 8}px` : '8px',
        right: '8px',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
      }}
    >
      {isFavorite
        ? <Star size={iconSize} fill="#ffd43b" stroke="#ffd43b" />
        : <Star size={iconSize} />}
    </button>
  );
}

// Candidate sizes offered as toggle chips in the batch dialog's size mode
// (covers common SD1.5 / SDXL resolutions). Same set for width and height.
const SIZE_OPTIONS = [512, 768, 1024];
// Defensive cap on the width×height cross product (3×3 = 9 today, room to grow).
const MAX_SIZE_COMBINATIONS = 16;

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
  interface Toast {
    id: string;
    message: string;
    type: 'error' | 'success';
  }
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

  const handleSwapDimensions = () => {
    const temp = width;
    setWidth(height);
    setHeight(temp);
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
  const [sdModels, setSdModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [sdSamplers, setSdSamplers] = useState<string[]>([]);
  const [selectedSampler, setSelectedSampler] = useState('');
  const [sdSchedulers, setSdSchedulers] = useState<string[]>([]);
  const [selectedScheduler, setSelectedScheduler] = useState('');
  const [sdLoras, setSdLoras] = useState<string[]>([]);
  const [selectedLoras, setSelectedLoras] = useState<{ name: string; weight: number }[]>([]);
  const [sdUpscalers, setSdUpscalers] = useState<string[]>([]);
  const [hiresFixEnabled, setHiresFixEnabled] = useState(false);
  const [selectedUpscaler, setSelectedUpscaler] = useState('');
  const [hiresScale, setHiresScale] = useState(1.5);
  const [hiresSteps, setHiresSteps] = useState(0);
  const [hiresDenoising, setHiresDenoising] = useState(0.5);
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

  // Single-click toggles selection. (A double-click fires onClick twice — toggling
  // back to the original state — then onDoubleClick recalls the image into preview.)
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

  const closeLightbox = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); } // leave OS fullscreen before closing
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

  // Index of the lightbox image within the displayed gallery order (-1 if not listed),
  // used to disable the prev/next buttons at the ends.
  const lightboxIndex = lightboxUrl
    ? displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl)
    : -1;

  // Track the last valid lightboxIndex so we can recover the "next" item if
  // the currently-shown image drops out of displayedHistory (e.g. unfavorited
  // in favoritesOnly mode).
  const prevLightboxIndexRef = useRef(-1);
  useEffect(() => {
    if (lightboxIndex >= 0) prevLightboxIndexRef.current = lightboxIndex;
  }, [lightboxIndex]);

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
  const [selectedWidths, setSelectedWidths] = useState<number[]>([...SIZE_OPTIONS]);
  const [selectedHeights, setSelectedHeights] = useState<number[]>([...SIZE_OPTIONS]);
  // Models picked for model-cycling batch. Reset to "all selected" each time the
  // modal opens (via openBatchModal) so the default is always the full available
  // list — the user opts OUT of specific models for that one batch.
  const [selectedBatchModels, setSelectedBatchModels] = useState<Set<string>>(new Set());

  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels));
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
    }
  }, [health?.stableDiffusion.connected]);

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
        const models: string[] = Array.isArray(data.models) ? data.models : [];
        setSdModels(models);
        setSelectedModel((prev) => prev || data.current || '');
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
  const loadIntoForm = (item: GenerationData) => {
    setPrompt(item.originalPrompt);
    setWidth(item.width);
    setHeight(item.height);
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
    if (item.seed !== undefined) {
      setSeedLocked(true);
      setSeedValue(item.seed);
    } else {
      setSeedLocked(false);
    }
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

  // Pending single-click timer for gallery images. Single-click and double-click
  // on the same element are ambiguous: React fires onClick twice AND onDoubleClick
  // on a double-click. To keep both behaviors — click → lightbox, double-click →
  // recall into preview — we defer the lightbox open by GALLERY_CLICK_DELAY_MS,
  // and cancel the pending timer if a double-click (or a second click) arrives
  // within that window. The tradeoff is a small perceived lag on single-click.
  const galleryClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const GALLERY_CLICK_DELAY_MS = 250;

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

  // One image's parameters in a batch run. All batch modes (count, size cross-product,
  // model-cycling) build a BatchJob[] and feed it to the single sequential loop in
  // handleBatchGenerate. `model` overrides the form's selectedModel for that one job
  // (used by model-cycling mode); when absent, the job uses selectedModel as usual.
  type BatchJob = { width: number; height: number; model?: string };

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

  const toggleSize = (
    setter: React.Dispatch<React.SetStateAction<number[]>>,
    value: number
  ) => {
    setter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <header className="glass-panel" style={{ 
        margin: '20px', 
        padding: '16px 24px', 
        borderRadius: '18px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        background: 'var(--panel-bg)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--pop-blue) 0%, var(--pop-teal) 100%)',
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(51, 154, 240, 0.25)'
          }}>
            <Sparkles size={22} color="#fff" />
          </div>
          <div style={{ textAlign: 'left' }}>
            <h1 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '0.2px', margin: 0, background: 'linear-gradient(135deg, var(--pop-blue) 30%, var(--pop-teal) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Sumica AI Studio 🎨⚡️
            </h1>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '1.5px', marginTop: '1px', fontWeight: '700' }}>
              Creative Image Lab
            </span>
          </div>
        </div>

        {/* STATUS BAR & SETTINGS BUTTON */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', background: 'var(--panel-bg-sunk)', padding: '8px 16px', borderRadius: '30px', border: '2px solid var(--panel-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
            {/* Storage mode + account */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: cloudActive ? 'var(--pop-green)' : 'var(--text-secondary)', fontWeight: '700' }}>
              {cloudActive ? (<><Cloud size={14} /><span>クラウド保存 ☁️</span></>) : (<><Folder size={14} /><span>ローカル保存 📁</span></>)}
            </div>

            {isFirebaseConfigured && (
              <>
                <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>
                {user ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {user.photoURL && (
                      <img src={user.photoURL} alt="" referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: '50%' }} />
                    )}
                    <span style={{ fontWeight: 700, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName ?? 'ユーザー'}</span>
                    <button onClick={() => { signOutUser(); }} className="scale-hover" style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>ログアウト</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { signInWithGoogle().catch((e) => addToast(`サインインに失敗しました: ${e.message}`, 'error')); }}
                    className="scale-hover"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', borderRadius: '20px', padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                  >
                    <LogIn size={14} /> Googleでログイン
                  </button>
                )}
              </>
            )}

            <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>
            
            {/* LM Studio Status (live health check) */}
            <ServiceStatusBadge
              label="LM Studio"
              checking={healthChecking && !health}
              connected={!!health?.lmStudio.connected}
              detail={health?.lmStudio.model}
            />

            <div style={{ width: '2px', height: '12px', background: 'var(--panel-border)' }}></div>

            {/* Stable Diffusion Status (live health check) */}
            <ServiceStatusBadge
              label="SD"
              checking={healthChecking && !health}
              connected={!!health?.stableDiffusion.connected}
            />
          </div>
        </div>
      </header>

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
        {/* LEFT COLUMN: CONTROL PANEL */}
        <section className="glass-panel" style={{ 
          padding: '24px', 
          display: 'flex', 
          flexDirection: 'column', 
          borderRadius: '20px',
          overflow: 'hidden',
          height: '100%'
        }}>

          <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Container splitting prompt input and advanced settings into equal halves.
                minmax(0, 1fr) rows force exactly-equal tracks regardless of content height. */}
            <div style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: '20px',
              paddingRight: '6px',
              marginBottom: '16px'
            }}>
              {/* PROMPT AREA */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left', flex: 1, minHeight: 0 }}>
                <label style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  生成プロンプト (日本語または英語)
                </label>
                <textarea
                  className="input-field"
                  placeholder="生成したい画像の内容を入力してください... (例: 'サイバーパンクな都市、雨に濡れたネオン、未来的、シネマティック照明')"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  style={{ flex: 1, minHeight: 0, resize: 'none', lineHeight: '1.4', borderRadius: '12px' }}
                  required
                  disabled={loading}
                />
              </div>

              {/* AI ENHANCEMENT IS ALWAYS ACTIVE */}

              {/* ADVANCED PARAMETERS (ALWAYS OPEN) */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                padding: '18px',
                background: 'var(--panel-bg-sunk)',
                borderRadius: '14px',
                border: '2px solid var(--panel-border)',
                flex: 1,
                minHeight: 0,
                overflowY: 'auto'
              }}>
                {/* Negative Prompt auto-applied by backend */}

                {/* Stable Diffusion Model Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>モデル (Stable Diffusion)</label>
                  {sdModels.length > 0 ? (
                    <select
                      className="input-field"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    >
                      {sdModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                      <option>モデル一覧を取得できません（SD未接続）</option>
                    </select>
                  )}
                </div>

                {/* Sampler + Schedule Type — paired side-by-side when SD exposes a
                    scheduler list (AUTOMATIC1111 ≥1.9 / recent Forge). On older SD
                    builds the scheduler picker is hidden and the sampler stretches
                    to fill the row via `gridColumn: '1 / -1'`. */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', gridColumn: sdSchedulers.length > 0 ? 'auto' : '1 / -1' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>サンプラー (Sampler)</label>
                    {sdSamplers.length > 0 ? (
                      <select
                        className="input-field"
                        value={selectedSampler}
                        onChange={(e) => setSelectedSampler(e.target.value)}
                        disabled={loading}
                        style={{ borderRadius: '8px' }}
                      >
                        {sdSamplers.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                        <option>サンプラー一覧を取得できません（SD未接続）</option>
                      </select>
                    )}
                  </div>

                  {sdSchedulers.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                      <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>スケジュール (Schedule Type)</label>
                      <select
                        className="input-field"
                        value={selectedScheduler}
                        onChange={(e) => setSelectedScheduler(e.target.value)}
                        disabled={loading}
                        style={{ borderRadius: '8px' }}
                      >
                        {sdSchedulers.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Size Select with Swap Button */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.6fr 1.2fr', gap: '8px', alignItems: 'end', textAlign: 'left' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>解像度 (幅)</label>
                    <select 
                      className="input-field" 
                      value={width} 
                      onChange={(e) => setWidth(parseInt(e.target.value))}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    >
                      <option value="512">512 px</option>
                      <option value="768">768 px</option>
                      <option value="1024">1024 px</option>
                    </select>
                  </div>
                  
                  <button
                    type="button"
                    onClick={handleSwapDimensions}
                    disabled={loading}
                    className="scale-hover"
                    style={{
                      background: 'rgba(51, 154, 240, 0.08)',
                      border: '2px solid rgba(51, 154, 240, 0.2)',
                      color: 'var(--pop-blue)',
                      borderRadius: '8px',
                      height: '42px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      marginBottom: '2px'
                    }}
                    title="幅と高さを入れ替える"
                  >
                    <ArrowLeftRight size={16} />
                  </button>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>解像度 (高さ)</label>
                    <select 
                      className="input-field" 
                      value={height} 
                      onChange={(e) => setHeight(parseInt(e.target.value))}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    >
                      <option value="512">512 px</option>
                      <option value="768">768 px</option>
                      <option value="1024">1024 px</option>
                    </select>
                  </div>
                </div>

                {/* Steps */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    <span>サンプリングステップ数 (Steps)</span>
                    <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{steps}</span>
                  </div>
                  <input 
                    type="range" 
                    min="10" 
                    max="50" 
                    value={steps} 
                    onChange={(e) => setSteps(parseInt(e.target.value))}
                    disabled={loading}
                  />
                </div>

                {/* CFG Scale */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    <span>プロンプト追従性 (CFG Scale)</span>
                    <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{cfgScale}</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="20" 
                    step="0.5"
                    value={cfgScale} 
                    onChange={(e) => setCfgScale(parseFloat(e.target.value))}
                    disabled={loading}
                  />
                </div>
                {/* Hires.fix */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: loading ? 'default' : 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    <input
                      type="checkbox"
                      checked={hiresFixEnabled}
                      onChange={(e) => setHiresFixEnabled(e.target.checked)}
                      disabled={loading}
                    />
                    Hires.fixを有効にする
                  </label>
                  {hiresFixEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '4px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>アップスケーラー (Upscaler)</label>
                        {sdUpscalers.length > 0 ? (
                          <select
                            className="input-field"
                            value={selectedUpscaler}
                            onChange={(e) => setSelectedUpscaler(e.target.value)}
                            disabled={loading}
                            style={{ borderRadius: '8px' }}
                          >
                            <option value="">SDのデフォルトを使用</option>
                            {sdUpscalers.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        ) : (
                          <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                            <option>アップスケーラー一覧を取得できません（SD未接続）</option>
                          </select>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                          <span>アップスケール倍率</span>
                          <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{hiresScale.toFixed(1)}x</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="2"
                          step="0.1"
                          value={hiresScale}
                          onChange={(e) => setHiresScale(parseFloat(e.target.value))}
                          disabled={loading}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                          <span>Hires用ステップ数 (0 = Stepsと同じ)</span>
                          <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{hiresSteps === 0 ? 'Stepsと同じ' : hiresSteps}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="50"
                          value={hiresSteps}
                          onChange={(e) => setHiresSteps(parseInt(e.target.value))}
                          disabled={loading}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                          <span>Denoising strength</span>
                          <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{hiresDenoising.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={hiresDenoising}
                          onChange={(e) => setHiresDenoising(parseFloat(e.target.value))}
                          disabled={loading}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {/* LoRA (multiple, each with a weight) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>LoRA (複数適用可)</label>
                  {sdLoras.length > 0 ? (
                    <select
                      className="input-field"
                      value=""
                      onChange={(e) => addLora(e.target.value)}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    >
                      <option value="">＋ LoRAを追加…</option>
                      {sdLoras.filter((n) => !selectedLoras.some((l) => l.name === n)).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  ) : (
                    <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                      <option>LoRA一覧を取得できません（SD未接続）</option>
                    </select>
                  )}
                  {selectedLoras.map((l) => (
                    <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--panel-bg)', border: '2px solid var(--panel-border)', borderRadius: '8px', padding: '6px 8px' }}>
                      <span style={{ flex: 1, fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>{l.name}</span>
                      <input
                        type="range"
                        min="0"
                        max="1.5"
                        step="0.05"
                        value={l.weight}
                        onChange={(e) => setLoraWeight(l.name, parseFloat(e.target.value))}
                        disabled={loading}
                        style={{ width: '90px' }}
                      />
                      <span style={{ fontSize: '11px', fontWeight: '800', color: 'var(--pop-blue)', width: '30px', textAlign: 'right' }}>{l.weight.toFixed(2)}</span>
                      <button type="button" onClick={() => removeLora(l.name)} disabled={loading} title="このLoRAを外す" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Seed */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: loading ? 'default' : 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    <input
                      type="checkbox"
                      checked={seedLocked}
                      onChange={(e) => setSeedLocked(e.target.checked)}
                      disabled={loading}
                    />
                    Seedを固定する
                  </label>
                  {seedLocked && (
                    <input
                      type="number"
                      className="input-field"
                      min={0}
                      step={1}
                      value={seedValue}
                      onChange={(e) => setSeedValue(parseInt(e.target.value) || 0)}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* GENERATE BUTTONS - Always visible and pinned at bottom */}
            <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
              <button
                type="submit"
                className="btn-neon"
                disabled={loading || !prompt.trim()}
                style={{
                  flex: 1,
                  padding: '16px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  fontSize: '17px',
                  whiteSpace: 'nowrap',
                  minWidth: 0
                }}
              >
                {loading ? (
                  <>
                    <RotateCw size={20} className="animate-spin-custom" />
                    <span>生成リクエストを実行中... ⚡️</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    <span>画像を生成する 🎨⚡️</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={openBatchModal}
                disabled={loading || !prompt.trim()}
                className="scale-hover"
                title="複数枚をまとめて生成"
                aria-label="複数枚をまとめて生成"
                style={{
                  flexShrink: 0,
                  padding: '16px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--panel-bg)',
                  color: 'var(--pop-blue)',
                  border: '2px solid var(--pop-blue)',
                  cursor: (loading || !prompt.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !prompt.trim()) ? 0.5 : 1
                }}
              >
                <Layers size={22} />
              </button>
            </div>
          </form>
        </section>

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
              </button>
            ))}
          </div>

          {/* TAB CONTENT (scrollable) */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {rightTab === 'preview' && (<>
          {/* GENERATION PREVIEW STAGE */}
          <div className="glass-panel" style={{
            padding: '24px',
            borderRadius: '20px',
            minHeight: '380px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {currentGeneration ? (
              <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 1.2fr', gap: '24px', alignItems: 'start' }}>
                {/* Image Frame — hugs the image and centers within its grid track */}
                <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '2px solid var(--panel-border-hover)', boxShadow: '0 8px 24px rgba(0,0,0,0.06)', justifySelf: 'center', maxWidth: '100%', minHeight: 0 }}>
                  <img
                    src={currentGeneration.imageUrl}
                    alt="Generated output"
                    onClick={() => openLightbox(currentGeneration.imageUrl, '__preview__')}
                    style={{ maxWidth: '100%', maxHeight: '48vh', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block', cursor: 'pointer', viewTransitionName: (morphSourceKey === '__preview__' && !lightboxUrl) ? 'lightbox-morph' : undefined }}
                  />
                  <FavoriteButton
                    size={34}
                    stackedAbove={0}
                    isFavorite={!!currentGeneration.isFavorite}
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(currentGeneration); }}
                  />
                  <div style={{ 
                    position: 'absolute', 
                    top: '12px', 
                    left: '12px', 
                    background: 'rgba(255,255,255,0.92)', 
                    backdropFilter: 'blur(4px)', 
                    padding: '4px 12px', 
                    borderRadius: '20px', 
                    fontSize: '12px', 
                    fontWeight: '700', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    border: '1.5px solid var(--panel-border-hover)',
                    color: 'var(--text-primary)'
                  }}>
                    {currentGeneration.backendMode === 'firebase' ? (
                      <>
                        <Cloud size={12} color="var(--pop-blue)" />
                        <span style={{ color: 'var(--pop-blue)' }}>クラウド保存 ☁️</span>
                      </>
                    ) : (
                      <>
                        <Folder size={12} color="var(--pop-orange)" />
                        <span style={{ color: 'var(--pop-orange)' }}>ローカル保存 📁</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Prompt Info column: fixed toolbar on top, scrollable detail below */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left', maxHeight: '48vh', minHeight: 0 }}>
                  {/* Toolbar — always visible */}
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => loadIntoForm(currentGeneration)}
                      className="scale-hover"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'rgba(51, 154, 240, 0.08)', border: '2px solid rgba(51, 154, 240, 0.2)', color: 'var(--pop-blue)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ♻️ フォームにロード
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDelete([itemKey(currentGeneration)])}
                      className="scale-hover"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'rgba(255, 107, 107, 0.08)', border: '2px solid rgba(255, 107, 107, 0.25)', color: 'var(--danger)', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      <Trash2 size={15} /> 削除
                    </button>
                  </div>
                  {/* Scrollable detail */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>元プロンプト</span>
                    <p style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px', color: 'var(--text-primary)', lineHeight: '1.4' }}>{currentGeneration.originalPrompt}</p>
                  </div>
                  
                  <div style={{ borderTop: '2px solid var(--panel-border)', paddingTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                    <div>
                      <span>解像度: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.width}x{currentGeneration.height}</strong>
                    </div>
                    <div>
                      <span>ステップ: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.steps}</strong>
                    </div>
                    <div>
                      <span>CFG: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.cfgScale}</strong>
                    </div>
                    {currentGeneration.model && (
                      <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                        <span>モデル: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.model}</strong>
                      </div>
                    )}
                    {currentGeneration.seed !== undefined && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span>Seed: </span>
                        <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{currentGeneration.seed}</strong>
                      </div>
                    )}
                    {currentGeneration.sampler && (
                      <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                        <span>サンプラー: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.sampler}</strong>
                      </div>
                    )}
                    {currentGeneration.scheduler && (
                      <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                        <span>スケジュール: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.scheduler}</strong>
                      </div>
                    )}
                    {currentGeneration.loras && currentGeneration.loras.length > 0 && (
                      <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                        <span>LoRA: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.loras.map((l) => `${l.name} (${l.weight})`).join(', ')}</strong>
                      </div>
                    )}
                    {currentGeneration.enableHr && (
                      <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                        <span>Hires.fix: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          ON ({(currentGeneration.hrScale ?? 2).toFixed(1)}x{currentGeneration.hrUpscaler ? `, ${currentGeneration.hrUpscaler}` : ''})
                        </strong>
                      </div>
                    )}
                  </div>

                  {currentGeneration.enhancedPrompt !== currentGeneration.originalPrompt && (
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--pop-blue)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                        <Sparkles size={11} /> 拡張プロンプト (ポジティブ)
                      </span>
                      <p style={{ fontSize: '12.5px', marginTop: '4px', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.4', background: 'var(--info-bg)', padding: '10px', borderRadius: '8px', border: '2px solid var(--info-border)', wordBreak: 'break-all' }}>
                        {currentGeneration.enhancedPrompt}
                      </p>
                    </div>
                  )}

                  {currentGeneration.negativePrompt && (
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                        ❌ ネガティブプロンプト
                      </span>
                      <p style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)', lineHeight: '1.4', background: 'var(--negative-bg)', padding: '10px', borderRadius: '8px', border: '2px solid var(--negative-border)', wordBreak: 'break-all' }}>
                        {currentGeneration.negativePrompt}
                      </p>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--text-secondary)', padding: '30px 0' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'rgba(51, 154, 240, 0.05)',
                  border: '2px dashed rgba(51, 154, 240, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--pop-blue)'
                }}>
                  <ImageIcon size={28} />
                </div>
                <div>
                  <h3 style={{ color: 'var(--text-primary)', fontSize: '16px', marginBottom: '4px', fontWeight: '800' }}>生成された画像のプレビュー 🖼️</h3>
                  <p style={{ fontSize: '13px', maxWidth: '300px', margin: '0 auto', lineHeight: '1.4' }}>
                    画像を生成すると、ここにプレビューが表示されます。
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* PROCESS TRACKER STAGE */}
          {genStatus !== 'idle' && (
            <div className="glass-panel" style={{
              padding: '20px 24px',
              borderRadius: '20px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              border: genStatus === 'error' ? '2.5px solid var(--danger)' : '2px solid var(--panel-border)',
              boxShadow: genStatus === 'error' ? '0 8px 20px rgba(255, 107, 107, 0.08)' : 'var(--shadow-soft)',
              background: genStatus === 'error' ? 'var(--danger-panel-bg)' : 'var(--panel-bg)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '24px' }}>
                {/* Spinner/Status Icon */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
                    <div style={{ 
                      position: 'absolute', 
                      inset: 0, 
                      border: '3px solid rgba(51, 154, 240, 0.15)', 
                      borderRadius: '50%' 
                    }}></div>
                    {genStatus !== 'error' && genStatus !== 'success' ? (
                      <div style={{ 
                        position: 'absolute', 
                        inset: 0, 
                        border: '3px solid transparent', 
                        borderTopColor: 'var(--pop-blue)', 
                        borderRightColor: 'var(--pop-teal)',
                        borderRadius: '50%',
                      }} className="animate-spin-custom"></div>
                    ) : genStatus === 'error' ? (
                      <div style={{ 
                        position: 'absolute', 
                        inset: 0, 
                        border: '3px solid var(--danger)', 
                        borderRadius: '50%',
                      }}></div>
                    ) : (
                      <div style={{ 
                        position: 'absolute', 
                        inset: 0, 
                        border: '3px solid var(--success)', 
                        borderRadius: '50%',
                      }}></div>
                    )}
                    {genStatus === 'success' ? (
                      <CheckCircle2 style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--success)' }} size={18} />
                    ) : genStatus === 'error' ? (
                      <AlertTriangle style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--danger)' }} size={18} />
                    ) : (
                      <Sparkles style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--pop-blue)' }} className="animate-bounce-custom" size={18} />
                    )}
                  </div>
                  
                  <div style={{ textAlign: 'left' }}>
                    <span style={{ fontSize: '14px', fontWeight: '800', display: 'block', color: genStatus === 'error' ? 'var(--danger)' : genStatus === 'success' ? 'var(--success)' : 'var(--text-primary)' }}>
                      {genStatus === 'error' ? '生成処理エラー ❌' : genStatus === 'success' ? '生成完了！ 🎉' : '画像生成パイプライン進行中... ⚡️'}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {genStatus === 'error' ? '処理の途中でエラーが発生しました' : genStatus === 'success' ? 'すべての処理が正常に完了しました' : 'バックエンドでタスクを実行しています'}
                    </span>
                  </div>

                  {/* Stop button — sits right next to the "画像生成パイプライン進行中" status text. */}
                  {genStatus === 'generating' && (
                    <button
                      type="button"
                      onClick={requestCancel}
                      disabled={cancelling}
                      className="scale-hover"
                      style={{ padding: '8px 16px', borderRadius: '10px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', fontSize: '12px', cursor: cancelling ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {cancelling ? '生成を止めています...' : '生成を止める'}
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  {/* Elapsed/remaining time — sits right next to (to the left of) the
                      steps sequence. Both this row and the stop button above render
                      only during 'generating', so the steps row's own height never
                      changes when a generation starts/stops (it did when these lived
                      in separate rows below, which visibly shifted
                      "プロンプト拡張→画像生成→保存完了"). */}
                  {genStatus === 'generating' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      <span>
                        経過{formatDuration(elapsedSeconds)}
                        {sdProgress && sdProgress.etaRelative > 0 ? ` / 残り約${formatDuration(sdProgress.etaRelative)}` : ''}
                      </span>
                      {sdProgress && (
                        <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: 'var(--panel-border)', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, Math.max(0, sdProgress.progress * 100))}%`,
                            height: '100%',
                            background: 'var(--pop-blue)',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      )}
                    </div>
                  )}

                {/* Steps Horizontally */}
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: (genStatus === 'error' && errorStep === 1) ? 'var(--danger)' : loadingStep >= 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                    <div style={{ 
                      width: '18px', 
                      height: '18px', 
                      borderRadius: '50%', 
                      background: (genStatus === 'error' && errorStep === 1) ? 'var(--danger)' : loadingStep > 1 || genStatus === 'success' ? 'var(--success)' : loadingStep === 1 ? 'var(--pop-blue)' : 'none', 
                      border: '1.5px solid ' + (((genStatus === 'error' && errorStep === 1) ? 'var(--danger)' : loadingStep >= 1 || genStatus === 'success') ? 'transparent' : 'var(--text-muted)'), 
                      color: (loadingStep >= 1 || genStatus === 'success' || (genStatus === 'error' && errorStep === 1)) ? '#fff' : 'var(--text-muted)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '9px', 
                      fontWeight: 'bold' 
                    }}>
                      {(genStatus === 'error' && errorStep === 1) ? '✗' : loadingStep > 1 || genStatus === 'success' ? '✓' : '1'}
                    </div>
                    <span className={genStatus === 'enhancing' ? 'processing-shimmer' : undefined}>プロンプト拡張</span>
                  </div>

                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>➔</span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: (genStatus === 'error' && errorStep === 2) ? 'var(--danger)' : loadingStep >= 2 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                    <div style={{ 
                      width: '18px', 
                      height: '18px', 
                      borderRadius: '50%', 
                      background: (genStatus === 'error' && errorStep === 2) ? 'var(--danger)' : loadingStep > 2 || genStatus === 'success' ? 'var(--success)' : loadingStep === 2 ? 'var(--pop-teal)' : 'none', 
                      border: '1.5px solid ' + (((genStatus === 'error' && errorStep === 2) ? 'var(--danger)' : loadingStep >= 2 || genStatus === 'success') ? 'transparent' : 'var(--text-muted)'), 
                      color: (loadingStep >= 2 || genStatus === 'success' || (genStatus === 'error' && errorStep === 2)) ? '#fff' : 'var(--text-muted)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '9px', 
                      fontWeight: 'bold' 
                    }}>
                      {(genStatus === 'error' && errorStep === 2) ? '✗' : loadingStep > 2 || genStatus === 'success' ? '✓' : '2'}
                    </div>
                    <span className={genStatus === 'generating' ? 'processing-shimmer' : undefined}>画像生成{batchProgress ? ` (${batchProgress.current}/${batchProgress.total})` : ''}</span>
                  </div>

                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>➔</span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: (genStatus === 'error' && errorStep === 3) ? 'var(--danger)' : loadingStep >= 3 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                    <div style={{ 
                      width: '18px', 
                      height: '18px', 
                      borderRadius: '50%', 
                      background: (genStatus === 'error' && errorStep === 3) ? 'var(--danger)' : genStatus === 'success' ? 'var(--success)' : loadingStep === 3 ? 'var(--pop-orange)' : 'none', 
                      border: '1.5px solid ' + (((genStatus === 'error' && errorStep === 3) ? 'var(--danger)' : loadingStep === 3 || genStatus === 'success') ? 'transparent' : 'var(--text-muted)'), 
                      color: (loadingStep === 3 || genStatus === 'success' || (genStatus === 'error' && errorStep === 3)) ? '#fff' : 'var(--text-muted)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '9px', 
                      fontWeight: 'bold' 
                    }}>
                      {(genStatus === 'error' && errorStep === 3) ? '✗' : genStatus === 'success' ? '✓' : '3'}
                    </div>
                    <span>保存完了</span>
                  </div>
                </div>
                </div>
              </div>
            </div>
          )}
          </>)}

          {/* HISTORY GALLERY */}
          {rightTab === 'gallery' && (
          <div style={{ flexShrink: 0 }}>
            {/* Toolbar: date filter + result count (left) / selection + delete (right).
                Sticks to the top of the surrounding scroll container so it stays
                visible while the image grid below scrolls — `top: 0` pins it at
                the TAB CONTENT scroll edge, and the opaque white background keeps
                the image grid from showing through. */}
            <div style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              marginBottom: '16px',
              padding: '8px 16px',
              background: 'var(--panel-bg)',
              border: '2px solid var(--panel-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexDirection: 'row-reverse',
              gap: '12px',
              flexWrap: 'wrap',
              minHeight: '40px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', opacity: favoritesOnly ? 0.4 : 1 }}>
                  📅
                  <input
                    type="date"
                    className="input-field"
                    value={filterDate}
                    onChange={(e) => { if (e.target.value) setFilterDate(e.target.value); }}
                    disabled={favoritesOnly}
                    style={{ borderRadius: '8px', padding: '5px 8px', fontSize: '13px', width: 'auto' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setFavoritesOnly((v) => !v)}
                  title={favoritesOnly ? 'お気に入りのみの表示を解除' : 'お気に入りのみ表示'}
                  className="scale-hover"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 10px',
                    borderRadius: '8px',
                    border: favoritesOnly ? 'none' : '1.5px solid var(--panel-border)',
                    background: favoritesOnly ? 'var(--pop-blue)' : 'transparent',
                    color: favoritesOnly ? '#fff' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {favoritesOnly
                    ? <Star size={14} fill="#ffd43b" stroke="#ffd43b" />
                    : <Star size={14} />}
                  お気に入りのみ
                </button>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>{displayedHistory.length}件</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: selectedIds.size > 0 ? 'var(--pop-blue)' : 'var(--text-muted)' }}>
                  {selectedIds.size}件選択
                </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedIds.size === 0}
                className={selectedIds.size === 0 ? '' : 'scale-hover'}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  padding: '4px 8px',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedIds.size === 0 ? 0.6 : 1
                }}
              >
                全解除
              </button>
              <button
                type="button"
                onClick={() => requestDelete([...selectedIds])}
                disabled={selectedIds.size === 0}
                className={selectedIds.size === 0 ? '' : 'scale-hover'}
                style={{
                  background: 'none',
                  border: 'none',
                  color: selectedIds.size === 0 ? 'var(--text-muted)' : 'var(--danger)',
                  padding: '4px 8px',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedIds.size === 0 ? 0.6 : 1
                }}
              >
                削除
              </button>
              </div>
            </div>
            {displayedHistory.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: '18px'
              }}>
                {displayedHistory.map((item) => (
                  <div
                    key={itemKey(item)}
                    className="glass-panel scale-hover"
                    style={{
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: selectedIds.has(itemKey(item)) ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                      boxShadow: selectedIds.has(itemKey(item)) ? '0 0 0 3px rgba(51, 154, 240, 0.25)' : 'none',
                      position: 'relative'
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img
                        src={item.thumbnailUrl ?? item.imageUrl}
                        alt={item.originalPrompt}
                        onClick={() => {
                          if (galleryClickTimerRef.current !== null) {
                            clearTimeout(galleryClickTimerRef.current);
                          }
                          // Lightbox always shows the full-resolution imageUrl,
                          // even when the tile displayed a thumbnail — click →
                          // zoom to the real thing.
                          const url = item.imageUrl;
                          const key = itemKey(item);
                          galleryClickTimerRef.current = setTimeout(() => {
                            galleryClickTimerRef.current = null;
                            openLightbox(url, key);
                          }, GALLERY_CLICK_DELAY_MS);
                        }}
                        onDoubleClick={() => {
                          if (galleryClickTimerRef.current !== null) {
                            clearTimeout(galleryClickTimerRef.current);
                            galleryClickTimerRef.current = null;
                          }
                          openInPreview(item);
                        }}
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block', backgroundColor: 'var(--panel-bg-sunk)', cursor: 'pointer', viewTransitionName: (morphSourceKey === itemKey(item) && !lightboxUrl) ? 'lightbox-morph' : undefined }}
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                      />
                      <SelectButton
                        size={26}
                        isSelected={selectedIds.has(itemKey(item))}
                        onClick={(e) => { e.stopPropagation(); toggleSelected(itemKey(item)); }}
                      />
                      <FavoriteButton
                        size={26}
                        stackedAbove={26}
                        isFavorite={!!item.isFavorite}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }}
                      />
                    </div>

                    {/* Badge indicator */}
                    <div style={{ 
                      position: 'absolute', 
                      top: '6px', 
                      right: '6px', 
                      background: 'rgba(255,255,255,0.92)', 
                      padding: '4px', 
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
                    }}>
                      {item.backendMode === 'firebase' ? (
                        <Cloud size={11} color="var(--pop-blue)" />
                      ) : (
                        <Folder size={11} color="var(--pop-orange)" />
                      )}
                    </div>

                    <div style={{ padding: '10px', textAlign: 'left', background: 'var(--panel-bg)' }}>
                      <p style={{ 
                        fontSize: '12px', 
                        fontWeight: '700', 
                        whiteSpace: 'nowrap', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis',
                        margin: 0,
                        color: 'var(--text-primary)'
                      }}>
                        {item.originalPrompt}
                      </p>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {new Date(item.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', borderRadius: '16px', background: 'var(--panel-bg)' }}>
                {history.length === 0
                  ? '生成履歴はありません。最初の画像を生成してみましょう！🎨⚡️'
                  : '指定した日付の画像はありません 📅'}
              </div>
            )}
          </div>
          )}
          </div>
        </section>
      </main>

      {/* LIGHTBOX: enlarged image */}
      {lightboxUrl && (
        <div
          ref={lightboxRef}
          onClick={() => closeLightbox()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '24px'
          }}
        >
          <img
            src={lightboxUrl}
            alt="拡大表示"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', height: '100%', objectFit: 'contain', viewTransitionName: 'lightbox-morph' }}
          />
          {/* Selection toggle: only available when the lightbox shows a gallery item
              (not the preview tab's current generation, whose key is '__preview__' and
              not present in displayedHistory). Mirrors the click-to-select behavior on
              the gallery tile so a user can flip through images and mark deletion
              candidates without leaving the lightbox. */}
          {lightboxIndex >= 0 && (() => {
            const k = itemKey(displayedHistory[lightboxIndex]);
            const isSelected = selectedIds.has(k);
            return (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleSelected(k); }}
                title={isSelected ? '選択を解除 (Space)' : '選択 (Space)'}
                className="scale-hover"
                style={{
                  position: 'absolute',
                  top: '20px',
                  right: '228px',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  border: isSelected ? '2px solid #fff' : 'none',
                  background: isSelected ? 'var(--pop-blue)' : 'rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: isSelected ? '0 0 0 3px rgba(51, 154, 240, 0.35)' : 'none'
                }}
              >
                {isSelected ? <CheckCircle2 size={22} /> : <Circle size={22} />}
              </button>
            );
          })()}
          {lightboxIndex >= 0 && (() => {
            const fav = !!displayedHistory[lightboxIndex].isFavorite;
            return (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleFavorite(displayedHistory[lightboxIndex]); }}
                title={fav ? 'お気に入りを解除 (F)' : 'お気に入りに追加 (F)'}
                className="scale-hover"
                style={{
                  position: 'absolute',
                  top: '20px',
                  right: '280px',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  border: fav ? '2px solid #fff' : 'none',
                  background: fav ? '#ffd43b' : 'rgba(255, 255, 255, 0.15)',
                  color: fav ? '#1a1a1a' : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: fav ? '0 0 0 3px rgba(255, 212, 59, 0.35)' : 'none'
                }}
              >
                {fav
                  ? <Star size={22} fill="#1a1a1a" stroke="#1a1a1a" />
                  : <Star size={22} />}
              </button>
            );
          })()}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}
            disabled={lightboxIndex <= 0}
            title="前の画像 (←)"
            className={lightboxIndex <= 0 ? '' : 'scale-hover'}
            style={{
              position: 'absolute',
              top: '20px',
              right: '176px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: lightboxIndex <= 0 ? 'not-allowed' : 'pointer',
              opacity: lightboxIndex <= 0 ? 0.35 : 1
            }}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}
            disabled={lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1}
            title="次の画像 (→)"
            className={(lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1) ? '' : 'scale-hover'}
            style={{
              position: 'absolute',
              top: '20px',
              right: '124px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: (lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1) ? 'not-allowed' : 'pointer',
              opacity: (lightboxIndex < 0 || lightboxIndex >= displayedHistory.length - 1) ? 0.35 : 1
            }}
          >
            <ChevronRight size={22} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            title={isFullscreen ? '全画面を解除' : '全画面表示'}
            className="scale-hover"
            style={{
              position: 'absolute',
              top: '20px',
              right: '72px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            title="閉じる (Esc)"
            className="scale-hover"
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <X size={22} />
          </button>
        </div>
      )}

      {/* MODAL: DELETE CONFIRMATION */}
      {showDeleteConfirm && (
        <div className={`dialog-overlay${confirmExiting ? ' exiting' : ''}`} style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 120,
          padding: '20px'
        }}>
          <div className={`glass-panel dialog-panel${confirmExiting ? ' exiting' : ''}`} style={{
            width: '100%',
            maxWidth: '420px',
            borderRadius: '20px',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            textAlign: 'center',
            border: '2px solid var(--danger)',
            background: 'var(--panel-bg)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(255, 107, 107, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={26} color="var(--danger)" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                {deleteTargetIds.length}件の画像を削除しますか？
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                選択した画像とその生成情報が完全に削除されます。<br />この操作は取り消せません。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={closeConfirm}
                disabled={deleting}
                className="scale-hover"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', cursor: 'pointer' }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="scale-hover"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: 'var(--danger)', color: '#fff', fontWeight: '800', cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BATCH GENERATION COUNT */}
      {showBatchModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 110,
          padding: '20px'
        }}>
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '420px',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              textAlign: 'left',
              border: '2px solid var(--pop-blue)',
              background: 'var(--panel-bg)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Layers color="var(--pop-blue)" size={20} />
                <span>まとめて生成 🖼️</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Segmented mode tabs */}
            <div style={{ display: 'flex', gap: '8px', background: 'var(--panel-bg-sunk)', borderRadius: '12px', padding: '4px' }}>
              {([['count', '枚数'], ['size', 'サイズの組合せ'], ['model', 'モデル切替']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBatchMode(mode)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '9px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: '13px',
                    background: batchMode === mode ? 'var(--pop-blue)' : 'transparent',
                    color: batchMode === mode ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {batchMode === 'count' ? (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  同じプロンプトで複数枚を1枚ずつ順番に生成します。生成する枚数を選んでください。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                    {batchCount}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>枚</span>
                  </span>
                  <input
                    type="range"
                    min={2}
                    max={10}
                    step={1}
                    value={batchCount}
                    onChange={(e) => setBatchCount(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>2枚</span>
                    <span>10枚</span>
                  </div>
                </div>
              </>
            ) : batchMode === 'size' ? (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  選んだ横幅と縦幅の組み合わせ（掛け合わせ）ごとに1枚ずつ生成します。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {([['横幅', selectedWidths, setSelectedWidths], ['縦幅', selectedHeights, setSelectedHeights]] as const).map(([label, selected, setter]) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{label}:</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {SIZE_OPTIONS.map(size => {
                          const active = selected.includes(size);
                          return (
                            <button
                              key={size}
                              type="button"
                              onClick={() => toggleSize(setter, size)}
                              className="scale-hover"
                              style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '10px',
                                border: active ? '2px solid var(--pop-blue)' : '2px solid var(--panel-border)',
                                background: active ? 'var(--pop-blue)' : 'var(--panel-bg)',
                                color: active ? '#fff' : 'var(--text-secondary)',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {size}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-blue)' }}>
                    横{selectedWidths.length} × 縦{selectedHeights.length} = {selectedWidths.length * selectedHeights.length}通りを生成
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  利用可能なモデルを順番に切り替えながら、1モデルにつき1枚ずつ生成します。サイズは現在のフォーム設定（{width}×{height}）を使用します。
                </p>
                {sdModels.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                        {selectedBatchModels.size}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>/ {sdModels.length}モデル</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedBatchModels(new Set(sdModels))}
                        className="scale-hover"
                        style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--pop-blue)', background: 'var(--panel-bg)', color: 'var(--pop-blue)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        全選択
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedBatchModels(new Set())}
                        className="scale-hover"
                        style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        全解除
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto', background: 'var(--panel-bg-sunk)', borderRadius: '10px', padding: '8px' }}>
                      {sdModels.map((m, i) => {
                        const isSelected = selectedBatchModels.has(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleBatchModel(m)}
                            className="scale-hover"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 8px',
                              borderRadius: '8px',
                              border: 'none',
                              background: isSelected ? 'rgba(51, 154, 240, 0.12)' : 'transparent',
                              color: isSelected ? 'var(--pop-blue)' : 'var(--text-secondary)',
                              fontSize: '12px',
                              fontWeight: isSelected ? 700 : 500,
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                            }}
                          >
                            {isSelected ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 700, minWidth: '20px', flexShrink: 0 }}>{i + 1}.</span>
                            <span style={{ wordBreak: 'break-all', flex: 1 }}>{m}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-orange)', background: 'var(--warning-bg)', borderRadius: '10px', padding: '14px' }}>
                    モデルが取得できていません。Stable Diffusion が起動しているか確認してください。
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="scale-hover"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', cursor: 'pointer' }}
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={
                  (batchMode === 'size' && (selectedWidths.length === 0 || selectedHeights.length === 0 || selectedWidths.length * selectedHeights.length > MAX_SIZE_COMBINATIONS)) ||
                  (batchMode === 'model' && (sdModels.length === 0 || selectedBatchModels.size === 0))
                }
                onClick={() => {
                  setShowBatchModal(false);
                  // Preserve sdModels' order when filtering so the cycling order matches
                  // the list the user sees (rather than Set iteration order).
                  const jobs: BatchJob[] = batchMode === 'count'
                    ? Array(batchCount).fill({ width, height })
                    : batchMode === 'size'
                      ? selectedWidths.flatMap(w => selectedHeights.map(h => ({ width: w, height: h })))
                      : sdModels.filter(m => selectedBatchModels.has(m)).map(m => ({ width, height, model: m }));
                  handleBatchGenerate(jobs);
                }}
                className="btn-neon"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer' }}
              >
                {batchMode === 'count'
                  ? `${batchCount}枚生成する`
                  : batchMode === 'size'
                    ? `${selectedWidths.length * selectedHeights.length}通り生成する`
                    : `${selectedBatchModels.size}モデルで生成する`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST CONTAINER */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast-item ${toast.type}`}>
            <div style={{
              color: toast.type === 'error' ? 'var(--danger)' : 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              marginTop: '2px',
              flexShrink: 0
            }}>
              {toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            </div>
            <div className="toast-message">{toast.message}</div>
            <button 
              onClick={() => removeToast(toast.id)}
              className="toast-close-btn"
              title="閉じる"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

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
