(function () {
  'use strict';

  // --- НАСТРОЙКИ SUPABASE ---
  const supabaseUrl = 'https://cuvexievsoldyadbtckc.supabase.co';
  // Вставь сюда свой Publishable key!
  const supabaseKey = 'sb_publishable_8QFv2y1yU7kBTF_bJThlpQ_aAbLqCx8';
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
  // ---------------------------

  let gameLocations = [];
  let editingId = null;
  let map, markerLayer;

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
    const { data, error } = await supabase.from('points').select('*').eq('type', 'game');
    if (!error && data) gameLocations = data;
  }

  function initAdminMap() {
    map = L.map('map', { center: [55.751, 37.618], zoom: 11, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}').addTo(map);
    markerLayer = L.layerGroup().addTo(map);

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
      setTimeout(() => map.invalidateSize(), 200);
    });
  }

  function renderAdminList() {
    const list = document.getElementById('adminList');
    if (gameLocations.length === 0) { list.innerHTML = '<div style="font-size:12px; color:var(--muted);">Нет локаций</div>'; return; }

    list.innerHTML = gameLocations.map(loc => `
      <div class="admin-list-item">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span style="font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${loc.name}</span>
        </div>
        <div style="display:flex; gap:4px;">
          <button class="btn-icon edit-btn" data-id="${loc.id}" style="color:#3b82f6;">✎</button>
          <button class="btn-icon del-btn" data-id="${loc.id}" style="color:#ff6b6b;">✕</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.edit-btn').forEach(b => b.onclick = (e) => {
      const loc = gameLocations.find(l => l.id == e.target.dataset.id);
      if (loc) {
        editingId = loc.id;
        document.getElementById('adminName').value = loc.name;
        document.getElementById('adminDesc').value = loc.description || '';
        document.getElementById('adminImg').value = loc.image_url || '';
        document.getElementById('adminLat').value = loc.lat;
        document.getElementById('adminLng').value = loc.lng;
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
          gameLocations = gameLocations.filter(l => l.id != id);
          renderAdminList(); renderAdminMarkers(); resetForm();
        }
      }
    });
  }

  function renderAdminMarkers() {
    markerLayer.clearLayers();
    gameLocations.forEach(loc => {
      const isEditing = (loc.id == editingId);
      const marker = L.marker([loc.lat, loc.lng], {
        draggable: false,
        icon: L.divIcon({
          className: 'vp-marker',
          html: `<div style="width:20px;height:20px;background:${isEditing ? '#ff4444' : '#8f1212'};border:2px solid #fff;transform:rotate(45deg);"></div>`,
          iconSize: [20,20], iconAnchor: [10,10]
        })
      }).addTo(markerLayer);

      marker.bindPopup(`<div style="text-align:center; min-width:130px; padding: 5px;"><div style="font-weight:600; margin-bottom:10px; color:#fff; font-size:14px;">${loc.name}</div><button type="button" class="btn btn-primary drag-trigger-btn" style="padding:8px 10px; font-size:12px;">✋ Двигать</button></div>`);

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
              html: `<div style="width:20px;height:20px;background:#ff4444;border:2px solid #fff;transform:rotate(45deg); animation: pulse 1.5s infinite;"></div>`,
              iconSize: [20,20], iconAnchor: [10,10]
            }));
          };
        }
      });

      marker.on('dragend', async function () {
        const pos = marker.getLatLng();
        const { error } = await supabase.from('points').update({ lat: pos.lat, lng: pos.lng }).eq('id', loc.id);

        if (!error) {
          loc.lat = pos.lat; loc.lng = pos.lng;
          if (isEditing) {
            document.getElementById('adminLat').value = pos.lat.toFixed(6);
            document.getElementById('adminLng').value = pos.lng.toFixed(6);
          }
        }

        marker.dragging.disable();
        marker.setIcon(L.divIcon({
          className: 'vp-marker',
          html: `<div style="width:20px;height:20px;background:${isEditing ? '#ff4444' : '#8f1212'};border:2px solid #fff;transform:rotate(45deg);"></div>`,
          iconSize: [20,20], iconAnchor: [10,10]
        }));
      });
    });
  }

  document.getElementById('adminSaveBtn').onclick = async () => {
    const name = document.getElementById('adminName').value.trim();
    const description = document.getElementById('adminDesc').value.trim();
    const rawImg = document.getElementById('adminImg').value.trim();
    const lat = parseFloat(document.getElementById('adminLat').value);
    const lng = parseFloat(document.getElementById('adminLng').value);

    if (!name) return alert('Введите название');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return alert('Введите координаты');

    const image_url = getDirectImageUrl(rawImg);
    const pointData = { name, description, image_url, lat, lng, type: 'game' };

    if (editingId) {
      const { error } = await supabase.from('points').update(pointData).eq('id', editingId);
      if (!error) {
        const loc = gameLocations.find(l => l.id == editingId);
        Object.assign(loc, pointData);
      }
    } else {
      const { data, error } = await supabase.from('points').insert([pointData]).select();
      if (!error && data) gameLocations.push(data[0]);
    }

    resetForm(); renderAdminList(); renderAdminMarkers();
    alert('Сохранено!');
  };

  function resetForm() {
    editingId = null;
    document.getElementById('adminName').value = '';
    document.getElementById('adminDesc').value = '';
    document.getElementById('adminImg').value = '';
    document.getElementById('adminSaveBtn').textContent = 'Сохранить локацию';
    document.getElementById('adminCancelBtn').style.display = 'none';
    renderAdminMarkers();
  }
  document.getElementById('adminCancelBtn').onclick = resetForm;

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
      } else { alert('Не найдено'); }
    } catch(e) { alert('Ошибка'); } finally { btn.textContent = '🔍'; btn.disabled = false; }
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