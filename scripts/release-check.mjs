import { execFile } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BackupService } from '../server/services/backupService.js';
import { migrateData } from '../server/data/migrations.js';
import {
  APP_VERSION,
  DATA_SCHEMA_VERSION,
  MIN_NODE_VERSION
} from '../server/releaseInfo.js';
import {
  assert,
  assertCleanReleaseWorkspace,
  assertMinimumVersion,
  assertRequiredFilesTracked,
  parseTrackedFiles
} from './release-check-core.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const requiredFiles = [
  'README.md',
  'package-lock.json',
  'SECURITY.md',
  '.github/workflows/ci.yml',
  'docs/release-v1.1.0-rc.2.md',
  'docs/release-v1.1.0-rc.2-scope.md',
  'server/agent/agreementGuard.js',
  'server/simulation/itemReferences.js',
  'server/simulation/actorReferences.js',
  'server/simulation/commitmentAvailability.js',
  'tests/rc2StateConsistency.test.js',
  'server/simulation/groundedLedger.js',
  'tests/agreementGuard.test.js',
  'tests/itemReferences.test.js',
  'tests/groundedLedger.test.js',
  'package.json',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'public/modules/customStoryBuilder.js',
  'public/modules/customStoryCompatibilityReview.js',
  'public/modules/heavyFrontendRuntime.js',
  'public/modules/memoryInspector.js',
  'public/modules/relationshipGraph.js',
  'public/modules/worldBookTagMapping.js',
  'server/index.js',
  'server/app.js',
  'server/releaseInfo.js',
  'server/agent/worldBookActivator.js',
  'server/agent/worldBookContext.js',
  'server/character/worldBookTagRegistry.js',
  'server/compat/compatibilityPolicy.js',
  'server/compat/declarativeLifecycle.js',
  'server/compat/lifecyclePolicy.js',
  'server/compat/lightFrontendRuntime.js',
  'server/compat/mvuProtocol.js',
  'server/content/contentPackManifest.js',
  'server/data/migrations.js',
  'server/heavyFrontend/heavyFrontendRuntimeService.js',
  'server/knowledgeGraph/knowledgeGraphService.js',
  'server/memory/memoryService.js',
  'server/plugins/pluginManifest.js',
  'server/resources/communityDependencyScanner.js',
  'server/resources/resourceAdapters.js',
  'server/resources/resourceEvaluator.js',
  'server/services/backupService.js',
  'server/services/pluginRegistryService.js',
  'server/services/resourceLibraryService.js',
  'server/services/worldSimulationService.js',
  'server/simulation/actionProtocol.js',
  'server/simulation/eventLedger.js',
  'server/simulation/npcSimulation.js',
  'server/simulation/worldStateArbiter.js',
  'scripts/audit-local-community-samples.mjs',
  'scripts/check-public-repository.mjs',
  'scripts/release-check-core.mjs',
  'scripts/release-check.mjs',
  'scripts/start-local.sh',
  'scripts/stop-local.sh',
  'start-local.command',
  'stop-local.command',
  'docs/action-protocol-v1.md',
  'docs/content-pack-spec-v1.md',
  'docs/heavy-frontend-runtime-v1.md',
  'docs/knowledge-graph-v1.md',
  'docs/light-frontend-runtime-v1.md',
  'docs/memory-system-v1.md',
  'docs/plugin-manifest-spec-v1.md',
  'docs/project-context.md',
  'docs/release-v0.2.md',
  'docs/release-v0.2.1.md',
  'docs/release-v0.2.2.md',
  'docs/release-v0.4.md',
  'docs/release-v0.4.1-rc.1.md',
  'docs/release-v0.5.0-rc.1.md',
  'docs/release-v0.5.0.md',
  'docs/release-v0.6.0-rc.1-scope.md',
  'docs/release-v0.6.0-rc.1.md',
  'docs/repository-content-policy.md',
  'docs/tavern-compatibility-contract-v2.md',
  'docs/tavern-compatibility-policy-v1.md',
  'tests/fixtures/compatibility/README.md',
  'tests/fixtures/compatibility/golden-matrix-v2.json',
  'tests/releaseCheck.test.js',
  'tests/tavernCompatibility.test.js'
];

assertMinimumVersion(process.versions.node, MIN_NODE_VERSION);
assert(packageJson.version === APP_VERSION, `package version ${packageJson.version} does not match ${APP_VERSION}`);
assert(packageJson.engines?.node === '>=22.13', 'package engines.node must be >=22.13');
assert(packageJson.scripts?.start === 'zsh scripts/start-local.sh', 'npm start must use the managed start script');
assert(packageJson.scripts?.stop === 'zsh scripts/stop-local.sh', 'npm stop must use the managed stop script');
assert(packageJson.scripts?.restart === 'zsh scripts/stop-local.sh && zsh scripts/start-local.sh', 'npm restart must use the managed lifecycle scripts');
for (const relativePath of requiredFiles) await access(path.join(rootDir, relativePath));

for (const relativePath of [
  'scripts/start-local.sh',
  'scripts/stop-local.sh',
  'start-local.command',
  'stop-local.command'
]) {
  const info = await stat(path.join(rootDir, relativePath));
  assert((info.mode & 0o111) !== 0, `${relativePath} is not executable`);
}

const gitOptions = { cwd: rootDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 };
const [{ stdout: trackedOutput }, { stdout: statusOutput }] = await Promise.all([
  execFileAsync('git', ['ls-files', '-z'], gitOptions),
  execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], gitOptions)
]);
assertRequiredFilesTracked(requiredFiles, parseTrackedFiles(trackedOutput));
assertCleanReleaseWorkspace(statusOutput);

const migration = await migrateData({ rootDir });
assert(migration.currentVersion === DATA_SCHEMA_VERSION, `data schema is ${migration.currentVersion}`);
const backupState = await new BackupService({ rootDir }).listBackups();

console.log(`v${APP_VERSION} 发布候选签发检查通过`);
console.log(`Node.js ${process.versions.node}`);
console.log(`数据版本 v${migration.currentVersion}`);
console.log(`有效备份 ${backupState.backups.length}，无效备份 ${backupState.invalidCount}`);
