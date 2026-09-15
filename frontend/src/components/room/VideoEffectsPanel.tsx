"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { AR_EFFECTS, BACKGROUNDS, LOOKS } from "@/features/room/effects/effectCatalog";
import { decodeCustomBackground, retainCustomBackground } from "@/features/room/effects/customBackground";
import { detectEffectCapabilities } from "@/features/room/effects/effectCapabilities";
import { useVideoEffectsStore } from "@/stores/useVideoEffectsStore";
import { useUIText } from "@/lib/i18n/uiText";

export function VideoEffectsPanel({ cameraEnabled, triggerRef }: { cameraEnabled: boolean; triggerRef?: React.RefObject<HTMLButtonElement | null> }) {
  const tr = useUIText();
  const selection = useVideoEffectsStore((state) => state.selection);
  const runtime = useVideoEffectsStore((state) => state.runtime);
  const setBackground = useVideoEffectsStore((state) => state.setBackground);
  const setLook = useVideoEffectsStore((state) => state.setLook);
  const setAR = useVideoEffectsStore((state) => state.setAR);
  const setPanelOpen = useVideoEffectsStore((state) => state.setPanelOpen);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const capabilities = detectEffectCapabilities();

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanelOpen(false); triggerRef?.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [setPanelOpen, triggerRef]);

  const chooseImage = async (file?: File) => {
    if (!file) return;
    setImageError(null);
    try {
      const resource = await decodeCustomBackground(file);
      setBackground("custom", retainCustomBackground(resource));
    } catch {
      setImageError(tr("Choose a JPEG, PNG, or WebP image under 8 MB and 4096 pixels."));
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const status = !capabilities.processor ? tr("This effect isn't available on this device.")
    : !cameraEnabled ? tr("Turn on your camera to use effects.")
      : runtime.status === "loading" ? tr("Preparing camera effect…")
        : runtime.status === "fallback" ? tr("Camera effects were reduced to keep your call smooth.") : null;

  return (
    <div role="dialog" aria-label={tr("Video effects")} className="fixed sm:absolute left-2 right-2 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:left-1/2 sm:right-auto sm:bottom-14 sm:-translate-x-1/2 z-50 sm:w-[30rem] max-h-[min(70vh,38rem)] overflow-y-auto rounded-3xl border border-[var(--border-loft)] bg-[var(--bg-loft-card)] shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2 font-semibold"><Sparkles className="w-4 h-4 text-[#2997FF]" />{tr("Video effects")}</div><button className="w-8 h-8 rounded-full hover:bg-[var(--border-loft)] flex items-center justify-center" aria-label={tr("Close")} onClick={() => { setPanelOpen(false); triggerRef?.current?.focus(); }}><X className="w-4 h-4" /></button></div>
      {status && <p role="status" className="text-xs text-[var(--text-loft-secondary)] mb-3 flex gap-2 items-center">{runtime.status === "loading" && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}{status}</p>}
      <EffectGroup label={tr("Background")} value={selection.background} options={BACKGROUNDS.filter((item) => item.id !== "custom")} disabled={!cameraEnabled || !capabilities.segmentation} onChange={(value) => setBackground(value as typeof selection.background)} />
      <div className="mt-2"><input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseImage(event.target.files?.[0])} /><button disabled={!cameraEnabled || !capabilities.segmentation} aria-pressed={selection.background === "custom"} onClick={() => fileRef.current?.click()} className={`w-full rounded-xl border px-3 py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-40 ${selection.background === "custom" ? "border-[#2997FF] bg-[#0066CC]/15" : "border-[var(--border-loft)]"}`}><ImagePlus className="w-4 h-4" />{tr("Custom background")}</button>{imageError && <p role="alert" className="mt-1.5 text-xs text-[#FF453A]">{imageError}</p>}</div>
      <EffectGroup label={tr("Looks")} value={selection.look} options={LOOKS} disabled={!cameraEnabled || !capabilities.processor} onChange={(value) => setLook(value as typeof selection.look)} />
      <EffectGroup label={tr("Fun")} value={selection.ar} options={AR_EFFECTS} disabled={!cameraEnabled || !capabilities.faceLandmarks} onChange={(value) => setAR(value as typeof selection.ar)} />
      <p className="mt-3 text-[11px] text-[var(--text-loft-secondary)]">{tr("Effects stay on this device and are never uploaded.")}</p>
    </div>
  );
}

function EffectGroup({ label, value, options, disabled, onChange }: { label: string; value: string; options: ReadonlyArray<{ id: string; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
  const tr = useUIText();
  return <fieldset className="mt-4"><legend className="text-[11px] uppercase tracking-wider text-[var(--text-loft-secondary)] mb-2">{label}</legend><div role="radiogroup" className="grid grid-cols-3 gap-2">{options.map((option) => <button type="button" role="radio" aria-checked={value === option.id} disabled={disabled} key={option.id} onClick={() => onChange(option.id)} className={`min-h-10 rounded-xl border px-2 py-2 text-xs disabled:opacity-40 ${value === option.id ? "border-[#2997FF] bg-[#0066CC]/15 text-[#2997FF]" : "border-[var(--border-loft)] hover:bg-[var(--border-loft)]"}`}>{tr(option.label)}</button>)}</div></fieldset>;
}
