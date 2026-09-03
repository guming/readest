import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entitlementsPath = join(appRoot, 'src-tauri/gen/apple/Lumen_iOS/Lumen_iOS.entitlements');
const projectYmlPath = join(appRoot, 'src-tauri/gen/apple/project.yml');
const pbxprojPath = join(appRoot, 'src-tauri/gen/apple/Readest.xcodeproj/project.pbxproj');

const localDevEnv =
  'export IPHONEOS_DEPLOYMENT_TARGET=15.0 ' +
  'CC_aarch64_apple_ios=/usr/bin/clang ' +
  'CXX_aarch64_apple_ios=/usr/bin/clang++ ' +
  'CARGO_TARGET_AARCH64_APPLE_IOS_LINKER=/usr/bin/clang ' +
  'CC_aarch64_apple_ios_sim=/usr/bin/clang ' +
  'CXX_aarch64_apple_ios_sim=/usr/bin/clang++ ' +
  'CARGO_TARGET_AARCH64_APPLE_IOS_SIM_LINKER=/usr/bin/clang && ';

const xcodeScript = 'pnpm tauri ios xcode-script';
const existingLocalDevEnv =
  /export IPHONEOS_DEPLOYMENT_TARGET=15\.0\s+(?:[A-Z0-9_a-z]+=[^\s]+\s+)*&&\s*/g;

function removeEntitlementKey(key) {
  if (!existsSync(entitlementsPath)) {
    return;
  }

  spawnSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, entitlementsPath], {
    stdio: 'ignore',
  });
}

function patchFile(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  const before = readFileSync(filePath, 'utf8');
  const withoutExistingEnv = before.replace(existingLocalDevEnv, '');
  const after = withoutExistingEnv.replaceAll(xcodeScript, `${localDevEnv}${xcodeScript}`);

  if (after === before) {
    return false;
  }

  writeFileSync(filePath, after);
  return true;
}

removeEntitlementKey('com.apple.developer.associated-domains');
removeEntitlementKey('com.apple.developer.applesignin');

const patchedFiles = [projectYmlPath, pbxprojPath].filter(patchFile);

console.log('Patched iOS local dev generated files.');
console.log(`- ${entitlementsPath}`);
for (const filePath of patchedFiles) {
  console.log(`- ${filePath}`);
}
