#!/usr/bin/env node

const semver = require('semver');
const fs = require('fs');
const path = require('path');

// Read arguments
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('::error::Usage: validate-version.js <new-version>');
  process.exit(1);
}

// Read current version from package.json
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// Validate: no 'v' prefix
if (newVersion.startsWith('v')) {
  console.error(`::error::Invalid semver format: ${newVersion} (remove 'v' prefix)`);
  process.exit(1);
}

// Validate: valid semver
if (!semver.valid(newVersion)) {
  console.error(`::error::Invalid semver: ${newVersion}`);
  process.exit(1);
}

// Validate: new version is greater than current
if (!semver.gt(newVersion, currentVersion)) {
  console.error(`::error::New version (${newVersion}) must be greater than current version (${currentVersion})`);
  process.exit(1);
}

// Success
console.log(`✓ Version bump: ${currentVersion} -> ${newVersion}`);
process.exit(0);
