import test from 'node:test';
import assert from 'node:assert/strict';
import { createImmersiveMemoryLedger } from '../public/modules/immersiveMemoryLedger.js';

test('immersiveMemoryLedger renders Core Memory, foreshadowing, offscreen events, and storyGraph', () => {
  const appendedSections = [];
  const fakeDossier = {
    appendImmersiveMemoryRows: (_body, heading, rows) => {
      appendedSections.push({ heading, rows });
    },
    createImmersiveDossier: () => ({
      root: { className: 'dossier-root' },
      body: { append: () => {} }
    }),
    getImmersiveRecentTurns: () => []
  };

  const state = {
    session: {
      memory: {
        coreMemory: {
          personaView: '视李青为生死之交',
          activeCommitments: ['护送密信至京城'],
          coreDirectives: ['查明旧案真相']
        },
        worldState: {
          foreshadowing: [
            { id: 'h1', content: '井底暗红封泥下的青铜残片', status: 'open', targetEntity: '柴翁' },
            { id: 'h2', content: '神像后的血衣', status: 'resolved' }
          ],
          offscreenEvents: [
            {
              id: 'off-1',
              actor: '慕容秋荻',
              location: '翠云峰山庄',
              summary: '密谋调遣天尊杀手',
              day: 2,
              timeOfDay: '清晨'
            }
          ],
          storyGraph: {
            currentChapter: '序幕：初入江湖',
            nodes: [
              { id: 'n1', chapter: '序幕', title: '古庙避雨', status: 'completed' },
              { id: 'n2', chapter: '第一幕', title: '夜探黑风寨', status: 'active', description: '潜入黑风寨调查账册' }
            ]
          }
        }
      }
    }
  };

  const fakeBody = {
    replaceChildren: () => {}
  };

  const render = createImmersiveMemoryLedger({
    state,
    els: { immersiveSidebarBody: fakeBody },
    dossier: fakeDossier,
    resolvePrologueTemplate: () => ({ tpl: {} }),
    getCurrentStoryPresentation: () => ({ title: '测试剧本', custom: false }),
    filterCustomStoryRecords: (r) => r,
    truncateText: (t) => t,
    documentObject: {
      createElement: (tag) => ({ tag, append: () => {}, className: '' })
    }
  });

  render('叙事记忆', 'wuxia');

  // 验证渲染出了「核心认知与羁绊」
  const coreSection = appendedSections.find((s) => s.heading === '核心认知与羁绊');
  assert.ok(coreSection, 'Must render 核心认知与羁绊 section');

  // 验证渲染出了「剧情伏笔与悬念」
  const hookSection = appendedSections.find((s) => s.heading === '剧情伏笔与悬念');
  assert.ok(hookSection, 'Must render 剧情伏笔与悬念 section');

  // 验证渲染出了「八方风云动态」
  const dynamicSection = appendedSections.find((s) => s.heading === '八方风云动态');
  assert.ok(dynamicSection, 'Must render 八方风云动态 section');

  // 验证渲染出了「主线章节与剧情脉络」
  const graphSection = appendedSections.find((s) => s.heading === '主线章节与剧情脉络');
  assert.ok(graphSection, 'Must render 主线章节与剧情脉络 section');
  assert.equal(graphSection.rows.length, 2);
  assert.equal(graphSection.rows[0].title, '【序幕】古庙避雨');
  assert.equal(graphSection.rows[0].meta, '已达成');
  assert.equal(graphSection.rows[1].title, '【第一幕】夜探黑风寨');
  assert.equal(graphSection.rows[1].meta, '当前主线');
});
