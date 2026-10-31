// Central authorization policy. LLM output never controls approval requirements.
export const ACTIONS = Object.freeze({
  list_servers: 'read',
  check_server_status: 'read',
  view_resources: 'read',
  view_allocations: 'read',
  view_docker_image: 'read',
  view_startup: 'read',
  view_subusers: 'read',
  view_schedules: 'read',
  view_backups: 'read',
  check_suspension: 'read',
  check_disk: 'read',
  check_subscription: 'read',
  check_invoices: 'read',
  diagnose_database: 'read',
  investigate_incident: 'read',
  summarize_ticket: 'read',
  power_start: 'customer',
  power_stop: 'customer',
  power_restart: 'customer',
  power_graceful_stop: 'customer',
  edit_startup: 'owner',
  reset_startup: 'owner',
  add_subuser: 'owner',
  edit_subuser: 'owner',
  remove_subuser: 'owner',
  create_backup: 'owner',
  restore_backup: 'owner',
  create_schedule: 'owner',
  edit_schedule: 'owner',
  remove_schedule: 'owner',
  change_files: 'owner',
  rotate_credentials: 'manual',
  change_docker_image: 'manual',
  create_database: 'manual',
  delete_server: 'manual',
  modify_billing: 'manual',
  service_extension: 'manual',
  service_migration: 'manual',
  upgrade_plan: 'manual'
});
export function requirement(action) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error('Action not supported');
  return ACTIONS[action];
}
export function mayExecute(action, { verified, customerConfirmed, ownerApproved } = {}) {
  const level = requirement(action);
  if (!verified || level === 'manual') return false;
  if (level === 'read') return true;
  if (!customerConfirmed) return false;
  return level === 'customer' || ownerApproved === true;
}
export function normalizeServerChoice(query, servers) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const matches = servers.filter(s => [s.id, s.identifier, s.uuid, s.name]
    .some(v => String(v || '').toLowerCase() === q));
  return matches.length === 1 ? matches[0] : null;
}
export function formatServerList(servers) {
  if (!servers.length) return 'No verified servers were found for your account.';
  return servers.slice(0, 20).map(s => String(s.name).slice(0, 70) + ' | ID: ' + s.identifier).join('\n');
}
