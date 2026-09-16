# Room API Contract Extension

Existing Room and Room Preview responses gain three backward-compatible fields:

```json
{
  "atmosphere": "ambient",
  "accent": "blue",
  "adaptive_media_background": true
}
```

Allowed atmosphere values: `minimal`, `ambient`, `focus`, `party`.

Allowed accent values: `blue`, `purple`, `green`, `orange`, `rose`.

Older records are represented with safe defaults. No endpoint accepts arbitrary CSS, color strings, artwork URL, image data, or personal application theme. Existing room create, resolve, list, and settings behavior remains compatible; exact HTTP mutation routing may continue to serve durable-owner settings, while current-host in-room mutation uses the realtime contract.
