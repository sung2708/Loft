export interface AtmosphereCapabilities {
  reducedMotion: boolean;
  saveData: boolean;
  constrainedDevice: boolean;
}

export function atmosphereCapabilities(): AtmosphereCapabilities {
  if (typeof window === "undefined") {
    return { reducedMotion: true, saveData: false, constrainedDevice: false };
  }
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: connection?.saveData === true,
    constrainedDevice: typeof memory === "number" && memory <= 2,
  };
}

export function shouldUseAdaptiveTreatment(capabilities: AtmosphereCapabilities) {
  return !capabilities.reducedMotion && !capabilities.saveData && !capabilities.constrainedDevice;
}
