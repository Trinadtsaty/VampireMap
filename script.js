(function () {
  'use strict';
  
  if (typeof L === 'undefined' || typeof window.supabase === 'undefined') return;

  // --- НАСТРОЙКИ SUPABASE ---
  const supabaseUrl = 'https://cuvexievsoldyadbtckc.supabase.co';
  // Вставь сюда свой Publishable key!
  const supabaseKey = 'sb_publishable_8QFv2y1yU7kBTF_bJThlpQ_aAbLqCx8';
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
  // ---------------------------

  const MOSCOW_BOUNDS = [[55.5, 37.3], [56.0, 37.9]];
  const MOSCOW_CENTER = [55.751, 37.618];
  const COLORS = ['red', 'blue', 'green', 'yellow', 'black'];
  const COLOR_HEX = { red: '#e03636', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', black: '#15151a' };

  let allPoints = []; // Теперь все точки хранятся тут
  const markersById = new Map();

  const map = L.map('map', {
    center: MOSCOW_CENTER, zoom: 11, minZoom: 10, maxZoom: 18,
    maxBounds: MOSCOW_BOUNDS, maxBoundsViscosity: 1.0, zoomControl: false
  });

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);

  // --- ЗАГРУЗКА ИЗ SUPABASE ---
  async function loadPointsFromDB() {
    const { data, error } = await supabase.from('points').select('*');
    if (error) {
      console.error('Ошибка загрузки:', error);
      return [];
    }
    return data;
  }

  // --- ИКОНКИ ---
  function buildGameIcon() {
    return L.divIcon({
      className: 'vp-marker',
      html: `<div style="width:24px; height:24px; background:#8f1212; border:2px solid #ff4444; transform:rotate(45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px #ff0000;"><span style="transform:rotate(-45deg); font-size:12px; color:white;">⚔</span></div>`,
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

  // --- ПОПАПЫ ---
  function buildGamePopup(item) {
    const img = item.image_url ? `<img src="${item.image_url}" class="vp-image" onerror="this.style.display='none'">` : '';
    return `<div class="vp-popup">${img}<div style="font-weight:600; font-size:14px; color:#ff6b6b;">${item.name}</div><div class="vp-desc">${item.description || ''}</div><div style="font-size:10px; color:var(--muted); text-align:center;">📍 Локация рассказчика</div></div>`;
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

  // --- ОТРИСОВКА ---
  function renderAll() {
    markerLayer.clearLayers();
    markersById.clear();

    allPoints.forEach(pt => {
      const isGame = pt.type === 'game';
      const m = L.marker([pt.lat, pt.lng], {
        icon: isGame ? buildGameIcon() : buildUserIcon(pt.color, false),
        draggable: false
      }).bindPopup(isGame ? buildGamePopup(pt) : buildUserPopup(pt), { minWidth: 220 });

      if (!isGame) {
        m.on('dragend', async function (e) {
          const newPos = e.target.getLatLng();
          const { error } = await supabase.from('points').update({ lat: newPos.lat, lng: newPos.lng }).eq('id', pt.id);
          if (!error) {
            pt.lat = newPos.lat;
            pt.lng = newPos.lng;
          } else {
            alert('Ошибка сохранения координат');
          }
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

    list.innerHTML = allPoints.map(p => `<div class="point-item" data-id="${p.id}"><div class="point-info"><span style="color:#ff6b6b;">${p.type === 'game' ? '⚔' : '📍'}</span><div class="point-name-text">${p.name}</div></div></div>`).join('');
    list.querySelectorAll('.point-item').forEach(el => {
      el.addEventListener('click', function() {
        const item = allPoints.find(p => p.id == this.getAttribute('data-id'));
        if (item) { map.setView([item.lat, item.lng], 15); markersById.get(item.id)?.openPopup(); }
      });
    });
  }

  // --- СОЗДАНИЕ ТОЧКИ ---
  map.on('click', async (e) => {
    if (!map.getBounds().contains(e.latlng)) return;

    const newPoint = { name: 'Метка', lat: e.latlng.lat, lng: e.latlng.lng, color: 'red', type: 'user' };
    const { data, error } = await supabase.from('points').insert([newPoint]).select();

    if (!error && data) {
      allPoints.push(data[0]);
      renderAll();
      markersById.get(data[0].id)?.openPopup();
    }
  });

  // --- РЕДАКТИРОВАНИЕ ---
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
        if (marker) {
          marker.dragging.enable();
          marker.setIcon(buildUserIcon(pt.color, true));
        }
      };
    }

    root.querySelector('.vp-save').onclick = async () => {
      const newName = nameInp.value || 'Метка';
      const { error } = await supabase.from('points').update({ name: newName, color: selColor }).eq('id', pt.id);
      if (!error) {
        pt.name = newName; pt.color = selColor;
        map.closePopup(); renderAll();
      }
    };

    root.querySelector('.vp-delete').onclick = async () => {
      const { error } = await supabase.from('points').delete().eq('id', pt.id);
      if (!error) {
        allPoints = allPoints.filter(p => p.id != pt.id);
        map.closePopup(); renderAll();
      }
    };
  });

  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.add('open');
  document.getElementById('closeSidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');

  // --- ПОИСК И ДОБАВЛЕНИЕ (упрощенно для примера) ---
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
           allPoints.push(dbData[0]);
           map.setView([lat, lng], 15);
           renderAll();
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

  // --- ЗАПУСК ---
  async function init() {
    allPoints = await loadPointsFromDB();
    renderAll();
    setTimeout(() => map.invalidateSize(), 100);
  }

  init();

})();