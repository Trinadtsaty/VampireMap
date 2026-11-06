(function () {
  'use strict';
  
  if (typeof L === 'undefined') return;

  const MOSCOW_BOUNDS = [[55.5, 37.3], [56.0, 37.9]];
  const MOSCOW_CENTER = [55.751, 37.618];
  const COLORS = ['red', 'blue', 'green', 'yellow', 'black'];
  const COLOR_HEX = { red: '#e03636', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', black: '#15151a' };

  let gameLocations = [];
  let userPoints = [];
  try { userPoints = JSON.parse(localStorage.getItem('user_points_v1') || '[]'); } catch(e) {}

  const markersById = new Map();

  const map = L.map('map', {
    center: MOSCOW_CENTER, zoom: 11, minZoom: 10, maxZoom: 18,
    maxBounds: MOSCOW_BOUNDS, maxBoundsViscosity: 1.0, zoomControl: false
  });

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);

  async function loadLocations() {
    const localData = localStorage.getItem('game_locations_v1');
    if (localData) {
      try {
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed) && parsed.length > 0) { gameLocations = parsed; return; }
      } catch (e) {}
    }
    try {
      const response = await fetch('game_locations.json');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) gameLocations = data;
      }
    } catch (err) {}
  }

  function buildGameIcon() {
    return L.divIcon({
      className: 'vp-marker',
      html: `<div style="width:24px; height:24px; background:#8f1212; border:2px solid #ff4444; transform:rotate(45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px #ff0000;"><span style="transform:rotate(-45deg); font-size:12px; color:white;">⚔</span></div>`,
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
    });
  }

  // ДОБАВЛЕН ПАРАМЕТР isMoving (для анимации при перемещении)
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
    const img = item.image ? `<img src="${item.image}" class="vp-image" onerror="this.style.display='none'">` : '';
    return `<div class="vp-popup">${img}<div style="font-weight:600; font-size:14px; color:#ff6b6b;">${item.name}</div><div class="vp-desc">${item.desc}</div><div style="font-size:10px; color:var(--muted); text-align:center;">📍 Локация рассказчика</div></div>`;
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

    gameLocations.forEach(loc => {
      const m = L.marker([loc.lat, loc.lng], { icon: buildGameIcon() }).bindPopup(buildGamePopup(loc), { minWidth: 220 });
      m.addTo(markerLayer); markersById.set(loc.id, m);
    });

    userPoints.forEach(pt => {
      // draggable: false по умолчанию!
      const m = L.marker([pt.lat, pt.lng], { icon: buildUserIcon(pt.color, false), draggable: false }).bindPopup(buildUserPopup(pt));

      // Когда отпускаем маркер
      m.on('dragend', function (e) {
        const newPos = e.target.getLatLng();
        pt.lat = newPos.lat; pt.lng = newPos.lng;
        try { localStorage.setItem('user_points_v1', JSON.stringify(userPoints)); } catch(err) {}

        // Фиксируем точку обратно
        m.dragging.disable();
        m.setIcon(buildUserIcon(pt.color, false));
      });

      m.addTo(markerLayer); markersById.set(pt.id, m);
    });

    updateSidebarList();
  }

  function updateSidebarList() {
    const list = document.getElementById('pointsList');
    const all = [...gameLocations, ...userPoints];
    document.getElementById('pointsCount').textContent = all.length;
    if (all.length === 0) { list.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;">Пусто</div>'; return; }

    list.innerHTML = all.map(p => `<div class="point-item" data-id="${p.id}"><div class="point-info"><span style="color:#ff6b6b;">${p.type === 'game' ? '⚔' : '📍'}</span><div class="point-name-text">${p.name}</div></div></div>`).join('');
    list.querySelectorAll('.point-item').forEach(el => {
      el.addEventListener('click', function() {
        const item = all.find(p => p.id == this.getAttribute('data-id'));
        if (item) { map.setView([item.lat, item.lng], 15); markersById.get(item.id)?.openPopup(); }
      });
    });
  }

  map.on('click', (e) => {
    if (!map.getBounds().contains(e.latlng)) return;
    const newPoint = { id: 'usr-' + Date.now(), type: 'user', lat: e.latlng.lat, lng: e.latlng.lng, name: 'Метка', color: 'red' };
    userPoints.push(newPoint);
    try { localStorage.setItem('user_points_v1', JSON.stringify(userPoints)); } catch(e) {}
    renderAll(); markersById.get(newPoint.id)?.openPopup();
  });

  map.on('popupopen', (e) => {
    const root = e.popup.getElement()?.querySelector('.vp-popup[data-id]');
    if (!root) return;
    const id = root.getAttribute('data-id');
    const pt = userPoints.find(p => p.id === id);
    if (!pt) return;

    const nameInp = root.querySelector('.vp-name');
    let selColor = pt.color;

    root.querySelectorAll('.swatch').forEach(btn => { btn.onclick = () => { selColor = btn.dataset.color; }; });

    // КНОПКА "ДВИГАТЬ"
    const moveBtn = root.querySelector('.vp-move');
    if (moveBtn) {
      moveBtn.onclick = () => {
        map.closePopup();
        const marker = markersById.get(id);
        if (marker) {
          marker.dragging.enable(); // Включаем перетаскивание
          marker.setIcon(buildUserIcon(pt.color, true)); // Пульсирующий эффект
        }
      };
    }

    root.querySelector('.vp-save').onclick = () => {
      pt.name = nameInp.value || 'Метка'; pt.color = selColor;
      try { localStorage.setItem('user_points_v1', JSON.stringify(userPoints)); } catch(e) {}
      map.closePopup(); renderAll();
    };
    root.querySelector('.vp-delete').onclick = () => {
      userPoints = userPoints.filter(p => p.id !== id);
      try { localStorage.setItem('user_points_v1', JSON.stringify(userPoints)); } catch(e) {}
      map.closePopup(); renderAll();
    };
  });

  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.add('open');
  document.getElementById('closeSidebar').onclick = () => document.getElementById('sidebar').classList.remove('open');

  loadLocations().then(() => {
    renderAll();
    setTimeout(() => map.invalidateSize(), 100);
  });

})();