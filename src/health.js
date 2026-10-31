const test = async (base,key,route) => {
  if(!base||!key) return 'not configured';
  try {
    const origin=new URL(base);
    if(origin.protocol!=='https:') return 'HTTPS required';
    const r=await fetch(new URL(route,origin),{
      headers:{Authorization:'Bearer '+key,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(10000)
    });
    return r.ok?'reachable (HTTP '+r.status+')':'error (HTTP '+r.status+')';
  } catch(e) {return e.name==='TimeoutError'?'timed out':'connection failed';}
};
export async function integrationHealth() {
  const [billing,panelClient,panelApplication] = await Promise.all([
    test(process.env.PAYMENTER_URL,process.env.PAYMENTER_API_KEY,'/api/aurelius/health'),
    test(process.env.PTERODACTYL_URL,process.env.PTERODACTYL_CLIENT_API_KEY,'/api/client/account'),
    test(process.env.PTERODACTYL_URL,process.env.PTERODACTYL_APPLICATION_API_KEY,'/api/application/users?per_page=1')
  ]);
  return {
    billing, panelClient,panelApplication,
    actions:process.env.PTERODACTYL_ACTIONS_ENABLED==='true'?'enabled':'disabled',
    audit:process.env.AI_ACTION_LOG_CHANNEL_ID?'configured':'missing',
    owner:process.env.OWNER_ID?'configured':'missing'
  };
}
