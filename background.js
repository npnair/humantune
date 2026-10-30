// Background worker: looks up artists on MusicBrainz (the open music
// database) for the suspicion score. Results are cached for a week.
importScripts("lib/core.js");
const HT = self.HumanTune;

const MB = "https://musicbrainz.org/ws/2/";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const inflight = new Map();

// MusicBrainz allows about one request per second.
let nextSlot = 0;
async function rateLimited(url) {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1100;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error("MusicBrainz HTTP " + resp.status);
  return resp.json();
}

const WIKI = new Set(["wikidata", "wikipedia"]);

function summarize(artist) {
  const rels = (artist.relations || []).filter((r) => r.url && r.url.resource);
  const begin = artist["life-span"] && artist["life-span"].begin;
  const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const recent = (artist["release-groups"] || []).filter((g) => {
    const d = Date.parse(g["first-release-date"] || "");
    return !isNaN(d) && d >= yearAgo;
  }).length;
  return {
    found: true,
    mbid: artist.id,
    wiki: rels.some((r) => WIKI.has(r.type)),
    links: rels.length,
    beginYear: begin ? parseInt(begin.slice(0, 4), 10) || null : null,
    recentReleases: recent
  };
}

async function lookup(name) {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, "")}"`);
  const search = await rateLimited(`${MB}artist/?query=${q}&fmt=json&limit=5`);
  const want = HT.normalize(name);
  const match = (search.artists || []).find(
    (a) => (a.score || 0) >= 90 && HT.normalize(a.name) === want
  );
  if (!match) return { found: false };
  const full = await rateLimited(`${MB}artist/${match.id}?inc=url-rels+release-groups&fmt=json`);
  return summarize(full);
}

async function artistInfo(name) {
  const key = "mb:" + HT.normalize(name);
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.info;
  if (inflight.has(key)) return inflight.get(key);
  const p = lookup(name)
    .then(async (info) => {
      await chrome.storage.local.set({ [key]: { at: Date.now(), info } });
      return info;
    })
    .catch(() => ({ error: true })) // not cached, so it retries next time
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "humantune:artistInfo" && msg.name) {
    artistInfo(msg.name).then(reply);
    return true; // async reply
  }
});
