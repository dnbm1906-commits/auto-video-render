import express from "express";
import { spawn } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/ping", (req, res) => res.status(200).send("pong"));
app.post("/echo", (req, res) => res.status(200).json({ ok: true, body: req.body }));

// In-memory job store (demo). Với Free plan có thể restart nên job mất.
// Bước sau nâng cấp: lưu job vào Redis/DB hoặc gửi status về Sheets ngay.
const JOBS = new Map();

app.post("/render", (req, res) => {
  const { job_id, scenes } = req.body;

  if (!job_id) return res.status(400).json({ error: "Missing job_id" });
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: "No scenes provided" });
  }

  // set status
  JOBS.set(job_id, { status: "RENDERING" });

  // trả ngay để tránh timeout proxy (tránh 502)
  res.status(202).json({ status: "RENDERING", job_id });

  try {
    // text overlay from scenes
    const textContent = scenes
      .map((s, i) => `Scene ${i + 1}: ${(s.onscreen_text || "").toString()}`)
      .join("\n");

    const textPath = `/tmp/text_${job_id}.txt`;
    fs.writeFileSync(textPath, textContent, "utf8");

    const output = `/tmp/output_${job_id}.mp4`;

    // NOTE: drawtext cần font; Dockerfile nên cài fonts-dejavu-core để ổn định
    const vf = `drawtext=textfile=${textPath}:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=10`;

    const args = [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=black:s=1080x1920:d=12",
      "-vf", vf,
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
        // demo: chưa có link public
        JOBS.set(job_id, { status: "DONE", video_url: "", video_file: output });
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
  res.status(200).json(job);
});

const PORT = process.env.PORT || 3000;
app.get("/download/:jobId", (req, res) => {
  const id = req.params.jobId;
  const job = JOBS.get(id);
  if (!job) return res.status(404).send("Job not found");
  if (job.status !== "DONE") return res.status(400).send("Job not done yet");
  if (!job.video_file) return res.status(400).send("No video file");

  return res.download(job.video_file, `output_${id}.mp4`);
});

app.listen(PORT, () => console.log("🚀 Render server running on port", PORT));
