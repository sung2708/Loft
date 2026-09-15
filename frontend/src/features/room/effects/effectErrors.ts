export function effectMessage(reason: unknown): string {
  if (reason === "unsupported") return "This effect isn't available on this device.";
  if (reason === "performance") return "Camera effects were reduced to keep your call smooth.";
  return "This camera effect couldn't start. Your camera is still available.";
}
