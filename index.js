import express from "express";
import { spawn } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => res.send("OK"));

app.post("/render", async (req, res) => {
  try {
    const { job_id, scenes } = req.body;

    if (!job_id) return res.status(400).json({ error: "Missing job_id" });
    if (!Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: "No scenes provided" });
    }

    // 1) Tạo text file từ scenes
    const textContent = scenes
      .map((s, i) => `Scene ${i + 1}: ${(s.onscreen_text || "").toString()}`)
      .join("\n");
    fs.writeFileSync("/tmp/text.txt", textContent, "utf8");

    const output = `/tmp/output_${job_id}.mp4`;

    // 2) Chạy ffmpeg bằng spawn(args) để KHÔNG bị lỗi xuống dòng
    const args = [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=black:s=1080x1920:d=12",
      "-vf", "drawtext=textfile=/tmp/text.txt:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=10",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      output
    ];

    const ff = spawn("ffmpeg", args);

    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));
    ff.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: "ffmpeg_failed", details: stderr.slice(-2000) });
      }

      // Demo: trả link giả (bước sau mình sẽ cho upload Drive và trả link thật)
      res.json({
        status: "DONE",
        video_file: output
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Render server running on port", PORT));
