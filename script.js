(function () {
  'use strict';
  
  if (typeof L === 'undefined' || typeof window.supabase === 'undefined') return;

  const supabaseUrl = 'https://cuvexievsoldyadbtckc.supabase.co';
  const supabaseKey = 'sb_publishable_8QFv2y1yU7kBTF_bJThlpQ_aAbLqCx8';
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

  const MOSCOW_BOUNDS = [[55.5, 37.3], [56.0, 37.9]];
  const MOSCOW_CENTER = [55.751, 37.618];
  const COLORS = ['red', 'blue', 'green', 'yellow', 'black'];
  const COLOR_HEX = { red: '#e03636', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', black: '#15151a' };
  const LINE_COLORS = { red: '#ff4444', blue: '#3b82f6', green: '#22c55e' };

  let allPoints = [];
  let drawnLines = []; // Хэш линий
  let lineIdCounter = 1;

  const markersById = new Map();
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  const map = L.map('map', {
    center: MOSCOW_CENTER, zoom: 11, minZoom: 10, maxZoom: 18,
    maxBounds: MOSCOW_BOUNDS, maxBoundsViscosity: 1.0, zoomControl: false
  });

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);
  const lineLayer = L.layerGroup().addTo(map);

  // ================= ЛИНИИ И РИСОВАНИЕ =================
  const linesPanel = document.getElementById('linesPanel');
  const linesList = document.getElementById('linesList');

  // Показываем панель линий всегда, если есть линии или мы в режиме рисования
  function updateLinesUI() {
    if (drawnLines.length > 0) {
      linesPanel.style.display = 'block';
    } else {
      linesPanel.style.display = 'none';
    }

    linesList.innerHTML = drawnLines.map(line => `
      <div class="line-item">
        <span style="color: ${LINE_COLORS[line.color]}">Линия ${line.id}</span>
        <button onclick="deleteLine(${line.id})">✕</button>
      </div>
    `).join('');
  }

  window.deleteLine = function(id) {
    drawnLines = drawnLines.filter(l => l.id !== id);
    lineLayer.clearLayers();
    drawnLines.forEach(l => {
      L.polyline([[l.lat1, l.lng1], [l.lat2, l.lng2]], { color: LINE_COLORS[l.color], weight: 4, dashArray: '5, 5' }).addTo(lineLayer);
    });
    updateLinesUI();
  };

  document.getElementById('startDrawLineBtn').onclick = () => {
    document.getElementById('sidebar').classList.remove('open');
    const color = document.getElementById('lineColorSelect').value;

    // Включаем режим рисования одной линии
    const drawer = new L.Draw.Polyline(map, {
      shapeOptions: { color: LINE_COLORS[color], weight: 4, dashArray: '5, 5' },
      maxPoints: 2 // Только 2 точки для прямой
    });
    drawer.enable();

    map.once(L.Draw.Event.CREATED, function (e) {
      const layer = e.layer;
      const latlngs = layer.getLatLngs();

      if (latlngs.length === 2) {
        const line = {
          id: lineIdCounter++,
          lat1: latlngs[0].lat, lng1: latlngs[0].lng,
          lat2: latlngs[1].lat, lng2: latlngs[1].lng,
          color: color
        };
        drawnLines.push(line);
        lineLayer.clearLayers();
        drawnLines.forEach(l => {
          L.polyline([[l.lat1, l.lng1], [l.lat2, l.lng2]], { color: LINE_COLORS[l.color], weight: 4, dashArray: '5, 5' }).addTo(lineLayer);
        });
        updateLinesUI();
      }
    });
  };

  // ================= ТОЧКИ =================
  async function loadPointsFromDB() {
    const { data, error } = await supabase.from('points').select('*');
    if (error) return [];
    return data.filter(pt => {
      if (pt.type !== 'game') return true;
      return !(pt.description || '').startsWith('{0}');
    });
  }

  function buildGameIcon(color) {
    const hex = COLOR_HEX[color] || '#8f1212';
    return L.divIcon({
      className: 'vp-marker',
      html: `<div style="width:24px; height:24px; background:${hex}; border:2px solid #fff; transform:rotate(45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${hex};"><span style="transform:rotate(-45deg); font-size:12px; color:white;">⚔</span></div>`,
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
    });
  }

  function buildUserIcon(color, isMoving) {
    const hex = COLOR_HEX[color] || COLOR_HEX.red;
    const glow = isMoving ? `0 0 15px ${hex}, 0 0 0 4px rgba(255,255,255,0.4)` : `0 2px 6px rgba(0,0,0,0.4)`;
    const anim = isMoving ? 'animation: pulse 1.5s infinite;' : '';
    return L.divIcon({
      className: 'vp-marker',
      html: `<div class="pin" style="background:${hex}; box-shadow:${glow}; ${anim}"></div>`,
      iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10]
    });
  }

  function buildGamePopup(item) {
    let desc = item.description || '';
    if (desc.startsWith('{1}') || desc.startsWith('{0}')) desc = desc.substring(3).trim();
    const img = item.image_url ? `<img src="${item.image_url}" class="vp-image" onerror="this.style.display='none'">` : '';
    return `<div class="vp-popup">${img}<div style="font-weight:600; font-size:14px; color:${COLOR_HEX[item.color] || '#ff6b6b'};">${item.name}</div><div class="vp-desc">${desc}</div><div style="font-size:10px; color:var(--muted); text-align:center;">📍 Локация рассказчика</div></div>`;
  }

  function buildUserPopup(item) {
    const swatches = COLORS.map(c => `<button type="button" class="swatch${c === item.color ? ' active' : ''}" data-color="${c}" style="background:${COLOR_HEX[c]}; width:24px;height:24px;border-radius:50%;border:2px solid #fff;cursor:pointer;"></button>`).join('');
    return `<div class="vp-popup" data-id="${item.id}">
      <div class="vp-label">Название</div>
      <input type="text" class="vp-name" value="${item.name}" style="width:100%;padding:5px;background:#000;color:#fff;border:1px solid #333;border-radius:4px;">
      <div class="vp-label">Цвет</div>
      <div style="display:flex;gap:5px;">${swatches}</div>
      <div class="vp-actions" style="margin-top: 5px;">
        <button type="button" class="vp-move" style="background:#2a2a35; color:#fff;">✋ Двигать</button>
      </div>
      <div class="vp-actions">
        <button type="button" class="vp-save">ОК</button>
        <button type="button" class="vp-delete">Удалить</button>
      </div>
    </div>`;
  }

  function renderAll() {
    markerLayer.clearLayers();
    markersById.clear();
    allPoints.forEach(pt => {
      const isGame = pt.type === 'game';
      const m = L.marker([pt.lat, pt.lng], {
        icon: isGame ? buildGameIcon(pt.color) : buildUserIcon(pt.color, false),
        draggable: false
      }).bindPopup(isGame ? buildGamePopup(pt) : buildUserPopup(pt), { minWidth: 220 });

      if (!isGame) {
        m.on('dragend', async function (e) {
          const newPos = e.target.getLatLng();
          const { error } = await supabase.from('points').update({ lat: newPos.lat, lng: newPos.lng }).eq('id', pt.id);
          if (!error) { pt.lat = newPos.lat; pt.lng = newPos.lng; }
          m.dragging.disable();
          m.setIcon(buildUserIcon(pt.color, false));
        });
      }
      m.addTo(markerLayer);
      markersById.set(pt.id, m);
    });
    updateSidebarList();
  }

  function updateSidebarList() {
    const list = document.getElementById('pointsList');
    document.getElementById('pointsCount').textContent = allPoints.length;
    if (allPoints.length === 0) { list.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;">Пусто</div>'; return; }

    list.innerHTML = allPoints.map(p => `<div class="point-item" data-id="${p.id}"><div class="point-info"><span style="color:${COLOR_HEX[p.color] || '#ff6b6b'};">${p.type === 'game' ? '⚔' : '📍'}</span><div class="point-name-text">${p.name}</div></div></div>`).join('');
    list.querySelectorAll('.point-item').forEach(el => {
      el.addEventListener('click', function() {
        const item = allPoints.find(p => p.id == this.getAttribute('data-id'));
        if (item) { map.setView([item.lat, item.lng], 15); markersById.get(item.id)?.openPopup(); }
      });
    });
  }

  // Логика клика (ПК)
  if (!isMobile) {
    map.doubleClickZoom.disable();
    map.on('dblclick', async (e) => {
      if (!map.getBounds().contains(e.latlng)) return;
      const newPoint = { name: 'Метка', lat: e.latlng.lat, lng: e.latlng.lng, color: 'red', type: 'user' };
      const { data, error } = await supabase.from('points').insert([newPoint]).select();
      if (!error && data) {
        allPoints.push(data[0]); renderAll();
        markersById.get(data[0].id)?.openPopup();
      }
    });
  }

  map.on('popupopen', (e) => {
    const root = e.popup.getElement()?.querySelector('.vp-popup[data-id]');
    if (!root) return;
    const id = root.getAttribute('data-id');
    const pt = allPoints.find(p => p.id == id);
    if (!pt) return;

    const nameInp = root.querySelector('.vp-name');
    let selColor = pt.color;
    root.querySelectorAll('.swatch').forEach(btn => { btn.onclick = () => { selColor = btn.dataset.color; }; });

    const moveBtn = root.querySelector('.vp-move');
    if (moveBtn) {
      moveBtn.onclick = () => {
        map.closePopup();
        const marker = markersById.get(pt.id);
        if (marker) { marker.dragging.enable(); marker.setIcon(buildUserIcon(pt.color, true)); }
      };
    }

    root.querySelector('.vp-save').onclick = async () => {
      const newName = nameInp.value || 'Метка';
      const { error } = await supabase.from('points').update({ name: newName, color: selColor }).eq('id', pt.id);
      if (!error) { pt.name = newName; pt.color = selColor; map.closePopup(); renderAll(); }
    };

    root.querySelector('.vp-delete').onclick = async () => {
      const { error } = await supabase.from('points').delete().eq('id', pt.id);
      if (!error) { allPoints = allPoints.filter(p => p.id != pt.id); map.closePopup(); renderAll(); }
    };
  });

  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.add('open');
  document.getElementById('closeSidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');

  document.getElementById('searchAddressBtn').onclick = async function() {
    const query = document.getElementById('addressInput').value.trim();
    if (!query) return;
    const btn = this; btn.textContent = '...'; btn.disabled = true;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('Москва, ' + query)}&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat); const lng = parseFloat(data[0].lon);
        const newPoint = { name: query, lat, lng, color: 'blue', type: 'user' };
        const { data: dbData, error } = await supabase.from('points').insert([newPoint]).select();
        if (!error && dbData) {
           allPoints.push(dbData[0]); map.setView([lat, lng], 15); renderAll();
           markersById.get(dbData[0].id)?.openPopup();
        }
      }
    } catch(e) {} finally { btn.textContent = 'Найти на карте'; btn.disabled = false; }
  };

  document.getElementById('addBtn').onclick = async () => {
    const lat = parseFloat(document.getElementById('lat').value);
    const lng = parseFloat(document.getElementById('lng').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const newPoint = { name: 'Метка', lat, lng, color: 'red', type: 'user' };
    const { data, error } = await supabase.from('points').insert([newPoint]).select();
    if (!error && data) {
      allPoints.push(data[0]); map.setView([lat, lng], 13); renderAll();
      markersById.get(data[0].id)?.openPopup();
    }
  };

  if (isMobile) {
    const mobileOverlay = document.getElementById('mobilePinOverlay');
    const mobileBar = document.getElementById('mobilePinBar');

    document.getElementById('mobileAddBtn').onclick = () => document.getElementById('sidebar').classList.add('open');

    document.getElementById('mobilePinBtn').onclick = () => {
      document.getElementById('sidebar').classList.remove('open');
      mobileOverlay.classList.add('active');
      mobileBar.classList.add('active');
    };

    document.getElementById('mobilePinConfirm').onclick = async () => {
      const center = map.getCenter();
      const newPoint = { name: 'Метка', lat: center.lat, lng: center.lng, color: 'red', type: 'user' };
      mobileOverlay.classList.remove('active');
      mobileBar.classList.remove('active');
      const { data, error } = await supabase.from('points').insert([newPoint]).select();
      if (!error && data) {
        allPoints.push(data[0]); renderAll();
        markersById.get(data[0].id)?.openPopup();
      }
    };

    document.getElementById('mobilePinCancel').onclick = () => {
      mobileOverlay.classList.remove('active');
      mobileBar.classList.remove('active');
      document.getElementById('sidebar').classList.add('open');
    };
  }

  async function init() {
    allPoints = await loadPointsFromDB();
    renderAll();
    updateLinesUI(); // Показываем список линий (если есть)
    setTimeout(() => map.invalidateSize(), 100);
  }

  init();

})();