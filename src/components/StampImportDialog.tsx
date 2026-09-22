import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle, ShieldCheck, Stamp, X } from 'lucide-react';
import { decodeStampFile, processStampPixels, stampPixelsToDataUrl, type StampBackgroundMode, type StampPixels } from '../lib/stamp-image';
import './stamp-import.css';

const MODES: { value: StampBackgroundMode; label: string; description: string }[] = [
  { value: 'preserve', label: '元の透過を保つ', description: '透過済みのPNGは、この設定で元の色と線を保てます。' },
  { value: 'white', label: '白い背景を除去', description: '白い紙の背景を透明にします。赤や黒の印影に使えます。' },
  { value: 'red', label: '朱色だけを残す', description: '赤系の印影を残し、背景や黒い文字を取り除きます。' },
  { value: 'black', label: '黒い背景を除去', description: '画像自体に含まれる黒い背景を透明にします。' },
];

export interface StampImportResult { name: string; dataUrl: string; width: number; height: number }

export function StampImportDialog({ file, onSave, onClose }: {
  file: File;
  onSave(result: StampImportResult): void;
  onClose(): void;
}) {
  const titleId = useId();
  const radioName = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(file.name.replace(/\.[^.]+$/u, '').slice(0, 40));
  const [source, setSource] = useState<{ pixels: StampPixels; originalDataUrl: string } | null>(null);
  const [mode, setMode] = useState<StampBackgroundMode>('preserve');
  const [threshold, setThreshold] = useState(18);
  const [crop, setCrop] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let canceled = false;
    setSource(null); setError('');
    setName(file.name.replace(/\.[^.]+$/u, '').slice(0, 40));
    decodeStampFile(file).then((decoded) => {
      if (!canceled) { setSource(decoded); setMode(decoded.suggestedMode); }
    }).catch((reason) => {
      if (!canceled) setError(reason instanceof Error ? reason.message : '画像を読み込めませんでした。');
    });
    return () => { canceled = true; };
  }, [file]);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const result = useMemo(() => {
    if (!source) return null;
    const pixels = processStampPixels(source.pixels, { mode, threshold, crop, margin: 4 });
    return { ...pixels, dataUrl: stampPixelsToDataUrl(pixels) };
  }, [source, mode, threshold, crop]);
  const canSave = Boolean(result?.hasContent && name.trim());

  return <div className="modal-backdrop stamp-import-backdrop" onClick={onClose}>
    <section className="modal stamp-import-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]');
          if (!focusable?.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div className="modal-heading"><div><Stamp size={22}/><h2 id={titleId}>印鑑画像を登録</h2></div><button type="button" className="icon-button" aria-label="印鑑の登録を閉じる" onClick={onClose}><X size={20}/></button></div>
      <p className="stamp-import-intro">元の印影を使い、背景の透過を調整できます。市松模様の部分が透明です。</p>
      <label className="stamp-import-name">印鑑名<input ref={nameRef} value={name} maxLength={40} placeholder="例：個人印・会社角印" onChange={event => setName(event.target.value)}/></label>
      <div className="stamp-comparison">
        <figure><figcaption>読み込んだ画像</figcaption><div className="stamp-checkerboard">{source ? <img src={source.originalDataUrl} alt="元の印鑑画像"/> : !error ? <LoaderCircle className="stamp-loading" size={26}/> : <span>読み込みできません</span>}</div><small>{source ? `${source.pixels.width} × ${source.pixels.height} px` : 'PNG / JPEG・2MBまで'}</small></figure>
        <figure><figcaption>登録する印鑑 <span>PNG</span></figcaption><div className="stamp-checkerboard">{result ? <img src={result.dataUrl} alt="透過処理後の印鑑画像"/> : <span>プレビュー</span>}</div><small>{result ? `${result.width} × ${result.height} px` : '処理後も線の形は描き直しません'}</small></figure>
      </div>
      <fieldset className="stamp-mode-fieldset" disabled={!source}><legend>背景の処理</legend><div className="stamp-mode-options">{MODES.map(option => <label key={option.value} className={mode === option.value ? 'stamp-mode-active' : ''}><input type="radio" name={radioName} value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)}/><span>{option.label}</span></label>)}</div></fieldset>
      <p className="stamp-mode-description">{MODES.find(option => option.value === mode)?.description}</p>
      <label className="stamp-threshold"><span>除去の強さ <output>{threshold}</output></span><input type="range" min={0} max={100} step={1} value={threshold} disabled={!source || mode === 'preserve'} onChange={event => setThreshold(Number(event.target.value))}/><span className="stamp-range-ends"><small>薄い線を残す</small><small>背景を多く除去</small></span></label>
      <label className="stamp-crop"><input type="checkbox" checked={crop} onChange={event => setCrop(event.target.checked)} disabled={!source}/>透明な余白を切り詰める（周囲に4px残す）</label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {result && !result.hasContent && <p className="stamp-empty-warning" role="alert">印影が残っていません。除去の強さを下げるか、別の処理を選択してください。</p>}
      <p className="stamp-local-note"><ShieldCheck size={16}/>画像はこの端末内で処理します。外部への送信はありません。</p>
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!canSave} onClick={() => { if (result && canSave) onSave({ name: name.trim(), dataUrl: result.dataUrl, width: result.width, height: result.height }); }}><Check size={16}/>この印鑑を登録</button></div>
    </section>
  </div>;
}
