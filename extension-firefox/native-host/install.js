#!/usr/bin/env node

/**
 * Install script for Playwriter Firefox Debug Bridge
 *
 * This script:
 * 1. Creates the native messaging host manifest
 * 2. Installs it to the correct location for the OS
 * 3. Makes the debug-bridge executable
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_ID = 'playwriter@anthropic.com';
const HOST_NAME = 'com.anthropic.playwriter.debug_bridge';

function getManifestPath() {
  const platform = os.platform();
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts');
    case 'linux':
      return path.join(home, '.mozilla', 'native-messaging-hosts');
    case 'win32':
      // Windows uses registry, but we'll put the manifest in AppData
      return path.join(process.env.APPDATA || home, 'Mozilla', 'NativeMessagingHosts');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function createManifest() {
  const bridgePath = path.join(__dirname, 'debug-bridge.js');

  return {
    name: HOST_NAME,
    description: 'Playwriter Firefox Debug Bridge - provides debugging capabilities via native messaging',
    path: bridgePath,
    type: 'stdio',
    allowed_extensions: [EXTENSION_ID]
  };
}

function install() {
  console.log('Installing Playwriter Firefox Debug Bridge...\n');

  // Get the manifest directory
  const manifestDir = getManifestPath();
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

  // Create directory if it doesn't exist
  if (!fs.existsSync(manifestDir)) {
    console.log(`Creating directory: ${manifestDir}`);
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  // Create and write the manifest
  const manifest = createManifest();
  console.log(`Writing manifest to: ${manifestPath}`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Make debug-bridge.js executable
  const bridgePath = path.join(__dirname, 'debug-bridge.js');
  console.log(`Making executable: ${bridgePath}`);
  fs.chmodSync(bridgePath, '755');

  console.log('\nInstallation complete!');
  console.log('\nTo use the debug bridge:');
  console.log('1. Install the Firefox extension');
  console.log('2. Launch Firefox with debugging enabled:');
  console.log('   firefox --start-debugger-server 6000');
  console.log('3. Set these preferences in about:config:');
  console.log('   devtools.debugger.remote-enabled = true');
  console.log('   devtools.chrome.enabled = true');
  console.log('   devtools.debugger.prompt-connection = false');

  // Windows-specific instructions
  if (os.platform() === 'win32') {
    console.log('\nNote for Windows:');
    console.log('You also need to add a registry entry. Run this in an admin PowerShell:');
    console.log(`  New-Item -Path "HKCU:\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" -Force`);
    console.log(`  Set-ItemProperty -Path "HKCU:\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" -Name "(Default)" -Value "${manifestPath}"`);
  }
}

function uninstall() {
  console.log('Uninstalling Playwriter Firefox Debug Bridge...\n');

  const manifestDir = getManifestPath();
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

  if (fs.existsSync(manifestPath)) {
    console.log(`Removing manifest: ${manifestPath}`);
    fs.unlinkSync(manifestPath);
    console.log('Uninstallation complete!');
  } else {
    console.log('Manifest not found, nothing to uninstall.');
  }
}

// Parse command line args
const args = process.argv.slice(2);

if (args.includes('--uninstall') || args.includes('-u')) {
  uninstall();
} else {
  install();
}
