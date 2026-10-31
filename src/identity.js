import fs from 'node:fs';
import path from 'node:path';

// Trusted export produced by the existing Discord↔Paymenter linking bot.
// Never accept entries from customers or from the AI.
const LOCATION = path.join(process.cwd(), 'data', 'verified-accounts.json');
export function getVerifiedCustomer(discordUserId) {
  if (!/^\d{15,22}$/.test(String(discordUserId))) return null;
  let accounts;
  try { accounts = JSON.parse(fs.readFileSync(LOCATION, 'utf8')); }
  catch { return null; }
  const account = accounts[String(discordUserId)];
  if (!account || account.verified !== true || !/^[0-9]+$/.test(String(account.paymenterUserId))) return null;
  const servers = Array.isArray(account.servers) ? account.servers : [];
  return {
    paymenterUserId: String(account.paymenterUserId),
    servers: servers.filter(s => s && typeof s.name === 'string' &&
      /^[A-Za-z0-9_-]{8,64}$/.test(String(s.identifier)) &&
      /^[0-9]+$/.test(String(s.paymenterServiceId)))
      .map(s => ({ name: s.name, identifier: s.identifier, paymenterServiceId: String(s.paymenterServiceId) }))
  };
}
export function verifiedServerFor(account, id) {
  return account?.servers.find(s => s.identifier === id) || null;
}
