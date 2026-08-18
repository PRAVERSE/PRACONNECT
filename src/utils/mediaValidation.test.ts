// src/utils/mediaValidation.test.ts
// Client file-picker validation rules for the local movie upload flow.
//
// Run: npx tsx --test src/utils/mediaValidation.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedLocalMovie, LOCAL_MOVIE_ACCEPT } from './mediaValidation';

function file(name: string, type: string) {
  return { name, type };
}

test('A: .mp4 accepted', () => {
  assert.equal(isSupportedLocalMovie(file('movie.mp4', 'video/mp4')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mp4', '')), true, 'extension alone is enough');
});

test('B: .webm accepted', () => {
  assert.equal(isSupportedLocalMovie(file('movie.webm', 'video/webm')), true);
  assert.equal(isSupportedLocalMovie(file('movie.webm', 'video/webm;codecs=vp9')), true, 'codecs params tolerated');
});

test('C: .mov accepted', () => {
  assert.equal(isSupportedLocalMovie(file('movie.mov', 'video/quicktime')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mov', '')), true);
});

test('D: .mkv accepted', () => {
  assert.equal(isSupportedLocalMovie(file('movie.mkv', 'video/x-matroska')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mkv', 'video/matroska')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mkv', 'application/x-matroska')), true);
});

test('E: uppercase .MKV accepted (case-insensitive extension)', () => {
  assert.equal(isSupportedLocalMovie(file('MOVIE.MKV', 'video/x-matroska')), true);
  assert.equal(isSupportedLocalMovie(file('MOVIE.MKV', '')), true);
  assert.equal(isSupportedLocalMovie(file('MOVIE.MP4', 'video/mp4')), true);
});

test('F: empty MIME + .mkv accepted', () => {
  assert.equal(isSupportedLocalMovie(file('movie.mkv', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mkv', 'application/octet-stream')), true);
});

test('G: unsupported extensions rejected', () => {
  assert.equal(isSupportedLocalMovie(file('movie.txt', 'text/plain')), false);
  assert.equal(isSupportedLocalMovie(file('movie.jpg', 'image/jpeg')), false);
  assert.equal(isSupportedLocalMovie(file('movie.xyz', 'application/octet-stream')), false, 'octet-stream without a supported extension is rejected');
  assert.equal(isSupportedLocalMovie(file('movie.mkv.exe', 'application/octet-stream')), false, 'extension must be at the end');
  assert.equal(isSupportedLocalMovie(file('nomkv', 'video/x-matroska')), true, 'supported MIME alone is enough');
});

test('H: broad container list accepted (Phase 6.10)', () => {
  assert.equal(isSupportedLocalMovie(file('movie.avi', 'video/x-msvideo')), true);
  assert.equal(isSupportedLocalMovie(file('movie.AVI', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.m4v', 'video/x-m4v')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mpeg', 'video/mpeg')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mpg', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.3gp', 'video/3gpp')), true);
  assert.equal(isSupportedLocalMovie(file('movie.flv', 'video/x-flv')), true);
  assert.equal(isSupportedLocalMovie(file('movie.ogv', 'video/ogg')), true);
  assert.equal(isSupportedLocalMovie(file('movie.wmv', 'video/x-ms-wmv')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mts', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.m2ts', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.divx', '')), true);
});

test('I: empty MIME type never rejected for supported extensions', () => {
  assert.equal(isSupportedLocalMovie(file('movie.mp4', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.webm', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mkv', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.mov', '')), true);
  assert.equal(isSupportedLocalMovie(file('movie.avi', 'application/octet-stream')), true, 'octet-stream falls back to extension');
});

test('accept attribute includes the broad Phase 6.10 list', () => {
  assert.match(LOCAL_MOVIE_ACCEPT, /video\/x-matroska/);
  assert.match(LOCAL_MOVIE_ACCEPT, /video\/matroska/);
  assert.match(LOCAL_MOVIE_ACCEPT, /application\/x-matroska/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.mkv/);
  assert.match(LOCAL_MOVIE_ACCEPT, /video\/mp4/);
  assert.match(LOCAL_MOVIE_ACCEPT, /video\/webm/);
  assert.match(LOCAL_MOVIE_ACCEPT, /video\/quicktime/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.mp4/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.webm/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.mov/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.avi/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.m4v/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.mpeg/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.mpg/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.3gp/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.flv/);
  assert.match(LOCAL_MOVIE_ACCEPT, /\.ogv/);
});