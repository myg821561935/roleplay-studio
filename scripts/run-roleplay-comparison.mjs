import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { buildOpenAICompatibleRequest, readOpenAICompatibleResponse } from '../server/provider/openaiCompatible.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function planComparison(bundle, provider, repeats = 3) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('repeats must be 1–10');
  if (provider.kind && provider.kind !== 'openai-compatible') throw new Error('Only OpenAI-compatible providers supported');
  const variants = [...(bundle.variants || [])];
  if (bundle.reference?.messages) variants.push({ mode: 'SillyTavern', status: 'ready', messages: bundle.reference.messages });
  if (variants.length < 2 || new Set(variants.map(v => v.mode)).size !== variants.length) throw new Error('Need at least two uniquely named variants');
  const requests = variants.map(variant => {
    if (variant.status !== 'ready' || !Array.isArray(variant.messages) || !variant.messages.length) throw new Error(`Variant unavailable: ${variant.mode}`);
    if (variant.messages.some(m => !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) throw new Error('Only text conversation messages supported');
    const request = buildOpenAICompatibleRequest({ provider, messages: variant.messages });
    return { mode: variant.mode, request, body: JSON.parse(request.init.body) };
  });
  const parameters = ({ messages, ...rest }) => rest;
  const first = hash(parameters(requests[0].body));
  if (requests.some(r => hash(parameters(r.body)) !== first)) throw new Error('Actual sampling parameters differ across variants; set explicit reasoning mode');
  return { requests, repeats, parameters: parameters(requests[0].body), hasTavernReference: Boolean(bundle.reference?.messages) };
}

export async function runComparison({ bundle, provider, repeats = 3, outputDir, fetchImpl = fetch, timeoutMs = 120000 }) {
  const plan = planComparison(bundle, provider, repeats);
  // A fresh directory prevents accidental overwrites and mixing separate experiments.
  await fs.mkdir(outputDir, { recursive: false, mode: 0o700 });
  const write = (name, value) => fs.writeFile(path.join(outputDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const manifest = { version: 1, scope: 'fixed-history-single-turn', status: 'running', sourceHash: hash(bundle),
    parameters: plan.parameters, hasTavernReference: plan.hasTavernReference, completed: 0, truncatedOutputs: 0,
    note: 'Blind outputs may reveal their style. No automated quality verdict; multi-turn experience is outside this test.' };
  await write('manifest.json', manifest);
  const jobs = Array.from({ length: repeats }, (_, repetition) => plan.requests.map(r => ({ ...r, repetition: repetition + 1 }))).flat();
  for (let i = jobs.length - 1; i > 0; i--) { const j = randomInt(i + 1); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
  const blind = [], key = [];
  try {
    for (const job of jobs) {
      const id = randomUUID();
      const started = Date.now();
      const response = await fetchImpl(job.request.url, { ...job.request.init, signal: AbortSignal.timeout(timeoutMs) });
      const result = await readOpenAICompatibleResponse(response);
      if (!result.content?.trim() || result.toolCalls?.length) throw new Error('Text-only evaluation requires nonempty prose without tool calls');
      await write(`${id}.private.json`, { mode: job.mode, repetition: job.repetition, request: job.body, raw: result.raw, elapsedMs: Date.now() - started });
      const finishReason = result.raw?.choices?.[0]?.finish_reason || 'unknown';
      const truncated = finishReason === 'length';
      if (truncated) manifest.truncatedOutputs++;
      blind.push({ id, content: result.content, finishReason, eligibleForScoring: finishReason === 'stop', scores: { character: null, prose: null, consequences: null, nonRepetition: null, playerControl: null }, notes: truncated ? '输出达到 token 上限，不能作为完整回复评分。' : '' });
      key.push({ id, mode: job.mode, repetition: job.repetition });
      manifest.completed++;
      await write('blind.json', blind); await write('key.private.json', key); await write('manifest.json', manifest);
    }
    manifest.status = 'completed';
  } catch (error) {
    // Provider errors can echo request data. Keep them out of public summaries.
    manifest.status = 'failed';
    await write('manifest.json', manifest);
    throw new Error(`Comparison stopped after ${manifest.completed} outputs; completed artifacts retained`, { cause: error });
  }
  await write('manifest.json', manifest);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [bundlePath, outputDir, action = '--dry-run'] = process.argv.slice(2);
    if (!bundlePath || !outputDir || !['--dry-run', '--run'].includes(action)) throw new Error('Usage: node scripts/run-roleplay-comparison.mjs bundle.json NEW_OUTPUT_DIR [--dry-run|--run]');
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    const provider = { ...bundle.conditions?.provider, kind: 'openai-compatible', baseUrl: process.env.ROLEPLAY_COMPARE_BASE_URL,
      apiKey: process.env.ROLEPLAY_COMPARE_API_KEY || (action === '--dry-run' ? 'dry-run-only' : ''), model: process.env.ROLEPLAY_COMPARE_MODEL || bundle.conditions?.provider?.model };
    const repeats = Number(process.env.ROLEPLAY_COMPARE_REPEATS || 3);
    if (action === '--dry-run') {
      const plan = planComparison(bundle, provider, repeats);
      console.log(JSON.stringify({ status: 'not-run', calls: plan.requests.length * repeats, parameters: plan.parameters, hasTavernReference: plan.hasTavernReference }, null, 2));
    } else console.log(JSON.stringify(await runComparison({ bundle, provider, repeats, outputDir: path.resolve(outputDir) })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
