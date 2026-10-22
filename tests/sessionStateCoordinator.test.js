import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_INSPECTOR_SECTIONS,
  createSessionStateCoordinator
} from '../public/modules/sessionState.js';

test('session replacement and fallback keep full-session semantics explicit', () => {
  const original = { id: 'one', messages: [{ id: 'm1' }], settings: { theme: 'old' } };
  const state = { session: original };
  const coordinator = createSessionStateCoordinator({ state });
  const replacement = { id: 'one', messages: [{ id: 'm2' }], settings: { theme: 'new' } };

  assert.equal(coordinator.replaceSession(replacement), replacement);
  assert.equal(state.session, replacement);

  const fallback = { id: 'one', messages: [], settings: { theme: 'fallback' } };
  assert.equal(coordinator.replaceSession(null, { fallback }), fallback);
  assert.equal(coordinator.replaceSession([], { fallback: null }), fallback);
});

test('full session replacement invalidates every inspector section exactly once', () => {
  const state = { session: { id: 'one' } };
  const coordinator = createSessionStateCoordinator({
    state,
    inspectorSections: ['memory', 'facts', 'worldbook']
  });

  coordinator.replaceSession({ id: 'one', messages: [{ id: 'm2' }] });
  assert.deepEqual(coordinator.getDirtyInspectorSections(), ['memory', 'facts', 'worldbook']);

  coordinator.replaceSession({ id: 'one', messages: [{ id: 'm3' }] });
  assert.deepEqual(coordinator.getDirtyInspectorSections(), ['memory', 'facts', 'worldbook']);
});

test('session merge is shallow and rejects stale async responses after a session switch', () => {
  const state = {
    session: {
      id: 'current',
      messages: [{ id: 'm1' }],
      settings: { theme: 'old', providerId: 'local' }
    }
  };
  const coordinator = createSessionStateCoordinator({ state });

  const staleReplacement = { id: 'previous', messages: [] };
  coordinator.replaceSession(staleReplacement, { expectedSessionId: 'previous' });
  assert.equal(state.session.id, 'current');

  coordinator.mergeSession(
    { settings: { theme: 'new' } },
    { expectedSessionId: 'previous' }
  );
  assert.deepEqual(state.session.settings, { theme: 'old', providerId: 'local' });

  const merged = coordinator.mergeSession(
    { settings: { theme: 'new' } },
    { expectedSessionId: 'current' }
  );
  assert.equal(merged.id, 'current');
  assert.deepEqual(merged.messages, [{ id: 'm1' }]);
  assert.deepEqual(merged.settings, { theme: 'new' });
});

test('dirty inspector sections deduplicate and flush in declared order', () => {
  const calls = [];
  let rendererReads = 0;
  const coordinator = createSessionStateCoordinator({
    state: {},
    inspectorSections: ['memory', 'facts', 'worldbook', 'facts'],
    getInspectorRenderers: () => {
      rendererReads += 1;
      return {
        memory: () => calls.push('memory'),
        facts: () => calls.push('facts'),
        worldbook: () => calls.push('worldbook')
      };
    }
  });

  coordinator.markInspectorDirty(['worldbook', 'unknown', 'memory', 'worldbook']);
  assert.deepEqual(coordinator.getDirtyInspectorSections(), ['memory', 'worldbook']);
  assert.deepEqual(coordinator.flushInspector(), ['memory', 'worldbook']);
  assert.deepEqual(calls, ['memory', 'worldbook']);
  assert.equal(rendererReads, 1);
  assert.deepEqual(coordinator.flushInspector(), []);
  assert.equal(rendererReads, 1);
});

test('full inspector refresh resolves lazy renderers only when rendering starts', () => {
  const calls = [];
  let ready = false;
  const coordinator = createSessionStateCoordinator({
    state: {},
    inspectorSections: ['first', 'second'],
    getInspectorRenderers: () => {
      assert.equal(ready, true);
      return {
        first: () => calls.push('first'),
        second: () => calls.push('second')
      };
    }
  });

  ready = true;
  assert.deepEqual(coordinator.renderInspector(), ['first', 'second']);
  assert.deepEqual(calls, ['first', 'second']);
});

test('renderer failure keeps the failed and remaining sections retryable', () => {
  const calls = [];
  let shouldFail = true;
  const coordinator = createSessionStateCoordinator({
    state: {},
    inspectorSections: ['first', 'second', 'third'],
    getInspectorRenderers: () => ({
      first: () => calls.push('first'),
      second: () => {
        calls.push('second');
        if (shouldFail) throw new Error('render failed');
      },
      third: () => calls.push('third')
    })
  });

  coordinator.markInspectorDirty(['first', 'second', 'third']);
  assert.throws(() => coordinator.flushInspector(), /render failed/);
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(coordinator.getDirtyInspectorSections(), ['second', 'third']);

  shouldFail = false;
  assert.deepEqual(coordinator.flushInspector(), ['second', 'third']);
  assert.deepEqual(calls, ['first', 'second', 'second', 'third']);
});

test('dirty marks raised during rendering remain queued for the next flush', () => {
  const calls = [];
  let coordinator;
  coordinator = createSessionStateCoordinator({
    state: {},
    inspectorSections: ['first', 'second'],
    getInspectorRenderers: () => ({
      first: () => {
        calls.push('first');
        coordinator.markInspectorDirty('second');
      },
      second: () => calls.push('second')
    })
  });

  coordinator.markInspectorDirty('first');
  assert.deepEqual(coordinator.flushInspector(), ['first']);
  assert.deepEqual(coordinator.getDirtyInspectorSections(), ['second']);
  assert.deepEqual(coordinator.flushInspector(), ['second']);
  assert.deepEqual(calls, ['first', 'second']);
});

test('default inspector section registry is unique and bounded', () => {
  assert.equal(new Set(SESSION_INSPECTOR_SECTIONS).size, SESSION_INSPECTOR_SECTIONS.length);
  assert.ok(SESSION_INSPECTOR_SECTIONS.length > 10);
  assert.ok(SESSION_INSPECTOR_SECTIONS.length < 30);
});
