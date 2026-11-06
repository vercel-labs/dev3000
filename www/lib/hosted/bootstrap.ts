/** Fixed launcher uploaded into the VM. Only project env and app-scoped preview access enter it. */
export const cloudBootstrap = `
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
const config=JSON.parse(raw);
const state=phase=>fs.writeFileSync('/tmp/d3k-cloud-state.json',JSON.stringify({phase}));
const run=(command,args,cwd)=>{
  const result=spawnSync(command,args,{cwd,env:process.env,encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.status!==0) throw Error(command+' failed: '+(result.stderr||result.error||'').toString().slice(-2000));
};
try {
  process.env.PATH='/tmp/d3k-bun/node_modules/.bin:/tmp/d3k-tools/node_modules/.bin:'+(process.env.PATH||'/usr/local/bin:/usr/bin:/bin');
  if(!config.recover){
  state('installing_tools');
  if(spawnSync('bun',['--version'],{encoding:'utf8'}).status!==0)run('npm',['install','--prefix','/tmp/d3k-bun','bun@1.3.11']);
  run('bun',['add','--cwd','/tmp/d3k-tools','/tmp/d3k-tools/dev3000.tgz']);
  }
  const chrome='/opt/google/chrome/chrome';
  // Also migrates restored VMs that do not yet have the standard Chrome package.
  if(!fs.existsSync(chrome)){
    state('installing_browser');
    run('sudo',['rpm','--import','https://dl.google.com/linux/linux_signing_key.pub']);
    run('sudo',['dnf','install','-y','--setopt=localpkg_gpgcheck=1','https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm']);
  }
  process.env.D3K_CHROME_NO_SANDBOX='1';
  const profileDir='/tmp/d3k-cloud-chrome';
  if(config.recover){
    // A restored VM has a new hostname and no prior Chrome process. Preserve
    // its profile, but discard the old process's singleton locks.
    for(const name of ['SingletonLock','SingletonSocket','SingletonCookie']){
      try{fs.unlinkSync(path.join(profileDir,name));}catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  process.chdir(config.workdir);
  if(!config.recover){state('installing_project');run('sh',['-c',config.installCommand||'bun install'],config.workdir);}
  state('starting');
  const {startRuntime}=await import('/tmp/d3k-tools/node_modules/dev3000/dist/runtime/runtime.js');
  await startRuntime({command:config.command||undefined,headless:true,browser:chrome,profileDir,startupTimeout:300000,sandbox:{appUrl:config.preview.origin,serverPort:3000,bridgePort:9223,token:config.unusedBridgeToken,preview:config.preview,cloudBrowser:true}});
  state('ready');
} catch(error) {
  // Errors remain in the VM; the hosted status endpoint returns a bounded message on request.
  fs.writeFileSync('/tmp/d3k-cloud-state.json',JSON.stringify({phase:'failed',error:String(error).slice(-2000)}));
  process.exitCode=1;
}
`
