import { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Settings, 
  History, 
  Image as ImageIcon, 
  RotateCw, 
  Cloud, 
  Folder,
  X,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface GenerationData {
  id?: string;
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  imageUrl: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
}

interface SystemStatus {
  firebaseEnabled: boolean;
  lmStudioUrl: string;
  stableDiffusionUrl: string;
  lmStudioModel: string;
  storageBucketName: string | null;
  localHistoryCount: number;
}

function App() {
  // Form input states
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7);
  
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
  
  // App system states
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<number>(0); // 0: Idle, 1: LM Studio Enhancing, 2: SD Generating, 3: Saving/Finishing
  const [history, setHistory] = useState<GenerationData[]>([]);
  const [currentGeneration, setCurrentGeneration] = useState<GenerationData | null>(null);
  
  // Config & Status states
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newLmStudioUrl, setNewLmStudioUrl] = useState('');
  const [newStableDiffusionUrl, setNewStableDiffusionUrl] = useState('');
  const [newLmStudioModel, setNewLmStudioModel] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  
  // Detail views
  const [selectedItem, setSelectedItem] = useState<GenerationData | null>(null);
  const [hasAttempted, setHasAttempted] = useState(false);

  const API_BASE = 'http://localhost:5000/api';

  useEffect(() => {
    fetchHistory();
    fetchStatus();
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

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setNewLmStudioUrl(data.lmStudioUrl);
        setNewStableDiffusionUrl(data.stableDiffusionUrl);
        setNewLmStudioModel(data.lmStudioModel || '');
      }
    } catch (error) {
      console.error('Failed to fetch system status:', error);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    // Backup current generation to restore in case of error
    const prevGen = currentGeneration;

    setHasAttempted(true);
    setLoading(true);
    setCurrentGeneration(null);
    setLoadingStep(1); // Always start with prompt enhancement

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          width,
          height,
          steps,
          cfgScale,
          skipEnhance: false
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate image');
      }

      setLoadingStep(3); // Saving & Uploading
      const result = await res.json();
      
      if (result.success && result.data) {
        // Success celebration with unisex Google/Slack-like toy colors!
        confetti({
          particleCount: 150,
          spread: 85,
          origin: { y: 0.6 },
          colors: ['#339af0', '#fcc419', '#ff922b', '#51cf66']
        });
        
        setCurrentGeneration(result.data);
        fetchHistory();
        addToast('画像を生成しました！🎨⚡️', 'success');
      }
    } catch (error: any) {
      console.error(error);
      // Restore the previous image so the canvas doesn't stay blank on error
      setCurrentGeneration(prevGen);
      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
      setLoadingStep(0);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsLoading(true);
    setSettingsSuccess(false);

    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newLmStudioUrl,
          newStableDiffusionUrl,
          newLmStudioModel
        })
      });

      if (res.ok) {
        setSettingsSuccess(true);
        fetchStatus();
        addToast('設定を保存しました！⚙️', 'success');
        setTimeout(() => {
          setSettingsSuccess(false);
          setShowSettings(false);
        }, 1500);
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error: any) {
      console.error('Failed to update settings:', error);
      addToast(`設定の保存に失敗しました。\n\n詳細: ${error.message || '接続先URLが正しいか確認してください。'}`, 'error');
    } finally {
      setSettingsLoading(false);
    }
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
        background: '#ffffff'
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', background: '#f8f9fa', padding: '8px 16px', borderRadius: '30px', border: '2px solid #e9ecef', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
            {/* Firebase Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: status?.firebaseEnabled ? 'var(--pop-green)' : 'var(--text-secondary)', fontWeight: '700' }}>
              {status?.firebaseEnabled ? (
                <>
                  <Cloud size={14} />
                  <span>クラウド保存 ☁️</span>
                </>
              ) : (
                <>
                  <Folder size={14} />
                  <span>ローカル保存 📁</span>
                </>
              )}
            </div>
            
            <div style={{ width: '2px', height: '12px', background: '#e9ecef' }}></div>
            
            {/* Stable Diffusion Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--pop-green)', fontWeight: '700' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--pop-green)', boxShadow: '0 0 6px var(--pop-green)' }}></span>
              <span>SD 接続中</span>
            </div>
          </div>

          <button 
            onClick={() => setShowSettings(true)}
            className="scale-hover"
            style={{ 
              background: '#ffffff', 
              border: '2px solid #e9ecef', 
              color: 'var(--pop-blue)', 
              width: '40px', 
              height: '40px', 
              borderRadius: '50%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
            title="Configure System URLs"
          >
            <Settings size={20} />
          </button>
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
            {/* Scrollable container for parameters */}
            <div style={{ 
              flex: 1, 
              overflowY: 'auto', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '20px',
              paddingRight: '6px',
              marginBottom: '16px'
            }}>
              {/* PROMPT AREA */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                <label style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  生成プロンプト (日本語または英語)
                </label>
                <textarea
                  className="input-field"
                  placeholder="生成したい画像の内容を入力してください... (例: 'サイバーパンクな都市、雨に濡れたネオン、未来的、シネマティック照明')"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  style={{ height: '110px', resize: 'none', lineHeight: '1.4', borderRadius: '12px' }}
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
                background: '#f8f9fa',
                borderRadius: '14px',
                border: '2px solid #e9ecef'
              }}>
                {/* Negative Prompt auto-applied by backend */}

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
              </div>
            </div>

            {/* GENERATE BUTTON - Always visible and pinned at bottom */}
            <button
              type="submit"
              className="btn-neon"
              disabled={loading || !prompt.trim()}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                fontSize: '17px',
                flexShrink: 0
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
          </form>
        </section>

        {/* RIGHT COLUMN: PREVIEW & HISTORY GRID */}
        <section style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '24px', 
          overflowY: 'auto',
          paddingRight: '4px'
        }}>
          {/* GENERATION LIVE STAGE */}
          <div className="glass-panel" style={{ 
            padding: '24px', 
            borderRadius: '20px', 
            minHeight: '400px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Loading Overlay */}
            {loading && (
              <div style={{ 
                position: 'absolute', 
                inset: 0, 
                backgroundColor: 'rgba(248, 249, 250, 0.92)', 
                backdropFilter: 'blur(6px)',
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                zIndex: 10,
                gap: '24px'
              }}>
                <div style={{ position: 'relative', width: '80px', height: '80px' }}>
                  <div style={{ 
                    position: 'absolute', 
                    inset: 0, 
                    border: '5px solid rgba(51, 154, 240, 0.15)', 
                    borderRadius: '50%' 
                  }}></div>
                  <div style={{ 
                    position: 'absolute', 
                    inset: 0, 
                    border: '5px solid transparent', 
                    borderTopColor: 'var(--pop-blue)', 
                    borderRightColor: 'var(--pop-teal)',
                    borderRadius: '50%',
                  }} className="animate-spin-custom"></div>
                  <Sparkles style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--pop-blue)' }} className="animate-bounce-custom" size={26} />
                </div>
                
                {/* Stepper Logic */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '80%', maxWidth: '320px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: loadingStep >= 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: loadingStep > 1 ? 'var(--success)' : loadingStep === 1 ? 'var(--pop-blue)' : 'none', border: '2px solid var(--text-muted)', color: loadingStep >= 1 ? '#fff' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>
                      {loadingStep > 1 ? '✓' : '1'}
                    </div>
                    <span>LM Studio でプロンプトを拡張中... 🪄</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: loadingStep >= 2 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: loadingStep > 2 ? 'var(--success)' : loadingStep === 2 ? 'var(--pop-teal)' : 'none', border: '2px solid var(--text-muted)', color: loadingStep >= 2 ? '#fff' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>
                      {loadingStep > 2 ? '✓' : '2'}
                    </div>
                    <span>Stable Diffusion で画像を生成中... 🎨</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: loadingStep >= 3 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: '700' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: loadingStep === 3 ? 'var(--pop-orange)' : 'none', border: '2px solid var(--text-muted)', color: loadingStep === 3 ? '#fff' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 'bold' }}>
                      {loadingStep === 3 ? '...' : '3'}
                    </div>
                    <span>画像をストレージに保存中... ☁️</span>
                  </div>
                </div>
              </div>
            )}

            {currentGeneration ? (
              <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) 1.2fr', gap: '24px', alignItems: 'start' }}>
                {/* Image Frame */}
                <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '2px solid #dee2e6', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}>
                  <img 
                    src={currentGeneration.imageUrl} 
                    alt="Generated output" 
                    style={{ width: '100%', height: 'auto', display: 'block' }}
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
                    border: '1.5px solid #dee2e6',
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

                {/* Prompt Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>元プロンプト</span>
                    <p style={{ fontSize: '16px', fontWeight: '700', marginTop: '4px', color: 'var(--text-primary)' }}>{currentGeneration.originalPrompt}</p>
                  </div>
                  
                  {currentGeneration.enhancedPrompt !== currentGeneration.originalPrompt && (
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--pop-blue)', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                        <Sparkles size={11} /> 拡張プロンプト (LM Studio)
                      </span>
                      <p style={{ fontSize: '13px', marginTop: '6px', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.5', background: '#f8f9fa', padding: '12px', borderRadius: '8px', border: '2px solid #e9ecef' }}>
                        {currentGeneration.enhancedPrompt}
                      </p>
                    </div>
                  )}

                  <div style={{ borderTop: '2px solid #e9ecef', paddingTop: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                    <div>
                      <span>解像度: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.width}x{currentGeneration.height}</strong>
                    </div>
                    <div>
                      <span>サンプリングステップ: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.steps}</strong>
                    </div>
                    <div>
                      <span>CFGスケール: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.cfgScale}</strong>
                    </div>
                    <div>
                      <span>保存先: </span>
                      <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{currentGeneration.backendMode}</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              !hasAttempted ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--text-secondary)', padding: '40px 0' }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    background: 'rgba(51, 154, 240, 0.05)',
                    border: '2px dashed rgba(51, 154, 240, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--pop-blue)'
                  }}>
                    <ImageIcon size={36} />
                  </div>
                  <div>
                    <h3 style={{ color: 'var(--text-primary)', fontSize: '18px', marginBottom: '6px', fontWeight: '800' }}>画像の生成準備完了 🖼️</h3>
                    <p style={{ fontSize: '14px', maxWidth: '340px', margin: '0 auto', lineHeight: '1.5' }}>
                      プロンプトを入力して「画像を生成する」ボタンを押すと、AIが素敵な画像を生成します。
                    </p>
                  </div>
                </div>
              ) : null
            )}
          </div>

          {/* HISTORY GALLERY */}
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--text-secondary)' }}>
              <History size={18} />
              <span>生成履歴ギャラリー 📸 ({history.length})</span>
            </h3>

            {history.length > 0 ? (
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
                gap: '18px' 
              }}>
                {history.map((item) => (
                  <div 
                    key={item.id || item.timestamp}
                    className="glass-panel scale-hover" 
                    onClick={() => setSelectedItem(item)}
                    style={{ 
                      borderRadius: '12px', 
                      overflow: 'hidden', 
                      cursor: 'pointer',
                      border: '2px solid #e9ecef',
                      position: 'relative'
                    }}
                  >
                    <img 
                      src={item.imageUrl} 
                      alt={item.originalPrompt} 
                      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                      loading="lazy"
                    />
                    
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

                    <div style={{ padding: '10px', textAlign: 'left', background: '#fff' }}>
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
              <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', borderRadius: '16px', background: '#fff' }}>
                生成履歴はありません。最初の画像を生成してみましょう！🎨⚡️
              </div>
            )}
          </div>
        </section>
      </main>

      {/* MODAL: IMAGE DETAIL VIEW */}
      {selectedItem && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          backgroundColor: 'rgba(0, 0, 0, 0.4)', 
          backdropFilter: 'blur(8px)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          zIndex: 100,
          padding: '20px'
        }}>
          <div className="glass-panel active" style={{ 
            width: '100%', 
            maxWidth: '820px', 
            borderRadius: '20px', 
            position: 'relative',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: '1.1fr 1fr',
            maxHeight: '90vh',
            border: '2px solid var(--pop-blue)'
          }}>
            {/* Left side: Image */}
            <div style={{ position: 'relative', background: '#f1f3f5', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '2px solid #e9ecef' }}>
              <img 
                src={selectedItem.imageUrl} 
                alt="Enlarged" 
                style={{ width: '100%', height: 'auto', maxHeight: '90vh', objectFit: 'contain', display: 'block' }} 
              />
            </div>
            
            {/* Right side: Parameter Info */}
            <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', textAlign: 'left', background: '#fff' }}>
              <button 
                onClick={() => setSelectedItem(null)}
                className="scale-hover"
                style={{ 
                  position: 'absolute', 
                  top: '20px', 
                  right: '20px', 
                  background: '#f1f3f5', 
                  border: 'none', 
                  color: 'var(--text-secondary)', 
                  cursor: 'pointer', 
                  width: '34px', 
                  height: '34px', 
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}
              >
                <X size={18} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {selectedItem.backendMode === 'firebase' ? (
                  <span style={{ fontSize: '12px', color: 'var(--pop-blue)', background: 'rgba(51,154,240,0.1)', padding: '4px 12px', borderRadius: '14px', border: '2px solid rgba(51,154,240,0.2)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                    <Cloud size={12} /> クラウド保存 ☁️
                  </span>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--pop-orange)', background: 'rgba(255,146,43,0.1)', padding: '4px 12px', borderRadius: '14px', border: '2px solid rgba(255,146,43,0.2)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                    <Folder size={12} /> ローカル保存 📁
                  </span>
                )}
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {new Date(selectedItem.timestamp).toLocaleString()}
                </span>
              </div>

              <div>
                <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: '700' }}>元プロンプト</h4>
                <p style={{ fontSize: '17px', fontWeight: '800', color: 'var(--text-primary)', lineHeight: '1.4' }}>{selectedItem.originalPrompt}</p>
              </div>

              {selectedItem.enhancedPrompt !== selectedItem.originalPrompt && (
                <div>
                  <h4 style={{ fontSize: '12px', color: 'var(--pop-blue)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                    <Sparkles size={12} /> 拡張プロンプト (LM Studio)
                  </h4>
                  <div style={{ 
                    background: '#f8f9fa', 
                    border: '2px solid #e9ecef', 
                    borderRadius: '10px', 
                    padding: '14px', 
                    fontSize: '13px', 
                    color: 'var(--text-secondary)',
                    lineHeight: '1.5',
                    fontStyle: 'italic'
                  }}>
                    {selectedItem.enhancedPrompt}
                  </div>
                </div>
              )}

              {selectedItem.negativePrompt && (
                <div>
                  <h4 style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: '700' }}>ネガティブプロンプト</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>{selectedItem.negativePrompt}</p>
                </div>
              )}

              <div style={{ 
                borderTop: '2px solid #e9ecef', 
                paddingTop: '20px', 
                marginTop: 'auto',
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '16px',
                fontSize: '13px',
                fontWeight: '600'
              }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>解像度: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{selectedItem.width} × {selectedItem.height} px</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>サンプリングステップ: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{selectedItem.steps} 回</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>CFGスケール: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{selectedItem.cfgScale}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>サンプラー: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>Euler a</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURATION SETTINGS */}
      {showSettings && (
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
          <form 
            onSubmit={handleSaveSettings}
            className="glass-panel" 
            style={{ 
              width: '100%', 
              maxWidth: '480px', 
              borderRadius: '20px', 
              padding: '24px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '20px',
              textAlign: 'left',
              border: '2px solid var(--pop-blue)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings color="var(--pop-blue)" size={20} />
                <span>API接続設定 ⚙️</span>
              </h3>
              <button 
                type="button"
                onClick={() => setShowSettings(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* LM Studio Endpoint */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  LM Studio 接続URL (LLM API)
                </label>
                <input 
                  type="url" 
                  className="input-field" 
                  value={newLmStudioUrl}
                  onChange={(e) => setNewLmStudioUrl(e.target.value)}
                  placeholder="http://localhost:1234"
                  style={{ borderRadius: '8px' }}
                  required
                />
              </div>

              {/* Stable Diffusion Endpoint */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  Stable Diffusion 接続URL (画像 API)
                </label>
                <input 
                  type="url" 
                  className="input-field" 
                  value={newStableDiffusionUrl}
                  onChange={(e) => setNewStableDiffusionUrl(e.target.value)}
                  placeholder="http://127.0.0.1:7860"
                  style={{ borderRadius: '8px' }}
                  required
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  AUTOMATIC1111/Forgeを起動するときに <code>--api</code> 引数をつけてください。
                </span>
              </div>

              {/* LLM Model override (optional) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  LLMモデル識別子 (省略可)
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={newLmStudioModel}
                  onChange={(e) => setNewLmStudioModel(e.target.value)}
                  placeholder="空欄の場合は現在ロードされているモデルを使用します"
                  style={{ borderRadius: '8px' }}
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="btn-neon" 
              style={{ padding: '14px', borderRadius: '10px', fontSize: '15px', marginTop: '10px' }}
              disabled={settingsLoading}
            >
              {settingsLoading ? '保存中...' : settingsSuccess ? '設定を保存しました！ ✓' : '変更を適用する'}
            </button>
          </form>
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
