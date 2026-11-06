(function () {
  'use strict';

  const supabaseUrl = 'https://cuvexievsoldyadbtckc.supabase.co';
  const supabaseKey = 'sb_publishable_8QFv2y1yU7kBTF_bJThlpQ_aAbLqCx8';
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

  const COLORS = ['red', 'blue', 'green', 'yellow', 'black'];
  const COLOR_HEX = { red: '#e03636', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', black: '#15151a' };
  const LINE_COLORS = { red: '#ff4444', blue: '#3b82f6', green: '#22c55e' };

  let allPoints = [];
  let gameLocations = [];
  let drawnLines = [];
  let lineIdCounter = 1;
  let editingId = null;
  let map, markerLayer, lineLayer;

  document.getElementById('loginBtn').onclick = () => {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    if (user === 'admin' && pass === 'admin') {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      initAdminMap();
    } else { alert('Неверный логин или пароль!'); }
  };

  function getDirectImageUrl(url) {
    if (!url) return '';
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return `https://lh3.googleusercontent.com/d/${match[1]}`;
    return url;
  }

  async function loadFromDB() {
    const { data, error } = await supabase.from('points').select('*');
    if (!error && data) {
      allPoints = data;
      gameLocations = data.filter(p => p.type === 'game');
    }
  }

  function initAdminMap() {
    map = L.map('map', { center: [55.751, 37.618], zoom: 11, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}').addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    lineLayer = L.layerGroup().addTo(map);

    map.on('click', (e) => {
      if (document.getElementById('mobilePinOverlay').classList.contains('active')) return;
      document.getElementById('adminLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('adminLng').value = e.latlng.lng.toFixed(6);
    });

    map.on('move', () => {
      if (document.getElementById('mobilePinOverlay').classList.contains('active')) {
        const center = map.getCenter();
        document.getElementById('adminLat').value = center.lat.toFixed(6);
        document.getElementById('adminLng').value = center.lng.toFixed(6);
      }
    });

    loadFromDB().then(() => {
      renderAdminList();
      renderAdminMarkers();
      updateLinesUI();
      setTimeout(() => map.invalidateSize(), 200);
    });
  }

  // ================= ЛИНИИ =================
  const linesPanel = document.getElementById('linesPanel');
  const linesList = document.getElementById('linesList');

  function updateLinesUI() {
    if (drawnLines.length > 0) { linesPanel.style.display = 'block'; }
    else { linesPanel.style.display = 'none'; }

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

  document.getElementById('adminStartDrawLineBtn').onclick = () => {
    document.getElementById('sidebar').classList.remove('open');
    const color = document.getElementById('lineColorSelect').value;

    const drawer = new L.Draw.Polyline(map, {
      shapeOptions: { color: LINE_COLORS[color], weight: 4, dashArray: '5, 5' },
      maxPoints: 2
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

  // ================= СПИСОК И МАРКЕРЫ =================
  function renderAdminList() {
    const list = document.getElementById('adminList');
    if (gameLocations.length === 0) { list.innerHTML = '<div style="font-size:12px; color:var(--muted);">Нет локаций</div>'; return; }

    list.innerHTML = gameLocations.map(loc => {
      const isHidden = (loc.description || '').startsWith('{0}');
      return `
      <div class="admin-list-item">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span style="font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity: ${isHidden ? 0.5 : 1};">${loc.name}</span>
          ${isHidden ? '<span style="font-size:10px; color:red;">(скрыта)</span>' : ''}
        </div>
        <div style="display:flex; gap:4px;">
          <button class="btn-icon edit-btn" data-id="${loc.id}" style="color:#3b82f6;">✎</button>
          <button class="btn-icon del-btn" data-id="${loc.id}" style="color:#ff6b6b;">✕</button>
        </div>
      </div>
    `}).join('');

    list.querySelectorAll('.edit-btn').forEach(b => b.onclick = (e) => {
      const loc = gameLocations.find(l => l.id == e.target.dataset.id);
      if (loc) {
        editingId = loc.id;
        document.getElementById('adminName').value = loc.name;

        let desc = loc.description || '';
        const isVisible = !desc.startsWith('{0}');
        if (desc.startsWith('{1}') || desc.startsWith('{0}')) desc = desc.substring(3).trim();

        document.getElementById('adminDesc').value = desc;
        document.getElementById('adminImg').value = loc.image_url || '';
        document.getElementById('adminLat').value = loc.lat;
        document.getElementById('adminLng').value = loc.lng;
        document.getElementById('adminVisible').checked = isVisible;
        document.getElementById('adminColor').value = loc.color || 'red';

        document.getElementById('adminSaveBtn').textContent = 'Обновить';
        document.getElementById('adminCancelBtn').style.display = 'block';
        map.setView([loc.lat, loc.lng], 15);
        renderAdminMarkers();
      }
    });

    list.querySelectorAll('.del-btn').forEach(b => b.onclick = async (e) => {
      if (confirm('Удалить локацию?')) {
        const id = e.target.dataset.id;
        const { error } = await supabase.from('points').delete().eq('id', id);
        if (!error) {
          await loadFromDB();
          renderAdminList(); renderAdminMarkers(); resetForm();
        }
      }
    });
  }

  function renderAdminMarkers() {
    markerLayer.clearLayers();
    allPoints.forEach(pt => {
      const isGame = pt.type === 'game';
      const isEditing = (pt.id == editingId);

      if (!isGame) {
        L.marker([pt.lat, pt.lng], {
          icon: L.divIcon({
            className: 'vp-marker',
            html: `<div style="width:12px;height:12px;background:#3b82f6;border:2px solid #fff;border-radius:50%;"></div>`,
            iconSize: [12,12], iconAnchor: [6,6]
          })
        }).addTo(markerLayer).bindPopup(`Точка игрока: ${pt.name}`);
        return;
      }

      const hex = COLOR_HEX[pt.color] || '#8f1212';
      const marker = L.marker([pt.lat, pt.lng], {
        draggable: false,
        icon: L.divIcon({
          className: 'vp-marker',
          html: `<div style="width:24px; height:24px; background:${isEditing ? '#ff4444' : hex}; border:2px solid #fff; transform:rotate(45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 0 12px ${isEditing ? '#ff0000' : hex};">
                   <span style="transform:rotate(-45deg); font-size:12px; color:white;">⚔</span>
                 </div>`,
          iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
        })
      }).addTo(markerLayer);

      marker.bindPopup(`<div style="text-align:center; min-width:130px; padding: 5px;"><div style="font-weight:600; margin-bottom:10px; color:#fff; font-size:14px;">${pt.name}</div><button type="button" class="btn btn-primary drag-trigger-btn" style="padding:8px 10px; font-size:12px;">✋ Двигать</button></div>`);

      marker.on('popupopen', function() {
        const popupEl = marker.getPopup().getElement();
        if (!popupEl) return;
        const btn = popupEl.querySelector('.drag-trigger-btn');
        if (btn) {
          btn.onclick = function() {
            marker.closePopup();
            marker.dragging.enable();
            marker.setIcon(L.divIcon({
              className: 'vp-marker',
              html: `<div style="width:24px; height:24px; background:#ff4444; border:2px solid #fff; transform:rotate(45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 0 15px #ff0000; animation: pulse 1.5s infinite;">
                       <span style="transform:rotate(-45deg); font-size:12px; color:white;">⚔</span>
                     </div>`,
              iconSize: [24, 24], iconAnchor: [12, 12]
            }));
          };
        }
      });

      marker.on('dragend', async function () {
        const pos = marker.getLatLng();
        const { error } = await supabase.from('points').update({ lat: pos.lat, lng: pos.lng }).eq('id', pt.id);

        if (!error) {
          pt.lat = pos.lat; pt.lng = pos.lng;
          if (isEditing) {
            document.getElementById('adminLat').value = pos.lat.toFixed(6);
            document.getElementById('adminLng').value = pos.lng.toFixed(6);
          }
        }

        marker.dragging.disable();
        marker.setIcon(L.divIcon({
          className: 'vp-marker',
          html: `<div style="width:24px; height:24px; background:${isEditing ? '#ff4444' : hex}; border:2px solid #fff; transform:rotate(45deg); display:flex; align-items:center; justify-content:center;">
                   <span style="transform:rotate(-45deg); font-size:12px; color:white;">⚔</span>
                 </div>`,
          iconSize: [24, 24], iconAnchor: [12, 12]
        }));
      });
    });
  }

  // ================= СОХРАНЕНИЕ =================
  document.getElementById('adminSaveBtn').onclick = async () => {
    const name = document.getElementById('adminName').value.trim();
    let description = document.getElementById('adminDesc').value.trim();
    const rawImg = document.getElementById('adminImg').value.trim();
    const lat = parseFloat(document.getElementById('adminLat').value);
    const lng = parseFloat(document.getElementById('adminLng').value);
    const isVisible = document.getElementById('adminVisible').checked;
    const color = document.getElementById('adminColor').value;

    if (!name) return alert('Введите название');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return alert('Введите координаты');

    const prefix = isVisible ? '{1} ' : '{0} ';
    description = prefix + description;

    const image_url = getDirectImageUrl(rawImg);
    const pointData = { name, description, image_url, lat, lng, type: 'game', color };

    if (editingId) {
      const { error } = await supabase.from('points').update(pointData).eq('id', editingId);
      if (error) return alert('Ошибка обновления: ' + error.message);
    } else {
      const { error } = await supabase.from('points').insert([pointData]);
      if (error) return alert('Ошибка добавления: ' + error.message);
    }

    await loadFromDB();
    resetForm(); renderAdminList(); renderAdminMarkers();
    alert('Локация сохранена!');
  };

  function resetForm() {
    editingId = null;
    document.getElementById('adminName').value = '';
    document.getElementById('adminDesc').value = '';
    document.getElementById('adminImg').value = '';
    document.getElementById('adminVisible').checked = true;
    document.getElementById('adminColor').value = 'red';
    document.getElementById('adminSaveBtn').textContent = 'Сохранить локацию';
    document.getElementById('adminCancelBtn').style.display = 'none';
    renderAdminMarkers();
  }
  document.getElementById('adminCancelBtn').onclick = resetForm;

  // ================= ИМПОРТ / ЭКСПОРТ =================
  document.getElementById('downloadTemplateBtn').onclick = () => {
    const template = [
      {
        "name": "Красная площадь",
        "description": "Главная площадь Москвы. Здесь часто собираются кланы.",
        "image_url": "https://example.com/image.jpg",
        "lat": 55.7539,
        "lng": 37.6208,
        "color": "red"
      }
    ];
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'locations_template.json';
    a.click();
  };

  document.getElementById('importFile').onchange = function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error('Ожидается массив объектов');

        let addedCount = 0;
        for (const item of data) {
          if (!item.name || !item.lat || !item.lng) continue; // Минимальная валидация

          // Проверка на {0} или {1}
          let desc = item.description || '';
          if (!desc.startsWith('{0}') && !desc.startsWith('{1}')) {
            desc = '{0} ' + desc; // По умолчанию скрываем, если не указано
          }

          const newPoint = {
            name: item.name,
            description: desc,
            image_url: getDirectImageUrl(item.image_url || ''),
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lng),
            type: 'game',
            color: item.color || 'red'
          };

          const { error } = await supabase.from('points').insert([newPoint]);
          if (!error) addedCount++;
        }

        await loadFromDB();
        renderAdminList(); renderAdminMarkers();
        alert(`Успешно загружено: ${addedCount} из ${data.length}`);
      } catch (err) {
        alert('Ошибка чтения JSON: ' + err.message);
      }
      this.value = '';
    };
    reader.readAsText(file);
  };

  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();

  // ================= ОСТАЛЬНОЕ =================
  document.getElementById('adminSearchBtn').onclick = async function() {
    const query = document.getElementById('adminAddressInput').value.trim();
    if (!query) return;
    const btn = this; btn.textContent = '...'; btn.disabled = true;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('Москва, ' + query)}&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat); const lng = parseFloat(data[0].lon);
        document.getElementById('adminLat').value = lat.toFixed(6);
        document.getElementById('adminLng').value = lng.toFixed(6);
        map.setView([lat, lng], 16);
      } else { alert('Адрес не найден'); }
    } catch(e) { alert('Ошибка поиска'); } finally { btn.textContent = '🔍'; btn.disabled = false; }
  };

  const mobileOverlay = document.getElementById('mobilePinOverlay');
  const mobileBar = document.getElementById('mobilePinBar');
  document.getElementById('adminMobilePinBtn').onclick = () => {
    mobileOverlay.classList.add('active'); mobileBar.classList.add('active');
    document.getElementById('sidebar').classList.remove('open');
    const lat = parseFloat(document.getElementById('adminLat').value) || 55.751;
    const lng = parseFloat(document.getElementById('adminLng').value) || 37.618;
    map.setView([lat, lng], 16);
  };
  document.getElementById('mobilePinConfirm').onclick = () => {
    mobileOverlay.classList.remove('active'); mobileBar.classList.remove('active');
    document.getElementById('sidebar').classList.add('open');
  };
  document.getElementById('mobilePinCancel').onclick = () => {
    mobileOverlay.classList.remove('active'); mobileBar.classList.remove('active');
    document.getElementById('sidebar').classList.add('open');
  };

})();