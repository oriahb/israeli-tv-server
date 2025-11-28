import express from "express";
import puppeteer from "puppeteer";

const app = express();

// Render will set PORT env var. Fallback to 10000 for local.
const PORT = process.env.PORT || 10000;

// Simple sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Source pages for each channel
const CHANNEL_SOURCES = {
  "10": "https://www.livehdtv.com/embed/arutz10",
  "12": "https://www.livehdtv.com/embed/channel-12-live-stream-from-israel"
};

// Cached state
const channelCache = {
  "10": { url: null, lastUpdated: null, lastError: null },
  "12": { url: null, lastUpdated: null, lastError: null }
};

let browserPromise = null;

// ---------------------------------------------------------------------
// Shared browser instance
// ---------------------------------------------------------------------
async function getBrowser() {
  if (!browserPromise) {
    console.log("Launching Puppeteer browser");
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox"
      ]
    });
  }
  return browserPromise;
}

// ---------------------------------------------------------------------
// Click helpers
// ---------------------------------------------------------------------
async function tryClickPlayOnPage(page) {
  await page.evaluate(() => {
    const selectors = [
      ".vjs-big-play-button",
      "button[aria-label='Play']",
      "button[title='Play']",
      "button.play",
      ".plyr__control--overlaid"
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        return;
      }
    }

    const video = document.querySelector("video");
    if (video) {
      video.click();
    }
  });
}

async function tryClickPlayInFrames(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      await frame.evaluate(() => {
        const selectors = [
          ".vjs-big-play-button",
          "button[aria-label='Play']",
          "button[title='Play']",
          "button.play",
          ".plyr__control--overlaid"
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            el.click();
            return;
          }
        }

        const video = document.querySelector("video");
        if (video) {
          video.click();
        }
      });
    } catch (e) {
      // ignore frame errors
    }
  }
}

// ---------------------------------------------------------------------
// Core scraper: open embed page, click play, capture m3u8
// ---------------------------------------------------------------------
async function fetchM3u8FromEmbed(channelId) {
  const embedUrl = CHANNEL_SOURCES[channelId];
  if (!embedUrl) throw new Error("Unknown channel " + channelId);

  console.log("Fetching m3u8 for channel", channelId, "from", embedUrl);

  const browser = await getBrowser();
  const page = await browser.newPage();

  let m3u8Url = null;
  let requestCount = 0;

  try {
    await page.setViewport({ width: 1280, height: 720 });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36"
    );

    // Log first few requests for debugging and capture .m3u8
    page.on("request", req => {
      const url = req.url();
      requestCount += 1;

      if (requestCount <= 10) {
        console.log("Sample request", requestCount, "for channel", channelId, ":", url);
      }

      if (url.includes(".m3u8")) {
        console.log("Detected m3u8 request for channel", channelId, ":", url);
        if (!m3u8Url) {
          m3u8Url = url;
        }
      }
    });

    await page.goto(embedUrl, {
      waitUntil: "networkidle2",
      timeout: 45000
    });

    // Give the player some time
    await sleep(3000);

    // Try clicking center of viewport as a dumb but effective fallback
    try {
      await page.mouse.click(640, 360, { button: "left" });
    } catch (e) {
      console.log("Center click failed:", e.message);
    }

    // Try click on main page
    try {
      await tryClickPlayOnPage(page);
    } catch (e) {
      console.log("Main-page play click error:", e.message);
    }

    // Try clicking inside iframes too
    try {
      await tryClickPlayInFrames(page);
    } catch (e) {
      console.log("Frame play click error:", e.message);
    }

    // Wait up to 45s for .m3u8 to show up
    const maxWaitMs = 45000;
    const stepMs = 1000;
    let waited = 0;

    while (!m3u8Url && waited < maxWaitMs) {
      await sleep(stepMs);
      waited += stepMs;
    }

    if (!m3u8Url) {
      throw new Error("Could not detect m3u8 request for channel " + channelId);
    }

    console.log("Final m3u8 for channel", channelId, "=", m3u8Url);
    return m3u8Url;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------
// Refresh logic with change detection
// ---------------------------------------------------------------------
async function refreshChannel(id) {
  const sourceUrl = CHANNEL_SOURCES[id];
  if (!sourceUrl) {
    console.warn("Unknown channel in refreshChannel:", id);
    return;
  }

  const previous = channelCache[id]?.url || null;

  try {
    const freshUrl = await fetchM3u8FromEmbed(id);

    if (!freshUrl) {
      throw new Error("No m3u8 URL returned for channel " + id);
    }

    if (freshUrl !== previous) {
      console.log(`Channel ${id} stream URL changed`);
      console.log("Old:", previous);
      console.log("New:", freshUrl);
    } else {
      console.log(`Channel ${id} stream URL unchanged`);
    }

    channelCache[id] = {
      url: freshUrl,
      lastUpdated: new Date().toISOString(),
      lastError: null
    };
  } catch (err) {
    console.error("Error refreshing channel", id, err);
    channelCache[id].lastError = err.message;
  }
}

async function refreshAllChannels() {
  console.log("Refreshing all channels");
  const ids = Object.keys(CHANNEL_SOURCES);

  for (const id of ids) {
    await refreshChannel(id);
  }

  console.log("Refresh complete");
}

// ---------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------

// Roku calls this
app.get("/api/channel/:id", async (req, res) => {
  const id = req.params.id;

  if (!CHANNEL_SOURCES[id]) {
    return res.status(404).json({ error: "Unknown channel id" });
  }

  const cache = channelCache[id];

  try {
    // If we have a cached URL, return it
    if (cache && cache.url) {
      return res.json({
        id,
        url: cache.url,
        lastUpdated: cache.lastUpdated,
        cached: true,
        lastError: cache.lastError
      });
    }

    // No cache, try fresh scrape
    const url = await fetchM3u8FromEmbed(id);

    channelCache[id] = {
      url,
      lastUpdated: new Date().toISOString(),
      lastError: null
    };

    return res.json({
      id,
      url,
      lastUpdated: channelCache[id].lastUpdated,
      cached: false,
      lastError: null
    });
  } catch (err) {
    console.error("Error in /api/channel/:id", id, err);
    channelCache[id].lastError = err.message;
    return res.status(500).json({ error: err.message });
  }
});

// Manual refresh endpoint (good for Render Cron or debugging)
app.post("/admin/refresh", async (req, res) => {
  try {
    await refreshAllChannels();
    return res.json({ ok: true, cache: channelCache });
  } catch (err) {
    console.error("Admin refresh error", err);
    return res.status(500).json({ error: err.message });
  }
});

// Status endpoint to see current cache
app.get("/status", (req, res) => {
  res.json(channelCache);
});

// ---------------------------------------------------------------------
// Schedule hourly refresh
// ---------------------------------------------------------------------
const ONE_HOUR_MS = 60 * 60 * 1000;

setInterval(() => {
  refreshAllChannels().catch(err => console.error("Periodic refresh failed", err));
}, ONE_HOUR_MS);

// Warm cache on startup
refreshAllChannels().catch(err => console.error("Initial refresh error", err));

// ---------------------------------------------------------------------
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
