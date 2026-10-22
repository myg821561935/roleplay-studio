import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOM_COLLECTION_SELECTORS,
  DOM_ELEMENT_IDS,
  DOM_SINGLE_SELECTORS,
  createDomElements
} from '../public/modules/domElements.js';

test('DOM registry preserves the complete explicit element contract', () => {
  const singleQueries = [];
  const collectionQueries = [];
  const collectionRows = new Map();
  const documentObject = {
    querySelector(selector) {
      singleQueries.push(selector);
      return { selector };
    },
    querySelectorAll(selector) {
      collectionQueries.push(selector);
      const rows = new Set([{ selector, index: 0 }, { selector, index: 1 }]);
      collectionRows.set(selector, rows);
      return rows;
    }
  };

  const elements = createDomElements(documentObject);

  assert.equal(DOM_ELEMENT_IDS.length, 405);
  assert.equal(new Set(DOM_ELEMENT_IDS).size, DOM_ELEMENT_IDS.length);
  assert.equal(Object.keys(elements).length, 421);
  assert.equal(singleQueries.length, 409);
  assert.equal(collectionQueries.length, 12);
  assert.deepEqual(elements.assetCenter, { selector: '#asset-center' });
  assert.deepEqual(elements.heavyFrontendManager, { selector: '#heavy-frontend-manager' });
  assert.deepEqual(elements.heavyFrontendPlayer, { selector: '#heavy-frontend-player' });
  assert.deepEqual(elements.vectorMemoryTopK, { selector: '#vector-memory-topk' });
  assert.deepEqual(elements.sendMessageButton, { selector: '#send-message' });
  assert.deepEqual(elements.deleteContinueStory, { selector: '#delete-continue-story' });
  assert.deepEqual(elements.providerReasoningMode, { selector: '#provider-reasoning-mode' });
  assert.deepEqual(elements.providerTtsModel, { selector: '#provider-tts-model' });
  assert.deepEqual(elements.providerSttModel, { selector: '#provider-stt-model' });
  assert.deepEqual(elements.voiceDictation, { selector: '#voice-dictation' });
  assert.deepEqual(elements.sandboxAuditCount, { selector: '#sandbox-audit-count' });
  assert.deepEqual(elements.sandboxAuditPanel, { selector: '#sandbox-audit-panel' });
  assert.deepEqual(elements.sessionHealthList, { selector: '#session-health-list' });
  assert.deepEqual(elements.sessionResponseLength, { selector: '#session-response-length' });
  assert.deepEqual(elements.sessionRoleplayMode, { selector: '#session-roleplay-mode' });
  assert.deepEqual(elements.cardRuntimeEnabled, { selector: '#card-runtime-enabled' });
  assert.deepEqual(elements.exportCharacterCardV3, { selector: '#export-character-card-v3' });
  assert.deepEqual(elements.storyCustomApprovals, { selector: '#story-custom-approvals' });
  assert.deepEqual(elements.referenceRepairSummary, { selector: '#reference-repair-summary' });
  assert.deepEqual(elements.applyReferenceRepair, { selector: '#apply-reference-repair' });
  assert.deepEqual(elements.sessionConfigMigrationSummary, { selector: '#session-config-migration-summary' });
  assert.deepEqual(elements.applySessionConfigMigration, { selector: '#apply-session-config-migration' });
  assert.deepEqual(elements.promptTemplateCenter, { selector: '#prompt-template-center' });
  assert.deepEqual(elements.promptStudio, { selector: '#prompt-studio' });
  assert.deepEqual(elements.sessionPromptIntegrity, { selector: '#session-prompt-integrity' });
  assert.deepEqual(elements.workspace, { selector: '.workspace' });
  assert.equal(elements.vectorMemoryTopk, undefined);
  assert.equal(elements.sendMessage, undefined);

  Object.entries(DOM_SINGLE_SELECTORS).forEach(([key, selector]) => {
    assert.equal(elements[key].selector, selector);
  });
  Object.entries(DOM_COLLECTION_SELECTORS).forEach(([key, selector]) => {
    assert.deepEqual(elements[key], Array.from(collectionRows.get(selector)));
    assert.notEqual(elements[key], collectionRows.get(selector));
  });
});

test('DOM registry fails early when selector APIs are unavailable', () => {
  assert.throws(
    () => createDomElements({ querySelector() {} }),
    /DOM document with selector APIs/
  );
});
