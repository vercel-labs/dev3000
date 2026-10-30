/** Fixed launcher uploaded into the VM. Only project env and app-scoped preview access enter it. */
export const cloudBootstrap = `
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
const config=JSON.parse(raw);
const state=phase=>fs.writeFileSync('/tmp/d3k-cloud-state.json',JSON.stringify({phase}));
const run=(command,args,cwd)=>{
  const result=spawnSync(command,args,{cwd,env:process.env,encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.status!==0) throw Error(command+' failed: '+(result.stderr||result.error||'').toString().slice(-2000));
};
const findChrome=(dir,depth=0)=>{
  if(depth>8||!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isFile()&&entry.name==='chrome')return file;
    if(entry.isDirectory()){const found=findChrome(file,depth+1);if(found)return found;}
  }
};
try {
  process.env.PATH='/tmp/d3k-bun/node_modules/.bin:/tmp/d3k-tools/node_modules/.bin:'+(process.env.PATH||'/usr/local/bin:/usr/bin:/bin');
  if(!config.recover){
  state('installing_tools');
  if(spawnSync('bun',['--version'],{encoding:'utf8'}).status!==0)run('npm',['install','--prefix','/tmp/d3k-bun','bun@1.3.11']);
  run('bun',['add','--cwd','/tmp/d3k-tools','/tmp/d3k-tools/dev3000.tgz']);
  state('installing_browser');
  run('sudo',['dnf','install','-y','--skip-broken','nss','nspr','libxkbcommon','atk','at-spi2-atk','at-spi2-core','libXcomposite','libXdamage','libXrandr','libXfixes','libXcursor','libXi','libXtst','libXScrnSaver','libXext','mesa-libgbm','libdrm','mesa-libGL','mesa-libEGL','cups-libs','alsa-lib','pango','cairo','gtk3','dbus-libs']);
  run('/tmp/d3k-tools/node_modules/.bin/agent-browser',['install']);
  }
  const chrome=findChrome(path.join(os.homedir(),'.agent-browser'))||findChrome(path.join(os.homedir(),'.cache'));
  if(!chrome)throw Error('Installed Chrome executable was not found');
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
