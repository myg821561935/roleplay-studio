import { exportCharacterCardPng, exportCharacterCardToV3 } from '../character/characterCardExport.js';
import { importCharacterCardFromPayload } from '../character/characterCardImport.js';
import { writeJson } from '../lib/http.js';
import { listImportSources } from '../services/importSourceService.js';
import {
  ApiError,
  readRequestBuffer,
  readRequestJson,
  validateBinaryMutatingRequest,
  validateMutatingRequest
} from './http.js';

export async function handleImportRoutes({
  req,
  res,
  url,
  assetService,
  configService,
  sessionService,
  resourceLibraryService,
  importSourceService,
  importUploadService,
  operations
}) {
  const {
    commitImport,
    previewImport,
    saveImportedCharacterPortrait
  } = operations;

  if (req.method === 'GET' && url.pathname === '/api/import-sources') {
    writeJson(res, 200, { sources: listImportSources() });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/import-sources/search') {
    const result = await importSourceService.search({
      source: url.searchParams.get('source') || 'chub',
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
      kind: url.searchParams.get('kind') || 'characters',
      limit: url.searchParams.get('limit') || undefined
    });
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/preview') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const preview = previewImport(body.payload ?? body);
    preview.inspection = await resourceLibraryService.inspectPreview(preview, body.source || {});
    writeJson(res, 200, { preview });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/upload') {
    validateBinaryMutatingRequest(req);
    const bytes = await readRequestBuffer(req);
    if (!bytes.length) throw new ApiError(400, 'IMPORT_UPLOAD_EMPTY');
    const fileName = url.searchParams.get('fileName') || 'import.bin';
    const mimeType = url.searchParams.get('mimeType') || req.headers?.['content-type'] || 'application/octet-stream';
    const source = { site: 'local-file', fileName };
    const upload = importUploadService.stage({ fileName, mimeType, bytes, source });
    try {
      const staged = importUploadService.get(upload.uploadId);
      const preview = previewImport(staged.payload);
      preview.inspection = await resourceLibraryService.inspectPreview(preview, source);
      writeJson(res, 200, {
        upload,
        preview: summarizePreviewForClient(preview)
      });
    } catch (error) {
      importUploadService.remove(upload.uploadId);
      throw error;
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/commit') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const uploadId = String(body.payload?.uploadId || body.uploadId || '');
    const staged = uploadId ? importUploadService.get(uploadId) : null;
    if (uploadId && !staged) throw new ApiError(410, 'IMPORT_UPLOAD_EXPIRED');
    const resolvedBody = staged
      ? {
        ...body,
        payload: staged.payload,
        source: { ...staged.source, ...(body.source || {}) }
      }
      : body;
    const result = await commitImport({
      assetService,
      configService,
      sessionService,
      resourceLibraryService,
      body: resolvedBody
    });
    if (uploadId) importUploadService.remove(uploadId);
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import-sources/download') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await importSourceService.download(body);
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/character-card/import') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const imported = importCharacterCardFromPayload(body);
    const portrait = await saveImportedCharacterPortrait(assetService, body);
    if (portrait) imported.characterCard.portrait = portrait;
    const characterCard = await assetService.saveCharacter(imported.characterCard);
    let worldBook = [];
    if (imported.worldBook?.length) {
      const wbAsset = await assetService.saveWorldBook(
        null,
        `${characterCard.name}的设定集`,
        imported.worldBook
      );
      worldBook = wbAsset.entries;
    }
    writeJson(res, 200, { characterCard, worldBook });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/character-card/export') {
    const exportSource = await resolveCharacterExportSource({ url, configService, sessionService });
    const { characterCard, worldBook, coreMemory, foreshadowing } = exportSource;
    const basePortrait = await assetService.readCharacterPortrait(characterCard?.portrait?.assetId);
    const png = exportCharacterCardPng(characterCard, worldBook, basePortrait, { coreMemory, foreshadowing });
    const filename = `${encodeURIComponent(characterCard?.name || 'character')}.png`;
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': png.length
    });
    res.end(png);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/character-card/export-v3') {
    const { characterCard, worldBook, coreMemory, foreshadowing } = await resolveCharacterExportSource({
      url,
      configService,
      sessionService
    });
    writeJson(res, 200, {
      characterCard: exportCharacterCardToV3(characterCard, { worldBook, coreMemory, foreshadowing })
    });
    return true;
  }

  return false;
}

async function resolveCharacterExportSource({ url, configService, sessionService }) {
  const config = await configService.getAll();
  const sessionId = String(url.searchParams.get('sessionId') || '').trim();
  if (!sessionId) {
    return {
      characterCard: config.characterCard || {},
      worldBook: Array.isArray(config.worldBook) ? config.worldBook : [],
      coreMemory: null,
      foreshadowing: []
    };
  }

  const session = await sessionService.getSession(sessionId);
  const sessionConfig = session?.config && typeof session.config === 'object' ? session.config : {};
  const memory = session?.memory && typeof session.memory === 'object' ? session.memory : {};
  return {
    characterCard: sessionConfig.characterCard || config.characterCard || {},
    worldBook: Array.isArray(sessionConfig.worldBook) ? sessionConfig.worldBook : (config.worldBook || []),
    coreMemory: memory.episodicMemory?.coreMemory || memory.coreMemory || null,
    foreshadowing: Array.isArray(memory.worldState?.foreshadowing)
      ? memory.worldState.foreshadowing
      : (Array.isArray(memory.foreshadowing) ? memory.foreshadowing : [])
  };
}

function summarizePreviewForClient(preview = {}) {
  const { importData: _importData, ...clientPreview } = preview;
  return clientPreview;
}
