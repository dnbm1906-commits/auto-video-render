import express from "express";
import { exec } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "50mb" }));

/**
 * POST /render
 * Body:
 * {
 *   job_id: "abc123",
 *   aspect_ratio: "9:16",
 *   voiceover_text: "...",
 *   scenes: [{ onscreen_text: "..." }, ...]
 * }
 */
app.post("/render", async (req, res) => {
  try {
    const { job_id, scenes } = req.body;

    if (!job_id) {
      return res.status(400).json({ error: "Missing job_id" });
    }
    if (!scenes || scenes.length === 0) {
      return res.status(400).json({ error: "No scenes provided" });
    }

    // 1️⃣ Tạo text overlay từ scenes
    const textContent = scenes
      .map((s, i) => `Scene ${i + 1}: ${s.onscreen_text || ""}`)
      .join("\n");

    fs.writeFileSync("text.txt", textContent);

    // 2️⃣ Render video đơn giản (nền đen + text)
    const output = `output_${job_id}.mp4`;

    const cmd = `
      ffmpeg -y
      -f lavfi -i color=c=black:s=1080x1920:d=12
      -vf "drawtext=textfile=text.txt:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=10"
      -c:v libx264 -pix_fmt yuv420p
      ${output}
    `;

    exec(cmd, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

      // Demo: trả link giả (bước sau sẽ upload Drive/S3)
      res.json({
        status: "DONE",
        video_url: `https://your-server/${output}`
      });
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Render server running on port", PORT);
});
