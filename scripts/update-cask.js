#!/usr/bin/env node
// Rewrites Casks/bigtable-desktop.rb for a release.
//
//   node scripts/update-cask.js <version> <arm64.dmg> <x64.dmg>
//
// The sha256 checksums are computed from the given DMG files.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, armDmg, intelDmg] = process.argv.slice(2);
if (!version || !armDmg || !intelDmg) {
  console.error('usage: update-cask.js <version> <arm64.dmg> <x64.dmg>');
  process.exit(1);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const caskFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Casks', 'bigtable-desktop.rb');

let cask = fs.readFileSync(caskFile, 'utf8');
const replace = (pattern, value) => {
  if (!pattern.test(cask)) throw new Error(`Pattern not found in cask: ${pattern}`);
  cask = cask.replace(pattern, value);
};
replace(/version "[^"]*"/, `version "${version.replace(/^v/, '')}"`);
replace(/sha256 arm:\s+"[0-9a-f]*",\s*\n\s*intel: "[0-9a-f]*"/, `sha256 arm:   "${sha256(armDmg)}",\n         intel: "${sha256(intelDmg)}"`);
fs.writeFileSync(caskFile, cask);
console.log(`Updated ${path.relative(process.cwd(), caskFile)} to ${version}`);
