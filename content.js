// Runs on open.spotify.com. Watches the "now playing" bar, shows the AI
// suspicion ring, and skips flagged songs while HumanTune is on.
(function () {
  "use strict";
  const HT = self.HumanTune;

  const SEL = {
    widget: '[data-testid="now-playing-widget"]',
    title: '[data-testid="context-item-info-title"], [data-testid="context-item-link"]',
    artist: '[data-testid="context-item-info-artist"]',
    skip: '[data-testid="control-button-skip-forward"]',
    playPause: '[data-testid="control-button-playpause"]'
  };
  const AI_LABEL = /\bAI[\s-]?(persona|generated)\b/i;

  let state = null;
  let current = { key: null, track: null, score: null };
  const infoByArtist = {};      // normalized name -> MusicBrainz summary
  let attempts = 0;             // skip attempts for the current song
  let loggedKey = null;
  let lastActionAt = 0;
  let alive = true;             // false once the extension is reloaded

  // ---------- reading the current track ----------

  function artistIdFromHref(href) {
    const m = (href || "").match(/\/artist\/([A-Za-z0-9]+)/);
    return m ? m[1] : undefined;
  }

  // /track/<id> or /album/<id>?highlight=spotify:track:<id>
  function trackIdFromHref(href) {
    const m = (href || "").match(/(?:\/track\/|spotify:track:|spotify%3Atrack%3A)([A-Za-z0-9]+)/);
    return m ? m[1] : undefined;
  }

  function readFromDom() {
    const widget = document.querySelector(SEL.widget);
    if (!widget) return null;
    const titleEl = widget.querySelector(SEL.title);
    const title = titleEl ? titleEl.textContent.trim() : "";
    const linkEl = titleEl && (titleEl.closest("a") || titleEl.querySelector("a"));
    const id = trackIdFromHref(linkEl && linkEl.getAttribute("href"));
    const artists = [];
    widget.querySelectorAll(SEL.artist).forEach((el) => {
      const links = el.tagName === "A" ? [el] : el.querySelectorAll("a");
      if (links.length) {
        links.forEach((a) =>
          artists.push({ name: a.textContent.trim(), id: artistIdFromHref(a.getAttribute("href")) })
        );
      } else if (el.textContent.trim()) {
        el.textContent.split(",").forEach((n) => artists.push({ name: n.trim() }));
      }
    });
    if (!title && !artists.length) return null;
    const ownText = widget.textContent.replace(document.getElementById("humantune-ring")?.textContent || "", "");
    return { title, id, artists: dedupe(artists), pageLabel: AI_LABEL.test(ownText) };
  }

  function readFromMediaSession() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!md || !md.title) return null;
    const artists = (md.artist || "").split(",").map((n) => ({ name: n.trim() })).filter((a) => a.name);
    return { title: md.title, artists, pageLabel: false };
  }

  function dedupe(artists) {
    const seen = new Set();
    return artists.filter((a) => {
      const k = a.id || HT.normalize(a.name);
      if (!a.name || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function currentTrack() {
    return readFromDom() || readFromMediaSession();
  }

  function keyOf(t) {
    return (t.id || t.title) + "|" + t.artists.map((a) => a.id || a.name).join(",");
  }

  // ---------- score ----------

  function rescore() {
    if (!current.track || !state) return;
    current.score = HT.scoreTrack(current.track, state, infoByArtist, current.track.pageLabel);
    renderRing();
  }

  function requestArtistInfo(track) {
    track.artists.forEach((a) => {
      const k = HT.normalize(a.name);
      if (infoByArtist[k] && !infoByArtist[k].error) return;
      infoByArtist[k] = { pending: true };
      try {
        chrome.runtime.sendMessage({ type: "humantune:artistInfo", name: a.name }, (info) => {
          if (chrome.runtime.lastError) { infoByArtist[k] = { error: true }; return; }
          infoByArtist[k] = info || { error: true };
          rescore();
          enforce();
        });
      } catch (_) {
        alive = false; // extension was reloaded; this copy of the script is orphaned
      }
    });
  }

  // ---------- the ring next to the now-playing title ----------

  function renderRing() {
    const widget = document.querySelector(SEL.widget);
    if (!widget) return;
    let ring = document.getElementById("humantune-ring");
    if (!ring || !widget.contains(ring)) {
      if (ring) ring.remove();
      ring = document.createElement("span");
      ring.id = "humantune-ring";
      Object.assign(ring.style, {
        display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "10px",
        flex: "none", cursor: "help", font: "600 11px system-ui, sans-serif"
      });
      widget.appendChild(ring);
    }
    const sc = current.score ? current.score.score : null;
    const lv = HT.levelFor(sc);
    ring.innerHTML = HT.ringSvg(sc, 26, true);
    const label = document.createElement("span");
    label.textContent = lv.label;
    label.style.color = lv.color;
    ring.appendChild(label);
    const reasons = current.score ? current.score.reasons.map((r) => (r.up ? "▲ " : "▼ ") + r.text) : [];
    ring.title = `HumanTune AI score: ${sc === null ? "checking" : Math.round(sc) + "/100"} (${lv.label})\n` +
      reasons.join("\n") +
      (current.score && !current.score.definitive && sc !== null ? "\nBased on artist metadata, not audio." : "");
  }

  // ---------- blocking ----------

  function shouldBlock() {
    if (!state || !state.enabled || !current.track) return null;
    const v = HT.verdict(current.track, state);
    if (v.block) return v.reason === "song" ? "song marked AI" : `${v.artist.name} is marked AI`;
    const sc = current.score;
    if (state.skipSuspected && sc && sc.score !== null && !sc.definitive && sc.score >= state.suspectThreshold) {
      return `suspected AI, score ${Math.round(sc.score)}`;
    }
    if (sc && sc.definitive && sc.score >= 95 && current.track.pageLabel) return "Spotify AI label";
    return null;
  }

  function isPlaying() {
    const b = document.querySelector(SEL.playPause);
    const label = b && (b.getAttribute("aria-label") || "");
    return /pause/i.test(label);
  }

  function clickSkip() {
    const btn = document.querySelector(SEL.skip);
    if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
    btn.click();
    return true;
  }

  function pause() {
    const b = document.querySelector(SEL.playPause);
    if (b && isPlaying()) { b.click(); return true; }
    return false;
  }

  async function logSkip(why) {
    const t = current.track; // capture now: the song changes as soon as we skip
    try {
      const s = await HT.getState();
      const entry = {
        title: t.title,
        artist: t.artists.map((a) => a.name).join(", "),
        reason: why.startsWith("song") ? "song" : why.startsWith("suspected") ? "score" : "artist",
        at: Date.now()
      };
      await HT.setState({ skipLog: [entry, ...s.skipLog].slice(0, HT.MAX_LOG) });
    } catch (_) { alive = false; }
  }

  // Runs on every check while a flagged song is the current song, so
  // replaying it from search, a playlist or the back button is caught too.
  function enforce() {
    const why = shouldBlock();
    if (!why) return;
    const now = Date.now();
    if (now - lastActionAt < 1200) return;
    lastActionAt = now;
    attempts++;
    const firstTime = loggedKey !== current.key;
    if (firstTime) { loggedKey = current.key; logSkip(why); }

    if (attempts <= 3 && clickSkip()) {
      if (firstTime) toast(`Skipped "${current.track.title}" (${why})`);
    } else if (pause()) {
      toast(`Paused "${current.track.title}" (${why}). Skipping didn't work here.`, true);
    }
  }

  function check() {
    if (!alive || !state) return;
    const track = currentTrack();
    if (!track) return;
    const key = keyOf(track);
    if (key !== current.key) {
      current = { key, track, score: null };
      attempts = 0;
      if (loggedKey !== key) loggedKey = null;
      requestArtistInfo(track);
      rescore();
    } else {
      if (current.track.pageLabel !== track.pageLabel) {
        current.track.pageLabel = track.pageLabel;
        rescore();
      } else if (!document.getElementById("humantune-ring")) renderRing();
    }
    enforce();
  }

  // ---------- on-page notice ----------

  function toast(message, warn) {
    let el = document.getElementById("humantune-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "humantune-toast";
      el.setAttribute("role", "status");
      Object.assign(el.style, {
        position: "fixed", bottom: "104px", left: "50%", transform: "translateX(-50%)",
        zIndex: "2147483647", padding: "10px 16px", borderRadius: "8px",
        font: "500 13px/1.4 system-ui, sans-serif", color: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,.4)", maxWidth: "80vw",
        transition: "opacity .3s", pointerEvents: "none"
      });
      document.body.appendChild(el);
    }
    el.textContent = "HumanTune · " + message;
    el.style.background = warn ? "#b3541e" : "#1f1f1f";
    el.style.borderLeft = "4px solid " + (warn ? "#ffb26b" : "#1db954");
    el.style.opacity = "1";
    clearTimeout(el._hide);
    el._hide = setTimeout(() => (el.style.opacity = "0"), 4000);
  }

  // ---------- wiring ----------

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "local" || !alive) return;
    try { state = await HT.getState(); } catch (_) { alive = false; return; }
    attempts = 0;
    rescore();
    enforce();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "humantune:getTrack") {
      reply({ track: currentTrack(), score: current.score });
    }
  });

  (async function init() {
    state = await HT.getState();
    new MutationObserver(check).observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["href", "aria-label"]
    });
    setInterval(check, 1000); // backup in case the observer misses a change
    check();
  })();
})();
