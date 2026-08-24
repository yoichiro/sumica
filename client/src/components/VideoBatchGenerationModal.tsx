import { Layers, X } from 'lucide-react';
import { t } from '../i18n';

// The video counterpart of BatchGenerationModal, deliberately count-only:
// LTX-Video-2's meaningful axes at this point are seed and (fidelity/motion/
// identity), and only the seed varies within a batch — a size/model
// cross-product would require the video form to expose model switching,
// which it does not today. Kept as a separate component (rather than a mode
// flag on BatchGenerationModal) so the video flow stays independent of the
// image flow's SDXL/SD1.5 preset plumbing.
//
// The layout deliberately mirrors BatchGenerationModal's count-tab body —
// big number readout, range slider, min/max endpoint labels, cancel /
// generate row — so the two dialogs read as siblings.

// Cap is 5 (not the image side's 10) because each video takes several
// minutes; a user who nudges the slider to the max should not accidentally
// queue an hour of compute.
export const VIDEO_BATCH_MIN = 2;
export const VIDEO_BATCH_MAX = 5;

interface VideoBatchGenerationModalProps {
  open: boolean;
  onClose: () => void;
  batchCount: number;
  setBatchCount: (n: number) => void;
  onStartBatch: () => void;
}

export function VideoBatchGenerationModal(props: VideoBatchGenerationModalProps) {
  const { open, onClose, batchCount, setBatchCount, onStartBatch } = props;
  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 110,
      padding: '20px',
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
          background: 'var(--panel-bg)',
          // Same shared-name convention as BatchGenerationModal — the source
          // button in ControlPanel drops `view-transition-name: video-batch-morph`
          // while the modal is up so open/close morphs the rect.
          viewTransitionName: 'video-batch-morph',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <Layers color="var(--pop-blue)" size={20} />
            <span>{t.videoBatchModal.title}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
          {t.videoBatchModal.countDescription}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
            {batchCount}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>{t.videoBatchModal.countUnitLabel}</span>
          </span>
          <input
            type="range"
            min={VIDEO_BATCH_MIN}
            max={VIDEO_BATCH_MAX}
            step={1}
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span>{t.videoBatchModal.countRangeLabel(VIDEO_BATCH_MIN)}</span>
            <span>{t.videoBatchModal.countRangeLabel(VIDEO_BATCH_MAX)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={onClose}
            className="scale-hover"
            style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', cursor: 'pointer' }}
          >
            {t.videoBatchModal.cancelButton}
          </button>
          <button
            type="button"
            onClick={onStartBatch}
            className="btn-neon"
            style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer' }}
          >
            {t.videoBatchModal.generateCountButton(batchCount)}
          </button>
        </div>
      </div>
    </div>
  );
}
