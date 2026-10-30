// Shared logic for the content script and the popup.
// Loaded as a plain script, so everything hangs off one global.
(function () {
  "use strict";

  // Starter list of artists widely reported as fully AI-generated.
  // Users can add more, import a list, or mark artists "Not AI".
  const SEED_BLOCKLIST = [
    { name: "The Velvet Sundown", source: "seed" },
    { name: "Breaking Rust", source: "seed" },
    { name: "Xania Monet", source: "seed" }
  ];

  const DEFAULTS = {
    enabled: true,
    blocklist: SEED_BLOCKLIST, // [{ name, id?, source }]
    allowlist: [],             // [{ name, id? }]  "Not AI" artist overrides
    songBlocklist: [],         // [{ title, artist, id? }] single songs marked AI
    songAllowlist: [],         // [{ title, artist, id? }] single songs marked Not AI
    skipLog: [],               // [{ title, artist, reason, at }] newest first
    skipSuspected: false,      // also skip songs whose suspicion score is high
    suspectThreshold: 70
  };

  const MAX_LOG = 50;

  // Lowercase, strip accents, punctuation and a leading "the".
  function normalize(name) {
    return (name || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/^the /, "");
  }

  function sameArtist(entry, artist) {
    if (entry.id && artist.id) return entry.id === artist.id;
    return normalize(entry.name) === normalize(artist.name);
  }

  // Returns the first artist on the track that is blocked (and not
  // allowlisted), or null.
  function findBlockedArtist(artists, blocklist, allowlist) {
    for (const artist of artists) {
      if (!artist || !artist.name) continue;
      if (allowlist.some((e) => sameArtist(e, artist))) continue;
      if (blocklist.some((e) => sameArtist(e, artist))) return artist;
    }
    return null;
  }

  // ---------- songs ----------

  // A song entry stored from a track: id when Spotify gives one, plus
  // title and main artist so it still matches if the id is missing.
  function songEntry(track) {
    return {
      title: track.title,
      artist: (track.artists[0] && track.artists[0].name) || "",
      id: track.id
    };
  }

  // The same song often exists on Spotify several times (single, album,
  // remaster, compilation), each with its own track ID. Strip version
  // tags so "Song - Remastered 2014" and "Song (feat. X)" match "Song".
  const VERSION_WORDS = "feat|ft\\.|with|remaster|version|edit|mono|stereo|mix|deluxe|bonus|live|single|anniversary|explicit|clean";
  const PAREN_TAG = new RegExp("\\s*[\\(\\[][^\\)\\]]*(" + VERSION_WORDS + ")[^\\)\\]]*[\\)\\]]", "gi");
  const DASH_TAG = new RegExp("\\s+[-\u2013\u2014]\\s+[^-\u2013\u2014]*(" + VERSION_WORDS + ").*$", "i");

  function baseTitle(title) {
    return normalize(String(title || "").replace(PAREN_TAG, "").replace(DASH_TAG, ""));
  }

  function sameSong(entry, track) {
    if (entry.id && track.id && entry.id === track.id) return true;
    if (baseTitle(entry.title) !== baseTitle(track.title)) return false;
    return track.artists.some((a) => normalize(a.name) === normalize(entry.artist));
  }

  function addSong(list, track) {
    return list.some((e) => sameSong(e, track)) ? list : [...list, songEntry(track)];
  }

  function removeSong(list, track) {
    return list.filter((e) => !sameSong(e, track));
  }

  // Decides what to do with a track. Most specific rule wins:
  //   song marked Not AI  > song marked AI  > artist rules.
  // Returns { block, reason: "song" | "artist" | null, artist? }.
  function verdict(track, s) {
    if (!track) return { block: false, reason: null };
    if ((s.songAllowlist || []).some((e) => sameSong(e, track))) {
      return { block: false, reason: "song-allowed" };
    }
    if ((s.songBlocklist || []).some((e) => sameSong(e, track))) {
      return { block: true, reason: "song" };
    }
    const artist = findBlockedArtist(track.artists, s.blocklist, s.allowlist);
    if (artist) return { block: true, reason: "artist", artist };
    return { block: false, reason: null };
  }

  // ---------- suspicion score ----------
  //
  // 0 to 100: how likely the current song is AI-generated. Your own marks
  // and known-AI lists are definitive. Otherwise it is a metadata guess
  // built from MusicBrainz (the open music database) and Spotify's own
  // "AI persona" label when the page shows one. It never analyzes audio.

  function levelFor(score) {
    if (score === null || score === undefined) return { key: "unknown", label: "Checking…", color: "#8a8a8a" };
    if (score >= 90) return { key: "ai", label: score >= 100 ? "AI (marked)" : "AI", color: "#e5534b" };
    if (score >= 60) return { key: "likely-ai", label: "Likely AI", color: "#ff8a3d" };
    if (score >= 30) return { key: "unsure", label: "Unsure", color: "#e6b422" };
    return { key: "human", label: "Likely human", color: "#1db954" };
  }

  // info: result of a MusicBrainz lookup for one artist (see background.js)
  function artistHeuristic(name, info) {
    if (!info || info.pending) return null;
    if (info.error) return null;
    let score = 25;
    const reasons = [];
    if (!info.found) {
      score += 35;
      reasons.push({ up: true, text: `${name} isn't in MusicBrainz, the open music database` });
    } else {
      if (info.wiki) {
        score -= 25;
        reasons.push({ up: false, text: `${name} has a Wikipedia/Wikidata entry` });
      } else if (!info.links) {
        score += 15;
        reasons.push({ up: true, text: `No website or social links on record for ${name}` });
      } else {
        score -= 5;
        reasons.push({ up: false, text: `${name} has a website or social profiles on record` });
      }
      const year = new Date().getFullYear();
      if (info.beginYear && info.beginYear <= year - 6) {
        score -= 15;
        reasons.push({ up: false, text: `Active since ${info.beginYear}` });
      } else if (info.beginYear && info.beginYear >= year - 2) {
        score += 10;
        reasons.push({ up: true, text: `Only active since ${info.beginYear}` });
      } else if (!info.beginYear) {
        score += 5;
        reasons.push({ up: true, text: "No start date on record" });
      }
      if (info.recentReleases >= 10) {
        score += 20;
        reasons.push({ up: true, text: `${info.recentReleases} releases in the past year` });
      }
    }
    return { score: Math.max(3, Math.min(97, score)), reasons };
  }

  // Returns { score, reasons:[{up,text}], definitive }
  function scoreTrack(track, s, infoByArtist, pageLabel) {
    if (!track) return { score: null, reasons: [] };
    const v = verdict(track, s);
    if (v.reason === "song-allowed") {
      return { score: 0, definitive: true, reasons: [{ up: false, text: "You marked this song Not AI" }] };
    }
    if (v.reason === "song") {
      return { score: 100, definitive: true, reasons: [{ up: true, text: "You marked this song AI" }] };
    }
    if (v.reason === "artist") {
      const entry = s.blocklist.find((e) => sameArtist(e, v.artist)) || {};
      return entry.source === "user"
        ? { score: 100, definitive: true, reasons: [{ up: true, text: `You marked ${v.artist.name} as AI` }] }
        : { score: 95, definitive: true, reasons: [{ up: true, text: `${v.artist.name} is on a list of known AI artists` }] };
    }
    const open = track.artists.filter((a) => !s.allowlist.some((e) => sameArtist(e, a)));
    if (!open.length) {
      return { score: 0, definitive: true, reasons: [{ up: false, text: `You marked ${track.artists[0].name} Not AI` }] };
    }
    if (pageLabel) {
      return { score: 95, definitive: true, reasons: [{ up: true, text: "Spotify labels this artist as AI-generated" }] };
    }
    // Heuristic: the most suspicious artist on the track sets the score.
    let best = null;
    let pending = false;
    for (const a of open) {
      const r = artistHeuristic(a.name, (infoByArtist || {})[normalize(a.name)]);
      if (!r) { pending = true; continue; }
      if (!best || r.score > best.score) best = r;
    }
    if (!best) {
      return { score: null, reasons: [{ up: false, text: pending ? "Looking up the artist…" : "Not enough data" }] };
    }
    return { score: best.score, definitive: false, reasons: best.reasons };
  }

  // SVG progress ring. Only numbers and fixed colors go into the markup.
  function ringSvg(score, size, showNumber) {
    const lv = levelFor(score);
    const stroke = Math.max(2, Math.round(size / 9));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, Number(score)));
    const dash = (pct / 100) * c;
    const text = showNumber
      ? `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="${lv.color}" ` +
        `font-family="system-ui,sans-serif" font-weight="700" font-size="${Math.round(size * 0.3)}">` +
        `${score === null || score === undefined ? "…" : Math.round(pct)}</text>`
      : "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="${stroke}"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${lv.color}" stroke-width="${stroke}" ` +
      `stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})" ` +
      `style="transition:stroke-dasharray .6s ease"/>` + text + `</svg>`;
  }

  // Accepts plain text (one artist per line, # comments allowed),
  // a JSON array of strings, or a JSON array of { name, id } objects.
  function parseImportedList(text) {
    const trimmed = (text || "").trim();
    let names = [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      let data = JSON.parse(trimmed);
      if (!Array.isArray(data)) data = data.artists || data.blocklist || [];
      for (const item of data) {
        if (typeof item === "string") names.push({ name: item });
        else if (item && item.name) names.push({ name: item.name, id: item.id });
      }
    } else {
      names = trimmed
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
        .map((name) => ({ name }));
    }
    return names.filter((n) => normalize(n.name));
  }

  // Adds entries that aren't already present. Returns { list, added }.
  function mergeIntoList(list, entries, source) {
    const out = list.slice();
    let added = 0;
    for (const e of entries) {
      if (!out.some((x) => sameArtist(x, e))) {
        out.push({ name: e.name, id: e.id, source });
        added++;
      }
    }
    return { list: out, added };
  }

  function removeFromList(list, artist) {
    return list.filter((e) => !sameArtist(e, artist));
  }

  function getState() {
    return new Promise((resolve) =>
      chrome.storage.local.get(DEFAULTS, (s) => resolve(s))
    );
  }

  function setState(patch) {
    return new Promise((resolve) => chrome.storage.local.set(patch, resolve));
  }

  self.HumanTune = {
    DEFAULTS,
    MAX_LOG,
    normalize,
    sameArtist,
    findBlockedArtist,
    sameSong,
    addSong,
    removeSong,
    verdict,
    baseTitle,
    levelFor,
    artistHeuristic,
    scoreTrack,
    ringSvg,
    parseImportedList,
    mergeIntoList,
    removeFromList,
    getState,
    setState
  };
})();
