import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('server entry delegates bounded API areas to route modules', async () => {
  const app = await readFile('server/app.js', 'utf8');
  const routeModules = [
    'chatRoutes',
    'importRoutes',
    'mcpRoutes',
    'providerRoutes',
    'referenceRepairRoutes',
    'sessionConfigMigrationRoutes',
    'resourceLibraryRoutes',
    'storyProjectRoutes'
  ];

  for (const moduleName of routeModules) {
    assert.match(app, new RegExp(`from './routes/${moduleName}\\.js'`));
  }

  assert.match(app, /handleImportRoutes\(\{/);
  assert.match(app, /handleStoryProjectRoutes\(\{/);
  assert.match(app, /handleReferenceRepairRoutes\(\{/);
  assert.match(app, /handleSessionConfigMigrationRoutes\(\{/);
  assert.doesNotMatch(app, /url\.pathname === '\/api\/import\/preview'/);
  assert.doesNotMatch(app, /url\.pathname === '\/api\/story-projects'/);
  assert.ok(app.split('\n').length < 2300, 'server/app.js should remain an orchestration entry');
});

test('route modules own their endpoint families', async () => {
  const [imports, stories, resources, repairs, configMigrations] = await Promise.all([
    readFile('server/routes/importRoutes.js', 'utf8'),
    readFile('server/routes/storyProjectRoutes.js', 'utf8'),
    readFile('server/routes/resourceLibraryRoutes.js', 'utf8'),
    readFile('server/routes/referenceRepairRoutes.js', 'utf8'),
    readFile('server/routes/sessionConfigMigrationRoutes.js', 'utf8')
  ]);

  assert.match(imports, /\/api\/import\/preview/);
  assert.match(imports, /\/api\/character-card\/import/);
  assert.match(stories, /\/api\/story-projects/);
  assert.match(resources, /\/api\/resource-library\/resources/);
  assert.match(repairs, /\/api\/reference-repairs\/orphans/);
  assert.match(configMigrations, /\/api\/session-config-migrations\/incomplete/);
});
