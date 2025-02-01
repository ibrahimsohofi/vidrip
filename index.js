const express = require("express");
const ytdlp ="yt-dlp";
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { spawn } = require('child_process');
const app = express();
const PORT = process.env.PORT || 10000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const { pipeline } = require("stream")

if (!YOUTUBE_API_KEY) {
  console.error("YOUTUBE_API_KEY is missing in the environment variables");
  process.exit(1);
}

const isValidUrl = (url) => {
  try {
    new URL(url);
    return url.includes("youtube.com") || url.includes("youtu.be");
  } catch (_) {
    return false;
  }
};

const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  methods: ["GET"],
};
app.use(cors(corsOptions));

app.get("/video-info", async (req, res) => {
  const videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: "No URL provided" });
  }

  if (!isValidUrl(videoUrl)) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  console.log(`Video URL provided: ${videoUrl}`);
  console.log("Fetching video details, please wait...");

  try {
    const cookiesFilePath = path.join(__dirname, 'cookies.txt'); // Path to cookies.txt

    // Fetch video details using yt-dlp with cookies
    const info = await ytdlp(videoUrl, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificate: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36", // Optional: use a common user agent

    });

    const videoId = info.id;
    const [videoResponse, channelResponse] = await Promise.all([
      axios.get(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`
      ),
      axios.get(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${info.channel_id}&key=${YOUTUBE_API_KEY}`
      ),
    ]);

    const videoSnippet = videoResponse.data.items?.[0]?.snippet || {};
    const channelSnippet = channelResponse.data.items?.[0]?.snippet || {};

    const formats = info.formats.map((format) => {
      const ext = format.ext || "Unknown";
      const fileSize = format.filesize
        ? `${(format.filesize / 1e6).toFixed(2)} MB`
        : "Unknown";
      return {
        formatId: format.format_id,
        resolution: format.resolution || `${format.width}x${format.height}` || "audio-only",
        videoCodec: format.vcodec,
        audioCodec: format.acodec,
        fileSize: fileSize,
        videoQuality: format.height ? `${format.height}p` : "Audio Only",
        audioBitrate: format.abr ? `${format.abr} kbps` : "Unknown",
        ext: ext,
        url: format.url || "Unknown",
      };
    });

    let vurl = formats.filter((item) => item.url.includes("https://rr") && item.videoQuality !== "Audio Only" && item.resolution !== "audio-only");
    const videoPlayUrl = vurl.length > 0 ? vurl[vurl.length - 1].url : null;

    res.json({
      url: info.url,
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      author: info.uploader,
      authorImg: channelSnippet.thumbnails?.default?.url || "Unknown",
      channelUrl: info.channel_url,
      formats,
      videoUrl: videoPlayUrl
    });

  } catch (err) {
    console.error("Error fetching video info:", err);
    const errorMessage =
      err.response?.data?.error?.message ||
      err.message ||
      "An unknown error occurred.";
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/download', (req, res) => {
  const { quality, audio, extension, url } = req.query;

  if (!url || !quality || !extension) {
    return res.status(400).json({ message: 'Missing required parameters.' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const format = `bestvideo[height<=${quality}]+bestaudio`;
  const ytDlpProcess = spawn('yt-dlp', ['-f', format, '--merge-output-format', extension, url]);

  let lastProgress = 0;

  ytDlpProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);

    // Extract the last progress percentage from the output
    const progressMatches = output.match(/(\d+\.\d+)%/g); // Extract all percentage values
    if (progressMatches) {
      const latestProgress = parseFloat(progressMatches[progressMatches.length - 1]);

      if (latestProgress >= lastProgress) { // Ensure progress only increases
        lastProgress = latestProgress;
        res.write(JSON.stringify({ progress: latestProgress }) + '\n');
      }
    }
  });

  ytDlpProcess.stderr.on('data', (data) => {
    console.error('yt-dlp error:', data.toString());
  });

  ytDlpProcess.on('close', (code) => {
    if (code === 0) {
      res.write(JSON.stringify({ message: 'Download completed', progress: 100 }) + '\n');
    } else {
      res.write(JSON.stringify({ error: 'Download failed', code }) + '\n');
    }
    res.end();
  });
});

app.get("/dl", async (req, res) => {
  const imageUrl = req.query.url;

  // Validate the URL query parameter
  if (!imageUrl) {
    return res.status(400).json({ error: "Missing 'url' query parameter" });
  }

  try {
    // Fetch the image from the remote server
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      return res.status(400).json({ error: "URL does not point to an image" });
    }

    // Set the appropriate content type
    res.set("Content-Type", contentType);

    // Use pipeline to pipe the response stream to the client
    pipeline(response.body, res, (err) => {
      if (err) {
        console.error("Pipeline error:", err);
        res.status(500).send("Failed to stream the image");
      }
    });
  } catch (error) {
    console.error("Error fetching image:", error.message);
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
