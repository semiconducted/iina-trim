"use strict";
(() => {
  // Info.json
  var preferenceDefaults = {
    ffmpeg_location: "",
    clip_suffix: "-clip",
    duplicate_separator: "-",
    shortcut_open: "Ctrl+Shift+t",
    shortcut_set_in: "Alt+Shift+i",
    shortcut_set_out: "Alt+Shift+o",
    thumbnail_min_width: 180,
    thumbnail_max_width: 240,
    thumbnail_jpeg_quality: 5,
    jog_window_first: 20,
    jog_window_wide: 300,
    reencode_container: "mov",
    videotoolbox_quality: 70,
    x264_crf: 23
  };

  // src/shared/settings.ts
  var CONTAINERS = ["mov", "mp4", "mkv"];
  var isFileNameText = (value) => /^[^/\\:\0]*$/.test(value);
  var isKeyBinding = (value) => /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:[A-Za-z0-9]+|[^\s+])$/.test(value);
  function text(read, key, fallback, isValid) {
    const value = read(key);
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return isValid(trimmed) ? trimmed : fallback;
  }
  function whole(read, key, fallback, min, max) {
    const raw = read(key);
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    const chosen = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, Math.round(chosen)));
  }
  function readSettings(read) {
    const minWidth = whole(read, "thumbnail_min_width", preferenceDefaults.thumbnail_min_width, 100, 640);
    const firstWindow = whole(read, "jog_window_first", preferenceDefaults.jog_window_first, 1, 3600);
    const container = CONTAINERS.find((option) => option === read("reencode_container"));
    return {
      clipSuffix: text(read, "clip_suffix", preferenceDefaults.clip_suffix, isFileNameText),
      duplicateSeparator: text(
        read,
        "duplicate_separator",
        preferenceDefaults.duplicate_separator,
        isFileNameText
      ),
      reencodeContainer: container ?? preferenceDefaults.reencode_container,
      shortcuts: {
        open: text(read, "shortcut_open", preferenceDefaults.shortcut_open, isKeyBinding),
        setIn: text(read, "shortcut_set_in", preferenceDefaults.shortcut_set_in, isKeyBinding),
        setOut: text(read, "shortcut_set_out", preferenceDefaults.shortcut_set_out, isKeyBinding)
      },
      videotoolboxQuality: whole(read, "videotoolbox_quality", preferenceDefaults.videotoolbox_quality, 1, 100),
      x264Crf: whole(read, "x264_crf", preferenceDefaults.x264_crf, 0, 51),
      thumbnailMinWidth: minWidth,
      thumbnailMaxWidth: whole(read, "thumbnail_max_width", preferenceDefaults.thumbnail_max_width, minWidth, 640),
      thumbnailJpegQuality: whole(read, "thumbnail_jpeg_quality", preferenceDefaults.thumbnail_jpeg_quality, 2, 31),
      jogWindows: [
        firstWindow,
        whole(read, "jog_window_wide", preferenceDefaults.jog_window_wide, firstWindow, 3600)
      ]
    };
  }
  var DEFAULT_SETTINGS = readSettings(() => void 0);
  var KEY_SYMBOLS = {
    Ctrl: "\u2303",
    Alt: "\u2325",
    Shift: "\u21E7",
    Meta: "\u2318"
  };
  function keyLabel(binding) {
    return binding.split("+").map((part) => KEY_SYMBOLS[part] ?? part.toUpperCase()).join("");
  }

  // src/shared/timecode.ts
  var pad = (value, width = 2) => String(value).padStart(width, "0");
  function toTimecode(seconds) {
    const totalMs = Math.round((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * 1e3);
    const whole2 = Math.floor(totalMs / 1e3);
    const clock = [Math.floor(whole2 / 3600), Math.floor(whole2 / 60) % 60, whole2 % 60];
    return `${clock.map((part) => pad(part)).join(":")}.${pad(totalMs % 1e3, 3)}`;
  }

  // src/plugin/paths.ts
  function folderOf(path) {
    const slash = path.lastIndexOf("/");
    if (slash < 0) return "";
    return slash === 0 ? "/" : path.slice(0, slash);
  }
  function joinPath(folder, name) {
    if (folder === "") return name;
    return folder.endsWith("/") ? folder + name : `${folder}/${name}`;
  }
  function extensionOf(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  }
  function isLocalFile(path) {
    return path !== "" && !path.includes("://");
  }
  function isPlainFileName(name) {
    return name !== "" && name === name.trim() && name.length <= 255 && /^[^./\\:\0][^/\\:\0]*$/.test(name);
  }
  function clipName(sourceName, lossless, settings) {
    const extension = extensionOf(sourceName);
    const stem = extension === "" ? sourceName : sourceName.slice(0, -(extension.length + 1));
    const format = lossless && extension !== "" ? extension : settings.reencodeContainer;
    return `${stem.trim() || "clip"}${settings.clipSuffix}.${format}`;
  }
  function freeClipName(folder, sourceName, lossless, exists, settings) {
    const name = clipName(sourceName, lossless, settings);
    if (!exists(joinPath(folder, name))) return name;
    const dot = name.lastIndexOf(".");
    for (let number = 2; ; number += 1) {
      const numbered = `${name.slice(0, dot)}${settings.duplicateSeparator}${number}${name.slice(dot)}`;
      if (!exists(joinPath(folder, numbered))) return numbered;
    }
  }

  // src/plugin/commands.ts
  var INSTALL_FOLDERS = ["/opt/homebrew/bin", "/usr/local/bin"];
  var VERTICAL_CROP = "crop=ih*9/16:ih,format=yuv420p";
  var toMilliseconds = (seconds) => Math.round(seconds * 1e3) / 1e3;
  function findFfmpeg(chosenPath, exists) {
    const chosen = typeof chosenPath === "string" ? chosenPath.trim() : "";
    const places = [chosen, ...INSTALL_FOLDERS.map((folder) => joinPath(folder, "ffmpeg"))];
    return places.find((place) => place !== "" && exists(place));
  }
  function findFfprobe(ffmpegFile, exists) {
    const folders = [folderOf(ffmpegFile), ...INSTALL_FOLDERS];
    return folders.filter((folder) => folder !== "").map((folder) => joinPath(folder, "ffprobe")).find((place) => exists(place));
  }
  function exportArgs(source, range, target, settings, copyLength) {
    const start = String(toMilliseconds(range.inTime));
    const length = String(toMilliseconds(range.crop ? range.outTime - range.inTime : copyLength ?? range.outTime - range.inTime));
    const always = ["-n", "-nostats", "-progress", "pipe:1"];
    if (!range.crop) {
      return [...always, "-ss", start, "-i", source, "-t", length, "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", target];
    }
    const decoder = range.useHardware ? ["-hwaccel", "videotoolbox"] : [];
    const encoder = range.useHardware ? ["-c:v", "h264_videotoolbox", "-q:v", String(settings.videotoolboxQuality)] : ["-c:v", "libx264", "-crf", String(settings.x264Crf)];
    return [...always, ...decoder, "-ss", start, "-i", source, "-t", length, "-vf", VERTICAL_CROP, ...encoder, "-c:a", "copy", "-copypriorss", "0", target];
  }
  function packetProbeArgs(source, outTime) {
    const span = `${toMilliseconds(Math.max(0, outTime - 2))}%${toMilliseconds(outTime + 2)}`;
    return ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,dts_time", "-of", "csv=p=0", "-read_intervals", span, source];
  }
  function copyLengthBefore(packets, range) {
    let stop = Number.POSITIVE_INFINITY;
    for (const line of packets.split("\n")) {
      const [shown, decoded] = line.split(",").map(Number);
      if (shown !== void 0 && decoded !== void 0 && shown >= range.outTime && decoded < stop) stop = decoded;
    }
    const length = Math.floor((stop - range.inTime) * 1e3) / 1e3;
    return Number.isFinite(length) && length > 0 ? length : void 0;
  }
  function previewArgs(source, time, frame, target, settings) {
    const at = toMilliseconds(time);
    const size = `showinfo,scale=${settings.thumbnailMaxWidth * 2}:-2`;
    const quality = ["-q:v", String(settings.thumbnailJpegQuality)];
    if (frame === "lastBefore") {
      return ["-hide_banner", "-nostdin", "-ss", String(Math.max(0, at - 1)), "-copyts", "-i", source, "-to", String(at), "-map", "0:v:0", "-vf", `select='lt(t,${at})',${size}`, ...quality, "-update", "1", "-y", target];
    }
    return [
      "-hide_banner",
      "-nostdin",
      ...frame === "keyframe" ? ["-noaccurate_seek"] : [],
      "-ss",
      String(at),
      "-copyts",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      // Twice the largest display width, so previews stay sharp on Retina screens.
      size,
      ...quality,
      "-y",
      target
    ];
  }
  function keyframeProbeArgs(source, from, to) {
    const span = `${toMilliseconds(Math.max(0, from))}%${toMilliseconds(Math.max(0, to))}`;
    return ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", "-read_intervals", span, source];
  }
  function readProgress(output) {
    const positions = output.match(/out_time_us=\d+/g);
    const last = positions?.[positions.length - 1];
    return last === void 0 ? void 0 : Number(last.slice("out_time_us=".length)) / 1e6;
  }
  function readFrameTime(log, frame) {
    const times = [...log.matchAll(/pts_time:(-?[\d.]+)/g)];
    const found = (frame === "lastBefore" ? times[times.length - 1] : times[0])?.[1];
    return found === void 0 ? void 0 : Number(found);
  }
  function readKeyframes(output) {
    const times = output.split("\n").map((line) => line.split(",")[0]?.trim() ?? "").filter((field) => field !== "").map(Number).filter(Number.isFinite);
    return [...new Set(times)].sort((a, b) => a - b);
  }
  var SAME_KEYFRAME = 2e-3;
  function adjacentKeyframe(times, from, direction) {
    if (direction === 1) return times.find((time) => time > from + SAME_KEYFRAME);
    return times.filter((time) => time < from - SAME_KEYFRAME).pop();
  }
  function knownNeighbor(known, time, direction) {
    const first = known[0];
    const last = known[known.length - 1];
    if (first === void 0 || last === void 0) return void 0;
    if (time < first - SAME_KEYFRAME || time > last + SAME_KEYFRAME) return void 0;
    return adjacentKeyframe(known, time, direction);
  }
  function mergeKeyframes(known, found) {
    const knownFirst = known[0];
    const knownLast = known[known.length - 1];
    const foundFirst = found[0];
    const foundLast = found[found.length - 1];
    if (foundFirst === void 0 || foundLast === void 0) return known;
    if (knownFirst === void 0 || knownLast === void 0) return found;
    if (foundFirst > knownLast + SAME_KEYFRAME || foundLast < knownFirst - SAME_KEYFRAME) return found;
    return [.../* @__PURE__ */ new Set([...known, ...found])].sort((a, b) => a - b);
  }
  function markTimeAt(keyframe, mark) {
    const round = mark === "in" ? Math.ceil : Math.floor;
    return round(keyframe * 1e3) / 1e3;
  }
  var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function toBase64(bytes) {
    let out = "";
    for (let at = 0; at < bytes.length; at += 3) {
      const left = bytes.length - at;
      const group = (bytes[at] ?? 0) << 16 | (bytes[at + 1] ?? 0) << 8 | (bytes[at + 2] ?? 0);
      out += BASE64.charAt(group >> 18 & 63) + BASE64.charAt(group >> 12 & 63);
      out += left > 1 ? BASE64.charAt(group >> 6 & 63) : "=";
      out += left > 2 ? BASE64.charAt(group & 63) : "=";
    }
    return out;
  }

  // src/plugin/trim.ts
  var isMark = (value) => value === "in" || value === "out";
  var isTime = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  function isRange(value) {
    const range = value;
    return isTime(range?.inTime) && isTime(range?.outTime) && range.outTime > range.inTime && typeof range.useHardware === "boolean" && typeof range.crop === "boolean";
  }
  function isTarget(value) {
    const target = value;
    return typeof target?.folder === "string" && typeof target.name === "string";
  }
  function startTrim(api) {
    const { core, sidebar, utils } = api;
    const exists = (path) => utils.fileInPath(path);
    const settings = () => readSettings((key) => api.preferences.get(key));
    const send = (name, data) => sidebar.postMessage(name, data);
    const boundKeys = settings().shortcuts;
    const marks = /* @__PURE__ */ new Map();
    const newestPreview = /* @__PURE__ */ new Map();
    let previewCount = 0;
    let knownKeyframes = [];
    let inFrame;
    let pageLoaded = false;
    const ffmpeg = () => findFfmpeg(api.preferences.get("ffmpeg_location"), exists);
    function localSource() {
      const path = api.mpv.getString("path");
      const name = api.mpv.getString("filename");
      return name && isLocalFile(path) ? { path, name } : void 0;
    }
    function sendSidebarState() {
      const { thumbnailMinWidth, thumbnailMaxWidth } = settings();
      send("ffmpegState", { found: ffmpeg() !== void 0 });
      send("sidebarConfig", {
        minWidth: thumbnailMinWidth,
        maxWidth: thumbnailMaxWidth,
        inKey: keyLabel(boundKeys.setIn),
        outKey: keyLabel(boundKeys.setOut)
      });
    }
    function markPlayhead(mark) {
      const time = markTimeAt(api.mpv.getNumber("time-pos"), mark);
      marks.set(mark, time);
      send("markSet", { mark, time });
      core.osd(`${mark === "in" ? "In" : "Out"} ${toTimecode(time)}`);
    }
    async function makePreview(mark, time, keyframe) {
      const ticket = ++previewCount;
      newestPreview.set(mark, ticket);
      const reply = (image, frameTime) => {
        if (newestPreview.get(mark) === ticket) send("framePreview", { mark, time, frameTime, image });
      };
      const tool = ffmpeg();
      const source = localSource();
      if (!tool || !source) {
        reply("", null);
        return;
      }
      const output = utils.resolvePath(`@tmp/preview-${mark}-${ticket}.jpg`);
      try {
        await utils.exec("/bin/mkdir", ["-p", folderOf(output)]);
        const frame = keyframe ? "keyframe" : mark === "out" ? "lastBefore" : "at";
        const run = await utils.exec(tool, previewArgs(source.path, time, frame, output, settings()));
        if (run.status !== 0 || !exists(output)) {
          reply("", null);
          return;
        }
        const file = api.file.handle(output, "read");
        const bytes = file.readToEnd();
        file.close();
        if (!bytes?.length) {
          reply("", null);
          return;
        }
        const frameTime = readFrameTime(run.stderr, frame) ?? null;
        if (mark === "in" && keyframe && frameTime !== null) inFrame = { time, frameTime };
        reply(`data:image/jpeg;base64,${toBase64(bytes)}`, frameTime);
      } catch (error) {
        api.console.error(`Trim preview failed: ${String(error)}`);
        reply("", null);
      } finally {
        if (exists(output)) api.file.delete(output);
      }
    }
    async function findAdjacentKeyframe(probe, source, time, direction) {
      const known = knownNeighbor(knownKeyframes, time, direction);
      if (known !== void 0) return known;
      for (const reach of settings().jogWindows) {
        const [from, to] = direction === 1 ? [time, time + reach] : [time - reach, time];
        const run = await utils.exec(probe, keyframeProbeArgs(source, from, to));
        if (run.status !== 0) throw new Error(`ffprobe stopped with code ${run.status}`);
        const times = readKeyframes(run.stdout);
        knownKeyframes = mergeKeyframes(knownKeyframes, times);
        const found = adjacentKeyframe(times, time, direction);
        if (found !== void 0) return found;
        if (direction === -1 && from <= 0) return void 0;
      }
      return void 0;
    }
    async function stepKeyframe(mark, time, direction) {
      const tool = ffmpeg();
      const probe = tool && findFfprobe(tool, exists);
      const source = localSource();
      let problem = "";
      if (!probe) problem = "ffprobe was not found next to FFmpeg.";
      else if (!source) problem = "Open a local video first.";
      else {
        try {
          const keyframe = await findAdjacentKeyframe(probe, source.path, time, direction);
          if (keyframe === void 0) {
            problem = `No keyframe found ${direction === 1 ? "after" : "before"} this point.`;
          } else {
            const markTime = markTimeAt(keyframe, mark);
            marks.set(mark, markTime);
            send("markSet", { mark, time: markTime });
            core.pause();
            core.seekTo(keyframe);
          }
        } catch (error) {
          problem = `Keyframe search failed: ${String(error)}`;
        }
      }
      send("stepEnded", { mark, problem });
    }
    function proposeSave(crop, folder) {
      const source = localSource();
      if (!source) return;
      const place = folder || folderOf(source.path);
      send("saveProposal", { folder: place, name: freeClipName(place, source.name, !crop, exists, settings()) });
    }
    function pickFolder(crop) {
      const chosen = utils.chooseFile("Choose where to save the clip", { chooseDir: true });
      if (chosen) proposeSave(crop, chosen.replace(/(.)\/+$/, "$1"));
    }
    async function findCopyLength(tool, source, range) {
      const probe = findFfprobe(tool, exists);
      if (!probe) return void 0;
      const run = await utils.exec(probe, packetProbeArgs(source, range.outTime));
      return run.status === 0 ? copyLengthBefore(run.stdout, range) : void 0;
    }
    async function startExport(job) {
      const stop = (message) => {
        send("exportState", { running: false, outcome: "failed", message });
        core.osd(message);
      };
      const tool = ffmpeg();
      const source = localSource();
      if (!tool) return stop("FFmpeg was not found. Set its path in Trim preferences.");
      if (!source) return stop("Open a local video first.");
      if (job.folder === "" || !isPlainFileName(job.name)) {
        return stop("Use a file name with no slashes, colons or leading dot.");
      }
      const target = joinPath(job.folder, job.name);
      if (target === source.path) return stop("A clip cannot replace its source video.");
      if (exists(target)) return stop(`${job.name} already exists. Choose another name.`);
      send("exportState", { running: true, outcome: "none", message: "" });
      core.osd("Saving clip");
      const start = !job.crop && inFrame?.time === job.inTime ? inFrame.frameTime : job.inTime;
      const length = job.outTime - start;
      let recent = "";
      const onProgress = (chunk) => {
        recent = (recent + chunk).slice(-2e3);
        const position = readProgress(recent);
        if (position !== void 0) send("exportProgress", { fraction: Math.min(1, position / length) });
      };
      try {
        const copyLength = job.crop ? void 0 : await findCopyLength(tool, source.path, job);
        const args = exportArgs(source.path, job, target, settings(), copyLength);
        const run = await utils.exec(tool, args, null, onProgress, null);
        if (run.status !== 0) {
          api.console.error(run.stderr);
          stop(`FFmpeg stopped with code ${run.status}.`);
          return;
        }
        send("exportProgress", { fraction: 1 });
        send("exportState", { running: false, outcome: "saved", message: `Saved ${target}` });
        core.osd(`Saved ${job.name}`);
        sidebar.hide();
        core.resume();
      } catch (error) {
        stop(`The clip could not be saved: ${String(error)}`);
      }
    }
    function listen() {
      const on = (topic, act) => sidebar.onMessage(topic, act);
      on("sidebarReady", () => {
        sendSidebarState();
        for (const [mark, time] of marks) send("markSet", { mark, time });
      });
      on("markPlayhead", (data) => {
        const { mark } = data;
        if (isMark(mark)) markPlayhead(mark);
      });
      on("seek", (data) => {
        const { time } = data;
        if (isTime(time)) core.seekTo(time);
      });
      on("previewWanted", (data) => {
        const { mark, time, keyframe } = data;
        if (isMark(mark) && isTime(time)) void makePreview(mark, time, keyframe === true);
      });
      on("stepKeyframe", (data) => {
        const { mark, time, direction } = data;
        if (isMark(mark) && isTime(time) && (direction === 1 || direction === -1)) {
          void stepKeyframe(mark, time, direction);
        }
      });
      on("proposeSave", (data) => {
        const { crop, folder } = data;
        if (typeof crop === "boolean" && typeof folder === "string") proposeSave(crop, folder);
      });
      on("pickFolder", (data) => {
        pickFolder(data.crop === true);
      });
      on("startExport", (data) => {
        if (isRange(data) && isTarget(data)) void startExport(data);
      });
    }
    function ensurePage() {
      if (pageLoaded) return;
      sidebar.loadFile("dist/sidebar.html");
      listen();
      pageLoaded = true;
    }
    function openPage() {
      if (!core.window.loaded) return false;
      ensurePage();
      sidebar.show();
      sendSidebarState();
      return true;
    }
    const addCommand = (title, key, action) => api.menu.addItem(api.menu.item(title, action, { keyBinding: key }));
    addCommand("Open Trim", boundKeys.open, () => {
      openPage();
    });
    addCommand("Set Clip In", boundKeys.setIn, () => {
      if (openPage()) markPlayhead("in");
    });
    addCommand("Set Clip Out", boundKeys.setOut, () => {
      if (openPage()) markPlayhead("out");
    });
    api.event.on("iina.file-loaded", () => {
      marks.clear();
      newestPreview.clear();
      inFrame = void 0;
      knownKeyframes = [];
      if (pageLoaded) send("marksCleared", {});
    });
    if (core.window.loaded) ensurePage();
    else api.event.on("iina.window-loaded", ensurePage);
  }

  // src/plugin/main.ts
  startTrim(iina);
})();
