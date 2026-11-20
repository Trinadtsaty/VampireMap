document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  try { localStorage.removeItem('vampiremap.dual.v1'); } catch (error) { console.warn('[VampireMap] Не удалось удалить старую двухбазную очередь', error); }
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const KEY = 'vampiremap.npcs.v1';
  const clone = v => JSON.parse(JSON.stringify(v));
  const isUUID = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const uid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
  const fixedFields = $$('.content-container input, .content-container textarea').filter(e => !e.closest('.dynamic-row') && !e.readOnly);
  fixedFields.forEach((e, i) => { e.dataset.key = e.id || [...e.classList].find(c => c.startsWith('input-') || c.startsWith('textarea-')) || `field-${i}`; });
  const baseDots = $$('.dots[data-type]').filter(e => !e.closest('.dynamic-row'));
  const defaults = Object.fromEntries(fixedFields.map(e => [e.dataset.key, e.type === 'checkbox' ? e.checked : e.type === 'number' ? Number(e.value) : e.value]));
  let store = { active: null, characters: [] }, undo = [], tab = 'base', portrait = null, editing = false;
  function mode() {
    fixedFields.forEach(e => { e.disabled = !editing && !['bloodCurrent','humanityInput','hideUntrained'].includes(e.id); });
    $$('.content-container .dot').forEach(e => { e.disabled = !editing && !e.closest('[data-type="wp"], #bloodBoxes'); });
    $$('.content-container .list-item input, .dynamic-row input, .content-container .btn-add, .content-container .btn-icon').forEach(e => { e.disabled = !editing; });
    $('#openPhotoBtn').disabled = !editing;
    $('#editNpcBtn').textContent = editing ? 'Завершить редактирование' : 'Редактировать';
    $('#characterTitle').textContent = current()?.fields['input-name'] || 'Новый персонаж';
    $('#modeHint').textContent = editing ? 'Редактор · изменения сохраняются автоматически. «Закрыть» вернёт к списку без потери данных.' : 'Режим игры · доступны только кровь, текущая воля, человечность и раны.';
    if (nosferatu()) $$('[data-type="attr"][data-name="app"] button').forEach(e => { e.disabled = true; });
  }
  function openCharacter(id, edit = false) {
    console.info('[VampireMap] NPC_OPEN', { id, mode: edit ? 'edit' : 'play' });
    store.active = id; undo = []; editing = edit;
    $('#characterActions').hidden = false; $('#moreActions').open = false;
    $('#npcLibrary').hidden = true; $('.content-container').hidden = false; $('.tabs').hidden = false;
    render(); activate('base');
  }
  function library() {
    console.info('[VampireMap] NPC_LIST_OPEN', { count: store.characters.length });
    $('#characterActions').hidden = true; $('#moreActions').open = false;
    $('#npcLibrary').hidden = false; $('.content-container').hidden = true; $('.tabs').hidden = true;
    const root = $('#npcCards'); root.replaceChildren();
    const query = $('#npcSearch').value.toLowerCase();
    store.characters.filter(c => `${c.fields['input-name'] || ''} ${c.fields['input-clan'] || ''}`.toLowerCase().includes(query)).forEach(c => {
      const card = document.createElement('article'); card.className = 'npc-card';
      const img = document.createElement('img'); img.src = photoURL(c.portrait); img.alt = ''; img.onerror = () => { if(img.src !== placeholder) img.src=placeholder; };
      const title = document.createElement('h3'); title.textContent = c.fields['input-name'] || 'Без имени';
      card.append(img,title);
      for (const [label,edit] of [['Открыть',false],['Редактировать',true]]) { const b=document.createElement('button'); b.textContent=label; b.onclick=()=>openCharacter(c.id,edit); card.append(b); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Удалить'; remove.onclick = () => deleteCharacter(c.id); card.append(remove);
      const meta = document.createElement('p'); meta.className = 'card-meta'; meta.textContent = `${c.fields['input-clan'] || 'Клан не указан'} · поколение ${c.fields.generationInput ?? '—'}`; card.insertBefore(meta, card.querySelector('button'));
      root.append(card);
    });
    if (!root.children.length) { const empty=document.createElement('p'); empty.className='empty-state'; empty.textContent=store.characters.length ? 'Ничего не найдено. Измените запрос.' : 'Пока нет персонажей. Создайте НПС или импортируйте JSON.'; root.append(empty); }
  }
  const blank = () => ({ id: uid(), schema_version: 1, ruleset: 'V20', fields: clone(defaults), ratings: Object.fromEntries(baseDots.filter(e => e.dataset.type === 'attr').map(e => [`attr.${e.dataset.name}`, 1])), lists: { disciplines: [], facts: [], merits: [], flaws: [], talent: [], skill: [], knowledge: [] }, health: [0,0,0,0,0,0,0], portrait: null });
  const current = () => store.characters.find(c => c.id === store.active);
  let lastStatus = '';
  const status = text => { if (text !== lastStatus) { console.info('[VampireMap] NPC_SAVE_STATUS', { message: text }); lastStatus = text; } };
  let recoveryPending = null, localError = '', cloudError = '', fetching = true;
  let snapshots = new Map();
  const changedDuringFetch = new Set(), knownIDs = new Set(), confirmed = new Map(), revisions = new Map();
  // NPCs use the original Supabase only. Edits are cached before network requests.
  const npcClient = window.supabase?.createClient(
    'https://cuvexievsoldyadbtckc.supabase.co',
    'sb_publishable_8QFv2y1yU7kBTF_bJThlpQ_aAbLqCx8'
  );
  const queueName = 'vampiremap.npc-primary-queue.v1';
  let npcQueue = [];
  try { npcQueue = JSON.parse(localStorage.getItem(queueName) || '[]'); if (!Array.isArray(npcQueue)) throw Error('Invalid queue'); }
  catch (error) { console.error('[VampireMap] NPC_QUEUE_READ_FAILED', error); npcQueue = []; }
  let sending = false, sendTimer;
  const db = () => npcClient && ({
    getStatus: () => ({ pending: npcQueue.length, errors: [] }),
    hasPending: (table, id) => table === 'npcs' && npcQueue.some(item => item.id === id),
    put: (table, row) => enqueueCloud(row),
    remove: (table, id) => enqueueCloud({ id, deleted_at: new Date().toISOString() }),
    read: async () => {
      try {
        const { data, error } = await npcClient.from('npcs').select('*');
        if (error) throw error;
        console.info('[VampireMap] NPC_DB_READ_OK', { count: data.length });
        return { data: [...data.filter(row => !npcQueue.some(item => item.id === row.id)), ...npcQueue.map(item => item.row)], error: null };
      } catch (error) { console.error('[VampireMap] NPC_DB_READ_FAILED', error); return { data: [], error }; }
    }
  });
  function enqueueCloud(row) {
    const previous = npcQueue;
    npcQueue = [...npcQueue.filter(item => item.id !== row.id), { id: row.id, row }];
    try { localStorage.setItem(queueName, JSON.stringify(npcQueue)); }
    catch (error) { npcQueue = previous; return Promise.resolve({ error }); }
    console.info('[VampireMap] NPC_WRITE_QUEUED', { id: row.id, pending: npcQueue.length });
    clearTimeout(sendTimer); sendTimer = setTimeout(() => void sendCloud(), 600);
    return Promise.resolve({ data: [row], error: null });
  }
  async function sendCloud() {
    if (sending || !npcClient || !navigator.onLine || !npcQueue.length) return;
    sending = true;
    try {
      for (const item of [...npcQueue]) {
        const { error } = await npcClient.from('npcs').upsert(item.row, { onConflict: 'id' });
        if (error) { console.error('[VampireMap] NPC_DB_WRITE_FAILED', { id: item.id, error }); break; }
        console.info('[VampireMap] NPC_DB_WRITE_OK', { id: item.id });
        npcQueue = npcQueue.filter(queued => queued !== item);
        try { localStorage.setItem(queueName, JSON.stringify(npcQueue)); }
        catch (saveError) { console.error('[VampireMap] NPC_QUEUE_SAVE_FAILED', saveError); break; }
      }
    } catch (error) { console.error('[VampireMap] NPC_DB_WRITE_FAILED', error); }
    finally { sending = false; saveStatus(); }
  }
  const pending = id => npcQueue.some(item => item.id === id);
  function saveStatus() {
    if (localError) { status(localError); return; }
    const connection = db()?.getStatus?.();
    const syncError = connection?.errors?.filter(Boolean).join('; ') || cloudError;
    const queued = [...knownIDs].some(pending);
    const savedInCloud = store.characters.length > 0 && store.characters.every(c => confirmed.get(c.id) === JSON.stringify(c));
    status('На устройстве' + (syncError ? ' · ошибка БД: ' + syncError : queued ? ' · ожидает отправки' : fetching && db() ? ' · чтение БД…' : savedInCloud ? ' + в Supabase' : ' · облачное сохранение не подтверждено'));
  }
  function writeLocal() {
    try {
      // Preserve the original unreadable record before any new autosave.
      if (recoveryPending !== null) {
        localStorage.setItem(KEY + '.recovery.' + Date.now(), recoveryPending);
        recoveryPending = null;
      }
      localStorage.setItem(KEY, JSON.stringify(store)); localError = ''; console.info('[VampireMap] NPC_LOCAL_SAVED', { count: store.characters.length, active: store.active });
    } catch { localError = 'Не удалось сохранить на устройстве! Экспортируйте JSON.'; }
  }
  function enqueue(id, character) {
    knownIDs.add(id); confirmed.delete(id);
    if (fetching) changedDuringFetch.add(id);
    if (!db()) { cloudError = 'модуль недоступен; сохранено только локально'; return; }
    try {
      // Queue to local storage synchronously; network write follows after a short delay.
      const operation = character
        ? db().put('npcs', { id, data: clone(character), schema_version: 1 })
        : db().remove('npcs', id);
      Promise.resolve(operation).then(result => {
        if (result?.error) cloudError = result.error.message || String(result.error);
        saveStatus();
      }).catch(error => { cloudError = error.message || String(error); saveStatus(); });
    } catch (error) { cloudError = error.message || String(error); }
  }
  function persist() {
    writeLocal();
    const next = new Map(store.characters.map(c => [c.id, JSON.stringify(c)]));
    for (const c of store.characters) if (snapshots.get(c.id) !== next.get(c.id)) enqueue(c.id, c);
    for (const id of snapshots.keys()) if (!next.has(id)) enqueue(id, null);
    snapshots = next;
    saveStatus();
  }
  function mergeRows(rows) {
    if (!Array.isArray(rows)) return;
    const wasOpen = !$('#npcLibrary').hidden, oldActive = store.active;
    let changed = false;
    for (const row of rows) {
      if (!row || !isUUID(row.id)) continue;
      knownIDs.add(row.id);
      if (pending(row.id) || (fetching && changedDuringFetch.has(row.id))) continue;
      if (Number(row.revision || 0) < (revisions.get(row.id) || 0)) continue;
      try {
        const index = store.characters.findIndex(c => c.id === row.id);
        if (row.deleted_at) {
          if (index >= 0) { store.characters.splice(index, 1); changed = true; }
          confirmed.delete(row.id);
        } else {
          const character = normalize({ ...row.data, id: row.id });
          const serialized = JSON.stringify(character);
          if (index < 0) { store.characters.push(character); changed = true; }
          else if (JSON.stringify(store.characters[index]) !== serialized) { store.characters[index] = character; changed = true; }
          confirmed.set(row.id, serialized);
        }
        revisions.set(row.id, Number(row.revision || 0));
      } catch (error) { cloudError = 'Некорректная карточка: ' + (error.message || String(error)); }
    }
    if (changed) {
      if (!current()) store.active = store.characters[0]?.id || null;
      undo = [];
      snapshots = new Map(store.characters.map(c => [c.id, JSON.stringify(c)]));
      writeLocal(); options();
      if (wasOpen || oldActive !== store.active || !current()) library(); else render();
    }
    saveStatus();
  }
  let loadingCloud = false;
  async function loadCloud() {
    if (loadingCloud) return;
    if (!db()) { fetching = false; saveStatus(); return; }
    loadingCloud = true; fetching = true; changedDuringFetch.clear();
    // Protect queued edits even if flush acknowledges them while read is in flight.
    store.characters.forEach(c => { if (pending(c.id)) changedDuringFetch.add(c.id); });
    saveStatus();
    try {
      const result = await db().read('npcs');
      if (result?.error) cloudError = result.error.message || String(result.error);
      else cloudError = '';
      mergeRows(result?.data);
      // Cached rows can accompany a failed read; only a confirmed response
      // tells us which local NPCs are not yet in the single cloud database.
      const readErrors = db().getStatus?.()?.errors?.filter(Boolean) || [];
      if (!result?.error && Array.isArray(result?.data) && !readErrors.length) {
        // Include tombstones and malformed rows: their IDs are not local-only.
        const cloudIDs = new Set(result.data.map(row => row?.id));
        for (const c of store.characters) {
          // Existing outbox operations must keep their order and payload.
          if (cloudIDs.has(c.id) || pending(c.id) || changedDuringFetch.has(c.id)) continue;
          enqueue(c.id, c);
        }
        // Cloud merges and migration are baselines, not new editor changes.
        snapshots = new Map(store.characters.map(c => [c.id, JSON.stringify(c)]));
      }
    } catch (error) { cloudError = error.message || String(error); }
    finally { loadingCloud = false; fetching = false; changedDuringFetch.clear(); saveStatus(); }
  }
  function options() {
    const select = $('#npcSelect'); select.replaceChildren();
    store.characters.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.fields['input-name'] || 'Без имени'; select.append(o); });
    select.value = store.active;
    $('#undoBtn').disabled = !undo.length;
  }
  function capture() {
    const c = clone(current());
    c.fields = Object.fromEntries(fixedFields.map(e => [e.dataset.key, e.type === 'checkbox' ? e.checked : e.type === 'number' ? (e.value === '' ? null : Number(e.value)) : e.value]));
    c.ratings = Object.fromEntries(baseDots.map(e => [`${e.dataset.type}.${e.dataset.name}`, Number(e.dataset.value || 0)]));
    Object.entries(listRoots).forEach(([key, root]) => {
      c.lists[key] = [...root.querySelectorAll(':scope > .list-item, :scope > .dynamic-row')].map(row => ({ name: row.querySelector('input').value, value: row.querySelector('.dots') ? Number(row.querySelector('.dots').dataset.value || 0) : null }));
    });
    c.health = $$('.health-box').map(e => Number(e.dataset.state)); c.portrait = portrait;
    return c;
  }
  function commit() {
    const before = current(), after = capture();
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    undo.push(clone(before)); if (undo.length > 100) undo.shift();
    store.characters[store.characters.indexOf(before)] = after;
    persist(); options(); mode();
  }
  const generation = () => Number($('#generationInput').value) || 13;
  const maxTrait = () => Math.max(5, Math.min(10, 13 - generation()));
  function nosferatu() { return /^(носферату|nosferatu)$/i.test($('.input-clan').value.trim()); }
  function dots(root, max, value = 0) {
    const attribute = root.dataset.type === 'attr';
    const locked = attribute && root.dataset.name === 'app' && nosferatu();
    if (attribute) value = locked ? 0 : Math.max(1, Number(value) || 1);
    root.title = locked ? 'Носферату: привлекательность всегда 0' : '';
    root.dataset.value = value == null ? '' : value;
    root.replaceChildren();
    for (let i = 1; i <= max; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dot';
      b.classList.toggle('active', i <= value); b.setAttribute('aria-label', `Значение ${i} из ${max}`); b.setAttribute('aria-pressed', String(i <= value));
      b.disabled = locked;
      b.onclick = () => { if (locked) return; dots(root, max, Number(root.dataset.value) === i ? (attribute ? 1 : 0) : i); commit(); filter(); };
      root.append(b);
    }
  }
  // V20: for generations 1–3 numeric blood limits are not specified here.
  const blood = { 4:[50,10], 5:[40,8], 6:[30,6], 7:[20,4], 8:[15,3], 9:[14,2], 10:[13,1], 11:[12,1], 12:[11,1], 13:[10,1], 14:[10,1], 15:[10,1] };
  function limits() {
    const rule = blood[generation()];
    $('#bloodMaxLabel').textContent = rule ? rule[0] : 'особый';
    $('#bloodSpend').value = rule ? rule[1] : '';
    $('#bloodSpend').placeholder = 'Решение Рассказчика';
    if (rule) $('#bloodCurrent').max = rule[0]; else $('#bloodCurrent').removeAttribute('max');
    $$('.dots[data-type="attr"], .ability-group .dots, .discipline-dots').forEach(e => dots(e, maxTrait(), Number(e.dataset.value || 0)));
    const boxes = $('#bloodBoxes'); boxes.replaceChildren();
    const squareMode = rule && rule[0] <= 20;
    $('#bloodCurrent').hidden = !!squareMode;
    if (squareMode) for(let i=1;i<=rule[0];i++) {
      const b=document.createElement('button'); b.type='button'; b.className='dot'; b.classList.toggle('active',i<=Number($('#bloodCurrent').value)); b.setAttribute('aria-label',`Кровь ${i} из ${rule[0]}`);
      b.onclick=()=>{ $('#bloodCurrent').value=Number($('#bloodCurrent').value)===i ? i-1 : i; limits(); commit(); }; boxes.append(b);
    }
    const wp = $('[data-type="wp"]'); dots(wp, Math.max(0, Math.min(10, Number($('#willpowerMax').value) || 0)), Number(wp.dataset.value || 0));
  }
  function filter() {
    $$('.ability-group .dot-row').forEach(row => { row.hidden = $('#hideUntrained').checked && !Number(row.querySelector('.dots').dataset.value); });
  }
  const listRoots = { disciplines: $('#disciplinesList'), facts: $('#factsList'), merits: $('#meritsList'), flaws: $('#flawsList') };
  $$('.ability-group').forEach((group, i) => {
    const key = ['talent','skill','knowledge'][i];
    group.querySelectorAll('.dynamic-row').forEach(e => e.remove());
    const root = document.createElement('div'); group.append(root); listRoots[key] = root;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-add'; b.textContent = '+ Своя способность';
    b.onclick = () => { addRow(key); $('#hideUntrained').checked = false; filter(); commit(); }; group.append(b);
  });
  function addRow(key, item = { name: '', value: 0 }) {
    const row = document.createElement('div'); row.className = ['talent','skill','knowledge'].includes(key) ? 'dot-row dynamic-row' : 'list-item';
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Название'; input.setAttribute('aria-label','Название'); input.value = item?.name ?? ''; row.append(input);
    if (!['merits','flaws'].includes(key)) { const d = document.createElement('div'); d.className = key === 'disciplines' ? 'dots discipline-dots' : 'dots'; dots(d, key === 'facts' ? 5 : maxTrait(), item?.value ?? 0); row.append(d); }
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn-icon'; del.textContent = '×'; del.setAttribute('aria-label','Удалить строку'); del.onclick = () => { row.remove(); commit(); }; row.append(del); listRoots[key].append(row);
  }
  [['disciplines','addDisciplineBtn'],['facts','addFactBtn'],['merits','addMeritBtn'],['flaws','addFlawBtn']].forEach(([key,id]) => { $('#'+id).onclick = () => { addRow(key); commit(); }; });
  const placeholder = new URL('img/plug.jpg', location.href).href;
  $('#currentPhoto').src = placeholder;
  function photoURL(value) {
    if (!value) return placeholder;
    try { const url = new URL(value); if (!['https:','http:'].includes(url.protocol)) return placeholder;
      if (url.hostname === 'drive.google.com') { const id = url.pathname.match(/\/d\/([\w-]+)/)?.[1] || url.searchParams.get('id'); if (id && /^[\w-]+$/.test(id)) return `https://lh3.googleusercontent.com/d/${id}`; }
      return url.href;
    } catch { return placeholder; }
  }
  function showPhoto() { $('#portraitImage').src = photoURL(portrait); }
  [$('#portraitImage'), $('#currentPhoto')].forEach(img => { img.onerror = () => { if (img.src !== placeholder) img.src = placeholder; }; });
  function render() {
    const c = current();
    fixedFields.forEach(e => { const v = c.fields[e.dataset.key]; if (e.type === 'checkbox') e.checked = !!v; else e.value = v ?? ''; });
    baseDots.forEach(e => dots(e, 5, c.ratings[`${e.dataset.type}.${e.dataset.name}`] ?? 0));
    Object.entries(listRoots).forEach(([k,root]) => { root.replaceChildren(); (c.lists[k] || []).forEach(item => addRow(k,item)); });
    $$('.health-box').forEach((e,i) => { e.dataset.state = c.health[i] || 0; e.setAttribute('aria-label', `Уровень здоровья ${i+1}, урон ${e.dataset.state}`); });
    portrait = c.portrait; showPhoto(); limits(); filter(); options(); mode();
  }
  document.querySelector('.content-container').addEventListener('input', e => { if (!e.target.matches('input,textarea')) return; if (['generationInput','willpowerMax'].includes(e.target.id) || e.target.classList.contains('input-clan')) limits(); filter(); commit(); });
  $$('.health-box').forEach((box,i) => {
    box.tabIndex = 0; box.setAttribute('role','button');
    const change = () => { box.dataset.state = (Number(box.dataset.state) + 1) % 4; box.setAttribute('aria-label',`Уровень здоровья ${i+1}, урон ${box.dataset.state}`); commit(); };
    box.onclick = change; box.onkeydown = e => { if (['Enter',' '].includes(e.key)) { e.preventDefault(); change(); } };
  });
  function activate(name) {
    if (!['base','resources','bio'].includes(name)) name = 'base'; tab = name;
    $$('.tab').forEach(e => { e.classList.toggle('active',e.dataset.tab === name); e.setAttribute('aria-pressed', String(e.dataset.tab === name)); });
    $$('.tab-content').forEach(e => { e.classList.toggle('active',e.dataset.content === name); });
    window.scrollTo(0,0);
  }
  $$('.tab').forEach(e => e.onclick = () => activate(e.dataset.tab));
  let start = null;
  $('.content-container').addEventListener('touchstart', e => { start = e.touches.length === 1 && !e.target.closest('input,textarea,button,summary,.health-box') ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : null; }, {passive:true});
  $('.content-container').addEventListener('touchend', e => { if (!start) return; const dx=e.changedTouches[0].clientX-start.x, dy=e.changedTouches[0].clientY-start.y; start=null; if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*2) { const names=['base','resources','bio']; const next=names[names.indexOf(tab)+(dx<0?1:-1)]; if(next) activate(next); } }, {passive:true});
  const modal = $('#photoModal'); modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-label','Портрет');
  const close = () => { modal.classList.remove('active'); $('#openPhotoBtn').focus(); };
  $('#openPhotoBtn').onclick = () => { $('#photoUrlInput').value = portrait || ''; $('#currentPhoto').src = photoURL(portrait); modal.classList.add('active'); $('#photoUrlInput').focus(); };
  $('.close-btn').onclick = close; modal.onclick = e => { if(e.target===modal) close(); };
  modal.onkeydown = e => { if(e.key==='Escape') close(); if(e.key==='Tab') { const a=[...modal.querySelectorAll('button,input')]; if(e.shiftKey && document.activeElement===a[0]) { e.preventDefault(); a.at(-1).focus(); } else if(!e.shiftKey && document.activeElement===a.at(-1)) { e.preventDefault(); a[0].focus(); } } };
  $('#photoUrlInput').oninput = () => { $('#currentPhoto').src = photoURL($('#photoUrlInput').value); };
  $('#savePhotoBtn').onclick = () => { const value=$('#photoUrlInput').value.trim(); if(value && photoURL(value)===placeholder) { alert('Введите ссылку HTTP или HTTPS.'); return; } portrait=value || null; showPhoto(); commit(); close(); };
  $('#clearPhotoBtn').onclick = () => { $('#photoUrlInput').value=''; $('#currentPhoto').src=placeholder; };
  $('#undoBtn').onclick = () => { if(!undo.length) return; store.characters[store.characters.indexOf(current())]=undo.pop(); render(); persist(); };
  $('#npcSelect').onchange = e => { openCharacter(e.target.value); persist(); };
  $('#backNpcBtn').onclick = library;
  $('#deleteNpcBtn').onclick = () => deleteCharacter(store.active);
  function deleteCharacter(id) {
    const c = store.characters.find(item => item.id === id); if (!c || !confirm(`Удалить НПС «${c.fields['input-name'] || 'Без имени'}»? Это действие нельзя отменить. Для резервной копии используйте экспорт JSON.`)) return;
    store.characters = store.characters.filter(item => item.id !== c.id);
    store.active = store.characters[0]?.id || null; undo = [];
    options(); persist(); library();
  }
  $('#npcSearch').oninput = library;
  $('#editNpcBtn').onclick = () => { editing=!editing; mode(); };
  $('#hideUntrained').addEventListener('change', filter);
  $('#newNpcBtn').onclick = () => { const c=blank(); store.characters.push(c); openCharacter(c.id,true); persist(); };
  $('#duplicateNpcBtn').onclick = () => { const c=clone(current()); c.id=uid(); c.fields['input-name']=(c.fields['input-name'] || 'Без имени')+' — копия'; store.characters.push(c); openCharacter(c.id,true); persist(); };
  $('#exportNpcBtn').onclick = () => { const blob=new Blob([JSON.stringify(current(),null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=(current().fields['input-name'] || 'npc').replace(/[\\/:*?"<>|]/g,'_')+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
  function normalize(raw) {
    if(!raw || raw.schema_version!==1 || raw.ruleset!=='V20' || !raw.fields || typeof raw.fields!=='object') throw new Error('Ожидается экспорт карточки V20 версии 1.');
    const c=blank();
    if (isUUID(raw.id)) c.id = raw.id;
    fixedFields.forEach(e => { const v=raw.fields[e.dataset.key]; if(v==null) c.fields[e.dataset.key]=null; else if(e.type==='number') { if(typeof v!=='number' || !Number.isFinite(v) || !Number.isInteger(v) || (e.min!=='' && v<Number(e.min)) || (e.max!=='' && e.id!=='bloodCurrent' && v>Number(e.max))) throw new Error('Некорректное число: '+e.dataset.key); c.fields[e.dataset.key]=v; } else c.fields[e.dataset.key]=e.type==='checkbox' ? !!v : String(v); });
    baseDots.forEach(e => { const k=`${e.dataset.type}.${e.dataset.name}`, v=raw.ratings?.[k]; if(v!=null && (!Number.isInteger(v)||v<0||v>10)) throw new Error('Некорректное значение точек'); c.ratings[k]=e.dataset.type === 'attr' ? (e.dataset.name === 'app' && /^(носферату|nosferatu)$/i.test(String(c.fields['input-clan'] || '').trim()) ? 0 : Math.max(1,v ?? 1)) : v ?? 0; });
    Object.keys(c.lists).forEach(k => { const arr=raw.lists?.[k] ?? []; if(!Array.isArray(arr)||arr.length>500) throw new Error('Некорректный список'); c.lists[k]=arr.map(item=> { const v=item?.value ?? 0; if(!Number.isInteger(v)||v<0||v>10) throw new Error('Некорректный уровень'); return {name:String(item?.name ?? ''),value:v}; }); });
    c.health=raw.health ?? [0,0,0,0,0,0,0]; if(!Array.isArray(c.health)||c.health.length!==7||c.health.some(v=>!Number.isInteger(v)||v<0||v>3)) throw new Error('Здоровье: семь чисел 0–3');
    c.portrait=typeof raw.portrait==='string' ? raw.portrait : null; return c;
  }
  $('#importNpcBtn').onclick=()=>$('#importNpcFile').click();
  $('#importNpcFile').onchange=async e=> { const file=e.target.files[0]; if(!file)return; try { if(file.size>2000000)throw new Error('Файл больше 2 МБ'); const c=normalize(JSON.parse(await file.text())); c.id=uid(); store.characters.push(c); openCharacter(c.id,true); persist(); } catch(err){alert('Импорт отменён: '+err.message);} finally{e.target.value='';} };
  let failed=false;
  try { const saved=localStorage.getItem(KEY); if(saved) { const raw=JSON.parse(saved); if(!Array.isArray(raw.characters))throw new Error(); const activeIndex=raw.characters.findIndex(c=>c.id===raw.active); store.characters=raw.characters.map(normalize); store.active=store.characters[Math.max(0,activeIndex)]?.id || null; } } catch { failed=true; try { recoveryPending=localStorage.getItem(KEY); } catch {} }
  if (store.characters.length) render(); else options();
  activate('base'); library();
  // Establish the editor baseline; loadCloud migrates only verified local-only IDs.
  snapshots = new Map(store.characters.map(c => [c.id, JSON.stringify(c)]));
  store.characters.forEach(c => knownIDs.add(c.id));
  if (failed) localError = 'Не удалось прочитать сохранение. Исходная запись пока не перезаписана.';
  else writeLocal(); // Save migrated legacy IDs once so the UUID survives reload.
  window.addEventListener('online', () => { void sendCloud(); void loadCloud(); });
  saveStatus();
  void loadCloud();
  void sendCloud();
});
