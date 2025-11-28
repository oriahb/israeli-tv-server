const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const chromium = require('chrome-aws-lambda');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for Roku requests
app.use(cors());

// Cache for m3u8 URLs
const urlCache = {
  channel10: {
    url: null,
    timestamp: null,
    ttl: 60 * 60 * 1000 // 1 hour
  },
  channel12: {
    url: null,
    timestamp: null,
    ttl: 60 * 60 * 1000 // 1 hour
  }
};

// Check if cached URL is still valid
function isCacheValid(channel) {
  const cache = urlCache[channel];
  if (!cache.url || !cache.timestamp) return false;
  return (Date.now() - cache.timestamp) < cache.ttl;
}

// Fetch m3u8 URL using Puppeteer
async function fetchM3u8WithPuppeteer(pageUrl, channelName) {
  console.log(`Fetching ${channelName} from ${pageUrl}...`);
  
  let browser;
  try {
    // Launch headless Chrome with Render-compatible settings
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Array to store captured m3u8 URLs
    const m3u8Urls = [];
    
    // Intercept network requests to capture m3u8 URLs
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      
      // Check if URL contains .m3u8
      if (url.includes('.m3u8')) {
        console.log(`Found m3u8 URL: ${url}`);
        m3u8Urls.push(url);
      }
      
      request.continue();
    });
    
    // Navigate to the page
    await page.goto(pageUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait a bit for video player to load
    await page.waitForTimeout(5000);
    
    // Try to find and click play button (common selectors)
    try {
      const playButtonSelectors = [
        'button[class*="play"]',
        'button[aria-label*="play"]',
        '.video-play-button',
        '.play-button',
        '[data-testid="play-button"]',
        'video'
      ];
      
      for (const selector of playButtonSelectors) {
        const button = await page.$(selector);
        if (button) {
          console.log(`Found play button: ${selector}`);
          await button.click();
          await page.waitForTimeout(3000);
          break;
        }
      }
    } catch (err) {
      console.log('No play button found or already playing');
    }
    
    // Wait a bit more for m3u8 requests
    await page.waitForTimeout(3000);
    
    await browser.close();
    
    // Return the first m3u8 URL found (usually the master playlist)
    if (m3u8Urls.length > 0) {
      // Prefer URLs with "master" or "playlist" or "index" in them
      const masterUrl = m3u8Urls.find(url => 
        url.includes('master') || url.includes('playlist') || url.includes('index')
      );
      return masterUrl || m3u8Urls[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching ${channelName}:`, error.message);
    if (browser) await browser.close();
    return null;
  }
}

// Fetch Channel 10 (Calcala TV)
async function fetchChannel10URL() {
  try {
    console.log('Fetching Channel 10...');
    
    // Try the LiveHDTV embed page
    const url = await fetchM3u8WithPuppeteer(
      'https://www.livehdtv.com/embed/arutz10',
      'Channel 10'
    );
    
    if (url) {
      // Cache the URL
      urlCache.channel10.url = url;
      urlCache.channel10.timestamp = Date.now();
      console.log('Channel 10 URL cached:', url);
      return url;
    }
    
    throw new Error('No m3u8 URL found for Channel 10');
  } catch (error) {
    console.error('Error fetching Channel 10:', error);
    return null;
  }
}

// Fetch Channel 12 (Keshet)
async function fetchChannel12URL() {
  try {
    console.log('Fetching Channel 12...');
    
    // Try the Mako live page
    const url = await fetchM3u8WithPuppeteer(
      'https://www.mako.co.il/mako-vod-live-tv/VOD-6540b8dcb64fd31006.htm',
      'Channel 12'
    );
    
    if (url) {
      // Cache the URL
      urlCache.channel12.url = url;
      urlCache.channel12.timestamp = Date.now();
      console.log('Channel 12 URL cached:', url);
      return url;
    }
    
    throw new Error('No m3u8 URL found for Channel 12');
  } catch (error) {
    console.error('Error fetching Channel 12:', error);
    return null;
  }
}

// API endpoint for Channel 10
app.get('/channel/10', async (req, res) => {
  try {
    // Check cache first
    if (isCacheValid('channel10')) {
      console.log('Returning cached Channel 10 URL');
      return res.json({
        success: true,
        url: urlCache.channel10.url,
        cached: true
      });
    }
    
    // Fetch new URL
    const url = await fetchChannel10URL();
    
    if (url) {
      res.json({
        success: true,
        url: url,
        cached: false
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Channel 10 stream'
      });
    }
  } catch (error) {
    console.error('Error in /channel/10:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint for Channel 12
app.get('/channel/12', async (req, res) => {
  try {
    // Check cache first
    if (isCacheValid('channel12')) {
      console.log('Returning cached Channel 12 URL');
      return res.json({
        success: true,
        url: urlCache.channel12.url,
        cached: true
      });
    }
    
    // Fetch new URL
    const url = await fetchChannel12URL();
    
    if (url) {
      res.json({
        success: true,
        url: url,
        cached: false
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Channel 12 stream'
      });
    }
  } catch (error) {
    console.error('Error in /channel/12:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cache: {
      channel10: {
        cached: isCacheValid('channel10'),
        age: urlCache.channel10.timestamp ? Date.now() - urlCache.channel10.timestamp : null
      },
      channel12: {
        cached: isCacheValid('channel12'),
        age: urlCache.channel12.timestamp ? Date.now() - urlCache.channel12.timestamp : null
      }
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Israeli TV Stream Proxy Server with Puppeteer',
    endpoints: {
      channel10: '/channel/10',
      channel12: '/channel/12',
      health: '/health'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Using Puppeteer to fetch m3u8 URLs`);
  console.log(`API available at:`);
  console.log(`  - http://localhost:${PORT}/channel/10`);
  console.log(`  - http://localhost:${PORT}/channel/12`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
