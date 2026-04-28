---
name: dashboard-demo-video-production
description: Capture and render professional Hussh Matrix Dashboard product demo videos from the real dashboard UI. Use when creating, updating, verifying, or publishing dashboard walkthrough videos, terminology explainers, MP4 demos, narration scripts, captions, or reusable demo capture assets.
---

# Dashboard Demo Video Production

## Goal

Produce polished MP4 demos from the actual Hussh Matrix Dashboard instead of static mockups. The pipeline captures real dashboard frames, writes narration and caption timing into versioned docs, renders local voiceover plus light music, and exports final 1080p H.264/AAC MP4s.

## Outputs In This Repo

- Product walkthrough: `artifacts/demo/hussh-matrix-dashboard-technical-demo.mp4`
- Beginner terminology explainer: `artifacts/demo/hussh-matrix-dashboard-terminology-demo.mp4`
- Product storyboard: `docs/demo/4-minute-technical-product-demo.md`
- Terminology storyboard: `docs/demo/4-minute-terminology-demo.md`
- Capture script: `scripts/demo-capture-assets.mjs`
- Render script: `scripts/demo-render-video.swift`

## Workflow

1. Verify the dashboard source.
   - Use `https://metrics.hushh.ai` by default.
   - Override with `DEMO_DASHBOARD_URL` when recording a local production build or preview URL.
   - Run `npm run test:prod` before recording when the demo claims production confidence.

2. Capture real UI frames.
   - Run `npm run demo:capture`.
   - The script opens headless Chrome through the Chrome DevTools Protocol, waits for the live dashboard loaded state, captures 1920x1080 frames, and writes them under `artifacts/demo/frames`.
   - Keep browser chrome, dev tools, loading flicker, raw errors, and cursors out of the final visuals.

3. Render the product walkthrough.
   - Run `npm run demo:render`.
   - This uses `scripts/demo-render-video.swift` in `product` mode.
   - It writes narration to `artifacts/demo/narration.txt`, creates the voiceover with macOS `say`, generates a subtle ambient audio bed, and exports `hussh-matrix-dashboard-technical-demo.mp4`.

4. Render the terminology explainer.
   - Run `npm run demo:render:terminology`.
   - This uses the same captured frames and renderer in `terminology` mode.
   - It defines beginner terms such as dashboard, aggregate metrics, sessions, users, DAU, WAU, MAU, events, page views, requests, non-2xx, error rate, Cloud Run, instances, latency, p95 latency, GA4, Search Console, impressions, clicks, CTR, Supabase, BigQuery, funnels, conversion rate, dropoff, freshness, source health, production probes, and no-store cache headers.

5. Verify the MP4s.
   - Confirm the video metadata with `mdls`:
     `mdls -name kMDItemContentType -name kMDItemCodecs -name kMDItemDurationSeconds -name kMDItemPixelWidth -name kMDItemPixelHeight artifacts/demo/<video>.mp4`
   - Confirm thumbnail orientation with:
     `qlmanage -t -s 960 -o artifacts/demo artifacts/demo/<video>.mp4`
   - For a clean 4-minute output, the final video duration should be `240` seconds and the voiceover should finish before the video ends.

6. Publish carefully.
   - Keep generated scratch assets ignored.
   - Force-add only the final MP4 files when they must be committed:
     `git add -f artifacts/demo/hussh-matrix-dashboard-technical-demo.mp4 artifacts/demo/hussh-matrix-dashboard-terminology-demo.mp4`
   - GitHub allows these files because each is under the 100 MB hard file limit, but keep future renders below that limit.

## Quality Bar

- Use actual dashboard visuals as the source of truth.
- Keep the pacing calm, with sparse captions and no dense on-screen explanations.
- Explain technical terms in plain English inside the narration.
- Export MP4, 16:9, 1080p minimum, H.264 video plus AAC audio.
- Run `npm run lint`, `npm run build`, `npm run check:secrets`, and `git diff --check` after changing docs, scripts, package commands, or video outputs.

## Notes

- The local renderer uses macOS frameworks through Swift, so it is intended for macOS development machines.
- The capture script expects Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` unless `CHROME_BIN` is provided.
- InVideo can be used later for external assembly if its connector is authenticated, but this repo now has a fully local fallback pipeline.
