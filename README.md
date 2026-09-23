# Promotion V0

A deliberately small prompt-to-product-film prototype.

## Current flow

1. Anonymous browser session (no login)
2. Upload product screenshots / supporting material
3. Enter a prompt and duration
4. Server builds a deterministic storyboard
5. Browser renders the storyboard into a video stream
6. Render server converts WebM to H.264 MP4 using ffmpeg-static
7. Output is stored under the anonymous session and survives refreshes when /var/data is persistent

## Storage

Set:

DATA_ROOT=/var/data/promotion

Expected persistent disk mount:

/var/data

Recommended initial disk size: 10 GB.

The included render.yaml declares this disk for Render Blueprint deployment.

## V0 limitations

- Visual screenshots are used directly in scenes.
- PDF/PPT text understanding is not implemented yet.
- No external AI APIs are used.
- No authentication or billing.
- No audio yet.

The purpose of V0 is to validate the complete hosted prompt + material -> rendered video loop before adding deeper document intelligence.
