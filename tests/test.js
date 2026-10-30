// End-to-end test: loads the extension in Chromium, serves a mock Spotify
// player at https://open.spotify.com/ and mock MusicBrainz responses.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const EXT = path.resolve(__dirname, "..");
const MOCK = fs.readFileSync(path.join(__dirname, "mock.html"), "utf8");
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) failures++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake MusicBrainz data, in the shape of the real /ws/2 JSON API.
const thisYear = new Date().getFullYear();
const recentDate = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const MB_ARTISTS = {
  "Real Person": {
    id: "mb-real", name: "Real Person", "life-span": { begin: "1970" },
    relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q1" } }],
    "release-groups": [{ "first-release-date": "1973-10-05" }]
  },
  "Someone Else": {
    id: "mb-else", name: "Someone Else", "life-span": { begin: String(thisYear - 1) },
    relations: [],
    "release-groups": Array.from({ length: 12 }, () => ({ "first-release-date": recentDate }))
  }
  // "Ghost Artist" is deliberately missing (not in MusicBrainz)
};
let mbRequests = 0;

(async () => {
  const ctx = await chromium.launchPersistentContext("/tmp/ht-profile-" + Date.now(), {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  await ctx.route("https://open.spotify.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: MOCK })
  );
  await ctx.route("https://raw.githubusercontent.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/plain", body: "# test list\nGhost Choir AI\nThe Velvet Sundown\n" })
  );
  await ctx.route("https://musicbrainz.org/**", (r) => {
    mbRequests++;
    const u = new URL(r.request().url());
    let body;
    if (u.pathname === "/ws/2/artist/") {
      const name = (u.searchParams.get("query").match(/"(.*)"/) || [])[1];
      const a = MB_ARTISTS[name];
      body = { artists: a ? [{ id: a.id, name: a.name, score: 100 }] : [] };
    } else {
      const id = u.pathname.split("/").pop();
      body = Object.values(MB_ARTISTS).find((a) => a.id === id);
    }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  const hex = require("crypto").createHash("sha256").update(EXT).digest("hex").slice(0, 32);
  const extId = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

  const page = await ctx.newPage();
  await page.goto("https://open.spotify.com/");
  await wait(2500);
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await page.bringToFront();

  const playing = () => page.evaluate(() => window.mock.current());
  const goTo = async (n, ms = 2500) => { await page.evaluate((n) => window.mock.jumpTo(n), n); await wait(ms); };
  const ringText = () => page.evaluate(() => document.getElementById("humantune-ring")?.textContent || "");
  const ringTitle = () => page.evaluate(() => document.getElementById("humantune-ring")?.title || "");
  const popupClick = async (text) => {
    await popup.reload(); await wait(900);
    await popup.getByRole("button", { name: text, exact: true }).click();
    await wait(2500);
  };
  const setToggle = async (on) => {
    await popup.reload(); await wait(500);
    if ((await popup.locator("#enabled").isChecked()) !== on) await popup.locator(".slider").click();
    await wait(400);
  };

  // --- Basics -------------------------------------------------------------
  ok((await playing()).title === "Human Song", "human track is not skipped");
  ok(mbRequests >= 2, `artist looked up on MusicBrainz (${mbRequests} requests)`);
  let rt = await ringText();
  ok(/^3Likely human$/.test(rt), "on-page ring shows 3 / Likely human for an established artist: " + rt);
  ok((await ringTitle()).includes("Wikipedia/Wikidata"), "ring tooltip explains why");

  await page.evaluate(() => window.mock.next());
  await wait(2500);
  ok((await playing()).title === "Another Human Song", "seeded AI artist (The Velvet Sundown) skipped");

  // --- Score levels ---------------------------------------------------------
  await goTo(4, 4000);
  ok((await playing()).title === "Last Song", "high-score song still plays while auto-skip-by-score is off");
  rt = await ringText();
  ok(/^70Likely AI$/.test(rt), "suspicious artist scores 70 / Likely AI: " + rt);
  const tip = await ringTitle();
  ok(tip.includes("12 releases in the past year") && tip.includes("not audio"), "tooltip lists the reasons and the caveat");

  await goTo(8, 4000);
  rt = await ringText();
  ok(/^60Likely AI$/.test(rt), "artist missing from MusicBrainz scores 60: " + rt);

  // --- Problem 1: marked songs must ALWAYS skip ----------------------------
  await goTo(0);
  await popupClick("Mark this song as AI");
  await page.bringToFront();
  ok((await playing()).title !== "Human Song", "marked song is skipped");
  for (let n = 1; n <= 3; n++) {
    await goTo(0);
    ok((await playing()).title !== "Human Song", `replay #${n} of the marked song is skipped`);
  }
  await goTo(7);
  ok((await playing()).title !== "Human Song - Remastered 2014",
    "a different release of the same song (other track ID, '- Remastered 2014') is skipped");
  await goTo(2);
  ok((await playing()).title === "Another Human Song", "other songs by the same artist still play");

  // If Spotify won't skip, the song gets paused instead.
  await page.evaluate(() => window.mock.setSkipDisabled(true));
  await goTo(0, 3000);
  let cur = await playing();
  ok(cur.title === "Human Song" && cur.playing === false, "when skipping is blocked, the marked song is paused");
  await page.evaluate(() => document.getElementById("pp").click()); // user presses play again
  await wait(2500);
  ok((await playing()).playing === false, "pressing play on it again gets paused again");
  await page.evaluate(() => window.mock.setSkipDisabled(false));

  // Ring shows 100 for marked songs
  await setToggle(false);
  await goTo(0);
  rt = await ringText();
  ok(/^100AI \(marked\)$/.test(rt), "marked song shows 100 / AI (marked): " + rt);

  // --- Popup ring -----------------------------------------------------------
  await popup.reload(); await wait(1200);
  const card = await popup.locator("#now").innerText();
  ok(card.includes("AI (marked)") && card.includes("You marked this song AI"), "popup shows the verdict and reason");
  await popup.getByRole("button", { name: "Unmark this song", exact: true }).click(); await wait(1500);
  await goTo(4, 1500);
  await popup.reload(); await wait(1200);
  const card2 = await popup.locator("#now").innerText();
  ok(card2.includes("Likely AI") && card2.includes("not audio"), "popup shows heuristic score with caveat");
  await popup.screenshot({ path: path.join(__dirname, "popup.png"), fullPage: true });
  const logLines = (await popup.locator("#log").innerText()).split("\n").filter((l) => l.includes("·"));
  const bad = logLines.filter((l) => /Mystery Track|Another Human Song|Last Song/.test(l));
  ok(bad.length === 0, "skip log only lists songs that were actually skipped: " + JSON.stringify(logLines));

  // --- Optional auto-skip by score -----------------------------------------
  await setToggle(true);
  await popup.locator("#skipSuspected").check(); await wait(300);
  await popup.locator("#threshold").selectOption("80"); await wait(300);
  await goTo(4);
  ok((await playing()).title === "Last Song", "score 70 is NOT skipped at threshold 80");
  await popup.locator("#threshold").selectOption("70"); await wait(2500);
  ok((await playing()).title !== "Last Song", "score 70 IS skipped at threshold 70");
  await goTo(0);
  ok((await playing()).title === "Human Song", "low-score song still plays with auto-skip on");
  await popup.locator("#skipSuspected").uncheck(); await wait(300);

  // --- Whole artist / Not AI overrides (from v0.2) --------------------------
  await goTo(0);
  await popupClick("Mark all of Real Person as AI");
  ok((await playing()).title !== "Human Song", "whole-artist block skips their song");
  await setToggle(false);
  await goTo(0);
  await popupClick("This song is Not AI");
  await setToggle(true); await wait(2000);
  ok((await playing()).title === "Human Song", "song marked Not AI plays even though its artist is blocked");
  await goTo(2);
  ok((await playing()).title !== "Another Human Song", "the rest of the blocked artist still skips");

  // --- Import ---------------------------------------------------------------
  await popup.reload(); await wait(800);
  await popup.getByText("Import a shared list from a URL").click();
  await popup.fill("#importUrl", "https://raw.githubusercontent.com/x/y/main/list.txt");
  await popup.click("#importBtn"); await wait(800);
  const msg = await popup.locator("#msg").innerText();
  ok(msg.includes("Imported 1 new"), "import added artists: " + msg);

  await page.screenshot({ path: path.join(__dirname, "page.png"), clip: { x: 0, y: 0, width: 600, height: 120 } });
  await ctx.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
