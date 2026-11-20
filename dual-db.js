/* Shared storage for map and NPC: read/reconcile on opening, write to both providers.
   Requires matching table columns and authorized API access on both providers. */
(() => {
  'use strict';
  const log=(event,details={},level='info')=>console[level](`[VampireMap ${new Date().toISOString()}] ${event}`,details);
  window.VampireLog=log;
  const safeError=e=>({message:String(e?.message||e).replace(/sb_[\w-]+/g,'[KEY]'),code:e?.code,status:e?.status});
  log('PAGE_OPEN',{page:location.pathname,online:navigator.onLine});
  document.addEventListener('click',e=>{const b=e.target.closest('button,summary');if(b)log('UI_ACTION',{id:b.id||null,label:b.classList.contains('dot')?'rating':b.getAttribute('aria-label')||b.textContent.trim().slice(0,80)});});
  window.addEventListener('error',e=>log('UNCAUGHT_ERROR',{message:e.message,file:e.filename,line:e.lineno},'error'));
  window.addEventListener('unhandledrejection',e=>log('UNHANDLED_REJECTION',safeError(e.reason),'error'));
  window.addEventListener('offline',()=>log('NETWORK_OFFLINE',{},'warn'));
  // Embedded NPC shares the admin's queue and clients, avoiding two writers to localStorage.
  if(window.parent !== window){
    try{if(window.parent.VampireDB){window.VampireDB=window.parent.VampireDB;
      for(const event of ['vampire-db-status','vampire-db-change'])window.parent.addEventListener(event,e=>window.dispatchEvent(new CustomEvent(event,{detail:e.detail})));
      log('SHARED_ADMIN_CONNECTION');return;
    }}catch{}
  }
  const targets = [
    ['Татнет','https://40d1d019c8da3ea4ede8fd0ea69cfaae.supa.tatnet.cloud','sb_publishable_nSJVb28QT38ZXyJEIV3kWrplxPUf'],
    ['Supabase','https://cuvexievsoldyadbtckc.supabase.co','sb_publishable_8QFv2y1yU7kBTF_bJThlpQ_aAbLqCx8']
  ];
  const KEY='vampiremap.dual.v1';
  let state={outbox:[],cache:{points:[],npcs:[]}}, errors=[], running=false, flushTimer;
  try { const raw=localStorage.getItem(KEY); if(raw){const parsed=JSON.parse(raw); if(!Array.isArray(parsed.outbox)||!parsed.cache)throw Error('Неверный кэш'); state=parsed;} }
  catch(e){ errors.push('Не удалось прочитать очередь: '+e.message); }
  log('QUEUE_RESTORED',{pending:state.outbox.length});
  let storageBroken=false;
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));storageBroken=false;log('LOCAL_QUEUE_SAVED',{pending:state.outbox.length});}catch(e){storageBroken=true;log('LOCAL_QUEUE_FAILED',safeError(e),'error');throw Error('Очередь не сохранена на устройстве: '+e.message);}}
  const clients=targets.map(([,url,key])=>window.supabase.createClient(url,key,{auth:{persistSession:true,storageKey:'auth-'+new URL(url).hostname},global:{fetch:async(url,options={})=>{const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}}}}));
  const getStatus=()=>({pending:state.outbox.length,errors:[...errors,...(storageBroken?['Локальное сохранение недоступно']:[])]});
  const notify=()=>window.dispatchEvent(new CustomEvent('vampire-db-status',{detail:getStatus()}));
  const revision=r=>Number(r.revision)||0;
  const stamp=r=>Date.parse(r.updated_at || r.created_at || '') || 0;
  const compare=(a,b)=>stamp(a)-stamp(b) || revision(a)-revision(b) || Number(!!a.deleted_at)-Number(!!b.deleted_at);
  const activeTables=new Set();
  let checking=false;
  function merge(rows){const map=new Map(); rows.forEach(r=>{const k=String(r.id),old=map.get(k);if(!old||compare(r,old)>0)map.set(k,r);});return [...map.values()];}
  function update(table,row){state.cache[table]=merge([...(state.cache[table]||[]),row]);}
  function emit(table){window.dispatchEvent(new CustomEvent('vampire-db-change',{detail:{table,rows:state.cache[table]||[]}}));}
  const allowed=t=>{if(!['points','npcs'].includes(t))throw Error('Неизвестная таблица');};
  function put(table,input){
    try{
      allowed(table);const old=(state.cache[table]||[]).find(r=>String(r.id)===String(input.id));
      const changedAt=Math.max(Date.now(),old?stamp(old)+1:0);
      const row={...input,revision:Math.max(changedAt*1000,revision(old)+1,revision(input)+1),updated_at:new Date(changedAt).toISOString()};
      if(row.id==null)row.id=table==='points'?Date.now()*1000+Math.floor(Math.random()*1000):crypto.randomUUID();
      // Keep in-flight older operation until acknowledged; newer revision is protected by DB trigger.
      const op={operation:crypto.randomUUID(),table,row,acked:[false,false]};
      log('WRITE_QUEUED',{operation:op.operation,table,id:row.id,updated_at:row.updated_at,deleted:!!row.deleted_at});
      state.outbox.push(op);update(table,row);save();notify();emit(table);clearTimeout(flushTimer);flushTimer=setTimeout(()=>void flush(),600);
      return Promise.resolve({data:[row],error:null});
    }catch(e){errors=[e.message];notify();return Promise.resolve({data:null,error:e});}
  }
  async function remove(table,id){const old=(state.cache[table]||[]).find(r=>String(r.id)===String(id));if(!old)return {data:null,error:Error('Сначала загрузите запись для удаления')};return put(table,{...old,deleted_at:new Date().toISOString()});}
  async function flush(){
    if(running||!navigator.onLine){log('SYNC_DEFERRED',{reason:running?'already-running':'offline',pending:state.outbox.length});return;}running=true;const failures=[];
    log('SYNC_START',{pending:state.outbox.length});
    try{
      const failedTargets=new Set();
      for(const op of [...state.outbox]){
        await Promise.all(clients.map(async(client,i)=>{
          if(op.acked[i] || failedTargets.has(i))return;
          const context={provider:targets[i][0],table:op.table,id:op.row.id,operation:op.operation};
          log('DB_WRITE_START',context);const started=Date.now();
          try{const {error,status}=await client.from(op.table).upsert(op.row,{onConflict:'id'});if(error)throw error;op.acked[i]=true;log('DB_WRITE_ACK',{...context,status,durationMs:Date.now()-started});save();}
          catch(e){log('DB_WRITE_FAILED',{...context,...safeError(e),durationMs:Date.now()-started},'error');failedTargets.add(i);failures.push(`${targets[i][0]}: ${e.message}`);}
        }));
        if(op.acked.every(Boolean)){log('BOTH_DATABASES_ACK',{operation:op.operation,table:op.table,id:op.row.id});state.outbox=state.outbox.filter(x=>x.operation!==op.operation);save();}
        // Continue sending other records to the healthy provider only.
      }
    }catch(e){failures.push(e.message);}finally{running=false;errors=[...new Set(failures)];log('SYNC_END',{pending:state.outbox.length,failures:failures.length},failures.length?'warn':'info');notify();}
  }
  async function read(table){
    allowed(table);activeTables.add(table);const failures=[];
    log('READ_BOTH_START',{table});
    const responses=await Promise.all(clients.map(async(client,i)=>{const started=Date.now();log('DB_READ_START',{table,provider:targets[i][0]});try{
      let rows=[],offset=0;while(true){const {data,error}=await client.from(table).select('*').order('id').range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)break;offset+=1000;}
      log('DB_READ_OK',{table,provider:targets[i][0],rows:rows.length,durationMs:Date.now()-started});return rows;
    }catch(e){log('DB_READ_FAILED',{table,provider:targets[i][0],...safeError(e),durationMs:Date.now()-started},'error');failures.push(`${targets[i][0]}: ${e.message}`);return [];}}));
    state.cache[table]=merge([...(state.cache[table]||[]),...responses.flat(),...state.outbox.filter(o=>o.table===table).map(o=>o.row)]);
    // Reconcile only complete successful snapshots; never interpret an outage as an empty DB.
    if(!failures.length){
      const winners=merge(responses.flat());
      for(const row of winners){
        const acked=responses.map(rows=>{const existing=rows.find(r=>String(r.id)===String(row.id));return !!existing && compare(existing,row)>=0;});
        if(!acked.every(Boolean) && !state.outbox.some(o=>o.table===table&&String(o.row.id)===String(row.id))){
          log('RECONCILE_COPY',{table,id:row.id,updated_at:row.updated_at,sendTo:targets.filter((_,i)=>!acked[i]).map(t=>t[0])});
          state.outbox.push({operation:crypto.randomUUID(),table,row,acked});
        }
      }
    }
    try{save();}catch(e){failures.push(e.message);}errors=failures;notify();emit(table);
    log('READ_MERGED',{table,rows:state.cache[table].length,failedProviders:failures.length,pending:state.outbox.length},failures.length?'warn':'info');
    if(!failures.length)void flush();
    return {data:state.cache[table],error:failures.length===2&&!state.cache[table].length?Error(failures.join('; ')):null};
  }
  function from(table){let action='read',payload,filter;
    const builder={select(){return builder;},insert(rows){action='insert';payload=rows;return builder;},update(row){action='update';payload=row;return builder;},delete(){action='delete';return builder;},eq(key,value){if(key!=='id')throw Error('Поддерживается фильтр id');filter=value;return builder;},then(resolve,reject){return execute().then(resolve,reject);}};
    async function execute(){if(action==='read'){const result=await read(table);return {...result,data:result.data.filter(r=>!r.deleted_at)};}
      if(action==='insert'){const results=await Promise.all((Array.isArray(payload)?payload:[payload]).map(r=>put(table,r)));return {data:results.flatMap(r=>r.data||[]),error:results.find(r=>r.error)?.error||null};}
      if(action==='delete')return remove(table,filter);
      const old=(state.cache[table]||[]).find(r=>String(r.id)===String(filter));if(!old)return {data:null,error:Error('Запись не загружена')};return put(table,{...old,...payload});}
    return builder;
  }
  // Public authentication helpers; owners must sign in separately on each provider.
  async function signIn(email,password){return Promise.all(clients.map(async(c,i)=>{log('AUTH_START',{provider:targets[i][0]});const result=await c.auth.signInWithPassword({email,password});log(result.error?'AUTH_FAILED':'AUTH_OK',{provider:targets[i][0],...(result.error?safeError(result.error):{})},result.error?'error':'info');return {provider:targets[i][0],error:result.error};}));}
  window.VampireDB={read,put,remove,from,flush,getStatus,signIn,hasPending:(t,id)=>state.outbox.some(o=>o.table===t&&String(o.row.id)===String(id))};
  async function checkAll(){
    if(checking || !navigator.onLine)return;checking=true;
    try{for(const table of activeTables)await read(table);await flush();}finally{checking=false;}
  }
  window.addEventListener('online',()=>void checkAll());
  // Pages call read() on opening; successful reads reconcile both databases.
  // No periodic polling. New edits and reconnects trigger delivery.
  notify();void flush();
})();
