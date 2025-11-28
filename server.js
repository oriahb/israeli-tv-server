import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// ---------------------------------------------------------------------
// Channel embed sources
// ---------------------------------------------------------------------
const CHANNEL_SOURCES = {
  "10": "https://www.livehdtv.com/embed/arutz10",
  "12": "https://www.livehdtv.com/embed/channel-12-live-stream-from-israel"
};

// ---------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------
const channelCache = {
  "10": { url: null, lastUpdated: null, lastError: null },
  "12": { url: null, lastUpdated: null, lastError: null }
};

// ---------------------------------------------------------------------
// Helper: fetch raw HTML from livehdtv
// ---------------------------------------------------------------------
async function fetchHtml(url, channelId) {
  console.log(new Date().toISOString(), "-", "Fetching HTML for channel", channelId);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching channel ${channelId}`);
  }

  return await res.text();
}

// ---------------------------------------------------------------------
// Extract m3u8 URL from JWPlayer setup
// ---------------------------------------------------------------------
function extractM3u8FromHtml(html, channelId) {
  // Pattern: file: "https://....m3u8?token=..."
  const fileRegex = /file\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/i;
  const match = html.match(fileRegex);

  if (!match) {
    throw new Error("Could not find m3u8 token in JWPlayer config for channel " + channelId);
  }

  return match[1];
}

// ---------------------------------------------------------------------
// Refresh logic
// ---------------------------------------------------------------------
async function refreshChannel(id) {
  const url = CHANNEL_SOURCES[id];
  if (!url) return;

  const previous = channelCache[id].url;

  try {
    const html = await fetchHtml(url, id);
    const m3u8 = extractM3u8FromHtml(html, id);

    if (m3u8 !== previous) {
      console.log(new Date().toISOString(), "-", `Channel ${id} URL updated`);
      console.log("Old:", previous);
      console.log("New:", m3u8);
    } else {
      console.log(new Date().toISOString(), "-", `Channel ${id} URL unchanged`);
    }

    channelCache[id] = {
      url: m3u8,
      lastUpdated: new Date().toISOString(),
      lastError: null
    };
  } catch (err) {
    console.error(new Date().toISOString(), "-", "Error refreshing channel", id, err.message);

    channelCache[id].lastError = err.message;
  }
}

async function refreshAllChannels() {
  console.log(new Date().toISOString(), "-", "Refreshing all channels...");

  for (const id of Object.keys(CHANNEL_SOURCES)) {
    await refreshChannel(id);
  }

  console.log(new Date().toISOString(), "-", "Refresh complete");
}

// ---------------------------------------------------------------------
// API: Roku fetches playlist URL here
// ---------------------------------------------------------------------
app.get("/api/channel/:id", async (req, res) => {
  const id = req.params.id;

  if (!CHANNEL_SOURCES[id]) {
    return res.status(404).json({ error: "Unknown channel" });
  }

  const cache = channelCache[id];

  try {
    // Return cached if available
    if (cache.url) {
      return res.json({
        id,
        url: cache.url,
        lastUpdated: cache.lastUpdated,
        cached: true,
        lastError: cache.lastError
      });
    }

    // Otherwise refresh live
    await refreshChannel(id);

    if (channelCache[id].url) {
      return res.json({
        id,
        url: channelCache[id].url,
        lastUpdated: channelCache[id].lastUpdated,
        cached: false,
        lastError: null
      });
    }

    return res.status(500).json({ error: "No URL available for channel " + id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// DEBUG: Return full raw HTML from livehdtv (for testing access)
// ---------------------------------------------------------------------
app.get("/debug/html-10", async (req, res) => {
  try {
    const html = await fetchHtml(CHANNEL_SOURCES["10"], "10");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error fetching HTML: " + err.message);
  }
});

app.get("/debug/html-12", async (req, res) => {
  try {
    const html = await fetchHtml(CHANNEL_SOURCES["12"], "12");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error fetching HTML: " + err.message);
  }
});

// ---------------------------------------------------------------------
// Status endpoint
// ---------------------------------------------------------------------
app.get("/status", (req, res) => {
  res.json(channelCache);
});

// ---------------------------------------------------------------------
// Hourly refresh
// ---------------------------------------------------------------------
const ONE_HOUR = 60 * 60 * 1000;
setInterval(() => {
  refreshAllChannels().catch(err => console.error("Periodic refresh failed:", err.message));
}, ONE_HOUR);

// Run one refresh immediately at startup
refreshAllChannels().catch(err => console.error("Initial refresh failed:", err.message));

// ---------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(new Date().toISOString(), "-", "Server listening on port", PORT);
});
