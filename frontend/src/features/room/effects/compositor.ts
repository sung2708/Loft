import type { EffectSelection } from "./contracts";
import type { SegmentationMask, VisionResult } from "./runtimeContracts";
import type { CustomBackgroundResource } from "./customBackground";
import { calculateARPlacements, getReadyARAsset } from "./arAssets";

export interface ComposeInput {
  source: CanvasImageSource;
  selection: EffectSelection;
  mask?: SegmentationMask;
  landmarks?: VisionResult["landmarks"];
  customBackground?: CustomBackgroundResource;
  timestamp: number;
  reducedMotion: boolean;
}

export class EffectCompositor {
  private maskCanvas = document.createElement("canvas");
  private maskContext = this.maskCanvas.getContext("2d", { willReadFrequently: true });

  constructor(private canvas: HTMLCanvasElement, private context: CanvasRenderingContext2D) {}

  resize(width: number, height: number) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  draw(input: ComposeInput) {
    const { width, height } = this.canvas;
    const ctx = this.context;
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    if (input.mask && input.selection.background !== "none") {
      if (input.selection.background === "custom" && input.customBackground) {
        drawCover(ctx, input.customBackground.image, width, height);
      } else {
        ctx.filter = "blur(12px)";
        drawCover(ctx, input.source, width, height, 1.05);
        ctx.filter = "none";
      }
      const mask = this.createMask(input.mask);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      drawCover(ctx, input.source, width, height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(mask, 0, 0, width, height);
      ctx.restore();
    } else {
      drawCover(ctx, input.source, width, height);
    }

    if (input.selection.look === "warm") {
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(255, 142, 72, .22)";
      ctx.fillRect(0, 0, width, height);
    } else if (input.selection.look === "monochrome") {
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = "#777";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = "source-over";
    if (input.selection.ar !== "none" && input.landmarks?.length) {
      drawAR(ctx, input.selection.ar, input.landmarks, width, height, input.timestamp, input.reducedMotion);
    }
    ctx.restore();
  }

  private createMask(mask: SegmentationMask) {
    this.maskCanvas.width = mask.width;
    this.maskCanvas.height = mask.height;
    const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
    for (let i = 0; i < mask.data.length; i++) {
      const alpha = mask.data[i];
      const at = i * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
      pixels[at + 3] = alpha;
    }
    this.maskContext?.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
    return this.maskCanvas;
  }

  destroy() { this.canvas.width = this.canvas.height = this.maskCanvas.width = this.maskCanvas.height = 0; }
}

function drawCover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, zoom = 1) {
  const size = sourceSize(source);
  const scale = Math.max(width / size.width, height / size.height) * zoom;
  const dw = size.width * scale, dh = size.height * scale;
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function sourceSize(source: CanvasImageSource) {
  const value = source as HTMLVideoElement;
  return { width: value.videoWidth || (source as { width?: number }).width || 1, height: value.videoHeight || (source as { height?: number }).height || 1 };
}

function drawAR(ctx: CanvasRenderingContext2D, effect: EffectSelection["ar"], points: ReadonlyArray<{ x: number; y: number }>, width: number, height: number, now: number, reduced: boolean) {
  for (const placement of calculateARPlacements(effect, points, width, height, now, reduced)) {
    const image = getReadyARAsset(placement.asset);
    if (!image) continue;
    ctx.save();
    ctx.translate(placement.centerX, placement.centerY);
    ctx.rotate(placement.rotation);
    ctx.globalAlpha = placement.opacity;
    ctx.drawImage(image, -placement.size / 2, -placement.size / 2, placement.size, placement.size);
    ctx.restore();
  }
}
