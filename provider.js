// PROVIDER=azure for real streaming; default is a mock so the app runs locally.
const crypto = require('crypto');
class MockProvider {
  async start() { return { remoteId: crypto.randomUUID(), streamUrl: null, note: 'mock' }; }
  async stop() { return true; }
}
const provider = process.env.PROVIDER === 'azure'
  ? new (require('./provider-azure').AzureProvider)() : new MockProvider();
module.exports = { provider };
