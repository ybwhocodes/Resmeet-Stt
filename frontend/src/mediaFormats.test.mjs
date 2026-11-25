import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_ACCEPT, isSupportedMediaFile } from './mediaFormats.js';

test('MPEG is accepted with uppercase extensions or an unknown MIME type', () => {
  for (const name of ['Pak Risa.MPEG', 'meeting.mpg', 'meeting.mpe', 'meeting.mpga']) {
    assert.equal(isSupportedMediaFile({ name, type: 'application/octet-stream' }), true);
    assert.ok(MEDIA_ACCEPT.split(',').includes(name.slice(name.lastIndexOf('.')).toLowerCase()));
  }
});

test('existing formats remain available and misleading filenames are rejected', () => {
  for (const name of ['meeting.m4a', 'meeting.mp4', 'recording.webm', 'meeting.wav']) {
    assert.equal(isSupportedMediaFile({ name }), true);
  }
  for (const name of ['meeting.mpeg.exe', 'meeting', 'notes.txt']) {
    assert.equal(isSupportedMediaFile({ name, type: 'video/mpeg' }), false);
  }
});
