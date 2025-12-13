app.get("/ping", (req, res) => res.status(200).send("pong"));
app.post("/echo", (req, res) => res.status(200).json({ ok: true, body: req.body }));

import express from "express";
import { spawn } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => res.send("OK"));

const JOBS = new Map(); // job_id -> {status, error, video_file}

app.post("/render", (req, res) => {
  const { job_id, scenes } = req.body;

  if (!job_id) return res.status(400).json({ error: "Missing job_id" });
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: "No scenes provided" });
  }

  // ghi trạng thái
  JOBS.set(job_id, { status: "RENDERING" });

  // trả ngay để tránh timeout 502
  res.status(202).json({ status: "RENDERING", job_id });

  try {
    const textContent = scenes
      .map((s, i) => `Scene ${i + 1}: ${(s.onscreen_text || "").toString()}`)
      .join("\n");
    fs.writeFileSync(`/tmp/text_${job_id}.txt`, textContent, "utf8");

    const output = `/tmp/output_${job_id}.mp4`;

    const args = [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=black:s=1080x1920:d=12",
      "-vf", `drawtext=textfile=/tmp/text_${job_id}.txt:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=10`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      output
    ];

    const ff = spawn("ffmpeg", args);

    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));

    ff.on("close", (code) => {
      if (code !== 0) {
        JOBS.set(job_id, { status: "ERROR", error: stderr.slice(-2000) });
      } else {
        JOBS.set(job_id, { status: "DONE", video_file: output });
      }
    });

    ff.on("error", (err) => {
      JOBS.set(job_id, { status: "ERROR", error: err.message });
    });
  } catch (e) {
    JOBS.set(job_id, { status: "ERROR", error: e.message });
  }
});

app.get("/status/:jobId", (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Render server running on port", PORT));
