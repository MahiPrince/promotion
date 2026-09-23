# Promotion — AI Product Filmmaker

Promotion turns a creative brief plus product material into a directed, deterministic product film.

## V1 flow

1. Anonymous persistent workspace (no login)
2. Upload screenshots, PDFs, decks, docs, or spreadsheets
3. OpenAI reads the material using vision and file inputs
4. An AI creative director produces a strict film specification
5. Promotion renders that specification deterministically with a locally bundled WebMotion core
6. Chromium WebCodecs exports H.264 MP4 without real-time screen recording
7. The MP4 and project specification persist on the Render disk
8. The user can ask for a targeted revision and render a new cut

## Infrastructure

- GitHub — source
- Render — Node service + 10 GB persistent disk
- OpenAI API — material understanding and creative direction
- No login service
- No external database
- No object-storage service
- No render farm
- No generative-video API

## Environment variables

- `OPENAI_API_KEY` — required
- `OPENAI_MODEL` — optional, defaults to `gpt-5.6-terra`
- `DATA_ROOT` — `/var/data/promotion` on Render

## Persistent layout

```
/var/data/promotion/
  sessions/
    sess_.../
      session.json
      assets.json
      uploads/
      projects/
      outputs/
```

## Rendering

The browser bundle includes `@superhq/webmotion` and uses deterministic frame rendering plus WebCodecs MP4 export. This replaces the V0 real-time MediaRecorder -> WebM -> FFmpeg pipeline.

WebMotion is MIT licensed. See `THIRD_PARTY_NOTICES.md`.
