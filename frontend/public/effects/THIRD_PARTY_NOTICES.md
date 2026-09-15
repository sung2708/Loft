# Video effects third-party notices

## @mediapipe/tasks-vision 0.10.35

- Source: https://github.com/google-ai-edge/mediapipe
- License: Apache-2.0
- Package integrity: recorded by `frontend/pnpm-lock.yaml`
- Use: browser-local segmentation and face landmarks

Model binaries and AR artwork must be added below with independent provenance and hashes before production release. Package licensing is not assumed to cover unrelated model or artwork files.

## MediaPipe Selfie Segmenter (float16 latest retrieved 2026-09-15)

- Source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
- SHA-256: `191AC9529AE506EE0BEEFA6B2C945A172DAB9D07D1E802A290A4E4038226658B`
- Use: local foreground confidence mask

## MediaPipe Face Landmarker (float16 latest retrieved 2026-09-15)

- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
- SHA-256: `64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF`
- Use: local landmarks for procedural 2D effects

## AR artwork

No third-party artwork is shipped. Glasses, ears, mask, face paint, and party glow are original procedural Canvas shapes defined by Mingly code.
