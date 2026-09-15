export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;
export const MAX_BACKGROUND_DIMENSION = 4096;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface CustomBackgroundResource {
  id: string;
  objectUrl: string;
  image: ImageBitmap;
  width: number;
  height: number;
  dispose(): void;
}

const resources = new Map<string, CustomBackgroundResource>();

export function retainCustomBackground(resource: CustomBackgroundResource) {
  for (const [id, previous] of resources) {
    if (id !== resource.id) { previous.dispose(); resources.delete(id); }
  }
  resources.set(resource.id, resource);
  return resource.id;
}

export function getCustomBackground(id?: string) { return id ? resources.get(id) : undefined; }

export function disposeCustomBackgrounds() {
  for (const resource of resources.values()) resource.dispose();
  resources.clear();
}

export async function decodeCustomBackground(file: File, signal?: AbortSignal): Promise<CustomBackgroundResource> {
  if (!ALLOWED.has(file.type)) throw new Error("unsupported");
  if (file.size <= 0 || file.size > MAX_BACKGROUND_BYTES) throw new Error("size");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await createImageBitmap(file);
    if (signal?.aborted) {
      image.close();
      throw new DOMException("Aborted", "AbortError");
    }
    if (image.width <= 0 || image.height <= 0 || image.width > MAX_BACKGROUND_DIMENSION || image.height > MAX_BACKGROUND_DIMENSION) {
      image.close();
      throw new Error("dimensions");
    }
    let disposed = false;
    return {
      id: crypto.randomUUID(), objectUrl, image, width: image.width, height: image.height,
      dispose() {
        if (disposed) return;
        disposed = true;
        image.close();
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}
