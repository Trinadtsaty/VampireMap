(function () {
  'use strict';
  const STORAGE_KEY = 'game_locations_v1';
  let gameLocations = [];
  let editingId = null;
  let map, markerLayer;

  // --- АВТОРИЗАЦИЯ (с защитой от случайных пробелов) ---
  document.getElementById('loginBtn').onclick = () => {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    
    if (user === 'admin' && pass === 'admin') {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      initAdminMap();
    } else {
      alert('Неверный логин или пароль!');
    }
  };

  // --- ПАРСЕР GOOGLE ДИСКА ---
  function getDirectImageUrl(url) {
    if (!url) return '';
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return `https://lh3.googleusercontent.com/d/${match[1]}`;
    return url;
  }

  // --- ИНИЦИАЛИЗАЦИЯ КАРТЫ ---
  function initAdminMap() {
    map = L.map('map', { center: [55.751, 37.618], zoom: 11, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}').addTo(map);
    markerLayer = L.layerGroup().addTo(map);

    // Клик по карте (если не включен мобильный режим) — заполняем координаты
    map.on('click', (e) => {
      if (document.getElementById('mobilePinOverlay').classList.contains('active')) return;
      document.getElementById('adminLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('adminLng').value = e.latlng.lng.toFixed(6);
    });

    // Движение карты обновляет координаты (для мобильного режима)
    map.on('move', () => {
      if (document.getElementById('mobilePinOverlay').classList.contains('active')) {
        const center = map.getCenter();
        document.getElementById('adminLat').value = center.lat.toFixed(6);
        document.getElementById('adminLng').value = center.lng.toFixed(6);
      }
    });

    loadData();
    renderAdminList();
    renderAdminMarkers();
    
    // Лечим чёрный экран в админке
    setTimeout(() => map.invalidateSize(), 200); 
  }

  function loadData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) gameLocations = JSON.parse(saved);
  }
  
  function saveData() { 
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameLocations)); 
  }

  // --- СПИСОК ЛОКАЦИЙ В МЕНЮ ---
  function renderAdminList() {
    const list = document.getElementById('adminList');
    if (gameLocations.length === 0) { 
      list.innerHTML = '<div style="font-size:12px; color:var(--muted);">Нет локаций</div>'; 
      return; 
    }
    
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
      const loc = gameLocations.find(l => l.id === e.target.dataset.id);
      if (loc) {
        editingId = loc.id;
        document.getElementById('adminName').value = loc.name;
        document.getElementById('adminDesc').value = loc.desc;
        document.getElementById('adminImg').value = loc.image || '';
        document.getElementById('adminLat').value = loc.lat;
        document.getElementById('adminLng').value = loc.lng;
        document.getElementById('adminSaveBtn').textContent = 'Обновить';
        document.getElementById('adminCancelBtn').style.display = 'block';
        map.setView([loc.lat, loc.lng], 15);
        renderAdminMarkers(); // Перерисовываем, чтобы выделить нужный маркер
      }
    });

    list.querySelectorAll('.del-btn').forEach(b => b.onclick = (e) => {
      if (confirm('Удалить локацию?')) {
        gameLocations = gameLocations.filter(l => l.id !== e.target.dataset.id);
        saveData(); renderAdminList(); renderAdminMarkers(); resetForm();
      }
    });
  }

  // --- МАРКЕРЫ В АДМИНКЕ (С ЗАЩИТОЙ ОТ СЛУЧАЙНОГО СДВИГА) ---
  function renderAdminMarkers() {
    markerLayer.clearLayers();

    gameLocations.forEach(loc => {
      const isEditing = (loc.id === editingId);
      
      const marker = L.marker([loc.lat, loc.lng], {
        draggable: false, // По умолчанию СТРОГО зафиксирован
        icon: L.divIcon({
          className: 'vp-marker',
          html: `<div style="width:20px;height:20px;background:${isEditing ? '#ff4444' : '#8f1212'};border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 10px ${isEditing ? '#ff0000' : 'transparent'};"></div>`,
          iconSize: [20,20], iconAnchor: [10,10]
        })
      }).addTo(markerLayer);

      // Попап с кнопкой "Двигать"
      const popupHtml = `
        <div style="text-align:center; min-width:130px; padding: 5px;">
          <div style="font-weight:600; margin-bottom:10px; color:#fff; font-size:14px;">${loc.name}</div>
          <button type="button" class="btn btn-primary drag-trigger-btn" style="padding:8px 10px; font-size:12px;">✋ Двигать</button>
        </div>
      `;
      marker.bindPopup(popupHtml);

      // Когда открывается попап — вешаем обработчик на кнопку "Двигать"
      marker.on('popupopen', function() {
        const popupEl = marker.getPopup().getElement();
        if (!popupEl) return;
        const btn = popupEl.querySelector('.drag-trigger-btn');
        if (btn) {
          btn.onclick = function() {
            marker.closePopup();
            marker.dragging.enable(); // Разрешаем перетаскивание
            
            // Добавляем пульсацию, чтобы было видно, что маркер активен
            marker.setIcon(L.divIcon({
              className: 'vp-marker',
              html: `<div style="width:20px;height:20px;background:#ff4444;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 15px #ff0000; animation: pulse 1.5s infinite;"></div>`,
              iconSize: [20,20], iconAnchor: [10,10]
            }));
          };
        }
      });

      // Когда отпустили маркер
      marker.on('dragend', function () {
        const pos = marker.getLatLng();
        loc.lat = pos.lat;
        loc.lng = pos.lng;
        saveData();
        
        // Фиксируем обратно
        marker.dragging.disable();
        marker.setIcon(L.divIcon({
          className: 'vp-marker',
          html: `<div style="width:20px;height:20px;background:${isEditing ? '#ff4444' : '#8f1212'};border:2px solid #fff;transform:rotate(45deg);"></div>`,
          iconSize: [20,20], iconAnchor: [10,10]
        }));

        // Обновляем поля ввода, если редактируем именно эту точку
        if (isEditing) {
          document.getElementById('adminLat').value = pos.lat.toFixed(6);
          document.getElementById('adminLng').value = pos.lng.toFixed(6);
        }
      });
    });
  }

  // --- СОХРАНЕНИЕ ЛОКАЦИИ ---
  document.getElementById('adminSaveBtn').onclick = () => {
    const name = document.getElementById('adminName').value.trim();
    const desc = document.getElementById('adminDesc').value.trim();
    const rawImg = document.getElementById('adminImg').value.trim();
    const lat = parseFloat(document.getElementById('adminLat').value);
    const lng = parseFloat(document.getElementById('adminLng').value);

    if (!name) return alert('Введите название');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return alert('Введите координаты');

    const image = getDirectImageUrl(rawImg);

    if (editingId) {
      const loc = gameLocations.find(l => l.id === editingId);
      Object.assign(loc, { name, desc, image, lat, lng });
    } else {
      gameLocations.push({ id: 'loc-' + Date.now(), type: 'game', name, desc, image, lat, lng });
    }

    saveData(); resetForm(); renderAdminList(); renderAdminMarkers();
    alert('Локация сохранена!');
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

  // --- ПОИСК ПО АДРЕСУ ---
  document.getElementById('adminSearchBtn').onclick = async function() {
    const query = document.getElementById('adminAddressInput').value.trim();
    if (!query) return;
    
    const btn = this; btn.textContent = '...'; btn.disabled = true;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('Москва, ' + query)}&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        document.getElementById('adminLat').value = lat.toFixed(6);
        document.getElementById('adminLng').value = lng.toFixed(6);
        map.setView([lat, lng], 16);
      } else { alert('Адрес не найден'); }
    } catch(e) { alert('Ошибка поиска'); } finally { btn.textContent = '🔍'; btn.disabled = false; }
  };

  // --- МОБИЛЬНЫЙ РЕЖИМ (ПРИЦЕЛ) ---
  const mobileOverlay = document.getElementById('mobilePinOverlay');
  const mobileBar = document.getElementById('mobilePinBar');

  document.getElementById('adminMobilePinBtn').onclick = () => {
    mobileOverlay.classList.add('active');
    mobileBar.classList.add('active');
    document.getElementById('sidebar').classList.remove('open');
    
    const lat = parseFloat(document.getElementById('adminLat').value) || 55.751;
    const lng = parseFloat(document.getElementById('adminLng').value) || 37.618;
    map.setView([lat, lng], 16);
  };

  document.getElementById('mobilePinConfirm').onclick = () => {
    mobileOverlay.classList.remove('active');
    mobileBar.classList.remove('active');
    document.getElementById('sidebar').classList.add('open');
  };

  document.getElementById('mobilePinCancel').onclick = () => {
    mobileOverlay.classList.remove('active');
    mobileBar.classList.remove('active');
    document.getElementById('sidebar').classList.add('open');
  };

  // --- ЭКСПОРТ / ИМПОРТ ---
  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(gameLocations, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'game_locations.json';
    a.click();
  };

  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (Array.isArray(data)) {
          gameLocations = data; saveData(); renderAdminList(); renderAdminMarkers(); alert('Импорт успешен!');
        }
      } catch (err) { alert('Ошибка чтения JSON'); }
      this.value = '';
    };
    reader.readAsText(file);
  };
})();