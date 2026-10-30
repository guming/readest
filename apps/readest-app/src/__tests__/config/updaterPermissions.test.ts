import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('updater shell permissions', () => {
  it('allows Lumen and legacy Readest update filenames', () => {
    const config = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
    const shell = config.permissions.find(
      (permission: { identifier?: string }) => permission.identifier === 'shell:allow-spawn',
    );
    for (const [name, extension] of [
      ['start-readest', 'exe'],
      ['chmod-appimage', 'AppImage'],
      ['launch-appimage', 'AppImage'],
    ]) {
      const command = shell.allow.find((entry: { name: string }) => entry.name === name);
      const validator = command.args.find((arg: unknown) => typeof arg === 'object').validator;
      const pattern = new RegExp(validator);
      expect(pattern.test(`/tmp/Lumen_1.0_x64.${extension}`)).toBe(true);
      expect(pattern.test(`/tmp/Readest_1.0_x64.${extension}`)).toBe(true);
      expect(pattern.test(`/tmp/Other_1.0_x64.${extension}`)).toBe(false);
    }
  });
});
