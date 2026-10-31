import { getVerifiedCustomer, paymenterServices } from './identity-live.js';
import { formatServerList, normalizeServerChoice } from './action-policy.js';
const req = async (url,token) => {
  if (!token || !url.startsWith('https://')) throw new Error('Panel client API is not configured');
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if (!r.ok) throw new Error('Pterodactyl returned '+r.status);
  return r.json();
};
export async function inspectServer(discordId, search, kind='status') {
  const account=await getVerifiedCustomer(discordId);
  if (!account) return 'Connect your billing account using **/account link** first.';
  const server=normalizeServerChoice(search,account.servers) ||
    (account.servers.length===1 ? account.servers[0]:null);
  if (!server) return 'Which server should I inspect?\n'+formatServerList(account.servers);
  const origin=new URL(process.env.PTERODACTYL_URL);
  const base=new URL('/api/client/servers/'+server.identifier+'/',origin);
  let endpoint='resources';
  if (kind==='startup') endpoint='startup';
  if (kind==='allocations') endpoint='network/allocations';
  if (kind==='subusers') endpoint='users';
  if (kind==='schedules') endpoint='schedules';
  if (kind==='backups') endpoint='backups';
  if (kind==='databases') endpoint='databases';
  const result=await req(new URL(endpoint,base).toString(),process.env.PTERODACTYL_CLIENT_API_KEY);
  if (kind==='status') {
    const a=result.attributes||{},r=a.resources||{};
    return '**'+server.name+'** | ID: '+server.identifier+'\nState: '+(a.current_state||'unknown')+
      '\nSuspended: '+(a.is_suspended||server.suspended?'Yes':'No')+
      '\nRAM used: '+Math.round((r.memory_bytes||0)/1048576)+' MiB'+
      '\nDisk used: '+Math.round((r.disk_bytes||0)/1048576)+' MiB'+
      '\nCPU: '+(r.cpu_absolute??'Unknown')+'%';
  }
  if (kind==='startup') {
    const a=result.meta||{},data=result.data||[];
    return '**'+server.name+'** | ID: '+server.identifier+
      '\nDocker image: '+String(server.container?.image||'Unavailable')+
      '\nStartup command: '+String(a.startup_command||server.container?.startup_command||'Unavailable').slice(0,400)+
      '\nEditable variable names: '+data.filter(v=>v.attributes?.is_editable).map(v=>v.attributes.env_variable).join(', ');
  }
  if (kind==='databases') return '**'+server.name+'** configured databases: '+(result.data||[]).map(v=>String(v.attributes?.name||'Unnamed')).slice(0,15).join(', ')+'. This confirms configuration, not live SQL connectivity; inspect sanitized application errors to diagnose failed connections.';
  if (kind==='subusers') return '**'+server.name+'** subusers: '+(result.data||[]).map(v=>v.attributes?.email).filter(Boolean).slice(0,20).join(', ');
  if (kind==='backups') return '**'+server.name+'** backups: '+(result.data||[]).map(v=>String(v.attributes?.name||'Unnamed')).slice(0,15).join(', ');
  if (kind==='schedules') return '**'+server.name+'** schedules: '+(result.data||[]).map(v=>String(v.attributes?.name||'Unnamed')).slice(0,15).join(', ');
  if (kind==='allocations') return '**'+server.name+'** allocations: '+(result.data||[]).map(v=>String(v.attributes?.ip_alias||v.attributes?.ip)+':'+v.attributes?.port).slice(0,15).join(', ');
  return 'Inspection completed.';
}
export async function subscriptions(discordId) {
  const account=await getVerifiedCustomer(discordId);
  if (!account) return 'Connect your account first with **/account link**.';
  const services=await paymenterServices(account);
  if (!services.length) return 'No services found for your verified Paymenter account.';
  return 'Your Paymenter services:\n'+services.slice(0,20).map(s=>
    String(s.name||s.product_name||'Service')+' | Service ID: '+s.id+' | Status: '+String(s.status||'Unknown')).join('\n')+
    '\nFor server ownership, these are checked separately against your linked Pterodactyl account.';
}

export async function paymentIssues(discordId) {
  const account=await getVerifiedCustomer(discordId);
  if(!account)return 'Connect your account with **/account link** first.';
  const base=new URL(process.env.PAYMENTER_URL);
  const url=new URL('/api/v1/admin/users/'+account.paymenterUserId+'?include=invoices',base);
  const r=await fetch(url,{headers:{Authorization:'Bearer '+process.env.PAYMENTER_API_KEY,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('Billing API returned '+r.status);
  const doc=await r.json();
  const refs=doc.data?.relationships?.invoices?.data||[];
  const invoices=refs.map(ref=>ref.attributes?ref:(doc.included||[]).find(x=>x.id===ref.id&&x.type===ref.type)).filter(Boolean);
  const outstanding=invoices.filter(x=>!['paid','completed'].includes(String(x.attributes?.status||'').toLowerCase()));
  return outstanding.length?'Invoices needing review:\\n'+outstanding.slice(0,10).map(x=>'Invoice '+x.id+' | Status: '+String(x.attributes?.status||'Unknown')).join('\\n')+
    '\\nFor payment gateway decline reasons, a billing staff member may need to inspect the transaction.':
    'No unpaid or failed invoices were found in the billing account response. This does not verify the payment gateway status.';
}
