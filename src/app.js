import "@superhq/webmotion/elements";

const $ = (id) => document.getElementById(id);

const state = {
  duration: 20,
  session: null,
  project: null,
  composition: null,
  player: null,
  busy: false
};

function setStatus(text, pct = 0) {
  $("statusText").textContent = text;
  $("statusPct").textContent = Math.round(pct) + "%";
  $("progressBar").style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i ? v.toFixed(v >= 10 ? 0 : 1) : v) + " " + units[i];
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[c]);
}

function setBusy(on) {
  state.busy = on;
  $("generateBtn").disabled = on;
  $("reviseBtn").disabled = on;
  $("fileInput").disabled = on;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};
  try {
    data = await response.json();
  } catch (_) {}
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadSession({ mount = true } = {}) {
  state.session = await api("/api/session");
  $("sessionPill").textContent = "Session " + state.session.id.slice(-8);
  renderAssets();
  renderHistory();

  if (state.session.activeProject) {
    state.project = state.session.activeProject;
    renderProjectInfo();
    if (mount) await mountPreview(state.project, false);
  }

  const latest = state.session.renders && state.session.renders[0];
  if (latest) {
    $("downloadLink").href = latest.url;
    $("downloadLink").classList.add("show");
  }
}

function renderAssets() {
  const list = $("assetList");
  const assets = (state.session && state.session.assets) || [];

  if (!assets.length) {
    list.innerHTML = '<div class="hint">No material yet.</div>';
    return;
  }

  list.innerHTML = assets.map((asset) => {
    const visual = asset.kind === "image"
      ? '<img class="thumb" src="' + asset.url + '" alt="">'
      : '<div class="docIcon">' +
        escapeHtml((asset.name.split(".").pop() || "DOC").toUpperCase()) +
        '</div>';

    return (
      '<div class="asset" data-id="' + asset.id + '">' +
        visual +
        '<div class="assetMeta">' +
          '<div class="assetName">' + escapeHtml(asset.name) + '</div>' +
          '<div class="assetSize">' + fmtBytes(asset.size) + '</div>' +
        '</div>' +
        '<button class="remove" data-remove="' + asset.id + '" title="Remove">×</button>' +
      '</div>'
    );
  }).join("");
}

function renderHistory() {
  const items = (state.session && state.session.renders) || [];

  $("historyList").innerHTML = items.length
    ? items.slice(0, 8).map((render) =>
        '<div class="render">' +
          '<a href="' + render.url + '" target="_blank">' +
            escapeHtml(render.id.replace("render_", "Cut ")) +
          '</a>' +
          '<span>' + new Date(render.createdAt).toLocaleString() + '</span>' +
        '</div>'
      ).join("")
    : '<div class="sectionNote">Nothing rendered yet.</div>';
}

function renderProjectInfo() {
  const p = state.project;
  if (!p) return;

  $("filmTitle").textContent = p.title || "Film preview";
  $("stageMeta").textContent =
    Math.round(p.duration) + " sec · 1280 × 720 · 30 fps";
  $("summary").textContent =
    p.creative_summary || "Directed from your supplied material.";

  $("tagRow").innerHTML =
    '<span class="tag">' + escapeHtml(p.tone || "directed") + '</span>' +
    '<span class="tag">' + escapeHtml(p.model || "OpenAI") + '</span>';

  $("sceneList").innerHTML = (p.scenes || []).map((scene, i) =>
    '<div class="scene">' +
      '<div class="sceneNo">' + String(i + 1).padStart(2, "0") + '</div>' +
      '<div class="sceneText">' +
        '<div class="sceneHead">' + escapeHtml(scene.headline || scene.type) + '</div>' +
        '<div class="sceneSub">' +
          escapeHtml(
            scene.type +
            " · " +
            scene.motion +
            (scene.asset_id ? " · product visual" : "")
          ) +
        '</div>' +
      '</div>' +
      '<div class="sceneDur">' + Number(scene.duration).toFixed(1) + 's</div>' +
    '</div>'
  ).join("");
}

function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  }

  if (text !== null) node.textContent = text;
  return node;
}

function animate(
  node,
  property,
  from,
  to,
  start,
  end,
  easing = "easeOutCubic"
) {
  node.appendChild(
    el("w-animate", {
      property,
      from,
      to,
      start,
      end,
      easing
    })
  );
}

function htmlBlock(className, html) {
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = html;
  return div;
}

function baseStyle(accent) {
  return [
    'w-composition{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}',
    '.film-bg{width:100%;height:100%;background:radial-gradient(circle at 20% 8%,rgba(110,120,255,.18),transparent 34%),radial-gradient(circle at 78% 80%,rgba(255,255,255,.055),transparent 30%),linear-gradient(145deg,#0b0d12,#050608 70%);position:relative;overflow:hidden}',
    '.film-grid{position:absolute;inset:0;opacity:.12;background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px);background-size:64px 64px}',
    '.kicker{font-size:18px;font-weight:650;letter-spacing:.18em;text-transform:uppercase;color:rgba(235,239,247,.58)}',
    '.hero{font-size:80px;line-height:.99;letter-spacing:-.055em;font-weight:750;color:#f7f8fa;max-width:1050px}',
    '.hero.small{font-size:60px;line-height:1.02}',
    '.sub{font-size:25px;line-height:1.35;letter-spacing:-.015em;color:rgba(231,235,242,.66);max-width:900px}',
    '.accent-line{height:3px;width:180px;border-radius:99px;background:' + accent + ';box-shadow:0 0 35px rgba(120,130,255,.3)}',
    '.screen-shell{width:100%;height:100%;padding:9px;border-radius:24px;background:linear-gradient(150deg,rgba(255,255,255,.18),rgba(255,255,255,.04));box-shadow:0 35px 100px rgba(0,0,0,.56),0 0 0 1px rgba(255,255,255,.07);overflow:hidden}',
    '.screen-inner{width:100%;height:100%;border-radius:17px;overflow:hidden;background:#0b0d11;position:relative}',
    '.screen-inner img{width:100%;height:100%;display:block;object-fit:cover}',
    '.glass{padding:18px 22px;border:1px solid rgba(255,255,255,.11);border-radius:18px;background:rgba(7,9,13,.72);box-shadow:0 18px 50px rgba(0,0,0,.38);backdrop-filter:blur(22px)}',
    '.scene-copy{display:flex;flex-direction:column;gap:13px}',
    '.scene-copy .title{font-size:44px;line-height:1.02;letter-spacing:-.04em;font-weight:720;color:#f6f7f9}',
    '.scene-copy .copy{font-size:18px;line-height:1.38;color:rgba(231,235,242,.66);max-width:760px}'
  ].join("");
}

function makeBaseScene(sequence, scene, frames) {
  const outer = el("w-el", {
    x: 0,
    y: 0,
    width: 1280,
    height: 720
  });

  animate(
    outer,
    "opacity",
    1,
    0,
    Math.max(0, frames - 12),
    frames,
    "easeInCubic"
  );

  const inner = el("w-el", {
    x: 0,
    y: 0,
    width: 1280,
    height: 720
  });

  animate(inner, "opacity", 0, 1, 0, 13, "easeOutCubic");
  animate(inner, "y", 18, 0, 0, 16, "easeOutCubic");

  inner.appendChild(
    htmlBlock("film-bg", '<div class="film-grid"></div>')
  );

  outer.appendChild(inner);
  sequence.appendChild(outer);

  return { outer, inner };
}

function addText(inner, scene, mode = "hero") {
  const centered = scene.layout === "center";
  const x = scene.layout === "right" ? 665 : 86;
  const y = centered ? 180 : 150;
  const w = centered ? 1108 : 555;

  const copy = el("w-el", {
    x,
    y,
    width: w,
    height: 420
  });

  const block = document.createElement("div");
  block.className = "scene-copy";

  if (centered) {
    block.style.alignItems = "center";
    block.style.textAlign = "center";
  }

  block.innerHTML =
    (scene.eyebrow
      ? '<div class="kicker">' + escapeHtml(scene.eyebrow) + '</div>'
      : '') +
    '<div class="' + (mode === "hero" ? "hero" : "hero small") + '">' +
      escapeHtml(scene.headline) +
    '</div>' +
    (scene.subline
      ? '<div class="sub">' + escapeHtml(scene.subline) + '</div>'
      : '') +
    '<div class="accent-line"></div>';

  copy.appendChild(block);

  animate(copy, "opacity", 0, 1, 5, 18, "easeOutCubic");
  animate(copy, "y", y + 28, y, 3, 20, "easeOutCubic");

  inner.appendChild(copy);
}

function assetFor(spec, id) {
  return id && spec.assets ? spec.assets[id] : null;
}

function addProductScene(inner, spec, scene, frames, split = false) {
  const asset = assetFor(spec, scene.asset_id);

  if (!asset) {
    addText(inner, scene, "small");
    return;
  }

  const imageOnLeft = scene.layout === "right";
  const cardX = split ? (imageOnLeft ? 72 : 628) : 86;
  const cardY = split ? 106 : 80;
  const cardW = split ? 580 : 1108;
  const cardH = split ? 508 : 560;

  const shell = el("w-el", {
    x: cardX,
    y: cardY,
    width: cardW,
    height: cardH
  });

  shell.style.overflow = "hidden";
  shell.style.borderRadius = "24px";

  const frame = document.createElement("div");
  frame.className = "screen-shell";

  const innerFrame = document.createElement("div");
  innerFrame.className = "screen-inner";

  frame.appendChild(innerFrame);
  shell.appendChild(frame);

  animate(shell, "opacity", 0, 1, 0, 14, "easeOutCubic");
  animate(
    shell,
    "scale",
    0.965,
    1,
    0,
    20,
    "cubic-bezier(0.2,0.85,0.25,1)"
  );

  const focus = scene.focus || {
    x: 0.15,
    y: 0.15,
    w: 0.7,
    h: 0.7
  };

  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h / 2;

  const focusScale =
    scene.motion === "focus"
      ? Math.min(1.28, Math.max(1.08, 0.72 / Math.max(focus.w, focus.h)))
      : scene.motion === "push"
        ? 1.10
        : scene.motion === "pull"
          ? 1.00
          : 1.055;

  const shiftX = (0.5 - cx) * (split ? 120 : 180);
  const shiftY = (0.5 - cy) * (split ? 70 : 95);

  const imageLayer = el("w-el", {
    x: 0,
    y: 0,
    width: cardW,
    height: cardH
  });

  imageLayer.style.transformOrigin = "50% 50%";

  const image = document.createElement("img");
  image.src = asset.url;
  image.alt = "";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "cover";

  imageLayer.appendChild(image);

  if (scene.motion === "pan_left") {
    animate(imageLayer, "x", 18, -26, 0, frames, "easeInOutCubic");
  } else if (scene.motion === "pan_right") {
    animate(imageLayer, "x", -18, 26, 0, frames, "easeInOutCubic");
  } else {
    animate(imageLayer, "x", 0, shiftX, 0, frames, "easeInOutCubic");
  }

  animate(imageLayer, "y", 0, shiftY, 0, frames, "easeInOutCubic");
  animate(
    imageLayer,
    "scale",
    scene.motion === "pull" ? 1.08 : 1.015,
    focusScale,
    0,
    frames,
    "easeInOutCubic"
  );

  innerFrame.appendChild(imageLayer);
  inner.appendChild(shell);

  if (split) {
    const textX = imageOnLeft ? 706 : 88;
    const text = el("w-el", {
      x: textX,
      y: 172,
      width: 486,
      height: 390
    });

    const div = document.createElement("div");
    div.className = "scene-copy";
    div.innerHTML =
      (scene.eyebrow
        ? '<div class="kicker">' + escapeHtml(scene.eyebrow) + '</div>'
        : '') +
      '<div class="hero small">' + escapeHtml(scene.headline) + '</div>' +
      (scene.subline
        ? '<div class="sub" style="font-size:19px">' +
            escapeHtml(scene.subline) +
          '</div>'
        : '') +
      '<div class="accent-line"></div>';

    text.appendChild(div);

    animate(text, "opacity", 0, 1, 8, 22, "easeOutCubic");
    animate(text, "y", 196, 172, 6, 24, "easeOutCubic");

    inner.appendChild(text);
  } else {
    const overlay = el("w-el", {
      x: 112,
      y: 500,
      width: 1056,
      height: 150
    });

    const div = document.createElement("div");
    div.className = "glass scene-copy";
    div.innerHTML =
      (scene.eyebrow
        ? '<div class="kicker" style="font-size:12px">' +
            escapeHtml(scene.eyebrow) +
          '</div>'
        : '') +
      '<div class="title">' + escapeHtml(scene.headline) + '</div>' +
      (scene.subline
        ? '<div class="copy">' + escapeHtml(scene.subline) + '</div>'
        : '');

    overlay.appendChild(div);

    animate(overlay, "opacity", 0, 1, 10, 23, "easeOutCubic");
    animate(overlay, "y", 522, 500, 8, 24, "easeOutCubic");

    inner.appendChild(overlay);
  }
}

function buildComposition(spec) {
  const fps = spec.fps || 30;
  const totalFrames = Math.round(spec.duration * fps);

  const comp = el("w-composition", {
    width: 1280,
    height: 720,
    fps,
    duration: totalFrames,
    background: spec.background || "#08090c"
  });

  const style = document.createElement("style");
  style.textContent = baseStyle(spec.accent || "#8e9bff");
  comp.appendChild(style);

  let cursor = 0;

  spec.scenes.forEach((scene, index) => {
    const frames = Math.max(30, Math.round(scene.duration * fps));

    const sequence = el("w-sequence", {
      from: cursor,
      duration: frames,
      label: (scene.headline || scene.type || ("Scene " + (index + 1))).slice(0, 50)
    });

    const { inner } = makeBaseScene(sequence, scene, frames);

    if (scene.type === "product" || scene.type === "feature") {
      addProductScene(inner, spec, scene, frames, false);
    } else if (scene.type === "split") {
      addProductScene(inner, spec, scene, frames, true);
    } else {
      addText(
        inner,
        scene,
        scene.type === "title" || scene.type === "end" ? "hero" : "small"
      );
    }

    comp.appendChild(sequence);

    if (index > 0 && scene.transition !== "cut") {
      const transitionFrames = 14;
      const transitionSequence = el("w-sequence", {
        from: Math.max(0, cursor - Math.floor(transitionFrames / 2)),
        duration: transitionFrames
      });

      const transition = el("w-transition", {
        pattern: scene.transition,
        color: spec.background || "#08090c",
        cell: scene.transition === "dissolve" ? 64 : 48,
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        enter: Math.floor(transitionFrames / 2),
        exit: Math.ceil(transitionFrames / 2)
      });

      transitionSequence.appendChild(transition);
      comp.appendChild(transitionSequence);
    }

    cursor += frames;
  });

  return comp;
}

async function mountPreview(spec, autoplay = true) {
  const stage = $("stage");

  if (state.composition) {
    try {
      state.composition.pause();
    } catch (_) {}
  }

  stage.innerHTML = "";

  const player = document.createElement("w-player");
  const composition = buildComposition(spec);

  player.appendChild(composition);
  stage.appendChild(player);

  state.player = player;
  state.composition = composition;

  await composition.ready;
  composition.seek(0);

  if (autoplay) composition.play();
}

async function exportAndSave() {
  const project = state.project;
  if (!project) return;

  if (
    typeof VideoEncoder === "undefined" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    throw new Error(
      "Fast MP4 export needs a Chromium browser such as Chrome or Edge."
    );
  }

  setStatus("Rendering deterministic frames", 52);

  let composition = state.composition;

  if (!composition || !composition.isConnected) {
    composition = buildComposition(project);

    const hidden = document.createElement("div");
    hidden.style.position = "fixed";
    hidden.style.left = "-10000px";
    hidden.style.width = "1280px";
    hidden.appendChild(composition);
    document.body.appendChild(hidden);

    await composition.ready;
  }

  try {
    composition.pause();
    composition.seek(0);
  } catch (_) {}

  const blob = await composition.export({
    bitrate: 10000000,
    onProgress: ({ progress }) => {
      setStatus("Rendering MP4", 52 + progress * 40);
    }
  });

  setStatus("Saving render", 94);

  const body = new FormData();
  body.append("video", blob, "promotion.mp4");
  body.append("projectId", project.id);

  const record = await api("/api/render", {
    method: "POST",
    body
  });

  $("downloadLink").href = record.url;
  $("downloadLink").classList.add("show");

  setStatus("Film ready", 100);

  await loadSession({ mount: true });

  return record;
}

async function generate() {
  if (state.busy) return;

  setBusy(true);
  $("downloadLink").classList.remove("show");

  try {
    setStatus("AI director is reading your material", 8);

    const prompt = $("prompt").value.trim();

    const project = await api("/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        duration: state.duration
      })
    });

    state.project = project;
    renderProjectInfo();

    setStatus("Building the directed cut", 38);
    await mountPreview(project, true);

    setStatus("Preview ready · exporting", 48);
    await exportAndSave();
  } catch (err) {
    console.error(err);
    setStatus("Generation stopped", 0);
    alert(err.message || "Generation failed");
  } finally {
    setBusy(false);
  }
}

async function revise() {
  if (state.busy || !state.project) return;

  const instruction = $("revisionInput").value.trim();
  if (!instruction) return;

  setBusy(true);

  try {
    setStatus("Director is revising the cut", 12);

    const project = await api("/api/revise", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        instruction
      })
    });

    state.project = project;
    $("revisionInput").value = "";
    $("downloadLink").classList.remove("show");

    renderProjectInfo();

    setStatus("Rebuilding revised film", 40);
    await mountPreview(project, true);

    await exportAndSave();
  } catch (err) {
    console.error(err);
    setStatus("Revision stopped", 0);
    alert(err.message || "Revision failed");
  } finally {
    setBusy(false);
  }
}

$("durationPicker").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-duration]");
  if (!button) return;

  document
    .querySelectorAll("#durationPicker button")
    .forEach((candidate) => candidate.classList.remove("active"));

  button.classList.add("active");
  state.duration = Number(button.dataset.duration);
});

$("fileInput").addEventListener("change", async function () {
  if (!this.files.length || state.busy) return;

  setBusy(true);

  try {
    setStatus("Uploading material", 5);

    const body = new FormData();
    [...this.files].forEach((file) => body.append("files", file));

    await api("/api/upload", {
      method: "POST",
      body
    });

    this.value = "";

    await loadSession({ mount: false });
    setStatus("Material ready", 10);
  } catch (err) {
    alert(err.message || "Upload failed");
    setStatus("Upload stopped", 0);
  } finally {
    setBusy(false);
  }
});

$("assetList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button || state.busy) return;

  setBusy(true);

  try {
    await api("/api/delete-file", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: button.dataset.remove
      })
    });

    await loadSession({ mount: false });
  } catch (err) {
    alert(err.message || "Could not remove asset");
  } finally {
    setBusy(false);
  }
});

$("generateBtn").addEventListener("click", generate);
$("reviseBtn").addEventListener("click", revise);

$("revisionInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") revise();
});

loadSession().catch((err) => {
  console.error(err);
  setStatus("Could not restore session", 0);
});
