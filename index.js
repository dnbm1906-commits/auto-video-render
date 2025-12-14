import express from "express";
import { spawn } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/ping", (req, res) => res.status(200).send("pong"));
app.post("/echo", (req, res) => res.status(200).json({ ok: true, body: req.body }));

/**
 * JOB STORE (in-memory)
 * Free plan có thể restart => mất trạng thái. Starter ổn định hơn.
 */
const JOBS = new Map(); // job_id -> {status, error, video_file, created_at, updated_at}
const QUEUE = [];
let WORKING = false;

// ---- Queue runner (chạy 1 job/lần) ----
async function runQueue_() {
  if (WORKING) return;
  WORKING = true;

  while (QUEUE.length > 0) {
    const jobId = QUEUE.shift();
    const job = JOBS.get(jobId);
    if (!job || job.status !== "QUEUED") continue;

    try {
      JOBS.set(jobId, { ...job, status: "RENDERING", updated_at: Date.now() });
      await renderVideoLight_(jobId, job.scenes);
      const done = JOBS.get(jobId);
      JOBS.set(jobId, { ...done, status: "DONE", updated_at: Date.now() });
    } catch (e) {
      const j = JOBS.get(jobId);
      JOBS.set(jobId, {
        ...j,
        status: "ERROR",
        error: String(e?.message || e),
        updated_at: Date.now()
      });
    }
  }

  WORKING = false;
}

// ---- FFmpeg render nhẹ (720x1280, 24fps, ultrafast, crf 28) ----
function renderVideoLight_(jobId, scenes) {
  return new Promise((resolve, reject) => {
    // Render “demo nhẹ” theo scenes: mỗi scene 2s, overlay text tối giản
    // Total duration: min(12s, scenes*2s) => nhẹ hơn rất nhiều
    const sceneCount = Math.max(1, Math.min(6, scenes.length)); // giới hạn 6 cảnh
    const perScene = 2; // giây / cảnh
    const total = sceneCount * perScene;

    // Text file cho drawtext (tối giản)
    const lines = [];
    for (let i = 0; i < sceneCount; i++) {
      const t = (scenes[i]?.onscreen_text || scenes[i]?.text || `Scene ${i + 1}`).toString();
      lines.push(`Scene ${i + 1}: ${t}`);
    }
    const textPath = `/tmp/text_${jobId}.txt`;
    fs.writeFileSync(textPath, lines.join("\\n"), "utf8");

    const outPath = `/tmp/output_${jobId}.mp4`;
    JOBS.set(jobId, { ...(JOBS.get(jobId) || {}), video_file: outPath });

    // drawtext nhẹ + font DejaVu (cài trong Dockerfile)
    const vf = [
      "scale=720:1280",
      "fps=24",
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=${textPath}:fontcolor=white:fontsize=40:x=(w-text_w)/2:y=h*0.75:line_spacing=10:box=1:boxcolor=black@0.35:boxborderw=20`
    ].join(",");

    const args = [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=black:s=720x1280:r=24:d=${total}`,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath
    ];

    const ff = spawn("ffmpeg", args);

    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));

    ff.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error("ffmpeg_failed: " + stderr.slice(-1500)));
      }
      resolve();
    });

    ff.on("error", (err) => reject(err));
  });
}

// ---- API: create render job (async) ----
app.post("/render", (req, res) => {
  const { job_id, scenes } = req.body;

  if (!job_id) return res.status(400).json({ error: "Missing job_id" });
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: "No scenes provided" });
  }

  // Nếu job đang tồn tại & đang làm, trả trạng thái
  const existing = JOBS.get(job_id);
  if (existing && (existing.status === "QUEUED" || existing.status === "RENDERING")) {
    return res.status(202).json({ status: existing.status, job_id });
  }

  // Lưu job + đẩy vào queue
  JOBS.set(job_id, {
    status: "QUEUED",
    scenes,
    error: "",
    video_file: "",
    created_at: Date.now(),
    updated_at: Date.now()
  });
  QUEUE.push(job_id);

  // Trả về ngay
  res.status(202).json({ status: "QUEUED", job_id });

  // Chạy queue background
  setImmediate(runQueue_);
});

// ---- API: status ----
app.get("/status/:jobId", (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.status(200).json({
    status: job.status,
    error: job.error || "",
    video_file: job.video_file || ""
  });
});

// ---- API: download mp4 ----
app.get("/download/:jobId", (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) return res.status(404).send("Job not found");
  if (job.status !== "DONE") return res.status(400).send("Job not done yet");
  if (!job.video_file || !fs.existsSync(job.video_file)) return res.status(404).send("Video file missing");

  return res.download(job.video_file, `output_${req.params.jobId}.mp4`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Render server running on port", PORT));
