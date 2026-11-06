/** Keep discovery and history on the remote disk, independently of build hashes. */
export const prepareEveWorkspaceScript = `
const fs = require('node:fs');
const path = require('node:path');
const [directory, owner, workdir, appUrl, legacyRoot = "/tmp"] = process.argv.slice(1);
const stateName = '.d3k-conversation.json';
let migrated = false;
if (!fs.existsSync(directory)) {
  const candidates = [];
  for (const name of fs.readdirSync(legacyRoot)) {
    if (!/^d3k-eve-([a-f0-9]{12}|[a-f0-9]{64})$/.test(name)) continue;
    const legacy = path.join(legacyRoot, name);
    if (fs.existsSync(path.join(legacy, stateName))) continue;
    const instructions = path.join(legacy, 'agent/instructions.md');
    if (!fs.existsSync(instructions)) continue;
    const context = fs.readFileSync(instructions, 'utf8');
    if (!context.includes(workdir) || !context.includes(appUrl)) continue;
    const runs = path.join(legacy, '.eve/.workflow-data/runs');
    if (!fs.existsSync(runs)) continue;
    for (const file of fs.readdirSync(runs)) {
      if (!file.endsWith('.json')) continue;
      const run = JSON.parse(fs.readFileSync(path.join(runs, file), 'utf8'));
      if (run.workflowName === 'workflow//eve//workflowEntry')
        candidates.push({directory:legacy, id:run.runId, createdAt:run.createdAt});
    }
  }
  candidates.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  fs.mkdirSync(path.dirname(directory), {recursive:true});
  if (candidates.length) {
    const latest = candidates[0];
    // Keep the original path valid: compiled builds contain absolute paths.
    fs.symlinkSync(latest.directory, directory, 'dir');
    const state = {version:1, owner, workdir, conversationId:latest.id};
    fs.writeFileSync(path.join(directory, stateName), JSON.stringify(state), {flag:'wx', mode:0o600});
    migrated = true;
  } else fs.mkdirSync(directory);
}
const statePath = path.join(directory, stateName);
// Recover after an uncertain create/save, never silently create over durable history.
if (!fs.existsSync(statePath)) {
  const runs = path.join(directory, '.eve/.workflow-data/runs');
  const roots = fs.existsSync(runs) ? fs.readdirSync(runs).filter(file => file.endsWith('.json')).map(file => JSON.parse(fs.readFileSync(path.join(runs,file),'utf8'))).filter(run => run.workflowName === 'workflow//eve//workflowEntry').sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
  if (roots.length) {
    fs.writeFileSync(statePath, JSON.stringify({version:1,owner,workdir,conversationId:roots[0].runId}), {flag:'wx',mode:0o600});
    migrated = true;
  }
}
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
console.log(JSON.stringify({state, migrated}));
`

export const saveEveConversationScript = `
const fs = require('node:fs');
const path = require('node:path');
const [directory, serialized] = process.argv.slice(1);
const file = path.join(directory, '.d3k-conversation.json');
const temporary = file + '.' + process.pid + '.tmp';
fs.writeFileSync(temporary, serialized, {mode:0o600});
fs.renameSync(temporary, file);
`

export function validateConversation(state, { owner, workdir }) {
  if (
    state?.version !== 1 ||
    state.owner !== owner ||
    state.workdir !== workdir ||
    typeof state.conversationId !== "string" ||
    !/^wrun_[A-Z0-9]{26}$/.test(state.conversationId)
  )
    throw new Error("Saved Eve conversation does not match this sandbox session; refusing to replace it.")
  return state
}

export async function openEveConversation({ client, state, owner, workdir, save, signal }) {
  if (state) {
    validateConversation(state, { owner, workdir })
    const session = client.sessions.attach(state.conversationId)
    try {
      await session.snapshot({ signal })
    } catch (error) {
      throw new Error(`Could not recover Eve conversation ${state.conversationId}. No new conversation was created.`, {
        cause: error
      })
    }
    return session
  }
  const { session } = await client.sessions.create()
  // Persist before accepting input. An uncertain create/save is never retried here.
  await save({ version: 1, owner, workdir, conversationId: session.id })
  return session
}
