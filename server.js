const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, ".data");
const SESSION_ROOT = path.join(DATA_ROOT, "sessions");

fs.mkdirSync(SESSION_ROOT, { recursive: true });

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || "";
  header.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function makeId(prefix) {
  return prefix + "_" + crypto.randomBytes(16).toString("hex");
}

function validId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

function ensureSession(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies.promo_sid;
  if (!validId(sid)) {
    sid = makeId("sess");
    res.setHeader("Set-Cookie", "promo_sid=" + encodeURIComponent(sid) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000");
  }
  const dir = path.join(SESSION_ROOT, sid);
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
  const metaPath = path.join(dir, "session.json");
  let meta = { id: sid, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), renders: [] };
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
  }
  meta.lastActive = new Date().toISOString();
  if (!Array.isArray(meta.renders)) meta.renders = [];
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { sid: sid, dir: dir, meta: meta, metaPath: metaPath };
}

function saveMeta(session) {
  fs.writeFileSync(session.metaPath, JSON.stringify(session.meta, null, 2));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dummyRes = { setHeader: function () {} };
      const session = ensureSession(req, req.res || dummyRes);
      req.sessionInfo = session;
      cb(null, path.join(session.dir, "uploads"));
    },
    filename: function (req, file, cb) {
      const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + safe);
    }
  }),
  limits: { fileSize: 60 * 1024 * 1024, files: 12 }
});

app.get("/health", function (req, res) {
  res.json({ ok: true, dataRoot: DATA_ROOT, ffmpeg: !!ffmpegPath });
});

app.get("/api/session", function (req, res) {
  const s = ensureSession(req, res);
  const uploadDir = path.join(s.dir, "uploads");
  const files = fs.readdirSync(uploadDir).map(function (name) {
    const st = fs.statSync(path.join(uploadDir, name));
    return { name: name, size: st.size, url: "/api/file/" + encodeURIComponent(name) };
  });
  res.json({
    id: s.sid,
    createdAt: s.meta.createdAt,
    lastActive: s.meta.lastActive,
    files: files,
    renders: s.meta.renders.slice().reverse()
  });
});

app.post("/api/upload", upload.array("files", 12), function (req, res) {
  const s = req.sessionInfo || ensureSession(req, res);
  res.json({
    ok: true,
    files: (req.files || []).map(function (f) {
      return { name: f.filename, originalName: f.originalname, size: f.size, url: "/api/file/" + encodeURIComponent(f.filename) };
    }),
    session: s.sid
  });
});

app.get("/api/file/:name", function (req, res) {
  const s = ensureSession(req, res);
  const name = path.basename(req.params.name);
  const file = path.join(s.dir, "uploads", name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

function extractTitle(prompt) {
  const cleaned = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Your product, in motion.";
  const words = cleaned.split(" ").slice(0, 8).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function buildStoryboard(prompt, duration, files) {
  const total = Math.max(8, Math.min(60, Number(duration) || 20));
  const images = files.filter(function (f) { return /\.(png|jpe?g|webp|gif)$/i.test(f.name); });
  const title = extractTitle(prompt);
  const sentences = String(prompt || "").split(/[.!?]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  const scenes = [];
  scenes.push({ type: "title", duration: Math.max(2.5, total * 0.16), headline: title, subline: "A generated product film" });
  const room = Math.max(1, total - scenes[0].duration - Math.max(2.5, total * 0.17));
  const contentCount = Math.max(1, Math.min(images.length || 1, 5));
  const per = room / contentCount;
  for (let i = 0; i < contentCount; i++) {
    const img = images[i] || null;
    scenes.push({
      type: img ? "image" : "statement",
      duration: per,
      image: img ? img.url : null,
      headline: sentences[i + 1] || sentences[i] || ["Designed to move faster.", "Built around the work that matters.", "From idea to action."][i % 3],
      eyebrow: "0" + (i + 1)
    });
  }
  scenes.push({ type: "end", duration: Math.max(2.5, total * 0.17), headline: "Make the idea visible.", subline: "Generated locally from your materials" });
  return { id: makeId("project"), prompt: prompt, duration: total, scenes: scenes, createdAt: new Date().toISOString() };
}

app.post("/api/generate", function (req, res) {
  const s = ensureSession(req, res);
  const prompt = String(req.body.prompt || "").slice(0, 4000);
  const duration = req.body.duration;
  const files = fs.readdirSync(path.join(s.dir, "uploads")).map(function (name) {
    return { name: name, url: "/api/file/" + encodeURIComponent(name) };
  });
  const project = buildStoryboard(prompt, duration, files);
  fs.writeFileSync(path.join(s.dir, "projects", project.id + ".json"), JSON.stringify(project, null, 2));
  s.meta.activeProject = project.id;
  s.meta.lastPrompt = prompt;
  saveMeta(s);
  res.json(project);
});

const renderUpload = multer({ dest: path.join(DATA_ROOT, "tmp"), limits: { fileSize: 250 * 1024 * 1024 } });

app.post("/api/render", renderUpload.single("video"), function (req, res) {
  const s = ensureSession(req, res);
  if (!req.file) return res.status(400).json({ error: "video missing" });
  const renderId = makeId("render");
  const webmPath = path.join(s.dir, "outputs", renderId + ".webm");
  const mp4Path = path.join(s.dir, "outputs", renderId + ".mp4");
  fs.renameSync(req.file.path, webmPath);

  function finish(record) {
    s.meta.renders.push(record);
    saveMeta(s);
    res.json(record);
  }

  if (!ffmpegPath) {
    return finish({ id: renderId, format: "webm", createdAt: new Date().toISOString(), url: "/api/output/" + renderId + ".webm" });
  }

  const ff = spawn(ffmpegPath, [
    "-y", "-i", webmPath,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    mp4Path
  ]);

  let stderr = "";
  ff.stderr.on("data", function (d) { stderr += d.toString().slice(-4000); });
  ff.on("close", function (code) {
    if (code === 0 && fs.existsSync(mp4Path)) {
      try { fs.unlinkSync(webmPath); } catch (_) {}
      finish({ id: renderId, format: "mp4", createdAt: new Date().toISOString(), url: "/api/output/" + renderId + ".mp4" });
    } else {
      finish({ id: renderId, format: "webm", createdAt: new Date().toISOString(), url: "/api/output/" + renderId + ".webm", note: "MP4 conversion unavailable" });
    }
  });
});

app.get("/api/output/:name", function (req, res) {
  const s = ensureSession(req, res);
  const name = path.basename(req.params.name);
  if (!/^[a-zA-Z0-9_-]+\.(mp4|webm)$/.test(name)) return res.status(400).end();
  const file = path.join(s.dir, "outputs", name);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.listen(PORT, "0.0.0.0", function () {
  console.log("Promotion V0 listening on " + PORT);
  console.log("Data root: " + DATA_ROOT);
});
