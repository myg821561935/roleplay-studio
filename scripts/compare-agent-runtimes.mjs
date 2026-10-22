import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AgentService } from '../server/services/agentService.js';
import { buildProviderClient } from '../server/provider/providerRegistry.js';
import { ConfigService } from '../server/config/configService.js';
import { JsonStore } from '../server/lib/jsonStore.js';
import { inspectNarrativeQuality } from '../server/agent/narrativeQuality.js';

export async function compareRuntimes({ messages, provider, outputDir, followUps, providerClient = buildProviderClient(), assembleTurn }) {
  if (!Array.isArray(messages) || !messages.length) throw new Error('Missing assembled messages');
  if (!Array.isArray(followUps) || followUps.length > 4) throw new Error('At most four follow-up turns allowed');
  await fs.mkdir(outputDir, { recursive: false, mode: 0o700 });
  const write = (name, value) => fs.writeFile(path.join(outputDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const order = randomInt(2) ? ['pi', 'native'] : ['native', 'pi'];
  const histories = Object.fromEntries(order.map(mode => [mode, structuredClone(messages)]));
  const storyHistories = Object.fromEntries(order.map(mode => [mode, []]));
  const manifest = { scope: 'isolated-runtime-multi-turn', status: 'running', model: provider.model,
    promptHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
    contextMode: assembleTurn ? 'reassembled-every-turn' : 'fixed-starting-prompt',
    note: 'No automatic prose verdict. Same starting prompt and provider; histories diverge after turn one. No session state is committed.', runs: [] };
  await write('manifest.json', manifest);
  const blind = [];
  try {
    for (let turn = 0; turn <= followUps.length; turn++) {
      for (const mode of turn % 2 ? [...order].reverse() : order) {
        if (assembleTurn) histories[mode] = await assembleTurn({ turn, history: structuredClone(storyHistories[mode]), userMessage: turn ? followUps[turn - 1] : messages.findLast(m => m.role === 'user')?.content });
        else if (turn) histories[mode].push({ role: 'user', content: followUps[turn - 1] });
        const service = new AgentService({ agentRuntime: mode, providerClient });
        const started = Date.now(); let firstTokenMs = null, chunks = 0;
        const result = await service.completeAssistantContentStream({ provider, messages: histories[mode], signal: AbortSignal.timeout(120000),
          onToken: () => { chunks++; firstTokenMs ??= Date.now() - started; } });
        if (!result.content?.trim() || result.toolCalls?.length) throw new Error('Expected prose response');
        const id = `${order.indexOf(mode) === 0 ? 'A' : 'B'}-${turn + 1}`;
        const finishReason = result.raw?.finishReason || result.raw?.choices?.[0]?.finish_reason || 'unknown';
        const audit = inspectNarrativeQuality({ content: result.content, messages: histories[mode], userMessage: turn ? followUps[turn - 1] : '' });
        const record = { id, mode, turn: turn + 1, elapsedMs: Date.now() - started, firstTokenMs, chunks, finishReason,
          contentLength: result.content.length, usage: result.raw?.usage || null, runtime: result.runtime || { kind: 'native' } };
        await write(`${id}.private.json`, { messages: histories[mode], result, audit });
        histories[mode].push({ role: 'assistant', content: result.content });
        storyHistories[mode].push({ role: 'user', content: turn ? followUps[turn - 1] : messages.findLast(m => m.role === 'user')?.content }, { role: 'assistant', content: result.content });
        manifest.runs.push(record);
        blind.push({ id, content: result.content, eligibleForScoring: finishReason === 'stop', scores: { character: null, prose: null, consequences: null, knowledgeBoundary: null }, notes: '' });
        await write('blind.private.json', blind);
        await write('manifest.json', manifest);
      }
    }
    manifest.status = 'completed';
  } catch (error) {
    manifest.status = 'failed';
    await write('manifest.json', manifest);
    throw new Error(`Runtime comparison stopped after ${manifest.runs.length} calls`, { cause: error });
  }
  await write('manifest.json', manifest);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [requestPath, providerId, outputDir, action = '--dry-run'] = process.argv.slice(2);
    if (!requestPath || !providerId || !outputDir || !['--run', '--dry-run'].includes(action)) throw new Error('Usage: request.json PROVIDER_ID NEW_OUTPUT_DIR [--dry-run|--run]');
    const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
    const config = await new ConfigService(new JsonStore('data')).getAll();
    const provider = config.providers.providers.find(p => p.id === providerId);
    if (!provider) throw new Error('Provider not found');
    const followUps = ['先观察眼前的环境和在场人物，暂不作出决定。', '回应眼前人物刚才的话，只推进当前这场互动。'];
    if (action === '--dry-run') console.log(JSON.stringify({ calls: 6, destination: new URL(provider.baseUrl).hostname, model: provider.model, messages: request.messages?.length }));
    else console.log(JSON.stringify(await compareRuntimes({ messages: request.messages, provider, outputDir, followUps })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
