import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

// Only Channel 12, via CXTvLive
const CHANNEL_ID = "12";
const CHANNEL_URL = "https://www.cxtvlive.com/live-tv/channel-12-israel";

const cache = {
  url: null,
  lastUpdated: null,
  lastError: null
};

let browserPromise = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBrowser() {
  if (!browserPromise) {
    console.log("Launching Puppeteer browser");
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }
  return browserPromise;
}

// Try to click play on the main CXTvLive page
async function clickPlayOnPage(page) {
  console.log("Channel 12: trying main-page play click");

  const selectors = [
    ".vjs-big-play-button",
    ".vjs-play-control",
    "button[title='Play']",
    "button[aria-label='Play']",
    ".play",
    ".video-js",
    "#player",
    ".embed-responsive",
    ".jw-display-icon-container",
    ".jw-icon-playback"
  ];

  for (const sel of selectors) {
    try {
      const handle = await page.$(sel);
      if (handle) {
        console.log(`Channel 12: clicking selector on main page: ${sel}`);
        await handle.click();
        await sleep(800);
      }
    } catch (e) {
      console.log(
        `Channel 12: error clicking ${sel} on main page:`,
        e.message
      );
    }
  }

  // Generic fallback
  try {
    await page.evaluate(() => {
      const clickableSelectors = [
        ".vjs-big-play-button",
        ".vjs-play-control",
        "button[title='Play']",
        "button[aria-label='Play']",
        ".play",
        ".video-js",
        ".jw-display-icon-container",
        ".jw-icon-playback"
      ];

      clickableSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          try {
            el.click();
          } catch {}
        });
      });

      const video = document.querySelector("video");
      if (video) {
        try {
          video.click();
        } catch {}
      }
    });
  } catch (e) {
    console.log("Channel 12: error in main-page evaluate click:", e.message);
  }
}

// Try to click play inside frames, with special handling for MAKO
async function clickPlayInFrames(page) {
  console.log("Channel 12: trying iframe play click");

  const genericSelectors = [
    ".vjs-big-play-button",
    ".vjs-play-control",
    "button[title='Play']",
    "button[aria-label='Play']",
    ".play",
    ".video-js",
    ".jw-display-icon-container",
    ".jw-icon-playback"
  ];

  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url();
    console.log("Channel 12: inspecting frame:", url);

    // SPECIAL CASE: MAKO EMBED FRAME
    if (url.includes("mako.co.il")) {
      try {
        // First, log some HTML around #click_container so we know it's there
        const hasClickContainer = await frame.evaluate(() => {
          const el = document.querySelector("#click_container");
          return !!el;
        });

        console.log(
          "Channel 12: MAKO frame has #click_container:",
          hasClickContainer
        );

        // Directly click the "sprite startPlay" inside #click_container
        const clicked = await frame.evaluate(() => {
          const btn = document.querySelector(
            "#click_container .sprite.startPlay"
          );
          if (btn) {
            try {
              btn.click();
            } catch {}
            // Extra: dispatch mouse events to be safe
            const rect = btn.getBoundingClientRect();
            const evOpts = {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2
            };
            ["mousedown", "mouseup", "click"].forEach(type => {
              try {
                btn.dispatchEvent(new MouseEvent(type, evOpts));
              } catch {}
            });
            return true;
          }
          return false;
        });

        console.log(
          "Channel 12: clicked #click_container .sprite.startPlay in MAKO frame:",
          clicked
        );

        // Give the player a moment to react
        await sleep(2000);

        // Also try to click any video element in the MAKO frame
        await frame.evaluate(() => {
          const video = document.querySelector("video");
          if (video) {
            try {
              video.click();
            } catch {}
          }
        });
      } catch (e) {
        console.log(
          "Channel 12: error while clicking MAKO play button:",
          e.message
        );
      }
    }

    // Generic clicks in all frames (including MAKO as fallback)
    for (const sel of genericSelectors) {
      try {
        const handle = await frame.$(sel);
        if (handle) {
          console.log(`Channel 12: clicking selector in frame: ${sel}`);
          await handle.click();
          await sleep(800);
        }
      } catch (e) {
        // ignore
      }
    }

    try {
      await frame.evaluate(() => {
        const clickableSelectors = [
          ".vjs-big-play-button",
          ".vjs-play-control",
          "button[title='Play']",
          "button[aria-label='Play']",
          ".play",
          ".video-js",
          ".jw-display-icon-container",
          ".jw-icon-playback"
        ];
        clickableSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            try {
              el.click();
            } catch {}
          });
        });
        const video = document.querySelector("video");
        if (video) {
          try {
            video.click();
          } catch {}
        }
      });
    } catch (e) {
      // ignore
    }
  }
}

// Core: load CXTvLive channel 12, simulate clicks, capture .m3u8
async function fetchChannel12M3u8() {
  console.log(`Channel 12: fetching m3u8 from ${CHANNEL_URL}`);

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

    page.on("console", msg => {
      try {
        console.log("Channel 12 page console:", msg.type(), msg.text());
      } catch {}
    });

    page.on("request", req => {
      const url = req.url();
      requestCount += 1;

      if (requestCount <= 20) {
        console.log(`Channel 12 request ${requestCount}: ${url}`);
      }

      if (url.includes(".m3u8")) {
        console.log(`Channel 12: detected m3u8 request: ${url}`);
        if (!m3u8Url) {
          m3u8Url = url;
        }
      }
    });

    // Load CXTvLive page
    try {
      await page.goto(CHANNEL_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });
    } catch (e) {
      console.log("Channel 12: navigation error, continuing:", e.message);
    }

    // Give scripts some time
    await sleep(5000);

    // Center click on the main page
    try {
      await page.mouse.click(640, 360, { button: "left" });
      console.log("Channel 12: center click done");
    } catch (e) {
      console.log("Channel 12: center click failed:", e.message);
    }

    await clickPlayOnPage(page);

    // Let any iframes load
    await sleep(5000);

    await clickPlayInFrames(page);

    // Wait up to 90 seconds for any .m3u8
    const maxWaitMs = 90000;
    const stepMs = 1000;
    let waited = 0;

    while (!m3u8Url && waited < maxWaitMs) {
      await sleep(stepMs);
      waited += stepMs;
    }

    if (!m3u8Url) {
      throw new Error("Could not detect m3u8 request for channel 12");
    }

    console.log("Channel 12: final m3u8 =", m3u8Url);
    return m3u8Url;
  } finally {
    await page.close();
  }
}

// Refresh channel 12 and update cache
async function refreshChannel12() {
  const previous = cache.url;

  try {
    const freshUrl = await fetchChannel12M3u8();

    if (freshUrl !== previous) {
      console.log("Channel 12: stream URL changed");
      console.log("Old:", previous);
      console.log("New:", freshUrl);
    } else {
      console.log("Channel 12: stream URL unchanged");
    }

    cache.url = freshUrl;
    cache.lastUpdated = new Date().toISOString();
    cache.lastError = null;
  } catch (err) {
    console.error("Channel 12: error refreshing:", err.message);
    cache.lastError = err.message;
  }
}

// API: Roku calls this to get current URL
app.get("/api/channel/12", async (req, res) => {
  try {
    if (cache.url) {
      return res.json({
        id: CHANNEL_ID,
        url: cache.url,
        lastUpdated: cache.lastUpdated,
        cached: true,
        lastError: cache.lastError
      });
    }

    const url = await fetchChannel12M3u8();

    cache.url = url;
    cache.lastUpdated = new Date().toISOString();
    cache.lastError = null;

    return res.json({
      id: CHANNEL_ID,
      url,
      lastUpdated: cache.lastUpdated,
      cached: false,
      lastError: null
    });
  } catch (err) {
    console.error("Channel 12: error in /api/channel/12:", err.message);
    cache.lastError = err.message;
    return res.status(500).json({ error: err.message });
  }
});

// Status endpoint
app.get("/status", (req, res) => {
  res.json({ "12": cache });
});

// Debug: return final HTML we see for channel 12 (no clicks, just load)
app.get("/debug/html-12", async (req, res) => {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36"
    );

    await page.goto(CHANNEL_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await sleep(3000);

    const html = await page.content();
    await page.close();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Channel 12: error in /debug/html-12:", err.message);
    res.status(500).send("Error: " + err.message);
  }
});

// Manual refresh endpoint
app.post("/admin/refresh-12", async (req, res) => {
  try {
    await refreshChannel12();
    res.json({ ok: true, cache });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hourly refresh
const ONE_HOUR = 60 * 60 * 1000;
setInterval(() => {
  refreshChannel12().catch(err =>
    console.error("Channel 12: periodic refresh failed:", err.message)
  );
}, ONE_HOUR);

// Initial refresh at startup
refreshChannel12().catch(err =>
  console.error("Channel 12: initial refresh error:", err.message)
);

app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
