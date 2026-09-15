import type { AREffect } from "./contracts";

export interface FacePoint {
  x: number;
  y: number;
}

export type ARAssetKey = Exclude<AREffect, "none" | "blush"> | "blush-left" | "blush-right";

export interface ARAssetPlacement {
  asset: ARAssetKey;
  centerX: number;
  centerY: number;
  size: number;
  rotation: number;
  opacity: number;
}

const assetUrls: Record<ARAssetKey, string> = {
  "cat-ears": "/effects/mingly/collection-01/kitty/mingly-kitty-ears.png",
  bunny: "/effects/mingly/collection-01/bunny/mingly-bunny-ears.png",
  crown: "/effects/mingly/collection-01/crown/mingly-tiny-crown.png",
  glasses: "/effects/mingly/collection-01/glasses/mingly-cozy-glasses.png",
  bloom: "/effects/mingly/collection-01/bloom/mingly-bloom.png",
  starry: "/effects/mingly/collection-01/starry/mingly-starry-group.png",
  cloudy: "/effects/mingly/collection-01/cloudy/mingly-cloudy-group.png",
  "blush-left": "/effects/mingly/collection-01/blush/mingly-blush-left.png",
  "blush-right": "/effects/mingly/collection-01/blush/mingly-blush-right.png",
};

const imageCache = new Map<ARAssetKey, HTMLImageElement>();

export function getReadyARAsset(asset: ARAssetKey): HTMLImageElement | undefined {
  if (typeof Image === "undefined") return undefined;
  let image = imageCache.get(asset);
  if (!image) {
    image = new Image();
    image.decoding = "async";
    image.src = assetUrls[asset];
    imageCache.set(asset, image);
  }
  return image.complete && image.naturalWidth > 0 ? image : undefined;
}

export function calculateARPlacements(
  effect: AREffect,
  points: ReadonlyArray<FacePoint>,
  width: number,
  height: number,
  timestamp = 0,
  reducedMotion = false,
): ReadonlyArray<ARAssetPlacement> {
  const face = faceGeometry(points, width, height);
  if (!face || effect === "none") return [];

  const wave = reducedMotion ? 0 : Math.sin(timestamp / 420);
  const placed = (asset: ARAssetKey, offsetX: number, offsetY: number, size: number, rotation = 0, opacity = 1): ARAssetPlacement => {
    const cos = Math.cos(face.rotation);
    const sin = Math.sin(face.rotation);
    return {
      asset,
      centerX: face.centerX + offsetX * cos - offsetY * sin,
      centerY: face.centerY + offsetX * sin + offsetY * cos,
      size,
      rotation: face.rotation + rotation,
      opacity,
    };
  };

  switch (effect) {
    case "cat-ears":
      return [placed(effect, 0, -face.width * 0.44, face.width * 1.18, wave * 0.012)];
    case "bunny":
      return [placed(effect, 0, -face.width * (0.59 + wave * 0.012), face.width * 1.25, wave * 0.015)];
    case "crown":
      return [placed(effect, 0, -face.width * (0.62 + wave * 0.018), face.width * 0.72, -0.08)];
    case "glasses":
      return [placed(effect, 0, 0, face.width * 1.08)];
    case "bloom":
      return [placed(effect, -face.width * 0.43, -face.width * (0.38 + wave * 0.008), face.width * 0.72, -0.12 + wave * 0.012)];
    case "starry":
      return [placed(effect, face.width * 0.4, -face.width * 0.43, face.width * (0.78 + wave * 0.018), 0.04, 0.96)];
    case "cloudy":
      return [placed(effect, 0, -face.width * (0.52 + wave * 0.018), face.width * 1.28)];
    case "blush":
      return [
        placed("blush-left", -face.width * 0.34, face.width * 0.17, face.width * 0.42, 0, 0.82),
        placed("blush-right", face.width * 0.34, face.width * 0.17, face.width * 0.42, 0, 0.82),
      ];
  }
}

function faceGeometry(points: ReadonlyArray<FacePoint>, width: number, height: number) {
  const left = points[33] ?? points[0];
  const right = points[263] ?? points[Math.min(1, points.length - 1)];
  if (!left || !right || width <= 0 || height <= 0) return undefined;
  const leftX = left.x * width;
  const leftY = left.y * height;
  const rightX = right.x * width;
  const rightY = right.y * height;
  const dx = rightX - leftX;
  const dy = rightY - leftY;
  return {
    centerX: (leftX + rightX) / 2,
    centerY: (leftY + rightY) / 2,
    width: Math.max(64, Math.hypot(dx, dy) * 2.25),
    rotation: Math.atan2(dy, dx),
  };
}
