# Chrome Web Store submission: copy and paste answers

Upload: `humantune-store-v0.3.0.zip`

---

## Store listing tab

**Name** (from the manifest): HumanTune: AI Song Blocker

**Summary** (from the manifest, 132 characters max):
Automatically skips AI-generated songs on the Spotify Web Player. Toggle it on or off anytime.

**Category:** Entertainment (or Productivity)

**Language:** English

**Description:**

```
Tired of AI-generated songs sneaking into your playlists and recommendations? HumanTune skips them for you while you listen in the Spotify Web Player.

HOW IT WORKS
• Turn it on and AI songs are skipped automatically. Turn it off and everything plays normally.
• Mark a single song as AI, or mark an artist's whole catalog. Marking one song never blocks the rest of an artist's music.
• Changed your mind? Mark a song or artist "Not AI" and it always plays.
• Marked songs stay blocked even if you replay them from search, a playlist, or another release of the same track.

AI SCORE
• A ring next to the song fills up from 0 to 100 showing how likely the song is AI-generated, with the reasons listed when you hover.
• Unmarked songs are scored from public artist information on MusicBrainz, the open music database: whether the artist exists there, has a Wikipedia entry or websites, how long they've been active, and how many releases they put out in the past year.
• The score is an estimate from metadata, not audio analysis. Auto-skipping by score is off by default and you choose the threshold.

ALSO
• Starts with a small list of widely reported AI artists, and you can import shared lists from GitHub.
• See every song it skipped in the popup.

PRIVACY
No accounts, no tracking, no ads. Your marks and settings stay in your browser. Only the current artist's name is sent to MusicBrainz to calculate the score.

Works with the Spotify Web Player (open.spotify.com). Not affiliated with or endorsed by Spotify.
```

**Graphic assets**
- Store icon: `icons/icon128.png` (inside the extension folder)
- Screenshots: 1280×800 or 640×400. Take 2 to 4 on the real Spotify web player:
  1. The popup open over Spotify showing the score ring and reasons
  2. The small ring next to a song title in the player bar
  3. The "Skipped …" notice right after a skip
- Small promo tile: `small-promo-tile-440x280.png`

---

## Privacy tab

**Single purpose description:**

```
HumanTune detects AI-generated songs playing in the Spotify Web Player, shows how likely each song is AI, and skips songs the user has chosen to block.
```

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| storage | Saves the user's on/off setting, the songs and artists they marked AI or Not AI, a list of recently skipped songs, and cached artist lookups, locally on their device. |
| Host: open.spotify.com | Reads the title and artist of the song currently playing in the Spotify Web Player, shows the AI score next to it, and presses the player's Next button to skip blocked songs. |
| Host: musicbrainz.org | Looks up the current artist in the public MusicBrainz music database to calculate the AI likelihood score. Only the artist name is sent. |
| Host: raw.githubusercontent.com, gist.githubusercontent.com | Downloads a shared blocklist of AI artists only when the user pastes a GitHub or Gist URL and clicks Import. |

**Remote code:** No, I am not using remote code.

**Data usage:** Leave every data type **unchecked** (it collects none of them). Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the link to `PRIVACY.md` once it's on GitHub, e.g.
`https://github.com/npnair/humantune/blob/main/PRIVACY.md`

---

## Distribution tab

- Visibility: **Public** (anyone can find it), or **Unlisted** if you want only people with the link to install it while you test with friends.
- Regions: All regions.
