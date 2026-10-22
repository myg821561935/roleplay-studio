import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { PluginRegistryService } from '../server/services/pluginRegistryService.js';

test('plugin registry exposes compatible built-in adapters', async () => {
  const service = await createService();
  const plugins = await service.listPlugins();
  const adapters = await service.listAdapters();

  assert.ok(plugins.find((item) => item.id === 'core.content-pack-v1' && item.compatible));
  assert.ok(plugins.every((item) => !item.warnings.some((warning) => warning.code === 'adapter-capability-unsupported')));
  assert.deepEqual(
    adapters.find((item) => item.id === 'character-card-v2')?.capabilities,
    ['inspect', 'normalize']
  );
  assert.ok(adapters.find((item) => item.id === 'lra-plugin-manifest-v1'));
});

test('plugin registry installs declarative adapters and blocks executable fields', async () => {
  const service = await createService();
  const manifest = createPluginManifest();
  const result = await service.installManifest(manifest);

  assert.equal(result.installStatus, 'created');
  assert.equal(result.plugin.origin, 'local');
  assert.equal(result.plugin.runtime, 'declarative');
  assert.deepEqual(result.plugin.capabilities, ['safe-macros', 'sidebar-panels']);
  assert.equal(result.plugin.capabilityCount, 2);
  assert.ok((await service.listAdapters()).find((item) => item.id === 'rain-night-lore'));

  const blocked = await service.inspectManifest({ ...manifest, id: 'community.unsafe', script: 'run-me.js' });
  assert.equal(blocked.canInstall, false);
  assert.ok(blocked.blockingIssues.find((item) => item.code === 'executable-plugin-unsupported'));

  const nestedExecutable = await service.inspectManifest({
    ...manifest,
    id: 'community.nested-unsafe',
    adapters: [{
      ...manifest.adapters[0],
      id: 'nested-unsafe-lore',
      match: {
        ...manifest.adapters[0].match,
        hooks: { onLoad: 'run-me' }
      },
      capabilities: ['inspect', 'arbitrary-javascript']
    }]
  });
  assert.equal(nestedExecutable.canInstall, false);
  assert.ok(nestedExecutable.blockingIssues.some((item) => item.path.includes('hooks')));
  assert.deepEqual(nestedExecutable.manifest.adapters[0].capabilities, ['inspect']);
  assert.ok(nestedExecutable.warnings.some((item) => item.code === 'adapter-capability-unsupported'));

  const partiallySupported = await service.inspectManifest({
    ...manifest,
    id: 'community.future-runtime',
    capabilities: ['safe-macros', 'arbitrary-javascript'],
    adapters: [{ ...manifest.adapters[0], id: 'future-runtime-lore' }]
  });
  assert.equal(partiallySupported.canInstall, true);
  assert.deepEqual(partiallySupported.manifest.capabilities, ['safe-macros']);
  assert.ok(partiallySupported.warnings.find((item) => item.code === 'plugin-capability-unsupported'));
});

test('plugin registry prevents silent downgrade and allows removal of local plugins', async () => {
  const service = await createService();
  await service.installManifest({ ...createPluginManifest(), version: '1.2.0' });
  const downgrade = await service.inspectManifest({ ...createPluginManifest(), version: '1.1.0' });

  assert.equal(downgrade.canInstall, false);
  assert.equal(downgrade.installAction, 'downgrade');
  assert.equal(await service.removePlugin('community.rain-night'), true);
  assert.equal((await service.listPlugins()).some((item) => item.id === 'community.rain-night'), false);
});

async function createService(appVersion='0.2.2') {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'plugin-registry-'));
  return new PluginRegistryService(new JsonStore(rootDir), {
    appVersion,
    now: () => new Date('2026-07-15T08:00:00.000Z')
  });
}

function createPluginManifest() {
  return {
    spec: 'lra.plugin/v1',
    id: 'community.rain-night',
    version: '1.0.0',
    name: '雨夜世界书适配',
    engine: '>=0.2.2 <2.0.0',
    capabilities: ['safe-macros', 'sidebar-panels'],
    adapters: [{
      id: 'rain-night-lore',
      label: '雨夜世界书',
      kinds: ['worldbook'],
      formats: ['json'],
      priority: 130,
      match: { previewKinds: ['world-book'], sourceIncludes: ['rain-night'] }
    }]
  };
}

test('release upgrade preserves an external plugin explicit pre-1.0 engine restriction',async()=>{
 const service=await createService('1.1.0-rc.1');
 const inspected=await service.inspectManifest({...createPluginManifest(),engine:'>=0.2.2 <1.0.0'});
 assert.equal(inspected.canInstall,false);
 assert.ok(inspected.blockingIssues.some(x=>x.code==='plugin-engine-incompatible'));
});
