const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
require("dotenv").config();
const { spawn } = require('child_process');
const app = express();
const PORT = process.env.PORT || 10000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

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
    const ytDlpProcess = spawn('yt-dlp', ['-j', videoUrl]);

    let data = '';
    ytDlpProcess.stdout.on('data', (chunk) => {
      data += chunk;
    });

    ytDlpProcess.stderr.on('data', (chunk) => {
      console.error('yt-dlp error:', chunk.toString());
    });

    ytDlpProcess.on('close', async (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: "Failed to fetch video info" });
      }

      try {
        const videoInfo = JSON.parse(data);
        const videoId = videoInfo.id;

        const [videoResponse, channelResponse] = await Promise.all([
          axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`),
          axios.get(`https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${videoInfo.channel_id}&key=${YOUTUBE_API_KEY}`)
        ]);

        const videoSnippet = videoResponse.data.items?.[0]?.snippet || {};
        const channelSnippet = channelResponse.data.items?.[0]?.snippet || {};

        const formats = videoInfo.formats.map((format) => {
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
          url: videoInfo.url,
          title: videoInfo.title,
          duration: videoInfo.duration,
          thumbnail: videoInfo.thumbnail,
          author: videoInfo.uploader,
          authorImg: channelSnippet.thumbnails?.default?.url || "Unknown",
          channelUrl: videoInfo.channel_url,
          formats,
          videoUrl: videoPlayUrl
        });
      } catch (err) {
        console.error("Error fetching additional info:", err);
        res.status(500).json({ error: "Error fetching additional video info" });
      }
    });
  } catch (err) {
    console.error("Error fetching video info:", err);
    res.status(500).json({ error: "An unknown error occurred" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
