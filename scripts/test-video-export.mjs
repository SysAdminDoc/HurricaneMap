import assert from 'node:assert/strict';

import {
  formatVideoFilename,
  getSupportedVideoMimeType,
  getVideoExportSupport,
  normalizeVideoOptions,
  sampleTrack,
} from '../src/video-export.js';

class FakeMediaRecorder {
  static isTypeSupported(type) {
    return type === 'video/webm;codecs=vp8';
  }
}

assert.equal(getSupportedVideoMimeType(FakeMediaRecorder), 'video/webm;codecs=vp8');
assert.equal(getSupportedVideoMimeType(null), '');
assert.deepEqual(getVideoExportSupport({
  mediaRecorderClass: FakeMediaRecorder,
  canvasPrototype: { captureStream() {} },
}), { available: true, reason: 'available', mimeType: 'video/webm;codecs=vp8' });
assert.deepEqual(getVideoExportSupport({
  mediaRecorderClass: FakeMediaRecorder,
  canvasPrototype: {},
}), { available: false, reason: 'capture-stream' });
assert.deepEqual(getVideoExportSupport({
  mediaRecorderClass: class {},
  canvasPrototype: { captureStream() {} },
}), { available: false, reason: 'webm-media-recorder' });

assert.deepEqual(normalizeVideoOptions({ fps: 60, durationSeconds: 30 }), {
  fps: 60, durationSeconds: 30, width: 1280, height: 720,
});
assert.deepEqual(normalizeVideoOptions({ fps: 25, durationSeconds: 12 }), {
  fps: 24, durationSeconds: 10, width: 1280, height: 720,
});
assert.deepEqual(normalizeVideoOptions({ fps: 'invalid', durationSeconds: null }).fps, 30);
assert.equal(formatVideoFilename({ name: 'KATRINA', year: 2005 }), 'HurricaneMap-Katrina-2005-track.webm');

const track = [
  { t: '2005-08-23T18:00:00Z', lat: 23, lon: -75, wind: 30, status: 'TD' },
  { t: '2005-08-24T18:00:00Z', lat: 25, lon: -77, wind: 50, status: 'TS' },
];
assert.deepEqual(sampleTrack(track, 0.5), {
  lat: 24, lon: -76, wind: 40, t: '2005-08-24T06:00:00.000Z', status: 'TS',
});
assert.equal(sampleTrack([{ lat: 1, lon: 2 }], 0.5).lat, 1);
assert.equal(sampleTrack([{ lat: 'bad', lon: 2 }], 0.5), null);

console.log('Video export contracts, support detection, interpolation, and filenames ok');
