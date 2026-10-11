import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import {
  ffmpegArgs,
  LiveVideo,
  MultipartJpegReader,
  withCredentials,
} from '../src/cameras/live-video.js';

/** One part of ffmpeg's -f mpjpeg output. */
const part = (body: string) =>
  Buffer.from(`--ffmpeg\r\nContent-type: image/jpeg\r\nContent-length: ${body.length}\r\n\r\n${body}\r\n`);

describe('MultipartJpegReader', () => {
  it('cuts frames by their stated length, however the bytes arrive', () => {
    const stream = Buffer.concat([part('FRAME-ONE'), part('FRAME\r\n\r\nTWO')]);
    const reader = new MultipartJpegReader();
    const frames: string[] = [];
    // One byte at a time: the worst a pipe can do.
    for (const byte of stream) frames.push(...reader.push(Buffer.from([byte])).map(String));
    // A frame may contain anything, header-looking bytes included.
    expect(frames).toEqual(['FRAME-ONE', 'FRAME\r\n\r\nTWO']);
  });
});

describe('ffmpeg command', () => {
  it('adds the credentials encoded, and reads TCP with a socket timeout', () => {
    expect(withCredentials('rtsp://10.0.0.5:554/Streaming/Channels/101', 'admin', 'p@ss:w/rd')).toBe(
      'rtsp://admin:p%40ss%3Aw%2Frd@10.0.0.5:554/Streaming/Channels/101',
    );
    const args = ffmpegArgs('rtsp://x', 5, 1920);
    expect(args).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp', '-timeout', '-f', 'mpjpeg']));
    expect(args[args.indexOf('-vf') + 1]).toBe('fps=5,scale=1920:-2');
  });
});

/** A stand-in for ffmpeg: a process whose stdout the test writes frames into. */
function fakeFfmpeg() {
  const processes: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void; killed: boolean })[] = [];
  const spawnFake = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill() {
        child.killed = true;
        child.emit('exit', null);
      },
    });
    processes.push(child);
    return child;
  }) as unknown as typeof spawn;
  return { spawnFake, processes };
}

describe('LiveVideo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (spawnFake: typeof spawn, onLog = vi.fn()) =>
    new LiveVideo({
      url: 'rtsp://10.0.0.5:554/Streaming/Channels/101',
      username: 'admin',
      password: 'Secret123',
      fps: 5,
      width: 1920,
      // Any file that exists: the fake never runs it.
      ffmpegPath: process.execPath,
      lingerMs: 1000,
      spawn: spawnFake,
      onLog,
    });

  it('runs one ffmpeg however many screens watch, and sends each its frames', () => {
    const { spawnFake, processes } = fakeFfmpeg();
    const video = make(spawnFake);
    const a: string[] = [];
    const b: string[] = [];
    video.subscribe((frame) => a.push(String(frame)));
    video.subscribe((frame) => b.push(String(frame)));

    processes[0]!.stdout.write(part('F1'));
    expect(spawnFake).toHaveBeenCalledTimes(1);
    expect(a).toEqual(['F1']);
    expect(b).toEqual(['F1']);
    expect(String(video.latestFrame)).toBe('F1');
  });

  it('stops ffmpeg a little after the last screen closes, not before', () => {
    const { spawnFake, processes } = fakeFfmpeg();
    const video = make(spawnFake);
    const leave = video.subscribe(() => undefined);
    leave();

    vi.advanceTimersByTime(900);
    expect(processes[0]!.killed).toBe(false);
    // A reload inside the linger reuses the running process.
    const again = video.subscribe(() => undefined);
    vi.advanceTimersByTime(2000);
    expect(spawnFake).toHaveBeenCalledTimes(1);
    again();
    vi.advanceTimersByTime(1000);
    expect(processes[0]!.killed).toBe(true);
  });

  it('restarts a dropped camera for as long as someone watches, and keeps the password out of the log', () => {
    const { spawnFake, processes } = fakeFfmpeg();
    const onLog = vi.fn();
    const video = make(spawnFake, onLog);
    video.subscribe(() => undefined);

    processes[0]!.stderr.write('rtsp://admin:Secret123@10.0.0.5 Connection refused\n');
    processes[0]!.emit('exit', 1);
    vi.advanceTimersByTime(1000);
    expect(spawnFake).toHaveBeenCalledTimes(2);

    const logged = onLog.mock.calls.map((call) => String(call[1])).join('\n');
    expect(logged).toContain('Connection refused');
    expect(logged).not.toContain('Secret123');
  });

  it('starts nothing once stopped', () => {
    const { spawnFake } = fakeFfmpeg();
    const video = make(spawnFake);
    video.stop();
    video.subscribe(() => undefined);
    expect(spawnFake).not.toHaveBeenCalled();
  });

  it('is unavailable without an ffmpeg on disk', () => {
    const { spawnFake } = fakeFfmpeg();
    const video = new LiveVideo({
      url: 'rtsp://x',
      username: '',
      password: '',
      fps: 5,
      width: 1920,
      ffmpegPath: 'C:/nowhere/ffmpeg.exe',
      spawn: spawnFake,
    });
    expect(video.available).toBe(false);
  });
});
