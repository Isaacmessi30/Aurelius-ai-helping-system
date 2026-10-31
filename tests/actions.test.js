import test from 'node:test';
import assert from 'node:assert/strict';
import { requirement, mayExecute, normalizeServerChoice, formatServerList } from '../src/action-policy.js';
import { parseManagement } from '../src/management-conversations.js';
import { recognizePower } from '../src/conversations.js';
test('action tiers are enforced independently of AI',()=>{
  assert.equal(requirement('power_restart'),'customer');
  assert.equal(requirement('add_subuser'),'owner');
  assert.equal(requirement('restore_backup'),'owner');
  assert.equal(requirement('change_docker_image'),'manual');
  assert.equal(mayExecute('power_restart',{verified:true,customerConfirmed:true}),true);
  assert.equal(mayExecute('power_restart',{verified:false,customerConfirmed:true}),false);
  assert.equal(mayExecute('add_subuser',{verified:true,customerConfirmed:true}),false);
  assert.equal(mayExecute('add_subuser',{verified:true,customerConfirmed:true,ownerApproved:true}),true);
  assert.equal(mayExecute('change_docker_image',{verified:true,customerConfirmed:true,ownerApproved:true}),false);
});
test('choose only an unambiguous server',()=>{
  const list=[{name:'Alpha',id:'1',identifier:'abcdefgh'},{name:'Beta',id:'2',identifier:'ijklmnop'}];
  assert.equal(normalizeServerChoice('Alpha',list).identifier,'abcdefgh');
  assert.equal(normalizeServerChoice('ijklmnop',list).name,'Beta');
  assert.equal(normalizeServerChoice('gamma',list),null);
  assert.match(formatServerList(list),/Alpha \| ID: abcdefgh/);
});
test('recognize common management intents',()=>{
  assert.equal(parseManagement('Can you add test@example.org to my server?').action,'add_subuser');
  assert.equal(parseManagement('Please create a backup').action,'create_backup');
  assert.equal(parseManagement('Change startup script to bash').action,'startup_bash');
  assert.equal(parseManagement('Reset startup to default').action,'startup_default');
});
test('power actions are not confused with backup or startup requests',()=>{
  assert.equal(recognizePower('Please restart the server').signal,'restart');
  assert.equal(recognizePower('Please stop the bot').signal,'stop');
  assert.equal(recognizePower('Please create a backup'),null);
});
