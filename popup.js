(function () {
  "use strict";
  const HT = self.HumanTune;
  const $ = (id) => document.getElementById(id);
  let currentTrack = null;
  let mbInfo = {}; // normalized artist name -> MusicBrainz summary (cached by background.js)

  function el(tag, props, ...children) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    children.forEach((c) => n.append(c));
    return n;
  }

  function flash(text, isError) {
    $("msg").textContent = text;
    $("msg").style.color = isError ? "#ff8a8a" : "#7ee2a1";
    clearTimeout(flash._t);
    flash._t = setTimeout(() => ($("msg").textContent = ""), 3500);
  }

  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    return h < 24 ? h + "h ago" : Math.round(h / 24) + "d ago";
  }

  async function render() {
    const s = await HT.getState();
    $("enabled").checked = s.enabled;
    $("skipSuspected").checked = s.skipSuspected;
    $("threshold").value = String(s.suspectThreshold);
    $("threshold").disabled = !s.skipSuspected;
    $("status").textContent = s.enabled
      ? "On: AI songs are skipped automatically."
      : "Off: AI songs will play normally.";
    $("count").textContent = s.blocklist.length;
    $("allowCount").textContent = s.allowlist.length;
    $("songCount").textContent = s.songBlocklist.length;
    $("songAllowCount").textContent = s.songAllowlist.length;
    renderSongList("songBlocklist", s.songBlocklist, "songBlocklist");
    renderSongList("songAllowlist", s.songAllowlist, "songAllowlist");

    // Skip log
    const log = $("log");
    log.replaceChildren();
    if (!s.skipLog.length) log.append(el("li", { className: "muted", textContent: "Nothing skipped yet." }));
    s.skipLog.slice(0, 15).forEach((e) =>
      log.append(el("li", {},
        el("span", { textContent: `${e.title} · ${e.artist}${e.reason === "song" ? " (song)" : e.reason === "score" ? " (score)" : ""}` }),
        el("span", { className: "muted", textContent: timeAgo(e.at) })))
    );

    // Blocklist
    const bl = $("blocklist");
    bl.replaceChildren();
    s.blocklist
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((e) => {
        const name = el("span", { textContent: e.name });
        if (e.source && e.source !== "user") name.append(el("span", { className: "tag", textContent: e.source }));
        const x = el("button", { className: "x", title: "Remove", textContent: "✕" });
        x.onclick = async () => {
          const st = await HT.getState();
          await HT.setState({ blocklist: HT.removeFromList(st.blocklist, e) });
          render();
        };
        bl.append(el("li", {}, name, x));
      });

    // Allowlist
    const al = $("allowlist");
    al.replaceChildren();
    s.allowlist.forEach((e) => {
      const x = el("button", { className: "x", title: "Remove", textContent: "✕" });
      x.onclick = async () => {
        const st = await HT.getState();
        await HT.setState({ allowlist: HT.removeFromList(st.allowlist, e) });
        render();
      };
      al.append(el("li", {}, el("span", { textContent: e.name }), x));
    });

    renderNow(s);
  }

  function button(text, cls, onclick) {
    const b = el("button", { className: cls, textContent: text });
    b.onclick = async () => { await onclick(); render(); };
    return b;
  }

  function renderNow(s) {
    const box = $("now");
    const t = currentTrack;
    if (!t || !t.artists.length) return;
    box.className = "track";
    const v = HT.verdict(t, s);
    const sc = HT.scoreTrack(t, s, mbInfo, t.pageLabel);
    const lv = HT.levelFor(sc.score);

    const ring = el("div", { className: "ring" });
    ring.innerHTML = HT.ringSvg(sc.score, 64, true);
    const head = el("div", { className: "verdict" },
      el("div", { className: "t", textContent: t.title }),
      el("div", { className: "muted", textContent: t.artists.map((a) => a.name).join(", ") }),
      el("div", { className: "lvl", textContent: lv.label, style: "color:" + lv.color })
    );
    box.replaceChildren(el("div", { className: "scorehead" }, ring, head));

    const why = el("ul", { className: "reasons" });
    sc.reasons.forEach((r) =>
      why.append(el("li", {},
        el("span", { className: r.up ? "up" : "down", textContent: r.up ? "▲" : "▼" }),
        el("span", { textContent: r.text })))
    );
    box.append(why);
    if (sc.score !== null && !sc.definitive) {
      box.append(el("div", { className: "note", textContent: "Estimate from artist metadata, not audio. Mark the song to make it certain." }));
    }

    // Song-level actions
    const songRow = el("div", { className: "row" });
    if (v.reason === "song") {
      songRow.append(button("Unmark this song", "ok", async () => {
        const st = await HT.getState();
        await HT.setState({ songBlocklist: HT.removeSong(st.songBlocklist, t) });
        flash("Song unmarked.");
      }));
    } else if (v.reason === "artist") {
      songRow.append(button("This song is Not AI", "ok", async () => {
        const st = await HT.getState();
        await HT.setState({ songAllowlist: HT.addSong(st.songAllowlist, t) });
        flash("This song will play. The rest of the artist stays blocked.");
      }));
    } else if (v.reason === "song-allowed") {
      songRow.append(button("Remove Not AI mark", "", async () => {
        const st = await HT.getState();
        await HT.setState({ songAllowlist: HT.removeSong(st.songAllowlist, t) });
      }));
    } else {
      songRow.append(button("Mark this song as AI", "danger", async () => {
        const st = await HT.getState();
        await HT.setState({
          songBlocklist: HT.addSong(st.songBlocklist, t),
          songAllowlist: HT.removeSong(st.songAllowlist, t)
        });
        flash(`"${t.title}" marked AI. Other songs by this artist still play.`);
      }));
    }
    box.append(songRow);

    // Artist-level actions (the whole catalog)
    const artistRow = el("div", { className: "row" });
    t.artists.forEach((a) => {
      const isBlocked = !!HT.findBlockedArtist([a], s.blocklist, s.allowlist);
      artistRow.append(isBlocked
        ? button(`${a.name} is Not AI`, "ok", async () => {
            const st = await HT.getState();
            await HT.setState({
              blocklist: HT.removeFromList(st.blocklist, a),
              allowlist: HT.mergeIntoList(st.allowlist, [a], "user").list
            });
            flash(`${a.name} won't be skipped.`);
          })
        : button(`Mark all of ${a.name} as AI`, "danger subtle", async () => {
            const st = await HT.getState();
            await HT.setState({
              allowlist: HT.removeFromList(st.allowlist, a),
              blocklist: HT.mergeIntoList(st.blocklist, [a], "user").list
            });
            flash(`Every song by ${a.name} will be skipped.`);
          }));
    });
    box.append(el("div", { className: "label", textContent: "Whole artist" }), artistRow);
  }

  function renderSongList(id, list, key) {
    const ul = $(id);
    ul.replaceChildren();
    if (!list.length) ul.append(el("li", { className: "muted", textContent: "None yet." }));
    list.forEach((e) => {
      const x = el("button", { className: "x", title: "Remove", textContent: "✕" });
      x.onclick = async () => {
        const st = await HT.getState();
        await HT.setState({ [key]: st[key].filter((y) => !(y.title === e.title && y.artist === e.artist && y.id === e.id)) });
        render();
      };
      ul.append(el("li", {}, el("span", { textContent: `${e.title} · ${e.artist}` }), x));
    });
  }

  async function loadCurrentTrack() {
    try {
      const tabs = await chrome.tabs.query({ url: "https://open.spotify.com/*" });
      // Prefer the active Spotify tab, otherwise any Spotify tab.
      const tab = tabs.find((t) => t.active) || tabs[0];
      if (!tab) return;
      const res = await chrome.tabs.sendMessage(tab.id, { type: "humantune:getTrack" });
      currentTrack = res && res.track;
      if (currentTrack) {
        const keys = currentTrack.artists.map((a) => "mb:" + HT.normalize(a.name));
        const got = await chrome.storage.local.get(keys);
        mbInfo = {};
        currentTrack.artists.forEach((a) => {
          const c = got["mb:" + HT.normalize(a.name)];
          if (c) mbInfo[HT.normalize(a.name)] = c.info;
        });
      }
    } catch (_) {
      currentTrack = null; // tab not ready, or page needs a reload after install
    }
  }

  $("skipSuspected").onchange = async (e) => {
    await HT.setState({ skipSuspected: e.target.checked });
    render();
  };
  $("threshold").onchange = async (e) => {
    await HT.setState({ suspectThreshold: Number(e.target.value) });
    render();
  };

  $("enabled").onchange = async (e) => {
    await HT.setState({ enabled: e.target.checked });
    render();
  };

  $("addBtn").onclick = async () => {
    const name = $("addName").value.trim();
    if (!name) return;
    const st = await HT.getState();
    const { list, added } = HT.mergeIntoList(st.blocklist, [{ name }], "user");
    await HT.setState({ blocklist: list, allowlist: HT.removeFromList(st.allowlist, { name }) });
    $("addName").value = "";
    flash(added ? `Added ${name}.` : `${name} is already on the list.`);
    render();
  };
  $("addName").addEventListener("keydown", (e) => e.key === "Enter" && $("addBtn").click());

  $("importBtn").onclick = async () => {
    const url = $("importUrl").value.trim();
    if (!url) return;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const entries = HT.parseImportedList(await resp.text());
      if (!entries.length) throw new Error("no artist names found");
      const st = await HT.getState();
      // Respect the user's "Not AI" choices over shared lists.
      const wanted = entries.filter((e) => !st.allowlist.some((a) => HT.sameArtist(a, e)));
      const { list, added } = HT.mergeIntoList(st.blocklist, wanted, "imported");
      await HT.setState({ blocklist: list });
      flash(`Imported ${added} new artist${added === 1 ? "" : "s"} (${entries.length} in list).`);
      render();
    } catch (err) {
      flash("Import failed: " + err.message, true);
    }
  };

  (async () => {
    await render();
    await loadCurrentTrack();
    render();
  })();
})();
