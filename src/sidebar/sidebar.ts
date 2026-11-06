import type { ClipRange, FramePreview, Mark, SaveTarget, ToPlugin, ToSidebar } from '../shared/messages';
import { DEFAULT_SETTINGS, keyLabel } from '../shared/settings';
import { fromTimecode, toTimecode } from '../shared/timecode';

// IINA provides window.iina inside the webview. Opened elsewhere, the page still draws.
type Receiver = (body: unknown) => void;
interface Host {
  onMessage(topic: string, receiver: Receiver): void;
  postMessage(topic: string, body: unknown): void;
}
const host = (window as unknown as { iina?: Host }).iina;

function send<K extends keyof ToPlugin>(topic: K, body: ToPlugin[K]): void {
  host?.postMessage(topic, body);
}

function receive<K extends keyof ToSidebar>(topic: K, receiver: (body: ToSidebar[K]) => void): void {
  host?.onMessage(topic, receiver as Receiver);
}

const PREVIEW_DELAY_MS = 350;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const cropBox = byId<HTMLInputElement>('crop');
const hardwareBox = byId<HTMLInputElement>('hardware');
const lengthLine = byId('length');
const folderLine = byId('folder');
const changeFolderButton = byId<HTMLButtonElement>('change-folder');
const fileNameInput = byId<HTMLInputElement>('file-name');
const exportRow = byId('export');
const progressBar = byId<HTMLProgressElement>('progress');
const progressText = byId('progress-text');
const saveButton = byId<HTMLButtonElement>('save-clip');
const messageLine = byId('message');

let ffmpegFound = true;
let exporting = false;
let saveTarget: SaveTarget | undefined;
// A name the user typed is kept; a proposed one follows the format and folder.
let nameEdited = false;
let exportFraction: number | undefined;

class MarkPanel {
  seconds: number | undefined;
  private preview: FramePreview | undefined;
  private loading = false;
  private stepping = false;
  // Presses made while a step is running: positive is forward, negative is back.
  private queuedSteps = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly frame: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly note: HTMLElement;
  private readonly cutTime: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly set: HTMLButtonElement;
  private readonly keyName: HTMLElement;
  private readonly go: HTMLButtonElement;

  constructor(
    private readonly mark: Mark,
    private readonly name: string,
  ) {
    const template = byId<HTMLTemplateElement>('mark-template');
    const root = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
    const part = <T extends Element>(selector: string): T => root.querySelector(selector) as T;

    this.frame = part('.frame');
    this.image = part('img');
    this.note = part('.frame-note');
    this.cutTime = part('.cut-time');
    this.back = part('.jog-back');
    this.next = part('.jog-next');
    this.input = part('.time');
    this.set = part('.set');
    this.keyName = part('kbd');
    this.go = part('.go');

    part('.set-name').textContent = `Set ${name}`;
    this.image.alt = `${name} frame`;
    this.input.setAttribute('aria-label', `${name} time`);
    this.back.setAttribute('aria-label', `Move ${name} to the previous keyframe`);
    this.next.setAttribute('aria-label', `Move ${name} to the next keyframe`);
    this.go.title = `Jump to ${name}`;

    this.back.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    this.set.addEventListener('click', () => send('markPlayhead', { mark }));
    this.go.addEventListener('click', () => {
      if (this.seconds !== undefined) send('seek', { time: this.seconds });
    });
    this.input.addEventListener('input', () => this.timeTyped());
    this.input.addEventListener('blur', () => this.tidyTyped());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.tidyTyped();
    });

    byId('marks').append(root);
  }

  // Where the clip really cuts: a lossless In starts on the keyframe shown.
  private cutPoint(): number | undefined {
    const shown = this.preview;
    const isCurrent = shown?.time === this.seconds && shown?.frameTime !== null;
    return this.mark === 'in' && isCurrent && shown ? (shown.frameTime ?? this.seconds) : this.seconds;
  }

  setKey(label: string): void {
    this.keyName.textContent = label;
    this.set.title = `Set ${this.name} to the playhead (${label})`;
  }

  setTime(time: number | undefined): void {
    this.input.value = time === undefined ? '' : toTimecode(time);
    this.timeTyped();
  }

  private timeTyped(): void {
    this.seconds = fromTimecode(this.input.value);
    messageLine.textContent = '';
    this.requestPreview();
    render();
  }

  private tidyTyped(): void {
    if (this.seconds === undefined) return;
    const tidy = toTimecode(this.seconds);
    if (tidy !== this.input.value) this.setTime(this.seconds);
  }

  requestPreview(): void {
    clearTimeout(this.timer);
    const time = this.seconds;
    if (time === undefined) {
      this.preview = undefined;
      this.loading = false;
      return;
    }
    this.loading = true;
    const keyframe = this.mark === 'in' && !cropBox.checked;
    this.timer = setTimeout(() => send('previewWanted', { mark: this.mark, time, keyframe }), PREVIEW_DELAY_MS);
  }

  previewArrived(preview: FramePreview): void {
    if (preview.time !== this.seconds) return;
    this.preview = preview;
    this.loading = false;
    render();
  }

  private step(direction: -1 | 1): void {
    if (this.stepping) {
      this.queuedSteps += direction;
      return;
    }
    const time = this.cutPoint();
    if (time === undefined) return;
    this.stepping = true;
    send('stepKeyframe', { mark: this.mark, time, direction });
    render();
  }

  stepFinished(succeeded: boolean): void {
    this.stepping = false;
    if (!succeeded) this.queuedSteps = 0;
    if (this.queuedSteps === 0) return;
    const direction = this.queuedSteps > 0 ? 1 : -1;
    this.queuedSteps -= direction;
    this.step(direction);
  }

  dropQueuedSteps(): void {
    this.queuedSteps = 0;
  }

  render(locked: boolean): void {
    const cut = this.cutPoint();
    const typed = this.input.value.trim();
    const picture = this.seconds === undefined ? '' : (this.preview?.image ?? '');

    this.input.disabled = locked;
    this.input.setAttribute('aria-invalid', String(typed !== '' && this.seconds === undefined));
    this.set.disabled = locked;
    this.go.disabled = locked || this.seconds === undefined;
    this.back.disabled = this.next.disabled = locked || cut === undefined;
    this.cutTime.textContent = cut === undefined ? '--:--:--.---' : toTimecode(cut);
    this.cutTime.classList.toggle('busy', this.stepping);

    this.frame.classList.toggle('loading', this.loading);
    this.image.hidden = picture === '';
    if (picture !== '' && this.image.getAttribute('src') !== picture) this.image.src = picture;
    this.note.hidden = picture !== '';
    this.note.textContent = this.loading ? 'Loading frame...' : `No ${this.name} frame`;
  }
}

function setPreviewWidths(min: number, max: number): void {
  document.documentElement.style.setProperty('--preview-min', `${min}px`);
  document.documentElement.style.setProperty('--preview-max', `${max}px`);
}

setPreviewWidths(DEFAULT_SETTINGS.thumbnailMinWidth, DEFAULT_SETTINGS.thumbnailMaxWidth);

const inPanel = new MarkPanel('in', 'In');
const outPanel = new MarkPanel('out', 'Out');
const panels: Record<Mark, MarkPanel> = { in: inPanel, out: outPanel };
inPanel.setKey(keyLabel(DEFAULT_SETTINGS.shortcuts.setIn));
outPanel.setKey(keyLabel(DEFAULT_SETTINGS.shortcuts.setOut));

function clipRange(): ClipRange | undefined {
  const inTime = inPanel.seconds;
  const outTime = outPanel.seconds;
  if (inTime === undefined || outTime === undefined || outTime <= inTime) return undefined;
  return { inTime, outTime, crop: cropBox.checked, useHardware: hardwareBox.checked };
}

function showMessage(text: string, tone: '' | 'good' | 'bad'): void {
  messageLine.textContent = text;
  messageLine.className = tone === '' ? 'message' : `message ${tone}`;
}

function render(): void {
  const range = clipRange();

  inPanel.render(exporting);
  outPanel.render(exporting);
  cropBox.disabled = exporting;
  // Hardware acceleration only matters when cropping re-encodes the video.
  hardwareBox.disabled = exporting || !cropBox.checked;

  if (range) lengthLine.textContent = `Length ${toTimecode(range.outTime - range.inTime)}`;
  else if (inPanel.seconds !== undefined && outPanel.seconds !== undefined) {
    lengthLine.textContent = 'Out must follow In';
  } else lengthLine.textContent = '';

  folderLine.textContent = saveTarget?.folder ?? '';
  changeFolderButton.disabled = fileNameInput.disabled = exporting || saveTarget === undefined;
  saveButton.disabled = !canSave();
  saveButton.textContent = exporting ? 'Saving...' : 'Save clip';

  exportRow.hidden = !exporting;
  if (exportFraction === undefined) {
    progressBar.removeAttribute('value');
    progressText.textContent = 'Working...';
  } else {
    progressBar.value = exportFraction;
    progressText.textContent = exportFraction >= 1 ? 'Finishing file...' : `${Math.round(exportFraction * 100)}%`;
  }
}

function canSave(): boolean {
  return ffmpegFound && !exporting && !!clipRange() && !!saveTarget && fileNameInput.value.trim() !== '';
}

function askForName(): void {
  send('proposeSave', { crop: cropBox.checked, folder: saveTarget?.folder ?? '' });
}

function saveClip(): void {
  const range = clipRange();
  if (!canSave() || !range || !saveTarget) return;
  inPanel.dropQueuedSteps();
  outPanel.dropQueuedSteps();
  exportFraction = undefined;
  send('startExport', { ...range, folder: saveTarget.folder, name: fileNameInput.value.trim() });
}

cropBox.addEventListener('change', () => {
  inPanel.requestPreview();
  askForName();
  render();
});
changeFolderButton.addEventListener('click', () => send('pickFolder', { crop: cropBox.checked }));
fileNameInput.addEventListener('input', () => {
  nameEdited = fileNameInput.value.trim() !== '';
  showMessage('', '');
  render();
});
fileNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveClip();
});
saveButton.addEventListener('click', saveClip);

receive('ffmpegState', ({ found }) => {
  ffmpegFound = found;
  if (!found) showMessage('FFmpeg was not found. Set its path in Trim preferences.', 'bad');
  render();
});
receive('sidebarConfig', ({ minWidth, maxWidth, inKey, outKey }) => {
  setPreviewWidths(minWidth, maxWidth);
  inPanel.setKey(inKey);
  outPanel.setKey(outKey);
});
receive('markSet', ({ mark, time }) => panels[mark].setTime(time));
receive('marksCleared', () => {
  // A new video starts over: its own folder and a proposed name.
  saveTarget = undefined;
  nameEdited = false;
  fileNameInput.value = '';
  inPanel.dropQueuedSteps();
  outPanel.dropQueuedSteps();
  inPanel.setTime(undefined);
  outPanel.setTime(undefined);
  askForName();
});
receive('framePreview', (preview) => panels[preview.mark].previewArrived(preview));
receive('stepEnded', ({ mark, problem }) => {
  panels[mark].stepFinished(problem === '');
  if (problem !== '') showMessage(problem, 'bad');
  render();
});
receive('saveProposal', (target) => {
  saveTarget = target;
  if (!nameEdited) fileNameInput.value = target.name;
  render();
});
receive('exportProgress', ({ fraction }) => {
  exportFraction = fraction;
  render();
});
receive('exportState', ({ running, outcome, message }) => {
  exporting = running;
  if (!running) exportFraction = undefined;
  // The saved name is now taken, so the next clip gets a fresh proposal.
  if (outcome === 'saved') {
    nameEdited = false;
    askForName();
  }
  showMessage(message, outcome === 'saved' ? 'good' : outcome === 'failed' ? 'bad' : '');
  render();
});

render();
send('sidebarReady', {});
askForName();
