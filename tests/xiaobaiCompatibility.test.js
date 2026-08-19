import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../server/agent/macroEngine.js';
import { scanCommunityDependencies } from '../server/resources/communityDependencyScanner.js';

test('macroEngine expands double-colon random and pick syntax', () => {
  const context = {
    user: '李逍遥',
    characterCard: { name: '赵灵儿' },
    promptVariables: {
      hp: 100,
      境界: '筑基初期'
    }
  };

  // random::min::max
  const randomNum = expandMacros('{{random::10::20}}', context);
  const num = Number(randomNum);
  assert.ok(num >= 10 && num <= 20, `randomNum should be in [10, 20], got ${randomNum}`);

  // random::a::b::c
  const randomChoice = expandMacros('{{random::金灵根::木灵根::水灵根}}', context);
  assert.ok(['金灵根', '木灵根', '水灵根'].includes(randomChoice), `got ${randomChoice}`);

  // pick::a::b::c
  const pickChoice = expandMacros('{{pick::青龙::白虎::朱雀::玄武}}', context);
  assert.ok(['青龙', '白虎', '朱雀', '玄武'].includes(pickChoice), `got ${pickChoice}`);
});

test('macroEngine evaluates safe math expressions (eval::)', () => {
  const context = {
    promptVariables: {
      hp: 80,
      attack: 15,
      defense: 5
    }
  };

  assert.equal(expandMacros('{{eval::10 + 5 * 2}}', context), '20');
  assert.equal(expandMacros('{{eval::(100 - 20) / 4}}', context), '20');
  assert.equal(expandMacros('{{eval::getvar(hp) - 15}}', context), '65');
  assert.equal(expandMacros('{{eval::getvar(attack) - getvar(defense)}}', context), '10');
});

test('macroEngine supports logic condition macros (if::, eq::, gt::, lt::, not::)', () => {
  assert.equal(expandMacros('{{if::true::通过::拒绝}}'), '通过');
  assert.equal(expandMacros('{{if::false::通过::拒绝}}'), '拒绝');
  assert.equal(expandMacros('{{eq::天师府::天师府}}'), 'true');
  assert.equal(expandMacros('{{eq::天师府::全真教}}'), 'false');
  assert.equal(expandMacros('{{gt::100::50}}'), 'true');
  assert.equal(expandMacros('{{gt::50::100}}'), 'false');
  assert.equal(expandMacros('{{lt::30::80}}'), 'true');
  assert.equal(expandMacros('{{not::false}}'), 'true');
  assert.equal(expandMacros('{{not::true}}'), 'false');
});

test('macroEngine resolves XiaoBai X variable tags (stat::, attr::, xiaobai_state::)', () => {
  const context = {
    promptVariables: {
      'cultivation.realm': '金丹大圆满',
      'spirit_power': 9999
    }
  };

  assert.equal(expandMacros('{{stat::cultivation.realm}}', context), '金丹大圆满');
  assert.equal(expandMacros('{{attr::spirit_power}}', context), '9999');
  assert.equal(expandMacros('{{getvar::cultivation.realm}}', context), '金丹大圆满');
});

test('communityDependencyScanner maps XiaoBai X and Tavern-Helper presets to safe degradation instead of hard blocking', () => {
  const presetPayload = {
    name: '日月r_y_ v999_三界修仙',
    sourceFormat: 'tavern-preset',
    promptLayout: [
      { name: 'System Core', content: '{{original}}\n你是一个修仙世界向导。' },
      { name: '🐟 语音 · 实时配小白X', content: '<voice tag="active" />\n{{setvar::mood::calm}}' },
      { name: 'Cultivation Status', content: '当前境界：{{getvar::cultivation.realm}}' }
    ]
  };

  const report = scanCommunityDependencies(presetPayload);
  assert.equal(report.readyToPlay, true, 'preset should be readyToPlay');
  assert.notEqual(report.acceptance?.outcome, 'blocked', 'outcome should not be blocked');
  assert.ok(
    report.acceptance?.outcome === 'safe-degradation' || report.acceptance?.outcome === 'full-mapping',
    `expected safe-degradation or full-mapping, got ${report.acceptance?.outcome}`
  );
  assert.equal(report.counts?.missing, 0, 'missing count should be 0');
});

test('communityDependencyScanner still isolates unsafe executable scripts', () => {
  const maliciousCard = {
    name: '危险脚本卡',
    description: '含有恶意外部执行脚本',
    custom_scripts: {
      scriptcode: '<script>window.location.href="http://evil.com";</script>'
    }
  };

  const report = scanCommunityDependencies(maliciousCard);
  assert.equal(report.readyToPlay, false, 'malicious card should not be directly runnable');
  assert.equal(report.acceptance?.outcome, 'blocked');
});
