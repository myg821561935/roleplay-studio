export const DOM_ELEMENT_IDS = Object.freeze(`
  asset-center open-asset-center heavy-frontend-manager heavy-frontend-player story-launcher open-story-launcher close-story-launcher story-continue-panel
  story-continue-title story-continue-meta continue-last-story delete-continue-story story-project-count story-project-list view-all-stories-btn view-all-stories-label story-pack-search
  story-category-filter story-pack-grid open-story-custom-dialog story-custom-dialog story-edit-dialog story-edit-form
  story-edit-dialog-title story-edit-title story-edit-description story-edit-status close-story-edit-dialog cancel-story-edit
  story-custom-steps close-story-custom-dialog cancel-story-custom-dialog story-import-base story-import-trigger story-import-file
  story-custom-library-summary story-custom-title story-custom-character story-custom-character-background-option story-custom-character-background story-custom-character-background-preview
  story-custom-worldbook-mode story-custom-baseline-fields story-custom-baseline-template story-custom-world-name story-custom-genre story-custom-visual-pack
  story-custom-premise story-custom-prose-style story-custom-hard-rules story-custom-worldbook-list story-custom-prompt-list story-custom-stack-preview
  story-custom-readiness-badge story-custom-token-estimate story-custom-checklist story-custom-conflicts story-custom-approvals story-custom-guidance story-custom-create
  story-custom-prev story-custom-next story-custom-status story-launcher-status open-advanced-session session-select
  open-new-session export-session import-session import-session-file delete-session new-session-dialog new-session-form new-session-cancel
  new-session-pack new-session-character new-session-worldbook app-status provider-preset provider-form
  provider-kind provider-id provider-base-url provider-api-key provider-model provider-model-custom provider-tts-model provider-stt-model
  provider-model-custom-row provider-temperature provider-max-tokens provider-reasoning-mode provider-headers test-provider save-provider
  provider-status provider-test-result release-version create-backup backup-select download-backup
  restore-backup backup-status task-provider-chat task-provider-fact task-provider-summary fallback-chain-input
  save-provider-routing vector-memory-enabled vector-memory-provider vector-memory-topk save-vector-memory rebuild-vector-index
  vector-stats-text vector-search-input vector-search-test vector-search-results image-gen-prompt image-gen-size
  generate-image insert-image-to-background image-gen-result mcp-servers-list mcp-edit-id mcp-edit-name
  mcp-edit-command mcp-edit-args mcp-edit-enabled mcp-save-server mcp-clear-form mcp-tools-list
  mcp-call-server-id mcp-call-tool-name mcp-call-args mcp-call-execute mcp-call-result tts-provider
  tts-voice tts-format tts-text tts-speak tts-result stt-provider
  stt-language stt-audio-input stt-record stt-stop-record stt-transcribe stt-result
  messages chat-form chat-input send-message stop-generation voice-dictation composer-status
  rewrite-chat-input continue-message toggle-author-note author-note-panel author-note-input toggle-background
  background-panel background-presets background-url-input apply-background-url clear-background background-mode
  background-status session-provider session-roleplay-mode session-response-length session-prompt-execution-mode session-prompt-budget session-prompt-integrity enhancement-memory-recall enhancement-npc-simulation enhancement-plot-guidance enhancement-action-suggestions card-runtime-enabled persona-enabled persona-name persona-description persona-background
  persona-personality save-persona persona-status quick-replies-bar quick-replies-editor add-quick-reply
  save-quick-replies quick-replies-status save-session-settings session-settings-status refresh-state memory-overview
  memory-view session-health-summary session-health-list session-health-status refresh-session-health reference-repair-summary preview-reference-repair apply-reference-repair session-config-migration-summary preview-session-config-migration apply-session-config-migration rule-status-view simulation-clock-label simulation-view-switch simulation-metrics simulation-status
  simulation-actor-count simulation-actors simulation-event-count simulation-events simulation-actors-editor simulation-actors-status
  save-simulation-actors exit-immersive-mode inspector-panel-title inspector-tab-select toggle-inspector-panel toggle-provider-panel
  open-provider-panel open-inspector-panel usage-view usage-scope refresh-usage usage-status
  fact-list fact-status add-fact save-facts worldbook-editor save-worldbook
  add-worldbook-entry worldbook-entries-list worldbook-search worldbook-type-filter worldbook-browser-count worldbook-trigger-input
  worldbook-trigger-test worldbook-trigger-clear worldbook-trigger-result export-worldbook import-worldbook worldbook-import-file
  macro-templates-list add-macro-template save-macro-templates macro-templates-status macro-test-input macro-test-run
  macro-test-clear macro-test-result worldbook-status content-pack-select apply-content-pack content-pack-status
  timeline-refresh timeline-branch-list timeline-compare-result
  content-stack-status content-stack-items character-overview character-card-editor character-card-import import-review-dialog
  import-review-kicker import-review-title close-import-review import-preview confirm-import cancel-import
  import-apply-current import-apply-option source-select source-kind source-query source-search
  source-status source-results refresh-resource-library resource-adapter-summary resource-count-all resource-count-character
  resource-count-worldbook resource-count-pack resource-kind-filter resource-query resource-library-status resource-library-list
  resource-pack-form resource-pack-title resource-pack-base resource-pack-character resource-pack-description resource-pack-include-base
  resource-pack-worldbooks resource-pack-prompts resource-pack-status resource-pack-list plugin-manifest-import plugin-summary
  plugin-list adapter-count adapter-list save-character-card export-character-card export-character-card-v3 character-preset-favorites
  load-character-preset save-character-preset delete-character-preset prompt-preset-favorites apply-saved-prompt-preset save-prompt-preset
  delete-prompt-preset prompt-template-center prompt-template-summary prompt-template-grid prompt-template-detail prompt-template-detail-title
  prompt-template-detail-description prompt-template-reasons prompt-template-parameters prompt-template-apply-mode prompt-template-preview
  prompt-studio prompt-studio-summary prompt-studio-refresh prompt-studio-show-request prompt-studio-integrity prompt-studio-modules prompt-studio-blocks prompt-studio-request prompt-studio-status prompt-studio-changes prompt-studio-export-comparison
  preview-prompt-template apply-prompt-template prompt-template-status group-members-list add-group-member save-group-members group-members-status group-speaker-strategy target-speaker-btn
  reset-character-card random-protagonist-genre random-protagonist character-card-status prompt-editor prompt-preset-select
  apply-prompt-preset worldbook-preset-select apply-worldbook-preset character-preset-select apply-character-preset save-prompt
  prompt-status session-status theme-select immersive-right-sidebar immersive-sidebar-content immersive-sidebar-close
  immersive-sidebar-title immersive-sidebar-body immersive-sidebar-tabs authoring-agent-profile authoring-scene-title authoring-scene-objective
  authoring-scene-pov authoring-scene-location authoring-scene-time authoring-scene-tone authoring-must-reveal authoring-must-hide
  authoring-forbidden authoring-ending-hook authoring-promises authoring-decisions add-authoring-promise add-authoring-decision
  save-authoring authoring-status authoring-summary sandbox-audit-panel sandbox-audit-list sandbox-audit-empty sandbox-audit-count
  display-prefs-panel custom-css-input reset-custom-css display-prefs-status
  chat-width-scale chat-width-value font-scale font-scale-value
  blur-disabled-toggle text-shadow-disabled-toggle
  hide-timestamps-toggle hide-token-count-toggle chat-style-select
`.trim().split(/\s+/));

const ID_KEY_OVERRIDES = Object.freeze({
  'vector-memory-topk': 'vectorMemoryTopK',
  'send-message': 'sendMessageButton'
});

export const DOM_SINGLE_SELECTORS = Object.freeze({
  workspace: '.workspace',
  inspectorPanel: '.inspector-panel',
  providerPanel: '.provider-panel',
  stageActions: '.stage-actions'
});

export const DOM_COLLECTION_SELECTORS = Object.freeze({
  storyViewButtons: '[data-story-view]',
  storyCustomStepButtons: '[data-story-custom-step]',
  storyCustomStepPanels: '[data-story-custom-panel]',
  workModeButtons: '#work-mode-switch .work-mode-button[data-work-mode]',
  narrativeModeButtons: '#narrative-mode-switch .narrative-mode-button[data-narrative-mode]',
  simulationAdvanceButtons: '[data-simulation-advance]',
  mobileNavButtons: '[data-mobile-view]',
  resourceViewButtons: '[data-resource-view]',
  resourceViews: '[data-resource-pane]',
  resourceFlowSteps: '[data-resource-flow-step]',
  tabButtons: '[data-tab]',
  tabPanes: '[data-pane]'
});

function elementKeyFromId(id) {
  return ID_KEY_OVERRIDES[id]
    || id.replace(/-([a-z0-9])/g, (_match, character) => character.toUpperCase());
}

export function createDomElements(documentObject = globalThis.document) {
  if (
    !documentObject
    || typeof documentObject.querySelector !== 'function'
    || typeof documentObject.querySelectorAll !== 'function'
  ) {
    throw new TypeError('A DOM document with selector APIs is required');
  }

  const elements = Object.fromEntries(
    DOM_ELEMENT_IDS.map((id) => [
      elementKeyFromId(id),
      documentObject.querySelector(`#${id}`)
    ])
  );

  Object.entries(DOM_SINGLE_SELECTORS).forEach(([key, selector]) => {
    elements[key] = documentObject.querySelector(selector);
  });
  Object.entries(DOM_COLLECTION_SELECTORS).forEach(([key, selector]) => {
    elements[key] = Array.from(documentObject.querySelectorAll(selector));
  });

  return elements;
}
