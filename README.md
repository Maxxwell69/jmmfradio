# jmmfradio

A small self-hosted "radio station" player for streaming to TikTok/etc. via OBS.

It gives you the parts a radio automation system has (category rotation
scheduling, a media library, a now-playing overlay) without any actual
broadcast/streaming server — OBS does the streaming, this just renders a page
that plays your media and shows what's on.

## How it works

- **Player page** (`/player.html`) — add this URL as an OBS **Browser
  Source**. It plays audio from your library according to a rotation
  ("clock wheel") pattern and shows a styled now-playing overlay (title,
  artist, art). This is the only page OBS needs to see.
- **Admin page** (`/admin.html`) — open this in a normal browser tab (not in
  OBS) to upload media, manage categories (Music, Station ID, Jingle, Ad, or
  your own), and build the rotation order.

Rotation works like a real station clock wheel: you define an ordered list of
categories, e.g. `Music, Music, Music, Station ID, Music, Music, Music,
Jingle`, and the player cycles through it, pulling a random track (avoiding
immediate repeats) from whichever category is next in line each time a track
ends.

## Setup

```bash
npm install
npm start
```

Then:

1. Open `http://localhost:3000/admin.html`, upload some audio files, and
   assign each to a category.
2. Adjust the rotation pattern and click **Save rotation**.
3. In OBS, add a **Browser Source** pointing at
   `http://localhost:3000/player.html`. Recommended source settings:
   - Width/height: whatever region you want the now-playing card to appear in
     (the card is anchored to the bottom-left; the rest of the page is
     transparent).
   - Check **"Control audio via OBS"** if you want the audio routed through
     an OBS audio mixer track instead of played by the browser directly.
   - Leave **"Shutdown source when not visible"** unchecked so playback keeps
     advancing even when you switch scenes.

The player polls for new uploads/rotation changes every 30 seconds, so you
can keep adding media while it's live without restarting the source.

**If audio doesn't start automatically:** some browsers/CEF configs block
autoplay with sound until there's a user interaction on the page. The player
shows a "Click to start playback" button in that case — in OBS, right-click
the source → **Interact**, then click the button once. After that it keeps
auto-advancing on its own.

## Notes / limitations

- Audio only (mp3, wav, ogg, flac, m4a/aac) — this is meant for a "radio"
  style audio playlist, not video.
- No authentication. This is meant to run locally/on your own machine for
  your own use — don't expose the admin page to the public internet as-is.
- State (categories, rotation, track metadata) is stored in `data/db.json`;
  uploaded files live in `media/`. Neither is committed to git.
