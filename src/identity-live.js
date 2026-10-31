// Authenticated account association from the existing AureliusAccounts Paymenter extension.
// No client-supplied email, server name or ID is used as authorization evidence.
const safeId = value => /^\d{17,20}$/.test(String(value));
async function request(base, key, endpoint) {
  if (!base?.startsWith('https://') || !key) throw new Error('Account integration is not configured.');
  const url = new URL(endpoint, base);
  if (url.origin !== new URL(base).origin) throw new Error('Invalid API endpoint');
  const response = await fetch(url, {
    headers:{Authorization:'Bearer '+key,Accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Account verification failed: HTTP '+response.status);
  return response.json();
}
export async function getVerifiedCustomer(discordId) {
  if (!safeId(discordId)) return null;
  if (!process.env.PAYMENTER_URL || !process.env.PAYMENTER_API_KEY ||
      !process.env.PTERODACTYL_APPLICATION_API_KEY) return null;
  const record = await request(process.env.PAYMENTER_URL,process.env.PAYMENTER_API_KEY,
    '/api/aurelius/discord/'+encodeURIComponent(discordId));
  if (!record.linked || record.discord_id !== discordId || !record.email_verified ||
      !Number.isInteger(record.panel_user_id) || record.panel_user_id < 1 ||
      !/^\d+$/.test(String(record.billing_user_id))) return null;
  const user = await request(process.env.PTERODACTYL_URL,process.env.PTERODACTYL_APPLICATION_API_KEY,
    '/api/application/users/'+record.panel_user_id+'?include=servers');
  const resources=user?.attributes?.relationships?.servers?.data;
  if (!Array.isArray(resources)) throw new Error('Panel did not return verified server ownership');
  const servers=resources.map(r=>r.attributes).filter(s=>
    s && Number(s.user)===record.panel_user_id && /^[a-z0-9]{8}$/.test(String(s.identifier)))
    .map(s=>({ name:String(s.name||'Unnamed server'),identifier:String(s.identifier),uuid:String(s.uuid||''),
      id:Number(s.id), paymenterServiceId:null, status:s.status, suspended:!!s.suspended,
      limits:s.limits || {}, container:s.container || {}, ownerId:record.panel_user_id }));
  return {paymenterUserId:String(record.billing_user_id),panelUserId:record.panel_user_id,
    revision:record.revision,servers};
}
export async function verifiedServerFor(discordId,identifier) {
  const account=await getVerifiedCustomer(discordId);
  return account?.servers.find(s=>s.identifier===identifier) || null;
}
export async function paymenterServices(account) {
  if (!account) return [];
  const document=await request(process.env.PAYMENTER_URL,process.env.PAYMENTER_API_KEY,
    '/api/v1/admin/users/'+account.paymenterUserId+'?include=services');
  const refs=document.data?.relationships?.services?.data||[];
  return refs.map(ref=>ref.attributes ? ref : (document.included||[]).find(item=>item.id===ref.id && item.type===ref.type))
    .filter(Boolean).map(item=>({id:item.id,...item.attributes}));
}
