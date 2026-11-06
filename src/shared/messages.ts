// Every message that crosses between the plugin and the sidebar webview.

export type Mark = 'in' | 'out';

export interface ClipRange {
  inTime: number;
  outTime: number;
  useHardware: boolean;
  crop: boolean;
}

export interface SaveTarget {
  folder: string;
  name: string;
}

export interface FramePreview {
  mark: Mark;
  time: number;
  // Source time of the frame shown; null when the frame could not be made.
  frameTime: number | null;
  // JPEG data URL, or an empty string when the frame could not be made.
  image: string;
}

export interface ExportState {
  running: boolean;
  outcome: 'none' | 'saved' | 'failed';
  message: string;
}

export interface ToSidebar {
  ffmpegState: { found: boolean };
  // Key labels name the shortcuts actually bound, which can lag the settings page.
  sidebarConfig: { minWidth: number; maxWidth: number; inKey: string; outKey: string };
  markSet: { mark: Mark; time: number };
  marksCleared: Record<string, never>;
  framePreview: FramePreview;
  stepEnded: { mark: Mark; problem: string };
  saveProposal: SaveTarget;
  exportState: ExportState;
  exportProgress: { fraction: number };
}

export interface ToPlugin {
  sidebarReady: Record<string, never>;
  markPlayhead: { mark: Mark };
  seek: { time: number };
  previewWanted: { mark: Mark; time: number; keyframe: boolean };
  stepKeyframe: { mark: Mark; time: number; direction: -1 | 1 };
  // A blank folder means the folder of the source video.
  proposeSave: { crop: boolean; folder: string };
  pickFolder: { crop: boolean };
  startExport: ClipRange & SaveTarget;
}
