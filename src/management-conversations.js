import { matchServer, matchFromRequest } from './server-matcher.js';
import { getVerifiedCustomer } from './identity-live.js';
import { formatServerList, normalizeServerChoice } from './action-policy.js';
const sessions=new Map();
export function requestKey(m) {return m.guildId+':'+m.channelId+':'+m.author.id;}
export function parseManagement(text) {
  const s=String(text||'').trim();
  const email=s.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
  if(email && /\b(add|invite|give access|lägg till|bjud in)\b/i.test(s))
    return {action:'add_subuser',values:{email}};
  if(email && /\b(remove|delete|revoke|ta bort|radera)\b/i.test(s))
    return {action:'remove_subuser',values:{email}};
  if(/\b(create|make|take|skapa|ta)\b/i.test(s)&&/\b(backup|säkerhetskopia)\b/i.test(s))
    return {action:'create_backup',values:{}};
  const scheduleChange=s.match(/(?:delete|remove|ta bort|radera|enable|disable|aktivera|inaktivera)\s+(?:schedule|schema|schemat|scheduled task)\s*(?:#|id\s*)?(\d+)/i);
  if(scheduleChange) {
    const del=/(?:delete|remove|ta bort|radera)/i.test(scheduleChange[0]);
    return {action:del?'delete_schedule':'toggle_schedule',values:{scheduleId:scheduleChange[1]}};
  }
  const restoration=s.match(/(?:restore|återställ)\s+(?:backup\s+)?([a-f0-9-]{36})/i);
  if(restoration)return {action:'restore_backup',values:{uuid:restoration[1]}};
  if(/\b(startup|startkommando|startscript|startup script)\b/i.test(s)) {
    if(/\b(bash)\b/i.test(s))return {action:'startup_bash',values:{}};
    if(/\b(default|standard|reset|återställ)\b/i.test(s))return {action:'startup_default',values:{}};
    const custom=s.match(/(?:to|till)\s+\`([^\`]{1,800})\`/i);
    if(custom)return {action:'startup_custom',values:{command:custom[1]}};
  }
  const variable=s.match(/(?:set|update|change|ändra)\s+(?:startup\s+)?(?:variable\s+)?([A-Z][A-Z0-9_]{1,60})\s*(?:=|to|till)\s*([^\n]{1,400})/i);
  if(variable)return {action:'startup_variable',values:{key:variable[1].toUpperCase(),value:variable[2].trim()}};
  return null;
}
export async function startManaged(m,input) {
  const intent=parseManagement(input);
  if(!intent)return null;
  const account=await getVerifiedCustomer(m.author.id);
  if(!account)return {type:'text',message:'Connect your Discord account to Paymenter with **/account link** first. No changes were made.'};
  if(!account.servers.length)return {type:'text',message:'No verified Pterodactyl servers belong to your linked account.'};
  const matches=account.servers.filter(s=>input.toLowerCase().includes(s.identifier)||input.toLowerCase().includes(s.name.toLowerCase()));
  const guess=matches.length===1?{kind:'exact',server:matches[0]}:matchFromRequest(input,account.servers);
  const server=guess.kind==='exact'?guess.server:account.servers.length===1?account.servers[0]:null;
  sessions.set(requestKey(m),{intent,selected:server?.identifier||null,expires:Date.now()+300000});
  if(!server&&guess.kind==='suggest')return {type:'suggest',server:guess.server,message:'**Server verification**\nDid you mean **'+guess.server.name+'** | ID: `'+guess.server.identifier+'`?\nPlease confirm the server before I prepare the change.'};
  return server?{type:'confirm',server,intent,message:description(server,intent)}:
    {type:'text',message:'Which of your servers should I use? Reply with its full name or ID:\n'+formatServerList(account.servers)};
}
function description(server,intent) {
  const values=Object.entries(intent.values).map(([k,v])=>k+': '+String(v).slice(0,120)).join(', ');
  return '**Owner-reviewed action**\nServer: **'+server.name+'** | ID: '+server.identifier+
    '\nRequested change: **'+intent.action+'**'+(values?'\nDetails: '+values:'')+
    '\nConfirm this is the right server and that you authorize the proposed change. It will be sent for owner approval; no changes have been made.';
}
export async function continueManaged(m,input) {
  const key=requestKey(m),state=sessions.get(key);
  if(!state)return null;
  if(state.expires<Date.now()){sessions.delete(key);return {type:'text',message:'Your pending action expired. Please request it again.'};}
  if(state.selected)return null;
  const account=await getVerifiedCustomer(m.author.id);
  if(!account){sessions.delete(key);return {type:'text',message:'Your account is no longer linked. Use /account link.'};}
  const guess=matchServer(input,account.servers);
  const match=guess.kind==='exact'?guess.server:null;
  if(guess.kind==='suggest')return {type:'suggest',server:guess.server,message:'**Server verification**\nDid you mean **'+guess.server.name+'** | ID: `'+guess.server.identifier+'`?\nPlease confirm the server before I prepare the change.'};
  if(!match)return {type:'text',message:'Please use the exact name or ID:\n'+formatServerList(account.servers)};
  state.selected=match.identifier;
  return {type:'confirm',server:match,intent:state.intent,message:description(match,state.intent)};
}
export async function pendingManaged(m) {
  const state=sessions.get(requestKey(m));
  if(!state||state.expires<Date.now()||!state.selected)return null;
  const account=await getVerifiedCustomer(m.author.id);
  const server=account?.servers.find(s=>s.identifier===state.selected);
  return server?{action:state.intent.action,values:state.intent.values,server}:null;
}
export function confirmManagedSuggestion(m,serverId){const state=sessions.get(requestKey(m));if(!state||state.expires<Date.now()||state.selected)return null;state.selected=serverId;return state.intent;}
export function clearManaged(m){sessions.delete(requestKey(m));}
