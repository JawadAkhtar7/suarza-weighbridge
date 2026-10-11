/**
 * The operator's live view, from the cameras' video rather than their stills.
 *
 * The live panel used to poll each camera's 640x360 sub-stream snapshot,
 * which went soft as soon as the operator zoomed in to frame the slip's
 * pictures. Bigger snapshots are not the answer on these cameras: one takes
 * 1-1.5 s, and while it is being taken the camera refuses every other
 * snapshot, the slip's own picture included. So this reads the main stream as
 * RTSP video — the way the site's recorder already does — and has ffmpeg turn
 * it into 1920-wide JPEG frames a few times a second. Video never touches the
 * snapshot engine, so printing is unaffected.
 *
 * One ffmpeg per camera, however many screens are watching, started by the
 * first viewer and stopped a little after the last one leaves. A camera that
 * drops is retried with backoff for as long as anyone is watching; the route
 * falls back to the old stills if no frame comes (routes/cameras.ts).
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

export type FrameListener = (frame: Buffer) => void;

export interface LiveVideoOptions {
  /** rtsp://host:port/path, WITHOUT credentials — they are added here. */
  url: string;
  username: string;
  password: string;
  /** Frames a second to produce. */
  fps: number;
  /** Width to scale to; height follows the camera's shape. */
  width: number;
  /** The ffmpeg binary; null or missing means no video. */
  ffmpegPath: string | null | undefined;
  /** Kept running this long after the last viewer leaves: a reload or a tab
      switch should not pay ffmpeg's start-up and the camera's next keyframe. */
  lingerMs?: number;
  onLog?: (level: 'info' | 'warn', message: string) => void;
  /** Tests substitute a fake process. */
  spawn?: typeof nodeSpawn;
}

const RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

/** The RTSP URL with the camera's credentials in it, encoded. */
export function withCredentials(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = encodeURIComponent(username);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

/**
 * ffmpeg's arguments for one camera.
 *
 * `-hwaccel auto` lets the PC's graphics decode the 4K H.265 where it can —
 * about a third of the CPU of decoding in software — and falls back to
 * software by itself where it cannot. TCP because a dropped UDP packet is a
 * smeared frame; the socket timeout (microseconds) makes a camera that goes
 * quiet end the process, so the restart below takes over.
 */
export function ffmpegArgs(url: string, fps: number, width: number): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-hwaccel', 'auto',
    '-rtsp_transport', 'tcp',
    '-timeout', '5000000',
    '-i', url,
    '-an',
    '-vf', `fps=${fps},scale=${width}:-2`,
    '-q:v', '4',
    '-f', 'mpjpeg',
    'pipe:1',
  ];
}

/**
 * Splits ffmpeg's multipart JPEG output into frames.
 *
 * Each part carries its own Content-length, so frames are cut by count, not
 * by hunting for JPEG markers in the data.
 */
export class MultipartJpegReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];

    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = this.buffer.subarray(0, headerEnd).toString('latin1');
      const length = /content-length:\s*(\d+)/i.exec(header);
      if (!length) {
        // Not a part header we understand: drop it rather than wedge.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      const end = start + Number(length[1]);
      if (this.buffer.length < end) break;
      frames.push(Buffer.from(this.buffer.subarray(start, end)));
      this.buffer = this.buffer.subarray(end);
    }

    // A stream that never yields a header is not a stream we can read.
    if (this.buffer.length > 32 * 1024 * 1024) this.buffer = Buffer.alloc(0);
    return frames;
  }
}

export class LiveVideo {
  private process: ChildProcess | null = null;
  private readonly listeners = new Set<FrameListener>();
  private lingerTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartAttempt = 0;
  private stopped = false;

  /** The newest frame, so a viewer who arrives mid-stream sees a picture at once. */
  latestFrame: Buffer | null = null;
  latestFrameAt = 0;

  constructor(private readonly options: LiveVideoOptions) {}

  /** Whether there is anything to run: a camera URL and an ffmpeg on disk. */
  get available(): boolean {
    const path = this.options.ffmpegPath;
    return Boolean(this.options.url) && Boolean(path) && existsSync(path!);
  }

  /** Starts the video if it is not running; returns the way to stop watching. */
  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    if (!this.process && !this.restartTimer) this.start();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && !this.lingerTimer) {
        this.lingerTimer = setTimeout(() => {
          this.lingerTimer = null;
          if (this.listeners.size === 0) this.halt();
        }, this.options.lingerMs ?? 15_000);
        this.lingerTimer.unref?.();
      }
    };
  }

  /** For shutdown: nothing restarts after this. */
  stop(): void {
    this.stopped = true;
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.halt();
  }

  private log(level: 'info' | 'warn', message: string): void {
    // ffmpeg repeats its input URL in errors; the password must not reach a log.
    const password = this.options.password;
    const safe = password ? message.split(encodeURIComponent(password)).join('***').split(password).join('***') : message;
    this.options.onLog?.(level, safe);
  }

  private start(): void {
    if (this.stopped || !this.available) return;

    const spawn = this.options.spawn ?? nodeSpawn;
    const url = withCredentials(this.options.url, this.options.username, this.options.password);
    const child = spawn(this.options.ffmpegPath!, ffmpegArgs(url, this.options.fps, this.options.width), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;

    const reader = new MultipartJpegReader();
    let stderr = '';
    let sawFrame = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const frame of reader.push(chunk)) {
        if (!sawFrame) {
          sawFrame = true;
          this.restartAttempt = 0;
          this.log('info', `Live video started from ${this.options.url}`);
        }
        this.latestFrame = frame;
        this.latestFrameAt = Date.now();
        for (const listener of this.listeners) listener(frame);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      // Only the tail matters, and an unread pipe would stall ffmpeg.
      stderr = (stderr + chunk.toString()).slice(-2000);
    });

    const ended = (reason: string) => {
      if (this.process !== child) return;
      this.process = null;
      if (this.stopped || this.listeners.size === 0) return;

      const delay =
        RESTART_DELAYS_MS[Math.min(this.restartAttempt, RESTART_DELAYS_MS.length - 1)]!;
      this.restartAttempt += 1;
      const detail = stderr.trim().split('\n').pop() || reason;
      this.log('warn', `Live video from ${this.options.url} stopped (${detail}); retrying in ${delay / 1000}s`);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (this.listeners.size > 0) this.start();
      }, delay);
      this.restartTimer.unref?.();
    };

    child.on('error', (error) => ended(error.message));
    child.on('exit', (code) => ended(`exit code ${code}`));
  }

  private halt(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.process;
    this.process = null;
    child?.kill();
  }
}
