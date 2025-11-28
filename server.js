import express from "express";

const app = express();
const PORT = process.env.PORT || 10000;

// LiveHDTV embed pages for each channel
const CHANNEL_PAGES = {
  "10": "https://www.livehdtv.com/embed/arutz10",
  "12": "https://www.livehdtv.com/embed/channel-12-live-stream-from-israel"
};

// Cache structure
const channelCache = {
  "10": { url: null, lastUpdated: null, lastError: null },
  "12": { url: null, lastUpdated: null, lastError: null }
};

// Small helper so logs are readable
function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

// ---------------------------------------------------------------------
// Core: fetch HTML and extract JWPlayer file URL
// ---------------------------------------------------------------------
async function fetchTokenizedUrl(channelId) {
  const pageUrl = CHANNEL_PAGES[channelId];
  if (!pageUrl) {
    throw new Error(`Unknown channel id: ${channelId}`);
  }

  log("Fetching HTML for channel", channelId, "from", pageUrl);

  const res = await fetch(pageUrl, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching channel ${channelId}`);
  }

  const html = await res.text();

  // Look for: file: "https://...m3u8?token=..."
  const fileRegex = /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i;
  const match = html.match(fileRegex);

  if (!match) {
    throw new Error(`Could not find m3u8 file URL in JWPlayer config for channel ${channelId}`);
  }

  const url = match[1];
  log("Extracted m3u8 URL for channel", channelId, "=", url);

  return url;
}

// ---------------------------------------------------------------------
// Refresh logic with change detection
// ---------------------------------------------------------------------
async function refreshChannel(channelId) {
  const previous = channelCache[channelId]?.url || null;

  try {
    const newUrl = await fetchTokenizedUrl(channelId);

    if (!newUrl) {
      throw new Error(`Empty URL returned for channel ${channelId}`);
    }

    if (newUrl !== previous) {
      log(`Channel ${channelId} URL changed`);
      log("Old:", previous);
      log("New:", newUrl);
    } else {
      log(`Channel ${channelId} URL unchanged`);
    }

    channelCache[channelId] = {
      url: newUrl,
      lastUpdated: new Date().toISOString(),
      lastError: null
    };
  } catch (err) {
    log("Error refreshing channel", channelId, err.message);
    channelCache[channelId].lastError = err.message;
  }
}

async function refreshAllChannels() {
  log("Refreshing all channels");
  const ids = Object.keys(CHANNEL_PAGES);

  for (const id of ids) {
    await refreshChannel(id);
  }

  log("Refresh complete");
}

// ---------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------

// Roku calls this to get the current URL
app.get("/api/channel/:id", async (req, res) => {
  const id = req.params.id;

  if (!CHANNEL_PAGES[id]) {
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

    // No cache yet? Fetch fresh
    const url = await fetchTokenizedUrl(id);

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
    log("Error in /api/channel/:id", id, err.message);
    channelCache[id].lastError = err.message;
    return res.status(500).json({ error: err.message });
  }
});

// Manual refresh (for you or Render cron)
app.post("/admin/refresh", async (req, res) => {
  try {
    await refreshAllChannels();
    return res.json({ ok: true, cache: channelCache });
  } catch (err) {
    log("Admin refresh error", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Quick status view
app.get("/status", (req, res) => {
  res.json(channelCache);
});

// ---------------------------------------------------------------------
// Schedule hourly refresh
// ---------------------------------------------------------------------
const ONE_HOUR_MS = 60 * 60 * 1000;

setInterval(() => {
  refreshAllChannels().catch(err => log("Periodic refresh failed", err.message));
}, ONE_HOUR_MS);

// Warm cache on startup
refreshAllChannels().catch(err => log("Initial refresh error", err.message));

// ---------------------------------------------------------------------
app.listen(PORT, () => {
  log("Server listening on port", PORT);
});
