import { getVerifiedCustomer, verifiedServerFor } from './identity-live.js';
import { formatServerList, normalizeServerChoice, mayExecute } from './action-policy.js';

// Natural language power requests must be confirmed by the customer,
// and verified against the account-link export before execution.
const sessions = new Map();
const verbs = [
  { action: 'power_restart', signal: 'restart', expression: /\b(restart|reboot|starta om|omstart)\b/i },
  { action: 'power_stop', signal: 'stop', expression: /\b(stop|shut down|stäng av|stäng ner)\b/i },
  { action: 'power_start', signal: 'start', expression: /\b(start|boot|starta|slå på)\b/i }
];
export function recognizePower(text) {
  const s = String(text || '');
  const matching = verbs.filter(v => v.expression.test(s));
  return matching.length === 1 ? matching[0] : null;
}
export async function beginPowerConversation(discordId, input, sessionKey = discordId) {
  const request = recognizePower(input);
  if (!request) return null;
  const account = await getVerifiedCustomer(discordId);
  if (!account) return { type:'unlinked', message:'Please connect your Discord account to billing using **/account link** first. I cannot manage servers until your account ownership is verified.' };
  if (!account.servers.length) return {type:'empty', message:'Your linked billing account has no verified Pterodactyl servers.'};
  const matches = account.servers.filter(s => [s.identifier,s.name].some(v => input.toLowerCase().includes(v.toLowerCase())));
  const exact = matches.length === 1 ? matches[0] : account.servers.length === 1 ? account.servers[0] : null;
  sessions.set(sessionKey, { request, servers:account.servers, selected:exact?.identifier || null, expires:Date.now()+5*60*1000 });
  if (!exact) return {type:'select',message:'Which server do you mean? Reply with its ID or full name:\n'+formatServerList(account.servers)};
  return {type:'confirm',server:exact,request,message:'Please confirm: **'+request.signal+'** server **'+exact.name+'** (ID: '+exact.identifier+'). No change has been made yet.'};
}
export function selectServer(sessionKey,input) {
  const state = sessions.get(sessionKey);
  if (!state) return null;
  if (state.expires < Date.now()) { sessions.delete(sessionKey); return {type:'expired',message:'The request expired. Please start again.'}; }
  if (state.selected) return null;
  const server = normalizeServerChoice(input,state.servers);
  if (!server) return {type:'select',message:'Please choose an exact server name or ID:\n'+formatServerList(state.servers)};
  state.selected=server.identifier;
  return {type:'confirm',server,request:state.request,message:'Please confirm: **'+state.request.signal+'** server **'+server.name+'** (ID: '+server.identifier+').'};
}
export async function getPending(discordId,sessionKey = discordId) {
  const state=sessions.get(sessionKey);
  if (!state || state.expires<Date.now() || !state.selected) return null;
  const server=await verifiedServerFor(discordId,state.selected);
  return server ? {server,action:state.request.action,signal:state.request.signal} : null;
}
export function finish(sessionKey) { sessions.delete(sessionKey); }
export async function allowPower(discordId, action) {
  const pending=await getPending(discordId);
  return pending && pending.action===action &&
    mayExecute(action,{verified:true,customerConfirmed:true});
}
