# iina-trim

Trim is a plugin for the [IINA](https://iina.io) video player on macOS. Mark In and Out points while a video plays, then save that range as a new file. By default the clip is lossless and takes moments to save, because the video and audio are copied rather than re-encoded.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The sidebar](#the-sidebar)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [How cuts work](#how-cuts-work)
- [File names](#file-names)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [Privacy and permissions](#privacy-and-permissions)
- [Development](#development)
- [License](#license)

## Features

- Set In and Out at the playhead with a button or shortcut, or type a time.
- See a frame preview for each mark, so you can check a cut before saving.
- Step either mark to the previous or next keyframe to land on a clean scene change.
- See the folder and file name at all times, and change either before saving.
- Save losslessly in the source format, keeping every stream.
- Optionally crop to a centered 9:16 frame, using hardware or software encoding.
- Follow the export with a progress bar.
- Never replace an existing file.
- Change names, shortcuts, preview size and encoding quality in IINA's settings.

## Requirements

- macOS and [IINA](https://iina.io) with plugin support. Trim is developed on IINA 1.5.0.
- [FFmpeg](https://ffmpeg.org) with ffprobe. Homebrew's package includes both:

  ```sh
  brew install ffmpeg
  ```

Trim looks for FFmpeg in `/opt/homebrew/bin` and `/usr/local/bin`. If yours is elsewhere, set its location in [Settings](#settings).

## Install

1. Clone the repository and link it into IINA's plugin folder:

   ```sh
   git clone https://github.com/semiconducted/iina-trim.git ~/Developer/iina-trim
   ln -s ~/Developer/iina-trim \
     "$HOME/Library/Application Support/com.colliderli.iina/plugins/iina-trim.iinaplugin-dev"
   ```

2. Quit and reopen IINA.
3. Open IINA's Settings, choose Plugins, and turn Trim on.

The built plugin is committed in `dist/`, so you do not need to build anything.

**To update:** run `git pull` in the clone, then quit and reopen IINA. Trim does not update itself.

**To uninstall:** delete the `iina-trim.iinaplugin-dev` link from the plugin folder, then delete the clone.

## Quick start

1. Open a video file in IINA.
2. Press **Ctrl+Shift+T** to open the Trim sidebar.
3. Play to the start of your clip and press **Set In**.
4. Play to the end and press **Set Out**.
5. Check both previews. Use `|<<` and `>>|` to step a mark to a nearby keyframe. The step sets the mark, so there is no need to press Set again.
6. Check the folder and name, then press **Save clip**.

When the clip is saved, the sidebar closes and playback resumes.

## The sidebar

Each mark, In and Out, has its own set of controls:

| Control | What it does |
|---|---|
| Preview | Shows the first frame of the clip for In, and the last for Out. It is blank until the mark is set. |
| Time between the arrows | Shows where the clip really cuts. See [How cuts work](#how-cuts-work). |
| `\|<<` and `>>\|` | Move the mark to the previous or next keyframe. Playback pauses and the playhead moves there too. |
| Time field | Shows the time you set. You can type `83`, `1:23` or `0:01:23.5`. Press Return or leave the field to apply it. |
| **Set In** or **Set Out** | Sets the mark to the current playhead. |
| **Go** | Moves the playhead to the mark. |

Below the marks:

| Control | What it does |
|---|---|
| Length | Shows the clip length, or a warning if Out is not after In. |
| Vertical crop (9:16) | Crops to a centered 9:16 frame. This re-encodes the video. |
| Hardware acceleration | Uses Apple VideoToolbox for the crop. Available only when Vertical crop is on. |
| Folder and **Change...** | Where the clip is saved. It starts as the folder of the video. |
| Name | The file name. A name you type stays until the clip is saved. |
| **Save clip** | Starts the export. It is available once In and Out are set and Out is after In. |

The source video is never changed: Trim always writes a new file. If a save fails, your marks, folder and name stay as they were so you can fix the problem.

Marks clear when another file opens.

## Keyboard shortcuts

| Action | Default |
|---|---|
| Open Trim | Ctrl+Shift+T |
| Set In | Option+Shift+I |
| Set Out | Option+Shift+O |

The same three commands are in IINA's Plugin menu as **Open Trim**, **Set Clip In** and **Set Clip Out**. Set In and Set Out also open the sidebar if it is closed. You can change the shortcuts in [Settings](#settings).

## How cuts work

Compressed video is built around keyframes, which are complete pictures. The frames between them store only what changed, so a clip that copies the video must begin on a keyframe.

**Lossless clips (the default)**

- The clip starts on the keyframe at or before In. The time between the arrows shows that keyframe, so it can be earlier than the time you set. How much earlier depends on how far apart the file's keyframes are.
- The clip ends at or just before Out, and shows no frame past it.
- Every stream is copied unchanged, and the source format is kept.

To cut exactly on a scene change, use the arrows. Encoders usually place a keyframe at a scene change, though not every file has one there.

- Stepping **In** to a keyframe makes that keyframe the first frame of the clip.
- Stepping **Out** to a keyframe stops just before it, so the first frame of the next scene is left out.

**Vertical crop clips**

- The video is re-encoded to H.264, so the clip starts on the exact frame at In.
- The picture is cropped to a centered 9:16 frame at full height. The source must be wider than 9:16.
- The main audio track is copied unchanged.
- Saving takes longer than a lossless clip.

## File names

By default, the clip is proposed beside the source video:

| Situation | Name |
|---|---|
| Lossless clip of `movie.mkv` | `movie-clip.mkv` |
| That name is already taken | `movie-clip-2.mkv` |
| Vertical crop of `movie.mkv` | `movie-clip.mov` |

You can edit the name before saving. Trim refuses a name that already exists, a name that would replace the source video, and a name with a slash, a colon or a leading dot.

## Settings

Open IINA's Settings, choose Plugins, choose Trim, then open the **Preferences** tab. There is no Save button: a change is kept when you press Return or leave the field. A blank number field uses the default, and an out-of-range number is moved into range.

| Setting | Default | Allowed | Applies |
|---|---|---|---|
| Added after the name | `-clip` | No slashes or colons | Next clip |
| Before the number | `-` | No slashes or colons | Next clip |
| Open Trim | `Ctrl+Shift+t` | See below | After reopening IINA |
| Set In | `Alt+Shift+i` | See below | After reopening IINA |
| Set Out | `Alt+Shift+o` | See below | After reopening IINA |
| Minimum preview width | 180 px | 100 to 640 | Next time the sidebar opens |
| Maximum preview width | 240 px | Minimum width to 640 | Next time the sidebar opens |
| JPEG quality | 5 | 2 to 31, lower is better | Next preview |
| First keyframe search | 20 s | 1 to 3600 | Next arrow press |
| Wider keyframe search | 300 s | First search to 3600 | Next arrow press |
| File format | mov | mov, mp4 or mkv | Next vertical crop |
| Hardware quality | 70 | 1 to 100, higher is better | Next vertical crop |
| Software CRF | 23 | 0 to 51, lower is better | Next vertical crop |
| FFmpeg location | Blank | A full path, or blank for Homebrew | Next use |

**Shortcuts** use mpv's key format, such as `Ctrl+Shift+t`. `Alt` is Option and `Meta` is Command. Avoid keys IINA already uses. An invalid entry uses the default.

**Preview widths** also control the layout: In and Out sit side by side when two previews at the minimum width fit the sidebar, and stack when they do not.

**Keyframe searches** set how far the arrows look. The wider search runs only if the first finds nothing, so larger values are slower only on files with few keyframes.

## Troubleshooting

| Problem | What to do |
|---|---|
| Trim is not in the Plugin menu or the sidebar | Turn it on under Settings, Plugins, then quit and reopen IINA. |
| "FFmpeg was not found" | Install FFmpeg, or set FFmpeg location in Settings. |
| "ffprobe was not found next to FFmpeg" | The arrows need ffprobe. Install a build of FFmpeg that includes it. |
| A clip starts earlier than In | This is expected for a lossless clip. Step In to a keyframe, or turn on Vertical crop for an exact start. |
| "No keyframe found" | Raise Wider keyframe search in Settings. There may also be no keyframe in that direction. |
| "Open a local video first" | Trim works only on local files, not streams. |
| A shortcut does nothing | Quit and reopen IINA after changing it, and check that it does not clash with an IINA shortcut. |
| A vertical crop fails | Check that the source is wider than 9:16. If the audio does not fit the chosen format, try another file format in Settings. |

## Limits

- Trim saves one continuous range at a time.
- Lossless clips can start only on a keyframe.
- Trim works on local files only.
- Previews and keyframe steps always use the first video stream.
- An export cannot be cancelled once it starts.
- Trim has been tested most on H.264 video in mp4.

## Privacy and permissions

Trim makes no network requests and does not update itself. It asks IINA for two permissions:

| Permission | Why |
|---|---|
| `file-system` | To run FFmpeg and ffprobe, and to read temporary preview images. |
| `show-osd` | To show short messages over the video. |

The build fails if `Info.json` ever requests network access or a self-update source.

## Development

You need Node and pnpm. Trim is developed on Node 25 and pnpm 11.

```sh
pnpm install
pnpm check
```

| Command | What it does |
|---|---|
| `pnpm check` | Type-checks, runs the tests, builds and checks the package. |
| `pnpm test` | Runs the tests. |
| `pnpm typecheck` | Type-checks only. |
| `pnpm build` | Rebuilds `dist/` and checks the package. |

After a change, run `pnpm build`, then quit and reopen IINA. Commit `dist/` with your change, because a clone runs from it directly.

| Path | Contents |
|---|---|
| `src/plugin/` | Code IINA runs: menu commands, FFmpeg and ffprobe calls, and file naming. |
| `src/sidebar/` | The sidebar page, written without a framework. |
| `src/shared/` | Messages between plugin and sidebar, time formats and settings. |
| `tests/` | Tests, run with Vitest against a stand-in for IINA. |
| `Info.json` | The plugin manifest, including the setting defaults under `preferenceDefaults`. |
| `pref.html` | The settings page. |
| `build.mjs` | Bundles the plugin, and builds the sidebar into one self-contained page. |
| `check-package.mjs` | Fails the build if the settings page disagrees with `Info.json`, or if network access is requested. |

The setting defaults live only in `Info.json`. To change or add one, update `pref.html` too, including the default it shows, or the build will fail.

## License

[ISC](LICENSE)
