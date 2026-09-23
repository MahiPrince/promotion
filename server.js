const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

let DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, ".data");

function initializeStorage(preferred) {
  try {
    fs.mkdirSync(path.join(preferred, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(preferred, "tmp"), { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch (err) {
    const fallback = path.join("/tmp", "promotion-data");
    fs.mkdirSync(path.join(fallback, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(fallback, "tmp"), { recursive: true });
    console.warn("Preferred DATA_ROOT unavailable; using ephemeral fallback:", fallback);
    return fallback;
  }
}

DATA_ROOT = initializeStorage(DATA_ROOT);
const SESSION_ROOT = path.join(DATA_ROOT, "sessions");
const TMP_ROOT = path.join(DATA_ROOT, "tmp");

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js")) res.setHeader("Cache-Control", "no-cache");
  }
}));

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || "";
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function makeId(prefix) {
  return prefix + "_" + crypto.randomBytes(12).toString("hex");
}

function validId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

function safeName(name) {
  return path.basename(String(name || "file")).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
}

function guessMime(name) {
  const ext = path.extname(name).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })[ext] || "application/octet-stream";
}

function kindForMime(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "document";
}

function isOpenAIFileType(name) {
  return /\.(pdf|ppt|pptx|doc|docx|rtf|odt|txt|md|json|html|xml|csv|xls|xlsx|tsv)$/i.test(name);
}

function ensureSession(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies.promo_sid;
  if (!validId(sid)) {
    sid = makeId("sess");
    res.setHeader(
      "Set-Cookie",
      "promo_sid=" + encodeURIComponent(sid) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000"
    );
  }

  const dir = path.join(SESSION_ROOT, sid);
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });

  const metaPath = path.join(dir, "session.json");
  let meta = {
    id: sid,
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    renders: [],
    activeProject: null
  };

  if (fs.existsSync(metaPath)) {
    try {
      meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, "utf8")) };
    } catch (_) {}
  }

  if (!Array.isArray(meta.renders)) meta.renders = [];
  meta.lastActive = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return { sid, dir, meta, metaPath };
}

function saveMeta(session) {
  fs.writeFileSync(session.metaPath, JSON.stringify(session.meta, null, 2));
}

function assetsPath(session) {
  return path.join(session.dir, "assets.json");
}

function loadAssets(session) {
  let assets = [];
  const p = assetsPath(session);

  if (fs.existsSync(p)) {
    try {
      assets = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {}
  }
  if (!Array.isArray(assets)) assets = [];

  const uploadDir = path.join(session.dir, "uploads");
  const known = new Set(assets.map((a) => a.storedName));

  for (const storedName of fs.readdirSync(uploadDir)) {
    if (known.has(storedName)) continue;
    const full = path.join(uploadDir, storedName);
    const st = fs.statSync(full);
    if (!st.isFile()) continue;

    const mime = guessMime(storedName);
    assets.push({
      id: makeId("asset"),
      storedName,
      originalName: storedName.replace(/^\d+-[a-f0-9]+-/, ""),
      mime,
      kind: kindForMime(mime),
      size: st.size,
      createdAt: st.birthtime.toISOString()
    });
  }

  fs.writeFileSync(p, JSON.stringify(assets, null, 2));
  return assets;
}

function saveAssets(session, assets) {
  fs.writeFileSync(assetsPath(session), JSON.stringify(assets, null, 2));
}

function publicAsset(asset) {
  return {
    id: asset.id,
    name: asset.originalName,
    mime: asset.mime,
    kind: asset.kind,
    size: asset.size,
    url: "/api/file/" + encodeURIComponent(asset.storedName)
  };
}

function readActiveProject(session) {
  if (!session.meta.activeProject) return null;
  const p = path.join(session.dir, "projects", session.meta.activeProject + ".json");
  if (!fs.existsSync(p)) return null;

  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
}

const uploadStorage = multer.diskStorage({
  destination(req, file, cb) {
    const session = ensureSession(req, req.res);
    req.sessionInfo = session;
    cb(null, path.join(session.dir, "uploads"));
  },
  filename(req, file, cb) {
    cb(null, Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + safeName(file.originalname));
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 40 * 1024 * 1024, files: 12 }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "1.0.0",
    openaiConfigured: !!OPENAI_API_KEY,
    model: OPENAI_MODEL,
    dataRoot: DATA_ROOT,
    persistent: DATA_ROOT.startsWith("/var/data")
  });
});

app.get("/api/session", (req, res) => {
  const session = ensureSession(req, res);
  const assets = loadAssets(session).map(publicAsset);
  const activeProject = readActiveProject(session);

  res.json({
    id: session.sid,
    createdAt: session.meta.createdAt,
    lastActive: session.meta.lastActive,
    assets,
    renders: session.meta.renders.slice().reverse(),
    activeProject
  });
});

app.post("/api/upload", upload.array("files", 12), (req, res) => {
  const session = req.sessionInfo || ensureSession(req, res);
  const assets = loadAssets(session);

  const added = (req.files || []).map((file) => {
    const mime = file.mimetype || guessMime(file.originalname);
    const asset = {
      id: makeId("asset"),
      storedName: file.filename,
      originalName: safeName(file.originalname),
      mime,
      kind: kindForMime(mime),
      size: file.size,
      createdAt: new Date().toISOString()
    };
    assets.push(asset);
    return publicAsset(asset);
  });

  saveAssets(session, assets);
  res.json({ ok: true, files: added, session: session.sid });
});

app.post("/api/delete-file", (req, res) => {
  const session = ensureSession(req, res);
  const id = String(req.body.id || "");
  let assets = loadAssets(session);
  const target = assets.find((asset) => asset.id === id);

  if (!target) return res.status(404).json({ error: "Asset not found." });

  try {
    fs.unlinkSync(path.join(session.dir, "uploads", target.storedName));
  } catch (_) {}

  assets = assets.filter((asset) => asset.id !== id);
  saveAssets(session, assets);
  res.json({ ok: true });
});

app.get("/api/file/:name", (req, res) => {
  const session = ensureSession(req, res);
  const name = path.basename(req.params.name);
  const file = path.join(session.dir, "uploads", name);

  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

const filmSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "creative_summary", "tone", "background", "accent", "duration", "scenes"],
  properties: {
    title: { type: "string" },
    creative_summary: { type: "string" },
    tone: { type: "string" },
    background: { type: "string" },
    accent: { type: "string" },
    duration: { type: "number" },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "duration",
          "asset_id",
          "eyebrow",
          "headline",
          "subline",
          "layout",
          "motion",
          "transition",
          "focus"
        ],
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["title", "product", "feature", "statement", "split", "end"]
          },
          duration: { type: "number", minimum: 1.5, maximum: 8 },
          asset_id: { type: "string" },
          eyebrow: { type: "string" },
          headline: { type: "string" },
          subline: { type: "string" },
          layout: {
            type: "string",
            enum: ["center", "left", "right", "full"]
          },
          motion: {
            type: "string",
            enum: ["push", "pull", "pan_left", "pan_right", "float", "reveal", "focus", "static"]
          },
          transition: {
            type: "string",
            enum: ["cut", "dissolve", "wipe", "iris"]
          },
          focus: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "w", "h"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              w: { type: "number", minimum: 0.05, maximum: 1 },
              h: { type: "number", minimum: 0.05, maximum: 1 }
            }
          }
        }
      }
    }
  }
};

const DIRECTOR_PROMPT = [
  "You are Promotion's principal creative director and motion designer.",
  "Turn the supplied product material into a polished, restrained launch film that feels deliberately directed, not templated.",
  "",
  "Creative rules:",
  "- Tell one clear story: hook -> reveal -> proof -> payoff -> brand.",
  "- Use actual product screens as evidence, not decoration.",
  "- Never invent unsupported product claims.",
  "- Prefer short, sharp on-screen copy. Avoid generic AI language and marketing filler.",
  "- If visual assets exist, identify what each screen shows and place the strongest screens at the strongest narrative moments.",
  "- focus coordinates are normalized regions of interest inside the selected screenshot.",
  "- Use title/statement scenes sparingly. Most scenes should show the product when useful visuals exist.",
  "- Every scene needs a distinct narrative purpose and motion treatment.",
  "- The first scene must hook immediately. The final scene must resolve to the product/brand.",
  "- Headline ideally <= 9 words. Subline ideally <= 16 words.",
  "- background and accent must be valid hex CSS colors.",
  "",
  "Motion vocabulary:",
  "push = slow camera push toward important UI",
  "pull = reveal wider system context",
  "pan_left / pan_right = lateral product inspection",
  "focus = stronger push toward the supplied focus region",
  "float = premium subtle product-card movement",
  "reveal = deliberate graphic entrance",
  "static = intentional stillness only.",
  "",
  "Return only a coherent film specification. The renderer handles implementation."
].join("\n");

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}

function normalizeFilmSpec(spec, requestedDuration, assets) {
  const imageAssets = assets.filter((asset) => asset.kind === "image");
  const validIds = new Set(assets.map((asset) => asset.id));
  const duration = clamp(requestedDuration || spec.duration || 20, 8, 60);

  let scenes = Array.isArray(spec.scenes) ? spec.scenes.slice(0, 10) : [];
  if (scenes.length < 3) throw new Error("AI returned too few scenes.");

  const rawTotal =
    scenes.reduce((sum, scene) => sum + clamp(scene.duration, 1.5, 8), 0) || 1;
  const scale = duration / rawTotal;

  scenes = scenes.map((scene, index) => {
    const fallbackAsset = imageAssets.length
      ? imageAssets[Math.min(index, imageAssets.length - 1)].id
      : "";

    let assetId = validIds.has(scene.asset_id) ? scene.asset_id : "";
    if (
      (scene.type === "product" || scene.type === "feature" || scene.type === "split") &&
      !assetId
    ) {
      assetId = fallbackAsset;
    }

    const focus = scene.focus || {};

    return {
      id: String(scene.id || "scene_" + (index + 1)),
      type: ["title", "product", "feature", "statement", "split", "end"].includes(scene.type)
        ? scene.type
        : "feature",
      duration: Math.max(1.25, clamp(scene.duration, 1.5, 8) * scale),
      asset_id: assetId,
      eyebrow: String(scene.eyebrow || "").slice(0, 40),
      headline: String(scene.headline || "").slice(0, 120),
      subline: String(scene.subline || "").slice(0, 180),
      layout: ["center", "left", "right", "full"].includes(scene.layout)
        ? scene.layout
        : "center",
      motion: [
        "push",
        "pull",
        "pan_left",
        "pan_right",
        "float",
        "reveal",
        "focus",
        "static"
      ].includes(scene.motion)
        ? scene.motion
        : "push",
      transition: ["cut", "dissolve", "wipe", "iris"].includes(scene.transition)
        ? scene.transition
        : "dissolve",
      focus: {
        x: clamp(focus.x ?? 0.15, 0, 1),
        y: clamp(focus.y ?? 0.15, 0, 1),
        w: clamp(focus.w ?? 0.7, 0.05, 1),
        h: clamp(focus.h ?? 0.7, 0.05, 1)
      }
    };
  });

  const normalizedTotal = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  scenes[scenes.length - 1].duration += duration - normalizedTotal;

  const assetMap = Object.fromEntries(
    assets.map((asset) => [asset.id, publicAsset(asset)])
  );

  return {
    id: makeId("project"),
    title: String(spec.title || "Product film").slice(0, 100),
    creative_summary: String(spec.creative_summary || "").slice(0, 600),
    tone: String(spec.tone || "premium, focused").slice(0, 160),
    background: /^#[0-9a-f]{3,8}$/i.test(spec.background || "")
      ? spec.background
      : "#08090c",
    accent: /^#[0-9a-f]{3,8}$/i.test(spec.accent || "")
      ? spec.accent
      : "#7c8cff",
    duration,
    fps: 30,
    scenes,
    assets: assetMap,
    model: OPENAI_MODEL,
    createdAt: new Date().toISOString()
  };
}

function toDataUrl(filePath, mime) {
  const bytes = fs.readFileSync(filePath);
  return {
    data: "data:" + mime + ";base64," + bytes.toString("base64"),
    bytes: bytes.length
  };
}

function buildMaterialContent(session, assets, prompt, duration) {
  const content = [
    {
      type: "input_text",
      text: [
        "USER BRIEF:",
        prompt,
        "",
        "TARGET DURATION: " + duration + " seconds",
        "",
        "AVAILABLE MATERIAL:",
        ...assets.map(
          (asset) =>
            "- " +
            asset.id +
            " | " +
            asset.originalName +
            " | " +
            asset.kind +
            " | " +
            asset.mime
        ),
        "",
        "When a scene uses a visual asset, asset_id MUST exactly match one of the IDs above. Use an empty string for scenes that intentionally have no asset."
      ].join("\n")
    }
  ];

  let includedBytes = 0;
  const maxBytes = 30 * 1024 * 1024;

  for (const asset of assets) {
    const filePath = path.join(session.dir, "uploads", asset.storedName);
    if (!fs.existsSync(filePath)) continue;
    if (includedBytes + asset.size > maxBytes) continue;

    try {
      if (asset.kind === "image") {
        const encoded = toDataUrl(filePath, asset.mime);
        content.push({
          type: "input_text",
          text: "VISUAL ASSET " + asset.id + ": " + asset.originalName
        });
        content.push({
          type: "input_image",
          image_url: encoded.data,
          detail: "auto"
        });
        includedBytes += encoded.bytes;
      } else if (isOpenAIFileType(asset.originalName)) {
        const encoded = toDataUrl(filePath, asset.mime);
        content.push({
          type: "input_text",
          text: "DOCUMENT ASSET " + asset.id + ": " + asset.originalName
        });

        const item = {
          type: "input_file",
          filename: asset.originalName,
          file_data: encoded.data
        };
        if (asset.kind === "pdf") item.detail = "auto";

        content.push(item);
        includedBytes += encoded.bytes;
      }
    } catch (err) {
      console.warn("Skipping material", asset.originalName, err.message);
    }
  }

  return content;
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  const pieces = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && typeof part.text === "string") {
        pieces.push(part.text);
      }
    }
  }
  return pieces.join("");
}

async function callOpenAI(payload) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + OPENAI_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      "OpenAI request failed with status " + response.status;
    throw new Error(String(message));
  }

  return data;
}

async function directFilm(session, prompt, duration, assets) {
  const response = await callOpenAI({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: DIRECTOR_PROMPT },
      {
        role: "user",
        content: buildMaterialContent(session, assets, prompt, duration)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "promotion_film",
        strict: true,
        schema: filmSchema
      }
    }
  });

  const outputText = extractOutputText(response);
  if (!outputText) throw new Error("OpenAI returned no film specification.");

  return normalizeFilmSpec(JSON.parse(outputText), duration, assets);
}

app.post("/api/generate", async (req, res) => {
  const session = ensureSession(req, res);
  const prompt = String(req.body.prompt || "").trim().slice(0, 5000);
  const duration = clamp(req.body.duration || 20, 8, 60);
  const assets = loadAssets(session);

  if (!OPENAI_API_KEY) {
    return res.status(503).json({
      error: "OpenAI API key is not configured on the service."
    });
  }

  if (!prompt && !assets.length) {
    return res.status(400).json({
      error: "Add a prompt or product material first."
    });
  }

  try {
    const project = await directFilm(
      session,
      prompt || "Create a compelling product launch film from the supplied material.",
      duration,
      assets
    );

    project.user_prompt = prompt;
    fs.writeFileSync(
      path.join(session.dir, "projects", project.id + ".json"),
      JSON.stringify(project, null, 2)
    );

    session.meta.activeProject = project.id;
    session.meta.lastPrompt = prompt;
    saveMeta(session);

    res.json(project);
  } catch (err) {
    console.error("AI generation failed:", err);
    res.status(500).json({
      error: err.message || "AI generation failed."
    });
  }
});

app.post("/api/revise", async (req, res) => {
  const session = ensureSession(req, res);
  const instruction = String(req.body.instruction || "").trim().slice(0, 3000);
  const current = readActiveProject(session);
  const assets = loadAssets(session);

  if (!OPENAI_API_KEY) {
    return res.status(503).json({
      error: "OpenAI API key is not configured."
    });
  }

  if (!current) {
    return res.status(400).json({
      error: "No active film to revise."
    });
  }

  if (!instruction) {
    return res.status(400).json({
      error: "Describe the change you want."
    });
  }

  try {
    const response = await callOpenAI({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            DIRECTOR_PROMPT +
            "\n\nYou are revising an existing film. Preserve everything that already works and change only what the user's revision actually requires."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "REVISION REQUEST:",
                instruction,
                "",
                "CURRENT FILM SPEC:",
                JSON.stringify({
                  title: current.title,
                  creative_summary: current.creative_summary,
                  tone: current.tone,
                  background: current.background,
                  accent: current.accent,
                  duration: current.duration,
                  scenes: current.scenes
                }),
                "",
                "AVAILABLE ASSET IDS:",
                ...assets.map(
                  (asset) => asset.id + " | " + asset.originalName
                )
              ].join("\n")
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "promotion_film_revision",
          strict: true,
          schema: filmSchema
        }
      }
    });

    const outputText = extractOutputText(response);
    if (!outputText) throw new Error("OpenAI returned no revision.");

    const project = normalizeFilmSpec(
      JSON.parse(outputText),
      current.duration,
      assets
    );

    project.parentProject = current.id;
    project.revision = instruction;
    project.user_prompt = current.user_prompt;

    fs.writeFileSync(
      path.join(session.dir, "projects", project.id + ".json"),
      JSON.stringify(project, null, 2)
    );

    session.meta.activeProject = project.id;
    saveMeta(session);

    res.json(project);
  } catch (err) {
    console.error("AI revision failed:", err);
    res.status(500).json({
      error: err.message || "Revision failed."
    });
  }
});

const renderUpload = multer({
  dest: TMP_ROOT,
  limits: { fileSize: 300 * 1024 * 1024 }
});

app.post("/api/render", renderUpload.single("video"), (req, res) => {
  const session = ensureSession(req, res);

  if (!req.file) {
    return res.status(400).json({ error: "Video missing." });
  }

  const projectId = String(
    req.body.projectId || session.meta.activeProject || ""
  );

  const renderId = makeId("render");
  const mp4Path = path.join(session.dir, "outputs", renderId + ".mp4");

  fs.renameSync(req.file.path, mp4Path);

  const record = {
    id: renderId,
    projectId,
    format: "mp4",
    bytes: fs.statSync(mp4Path).size,
    createdAt: new Date().toISOString(),
    url: "/api/output/" + renderId + ".mp4"
  };

  session.meta.renders.push(record);
  saveMeta(session);

  res.json(record);
});

app.get("/api/output/:name", (req, res) => {
  const session = ensureSession(req, res);
  const name = path.basename(req.params.name);

  if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(name)) {
    return res.status(400).end();
  }

  const file = path.join(session.dir, "outputs", name);
  if (!fs.existsSync(file)) return res.status(404).end();

  res.sendFile(file);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Promotion AI Filmmaker listening on " + PORT);
  console.log("Data root:", DATA_ROOT);
  console.log(
    "OpenAI:",
    OPENAI_API_KEY ? "configured" : "MISSING",
    "| model:",
    OPENAI_MODEL
  );
});
