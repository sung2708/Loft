export interface AdaptivePalette {
  primary: string;
  secondary: string;
}

const cache = new Map<string, AdaptivePalette | null>();
const maxCacheEntries = 24;

function cachePalette(videoId: string, palette: AdaptivePalette | null) {
  cache.delete(videoId);
  cache.set(videoId, palette);
  while (cache.size > maxCacheEntries) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

export function youtubeThumbnail(videoId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

export async function deriveAdaptivePalette(videoId: string, signal?: AbortSignal): Promise<AdaptivePalette | null> {
  if (cache.has(videoId)) return cache.get(videoId) ?? null;
  const source = youtubeThumbnail(videoId);
  if (!source || typeof document === "undefined") return null;
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("thumbnail unavailable"));
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    image.src = source;
    await loaded;
    if (signal?.aborted) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 14;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, green = 0, blue = 0, samples = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      red += pixels[index]; green += pixels[index + 1]; blue += pixels[index + 2]; samples++;
    }
    if (!samples) return null;
    const clamp = (value: number) => Math.max(32, Math.min(190, Math.round(value / samples)));
    const primary = `${clamp(red)} ${clamp(green)} ${clamp(blue)}`;
    const secondary = `${clamp(blue)} ${clamp(red)} ${clamp(green)}`;
    const palette = { primary, secondary };
    cachePalette(videoId, palette);
    return palette;
  } catch {
    if (!signal?.aborted) cachePalette(videoId, null);
    return null;
  }
}

export function clearAdaptivePaletteCache() { cache.clear(); }
