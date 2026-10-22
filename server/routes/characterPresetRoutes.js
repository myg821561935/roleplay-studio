import crypto from 'node:crypto';

import { buildEditableSessionConfig } from '../config/sessionScopedConfig.js';
import { writeJson } from '../lib/http.js';
import { ApiError, readRequestJson, validateMutatingRequest } from './http.js';

const CHARACTER_PRESET_PATH = '/api/character-presets';

export async function handleCharacterPresetRoutes({
  req,
  res,
  url,
  configService,
  sessionService
}) {
  if (req.method === 'PUT' && url.pathname === `${CHARACTER_PRESET_PATH}/apply`) {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const characterCard = body.characterCard ?? {};
    const worldBook = body.worldBook ?? [];
    const promptModules = body.promptModules ?? [];
    if (!isPlainObject(characterCard)) throw new ApiError(400, 'INVALID_CHARACTER_CARD');
    if (!Array.isArray(worldBook)) throw new ApiError(400, 'INVALID_WORLD_BOOK');
    if (!Array.isArray(promptModules)) throw new ApiError(400, 'INVALID_PROMPT_MODULES');

    const session = await getSession(sessionService, body.sessionId);
    session.config = buildEditableSessionConfig(await configService.getAll(), session);
    Object.assign(session.config, { characterCard, worldBook, promptModules });
    session.updatedAt = new Date().toISOString();
    await sessionService.saveSession(session);
    writeJson(res, 200, { characterCard, worldBook, promptModules });
    return true;
  }

  if (req.method === 'POST' && url.pathname === CHARACTER_PRESET_PATH) {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.characterPresets) ? config.characterPresets : [];
    const newPreset = {
      id: `preset-${crypto.randomUUID()}`,
      name: String(body.name || body.characterCard?.name || '未命名').trim().slice(0, 30),
      characterCard: body.characterCard || config.characterCard,
      worldBook: body.worldBook || config.worldBook,
      promptModules: body.promptModules || config.promptModules,
      createdAt: new Date().toISOString()
    };
    const updated = [...presets, newPreset];
    await configService.saveCharacterPresets(updated);
    writeJson(res, 200, { characterPresets: updated, preset: newPreset });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === CHARACTER_PRESET_PATH) {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.characterPresets) ? config.characterPresets : [];
    const updated = presets.filter((preset) => preset.id !== body.id);
    await configService.saveCharacterPresets(updated);
    writeJson(res, 200, { characterPresets: updated });
    return true;
  }

  return false;
}

async function getSession(sessionService, sessionId) {
  try {
    return await sessionService.getSession(sessionId);
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
