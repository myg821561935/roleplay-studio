export function resolveTieredProvider({
  session = {},
  providers = [],
  taskType = 'main',
  primaryProviderId = ''
} = {}) {
  const allProviders = Array.isArray(providers) ? providers : [];
  const preferredPrimaryId = String(primaryProviderId || session.settings?.providerId || '').trim();
  const primaryProvider = allProviders.find((p) => p.id === preferredPrimaryId) || allProviders[0] || null;

  if (taskType === 'fast') {
    const fastId = session.settings?.fastTaskProviderId;
    if (fastId) {
      const fastProvider = allProviders.find((p) => p.id === fastId);
      if (fastProvider) return { provider: fastProvider, isTiered: true };
    }
  }

  return { provider: primaryProvider, isTiered: false };
}

export async function executeFastTask({
  taskName = 'fast-task',
  messages = [],
  session = {},
  providers = [],
  providerClient = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const { provider, isTiered } = resolveTieredProvider({ session, providers, taskType: 'fast' });
  if (!provider || !providerClient?.complete) {
    return {
      status: 'skipped',
      reason: 'PROVIDER_UNAVAILABLE',
      taskName,
      isTiered: false
    };
  }

  try {
    const result = await providerClient.complete({
      provider,
      messages,
      fetchImpl
    });
    return {
      status: 'success',
      taskName,
      isTiered,
      providerId: provider.id,
      content: result?.content || '',
      usage: result?.usage || null
    };
  } catch (err) {
    return {
      status: 'failed',
      taskName,
      isTiered,
      error: String(err?.message || err)
    };
  }
}
