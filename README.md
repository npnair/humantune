<img width="270" height="281" alt="image" src="https://github.com/user-attachments/assets/668784b1-8961-4014-840c-3488a4a56b89" />


# HumanTune: AI Song Blocker

A Chrome extension that spots AI-generated songs in the Spotify Web Player and skips them while you listen. Switch it on to block AI music, or off to let everything play.

## Features

- **On/off toggle:** when it's on, flagged songs are skipped automatically. When it's off, everything plays normally.
- **Block one song or a whole artist:** mark just the song that's playing as AI, or mark an artist's entire catalog. Marking one song never blocks the rest of that artist's music.
- **"Not AI" overrides:** unblock a single song or a whole artist at any time.
- **Blocks stick:** a marked song is skipped every time it comes up, including when you replay it from search, a playlist or the back button, and on other releases of the same track (remasters, singles, compilations). If Spotify won't let it skip, the song is paused instead.
- **AI score ring:** a ring next to the song title fills from 0 to 100 to show how likely the song is AI-generated. Hover over it to see the reasons.
- **Optional auto-skip by score:** skip unmarked songs that score above a threshold you choose. Off by default.
- **Shared blocklists:** starts with a few widely reported AI artists, and can import a list from a GitHub or Gist URL.
- **Skip history:** the popup lists recently skipped songs and why each was skipped.

## Install

**From source (developer mode)**

1. Clone or download this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder (the one containing `manifest.json`).
4. Refresh open.spotify.com and play something.

After pulling updates, click the reload arrow on the HumanTune card, then refresh the Spotify tab.

## How the AI score works

| Score | Label | Meaning |
|---|---|---|
| 100 | AI (marked) | You marked the song or artist as AI |
| 90 to 99 | AI | On a known-AI list, or Spotify labels the artist as AI |
| 60 to 89 | Likely AI | The artist's metadata looks like an AI project |
| 30 to 59 | Unsure | Mixed signals |
| 0 to 29 | Likely human | An established artist, or you marked it Not AI |

Your own marks and known-AI lists always decide the score. For anything unmarked, HumanTune looks the artist up on [MusicBrainz](https://musicbrainz.org), the open music database, and scores these signals:

| Signal | Effect |
|---|---|
| Artist not in MusicBrainz | +35 |
| Has a Wikipedia or Wikidata entry | −25 |
| No website or social links on record | +15 |
| Active for 6+ years | −15 |
| Only active in the last 2 years | +10 |
| 10+ releases in the past year | +20 |

The score starts at 25 and is kept between 3 and 97. On a song with several artists, the most suspicious artist sets the score. Lookups are rate-limited to one request per second and cached for a week.

**Limits:** the score comes from metadata, not from analyzing the audio, so a small or new human artist can score high and a well-documented AI project can score low. That's why auto-skipping by score is opt-in, and why your marks always override it.

## Project structure

```
manifest.json     Manifest V3 config
content.js        Runs on open.spotify.com: reads the now-playing bar, draws the ring, skips/pauses
background.js     Service worker: MusicBrainz lookups with rate limiting and caching
lib/core.js       Shared logic: matching rules, song/artist lists, scoring, ring SVG
popup.html/.js    Toolbar popup: toggle, score and reasons, mark buttons, lists, settings
tests/            End-to-end tests against a mock Spotify player
store/            Chrome Web Store listing text and promo tile
PRIVACY.md        Privacy policy
```

## Tests

The tests load the real extension into Chromium with Playwright and run it against a mock player that copies Spotify's page structure, with mocked MusicBrainz responses. They cover skipping and the toggle, song-level vs artist-level blocking, replays and alternate releases, the pause fallback, score levels, the threshold setting, overrides and list import.

```bash
npm install playwright
npx playwright install chromium
node tests/test.js
```

## Privacy

No accounts, tracking or ads. Your settings and marks stay in your browser. Only the name of the artist currently playing is sent to MusicBrainz to calculate the score. See [PRIVACY.md](PRIVACY.md).

## Roadmap

- An audio-based detector as an extra signal in the score
- Reading Spotify's own "AI persona" labels from more parts of the page
- An auto-updating community blocklist
- YouTube Music and Apple Music web support

---

Works with the Spotify Web Player. Not affiliated with or endorsed by Spotify.
