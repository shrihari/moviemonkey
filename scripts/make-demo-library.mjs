#!/usr/bin/env node
// Creates ./demo-library with realistic (messy!) release names as *sparse*
// files: they report multi-GB sizes but take ~0 bytes on disk.
//
//   npm run demo            # creates ./demo-library
//   npm run demo -- <dir>   # somewhere else
import { mkdirSync, openSync, ftruncateSync, closeSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'demo-library');
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const movies = [
  ['The.Matrix.1999.1080p.BluRay.x264-SPARKS.mkv', 8.7],
  ['The.Matrix.1999.1080p.BluRay.x264-SPARKS/Sample/sample-the.matrix.mkv', 0.06],
  ['Inception (2010) [1080p] [BluRay] [5.1] [YTS.MX]/Inception.2010.1080p.BluRay.x264.YIFY.mp4', 2.1],
  ['Interstellar.2014.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ.mkv', 31.4],
  ['Parasite (2019)/Parasite (2019).mkv', 4.4],
  ['Spirited Away (2001) [1080p]/Spirited.Away.2001.1080p.BluRay.x264.mkv', 6.6],
  ['Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos.H.265-FLUX.mkv', 22.3],
  ['Blade Runner 2049 (2017).mkv', 11.2],
  ['Heat (1995)/movie.mkv', 9.1],
  ['2001.A.Space.Odyssey.1968.REMASTERED.1080p.BluRay.x264.mkv', 10.3],
  ['Arrival.2016.1080p.BluRay.x264-SPARKS/sparks-arrival-1080p.mkv', 7.9],
  ['Arrival.2016.1080p.BluRay.x264-SPARKS/Featurettes/Xenolinguistics.mkv', 0.4],
  ['Whiplash.2014.720p.BluRay.x264.mp4', 1.4],
  ['The Grand Budapest Hotel 2014 1080p.mkv', 5.2],
  ['Mad.Max.Fury.Road.2015.1080p.BluRay.x264-SPARKS.mkv', 8.8],
  ['Everything Everywhere All at Once (2022) [2160p].mkv', 18.1],
  ['Amelie.2001.1080p.BluRay.mkv', 7.7],
  ['Oppenheimer.2023.1080p.WEB-DL.DDP5.1.H.264.mkv', 6.9],
  ['Past.Lives.2023.1080p.WEBRip.x265.mkv', 2.2],
  ['Her.2013.1080p.BluRay.x264.mkv', 7.1],
  ['The.Godfather.1972.REMASTERED.1080p.BluRay.x264.mkv', 11.5],
  ['Pulp Fiction (1994).mkv', 9.6],
  ['Spider-Man.Into.the.Spider-Verse.2018.1080p.BluRay.x264.mkv', 6.3],
  ['Coco.2017.1080p.BluRay.x264.mkv', 5.6],
  ['La.La.Land.2016.1080p.BluRay.x264.mkv', 6.1],
  ['Knives.Out.2019.1080p.BluRay.x264.mkv', 7.4],
  ['The.Social.Network.2010.1080p.BluRay.x264.mkv', 6.8],
  ['Lawrence.of.Arabia.1962/Lawrence.of.Arabia.1962.CD1.avi', 0.7],
  ['Lawrence.of.Arabia.1962/Lawrence.of.Arabia.1962.CD2.avi', 0.7],
  ['Home Videos/Goa Trip 2019 - Day 2.mov', 1.1],
];

const shows = [];
const ep = (show, s, e, tail = '1080p.WEB-DL.x264') =>
  `${show}.S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}.${tail}.mkv`;

for (let e = 1; e <= 7; e++) shows.push([`Breaking Bad/Season 1/${ep('Breaking.Bad', 1, e, '720p.BluRay.x264-DEMAND')}`, 1.1]);
for (let e = 1; e <= 5; e++) shows.push([`Breaking Bad/Season 2/${ep('Breaking.Bad', 2, e, '720p.BluRay.x264-DEMAND')}`, 1.1]);
for (let e = 1; e <= 6; e++) shows.push([`The Office (US)/Season 2/${ep('The.Office.US', 2, e, '720p.WEB-DL')}`, 0.45]);
for (let e = 1; e <= 9; e++) shows.push([`Severance/${ep('Severance', 1, e, '2160p.ATVP.WEB-DL.DDP5.1.HDR.H.265')}`, 6.2]);
for (let e = 1; e <= 6; e++) shows.push([`Fleabag/Season 1/0${e} - Episode ${e}.mkv`, 0.7]);
for (let e = 1; e <= 4; e++) shows.push([`Shogun.2024.S01.1080p.DSNP.WEB-DL/${ep('Shogun.2024', 1, e, '1080p.DSNP.WEB-DL.DDP5.1.H.264')}`, 2.4]);
for (let e = 1; e <= 5; e++) shows.push([`Chernobyl/${ep('Chernobyl', 1, e, '1080p.BluRay.x264')}`, 3.1]);
for (let e = 1; e <= 3; e++) shows.push([`The Bear/Season 2/${ep('The.Bear', 2, e, '1080p.HULU.WEB-DL')}`, 1.3]);

function touch(rel, gb) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p)) return;
  const fd = openSync(p, 'w');
  ftruncateSync(fd, Math.max(Math.round(gb * GB), 1 * MB));
  closeSync(fd);
}

for (const [rel, gb] of movies) touch(join('Movies', rel), gb);
for (const [rel, gb] of shows) touch(join('TV Shows', rel), gb);

console.log(`Demo library ready: ${root}`);
console.log(`  ${movies.length} movie files, ${shows.length} episode files (sparse, ~0 bytes on disk)`);
console.log('Drag that folder onto Movie Monkey.');
