(function () {
  const data = window.PODGORICA_TRANSIT;
  const panel = document.getElementById("panel");
  const sourcesButton = document.getElementById("sourcesButton");
  const locateButton = document.getElementById("locateButton");
  const locateLabel = locateButton.querySelector("[data-locate-label]");
  const message = document.getElementById("mapMessage");
  const networkSummary = document.getElementById("networkSummary");

  if (!window.L || !data || !Array.isArray(data.routes) || !data.routes.length) {
    panel.innerHTML = '<p class="panel-kicker">Ошибка загрузки</p><h2>Карта не загрузилась</h2><p>Обновите страницу или попробуйте ещё раз позже.</p>';
    networkSummary.textContent = "Нет данных";
    return;
  }

  const routeById = new Map(data.routes.map(route => [String(route.id), route]));
  const stopById = new Map(data.stops.map(stop => [String(stop.id), stop]));
  const routeOrder = new Map(data.routes.map((route, index) => [String(route.id), index]));
  const memberships = new Map(data.stops.map(stop => [String(stop.id), []]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  data.routes.forEach(route => {
    route.directions.forEach(direction => {
      direction.variants.forEach(variant => {
        variant.stopIds.forEach((stopId, index) => {
          const list = memberships.get(String(stopId));
          if (list) list.push({ route, direction, variant, index });
        });
      });
    });
  });

  const map = L.map("map", {
    zoomControl: false,
    minZoom: 8,
    maxZoom: 18,
    preferCanvas: true
  }).setView([42.4406, 19.2636], 12);

  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  map.createPane("networkPane");
  map.getPane("networkPane").style.zIndex = 330;
  map.createPane("routePane");
  map.getPane("routePane").style.zIndex = 390;
  map.createPane("stopPane");
  map.getPane("stopPane").style.zIndex = 440;

  const networkLayer = L.layerGroup().addTo(map);
  const activeRouteLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  const locationLayer = L.layerGroup().addTo(map);
  const stopRenderer = L.canvas({ pane: "stopPane", padding: 0.4 });
  const stopMarkers = new Map();

  let activeRouteId = null;
  let activeDirectionId = 0;
  let activeVariantId = 0;
  let routeContextStopId = null;
  let selectedStopId = null;
  let manualLocationMode = false;
  let locationRequestId = 0;

  data.routes.forEach(route => {
    const direction = route.directions[0];
    if (!direction) return;
    direction.variants.forEach(variant => {
      if (variant.geometry.length < 2) return;
      L.polyline(variant.geometry, {
        pane: "networkPane",
        color: route.color,
        weight: 2.2,
        opacity: 0.28,
        interactive: false,
        lineJoin: "round"
      }).addTo(networkLayer);
    });
  });

  data.stops.forEach(stop => {
    const marker = L.circleMarker([stop.lat, stop.lng], {
      pane: "stopPane",
      renderer: stopRenderer,
      radius: 3.5,
      weight: 1.6,
      color: "#ffffff",
      fillColor: "#17384d",
      fillOpacity: 0.82,
      opacity: 0.95
    }).addTo(stopLayer);
    marker.bindTooltip(escapeHtml(stop.name), { direction: "top", offset: [0, -5], opacity: 0.96 });
    marker.on("click", event => {
      if (manualLocationMode) {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        useManualLocation({ lat: stop.lat, lng: stop.lng });
        return;
      }
      showStop(stop.id, true);
    });
    stopMarkers.set(String(stop.id), marker);
  });

  networkSummary.textContent = `${data.routes.length} линий · ${data.stops.length} остановок`;
  renderOverview();

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function cleanTerminal(value) {
    return String(value || "").replace(/\s*\([ABАВ]\)\s*$/u, "");
  }

  function formatSnapshotDate() {
    const date = new Date(data.generatedAt);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  function sourceNote() {
    return `<div class="source-note"><p><strong>Источники:</strong> ePodgorica, Putevi и OpenStreetMap · снимок ${escapeHtml(formatSnapshotDate())}.</p><button class="source-details" type="button" data-action="sources">Источники и методика</button></div>`;
  }

  function renderSources() {
    endManualLocationMode();
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-row">
          <button class="back-button" type="button" data-action="overview" aria-label="К обзору маршрутов">←</button>
          <div class="panel-title-copy"><p class="panel-kicker">О проекте</p><h2>Источники данных</h2><p>Что показано на карте и откуда взята информация.</p></div>
        </div>
      </div>
      <section class="section source-list" aria-label="Список источников">
        <article class="source-card">
          <p class="source-type">Остановки и линии</p>
          <h3><a href="https://epodgorica.me/javniprevoz/mapa" target="_blank" rel="noopener">ePodgorica</a></h3>
          <p>Названия, координаты и последовательность остановок, состав и направления городских линий.</p>
        </article>
        <article class="source-card">
          <p class="source-type">Маршрутная сеть</p>
          <h3><a href="https://putevi.me/gradski-prevoz/aktuelni-red-voznje/" target="_blank" rel="noopener">Putevi DOO Podgorica</a></h3>
          <p>Перечень действующих линий и их направления сверены с опубликованным расписанием перевозчика.</p>
        </article>
        <article class="source-card">
          <p class="source-type">Картографическая основа</p>
          <h3><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></h3>
          <p>Подложка и дорожная сеть: © OpenStreetMap contributors, данные доступны по лицензии ODbL.</p>
        </article>
      </section>
      <section class="section methodology-card" aria-labelledby="methodologyTitle">
        <div class="section-title"><h3 id="methodologyTitle">Как подготовлена карта</h3><span class="section-count">${escapeHtml(formatSnapshotDate())}</span></div>
        <p>Остановки соединены по порядку следования, а линии восстановлены вдоль дорожной сети. Поэтому форма трассы носит справочный характер: временные объезды и недавние изменения могут отличаться.</p>
        <p>Карта не показывает движение автобусов в реальном времени и не является официальным сервисом перевозчика.</p>
      </section>
    `;
    panel.scrollTop = 0;
  }

  function renderOverview() {
    const routeButtons = data.routes.map(route => `
      <button class="route-chip" style="--route:${route.color}" type="button" data-action="route" data-route-id="${escapeHtml(route.id)}" aria-label="Линия ${escapeHtml(route.short)}: ${escapeHtml(route.name)}">${escapeHtml(route.short)}</button>
    `).join("");

    panel.innerHTML = `
      <div class="panel-header">
        <p class="panel-kicker">${data.routes.length} линий · ${data.stops.length} остановок</p>
        <h2>Нажмите на остановку</h2>
        <p>Покажем все автобусы, их направление и следующие остановки по пути.</p>
      </div>
      <div class="hint-box"><span class="hint-icon" aria-hidden="true">i</span><p>Тёмные точки — остановки. Цветные линии — обзор маршрутной сети. Выберите номер линии или точку на карте.</p></div>
      <section class="section" aria-labelledby="routesTitle">
        <div class="section-title"><h3 id="routesTitle">Все линии</h3><span class="section-count">${data.routes.length}</span></div>
        <div class="route-grid">${routeButtons}</div>
      </section>
      ${sourceNote()}
    `;
    panel.scrollTop = 0;
  }

  function showOverview() {
    endManualLocationMode();
    activeRouteId = null;
    selectedStopId = null;
    routeContextStopId = null;
    activeRouteLayer.clearLayers();
    updateStopMarkers();
    renderOverview();
  }

  function flattenRouteChoices(route) {
    const choices = [];
    route.directions.forEach(direction => {
      direction.variants.forEach(variant => choices.push({ direction, variant }));
    });
    return choices;
  }

  function showRoute(routeId, directionId = 0, variantId = 0, contextStopId = null, fit = true) {
    endManualLocationMode();
    const route = routeById.get(String(routeId));
    if (!route) return;
    const direction = route.directions.find(item => item.id === Number(directionId)) || route.directions[0];
    const variant = direction?.variants.find(item => item.id === Number(variantId)) || direction?.variants[0];
    if (!variant) return;

    activeRouteId = String(route.id);
    activeDirectionId = direction.id;
    activeVariantId = variant.id;
    routeContextStopId = contextStopId ? String(contextStopId) : routeContextStopId;
    selectedStopId = contextStopId ? String(contextStopId) : null;
    drawActiveRoute(route, variant);
    updateStopMarkers();
    renderRoute(route, direction, variant);
    if (fit) fitVariant(variant);
  }

  function drawActiveRoute(route, variant) {
    activeRouteLayer.clearLayers();
    if (variant.geometry.length < 2) return;
    L.polyline(variant.geometry, {
      pane: "routePane", color: "#ffffff", weight: 9, opacity: 0.92, interactive: false, lineJoin: "round"
    }).addTo(activeRouteLayer);
    L.polyline(variant.geometry, {
      pane: "routePane", color: route.color, weight: 5.5, opacity: 1, interactive: false, lineJoin: "round"
    }).addTo(activeRouteLayer);
  }

  function renderRoute(route, direction, variant) {
    const choices = flattenRouteChoices(route);
    const choiceButtons = choices.map((choice, index) => {
      const active = choice.direction.id === direction.id && choice.variant.id === variant.id;
      const suffix = choices.length > 2 ? `Вариант ${index + 1}` : `Направление ${index + 1}`;
      return `<button class="direction-button ${active ? "active" : ""}" style="--route:${route.color}" type="button" data-action="route-choice" data-route-id="${escapeHtml(route.id)}" data-direction-id="${choice.direction.id}" data-variant-id="${choice.variant.id}">
        <span class="direction-letter" aria-hidden="true">${index + 1}</span>
        <span class="direction-copy"><strong>${escapeHtml(cleanTerminal(choice.variant.from))} → ${escapeHtml(cleanTerminal(choice.variant.to))}</strong><span>${suffix} · ${choice.variant.stopIds.length} остановок</span></span>
      </button>`;
    }).join("");

    const stopRows = variant.stopIds.map((stopId, index) => {
      const stop = stopById.get(String(stopId));
      if (!stop) return "";
      const context = String(stopId) === String(routeContextStopId);
      return `<li><button class="stop-row ${context ? "context-stop" : ""}" style="--route:${route.color}" type="button" data-action="stop" data-stop-id="${escapeHtml(stopId)}">
        <span class="stop-index">${index + 1}</span><span class="stop-name">${escapeHtml(stop.name)}</span>
      </button></li>`;
    }).join("");

    const backAction = routeContextStopId ? "back-stop" : "overview";
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-row">
          <button class="back-button" type="button" data-action="${backAction}" ${routeContextStopId ? `data-stop-id="${escapeHtml(routeContextStopId)}"` : ""} aria-label="Назад">←</button>
          <div class="panel-title-copy">
            <p class="panel-kicker">Линия</p>
            <div class="route-heading"><span class="route-badge" style="--route:${route.color}">${escapeHtml(route.short)}</span><h2>${escapeHtml(cleanTerminal(variant.to))}</h2></div>
            <p class="route-name">${escapeHtml(route.name)}</p>
          </div>
        </div>
      </div>
      <section class="section"><div class="section-title"><h3>Куда едет</h3><span class="section-count">${choices.length} ${choices.length > 2 ? "варианта" : "направления"}</span></div><div class="direction-list">${choiceButtons}</div></section>
      <section class="section"><div class="section-title"><h3>Остановки по пути</h3><span class="section-count">${variant.stopIds.length}</span></div><ol class="stop-list">${stopRows}</ol></section>
      ${sourceNote()}
    `;
    panel.scrollTop = 0;
    if (routeContextStopId) {
      window.setTimeout(() => panel.querySelector(".context-stop")?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" }), 40);
    }
  }

  function showStop(stopId, focus = false) {
    endManualLocationMode();
    const stop = stopById.get(String(stopId));
    if (!stop) return;
    activeRouteId = null;
    routeContextStopId = null;
    selectedStopId = String(stop.id);
    activeRouteLayer.clearLayers();
    updateStopMarkers();
    renderStop(stop);
    if (focus) focusStop(stop);
  }

  function renderStop(stop) {
    const seen = new Set();
    const stopMemberships = (memberships.get(String(stop.id)) || [])
      .filter(item => {
        const key = `${item.route.id}:${item.direction.id}:${item.variant.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => routeOrder.get(String(a.route.id)) - routeOrder.get(String(b.route.id)));

    const cards = stopMemberships.map(item => {
      const nextIds = item.variant.stopIds.slice(item.index + 1, item.index + 4);
      const remaining = Math.max(0, item.variant.stopIds.length - item.index - 1);
      const nextNames = nextIds.map(id => stopById.get(String(id))?.name).filter(Boolean).map(cleanTerminal);
      const detail = remaining === 0 ? "Конечная остановка" : `Дальше: ${nextNames.join(" · ")}${remaining > 3 ? ` · ещё ${remaining - 3}` : ""}`;
      return `<button class="route-card" type="button" data-action="route-from-stop" data-route-id="${escapeHtml(item.route.id)}" data-direction-id="${item.direction.id}" data-variant-id="${item.variant.id}" data-stop-id="${escapeHtml(stop.id)}">
        <span class="route-badge" style="--route:${item.route.color}">${escapeHtml(item.route.short)}</span>
        <span class="route-card-copy"><strong>→ ${escapeHtml(cleanTerminal(item.variant.to))}</strong><span>${escapeHtml(detail)}</span></span>
        <span class="route-arrow" aria-hidden="true">›</span>
      </button>`;
    }).join("");

    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-row">
          <button class="back-button" type="button" data-action="overview" aria-label="К обзору маршрутов">←</button>
          <div class="panel-title-copy"><p class="panel-kicker">Остановка</p><h2>${escapeHtml(stop.name)}</h2><p>Выберите автобус, чтобы посмотреть весь путь.</p></div>
        </div>
        <div class="stop-meta"><span class="meta-pill">ID ${escapeHtml(stop.id)}</span><span class="meta-pill">${stopMemberships.length} ${pluralizeRoutes(stopMemberships.length)}</span></div>
      </div>
      <section class="section"><div class="section-title"><h3>Отсюда едут</h3><span class="section-count">направление указано справа</span></div><div class="route-card-list">${cards || '<div class="empty-state">Для этой остановки маршруты не найдены.</div>'}</div></section>
      ${sourceNote()}
    `;
    panel.scrollTop = 0;
  }

  function pluralizeRoutes(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "маршрут";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "маршрута";
    return "маршрутов";
  }

  function updateStopMarkers() {
    const route = activeRouteId ? routeById.get(activeRouteId) : null;
    const direction = route?.directions.find(item => item.id === activeDirectionId);
    const variant = direction?.variants.find(item => item.id === activeVariantId);
    const activeStops = new Set((variant?.stopIds || []).map(String));
    const baseRadius = map.getZoom() >= 14 ? 4.2 : 3.3;

    stopMarkers.forEach((marker, stopId) => {
      const isSelected = stopId === String(selectedStopId);
      const onRoute = activeStops.has(stopId);
      marker.setRadius(isSelected ? 8 : onRoute ? 5.4 : baseRadius);
      marker.setStyle({
        color: isSelected ? "#071b2a" : "#ffffff",
        weight: isSelected ? 2.5 : onRoute ? 2.2 : 1.5,
        fillColor: isSelected ? "#ffd166" : onRoute && route ? route.color : "#17384d",
        fillOpacity: route && !onRoute ? 0.2 : 0.86,
        opacity: route && !onRoute ? 0.32 : 0.98
      });
    });
  }

  function fitVariant(variant) {
    const points = variant.geometry.length ? variant.geometry : variant.stopIds.map(id => {
      const stop = stopById.get(String(id));
      return stop ? [stop.lat, stop.lng] : null;
    }).filter(Boolean);
    if (!points.length) return;
    const mobile = window.innerWidth <= 700;
    map.fitBounds(L.latLngBounds(points), {
      animate: !reduceMotion,
      duration: 0.65,
      maxZoom: 15,
      paddingTopLeft: mobile ? [18, 18] : [420, 24],
      paddingBottomRight: mobile ? [18, Math.round(window.innerHeight * 0.48)] : [24, 24]
    });
  }

  function focusStop(stop) {
    map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 15), { animate: !reduceMotion, duration: 0.6 });
    if (window.innerWidth <= 700) window.setTimeout(() => map.panBy([0, Math.round(window.innerHeight * 0.15)], { animate: !reduceMotion }), 380);
  }

  function haversineMeters(a, b) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} м`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} км`;
  }

  function renderNearby(nearest, manual = false) {
    const cards = nearest.map(item => {
      const count = new Set((memberships.get(String(item.stop.id)) || []).map(membership => membership.route.id)).size;
      return `<button class="nearby-card" type="button" data-action="stop" data-stop-id="${escapeHtml(item.stop.id)}"><span class="nearby-copy"><strong>${escapeHtml(item.stop.name)}</strong><span>${count} ${pluralizeRoutes(count)}</span></span><span class="distance">${escapeHtml(formatDistance(item.distance))}</span></button>`;
    }).join("");

    panel.innerHTML = `
      <div class="panel-header"><div class="panel-title-row"><button class="back-button" type="button" data-action="overview" aria-label="К обзору маршрутов">←</button><div class="panel-title-copy"><p class="panel-kicker">${manual ? "Выбранная точка" : "Геолокация"}</p><h2>Ближайшие остановки</h2><p>Расстояние рассчитано по прямой ${manual ? "от указанного места" : "от вашей текущей позиции"}.</p></div></div></div>
      <section class="section"><div class="nearby-list">${cards}</div>${manual ? '<button class="text-action" type="button" data-action="pick-location">Изменить точку на карте</button>' : ""}</section>
      ${sourceNote()}
    `;
    panel.scrollTop = 0;
  }

  function geolocationAllowedByPolicy() {
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== "function") return true;
    try {
      return policy.allowsFeature("geolocation");
    } catch (_) {
      return true;
    }
  }

  function endManualLocationMode() {
    manualLocationMode = false;
    map.getContainer().classList.remove("manual-location-mode");
  }

  function renderLocationHelp(reason) {
    const standaloneUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-row">
          <button class="back-button" type="button" data-action="overview" aria-label="К обзору маршрутов">←</button>
          <div class="panel-title-copy"><p class="panel-kicker">Геолокация</p><h2>Не удалось получить позицию</h2><p>${escapeHtml(reason)}</p></div>
        </div>
      </div>
      <div class="geo-actions">
        <button class="geo-button geo-button-primary" type="button" data-action="retry-location">Повторить GPS</button>
        <button class="geo-button" type="button" data-action="pick-location">Указать место на карте</button>
        <a class="geo-link" href="${escapeHtml(standaloneUrl)}" target="_blank" rel="noopener external">Открыть карту отдельно ↗</a>
      </div>
      <div class="hint-box"><span class="hint-icon" aria-hidden="true">i</span><p>Если карта открыта внутри ChatGPT, встроенное окно может не передать разрешение на GPS. Откройте карту отдельно и разрешите браузеру доступ к геопозиции — либо укажите место вручную.</p></div>
      ${sourceNote()}
    `;
    panel.scrollTop = 0;
  }

  function failLocation(reason) {
    endManualLocationMode();
    locateButton.disabled = false;
    locateButton.setAttribute("aria-pressed", "false");
    locateLabel.textContent = "Где я";
    renderLocationHelp(reason);
    showMessage(reason, 7200);
  }

  function beginManualLocation() {
    locationRequestId += 1;
    manualLocationMode = true;
    map.getContainer().classList.add("manual-location-mode");
    locateButton.disabled = false;
    locateButton.setAttribute("aria-pressed", "false");
    locateLabel.textContent = "Выберите точку";
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-row">
          <button class="back-button" type="button" data-action="cancel-location" aria-label="Отменить выбор точки">←</button>
          <div class="panel-title-copy"><p class="panel-kicker">Ручной выбор</p><h2>Где вы находитесь?</h2><p>Нажмите на своё место на карте. Можно выбрать и ближайшую остановку.</p></div>
        </div>
      </div>
      <div class="hint-box"><span class="hint-icon" aria-hidden="true">+</span><p>После нажатия покажем четыре ближайшие остановки и расстояние до них.</p></div>
      ${sourceNote()}
    `;
    panel.scrollTop = 0;
    showMessage("Нажмите на своё место на карте.", 9000);
  }

  function cancelManualLocation() {
    locationRequestId += 1;
    endManualLocationMode();
    locateButton.disabled = false;
    locateButton.setAttribute("aria-pressed", "false");
    locateLabel.textContent = "Где я";
    message.hidden = true;
    showOverview();
  }

  function applyUserLocation(userPosition, manual = false) {
    if (!Number.isFinite(userPosition.lat) || !Number.isFinite(userPosition.lng)) {
      failLocation("Получены некорректные координаты. Попробуйте ещё раз.");
      return;
    }

    endManualLocationMode();
    locationLayer.clearLayers();
    if (!manual && Number.isFinite(userPosition.accuracy) && userPosition.accuracy < 5000) {
      L.circle([userPosition.lat, userPosition.lng], { radius: userPosition.accuracy, color: "#168aad", weight: 1, fillColor: "#168aad", fillOpacity: 0.08, interactive: false }).addTo(locationLayer);
    }
    L.marker([userPosition.lat, userPosition.lng], {
      icon: L.divIcon({ className: "user-location-icon", html: '<span class="user-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] })
    }).addTo(locationLayer).bindTooltip(manual ? "Выбранная точка" : "Вы здесь", { direction: "top", offset: [0, -10] });

    const nearest = data.stops.map(stop => ({ stop, distance: haversineMeters(userPosition, stop) })).sort((a, b) => a.distance - b.distance).slice(0, 4);
    activeRouteId = null;
    selectedStopId = null;
    activeRouteLayer.clearLayers();
    updateStopMarkers();
    renderNearby(nearest, manual);
    const points = [[userPosition.lat, userPosition.lng], ...nearest.map(item => [item.stop.lat, item.stop.lng])];
    map.fitBounds(L.latLngBounds(points), {
      animate: !reduceMotion,
      maxZoom: 16,
      paddingTopLeft: window.innerWidth <= 700 ? [16, 16] : [420, 22],
      paddingBottomRight: window.innerWidth <= 700 ? [16, Math.round(window.innerHeight * 0.48)] : [22, 22]
    });
    message.hidden = true;
    locateButton.disabled = false;
    locateButton.setAttribute("aria-pressed", "true");
    locateLabel.textContent = manual ? "Точка выбрана" : "Я на карте";
  }

  function useManualLocation(latlng) {
    if (!manualLocationMode) return;
    locationRequestId += 1;
    applyUserLocation({ lat: latlng.lat, lng: latlng.lng, accuracy: null }, true);
  }

  function locateUser() {
    endManualLocationMode();
    if (!navigator.geolocation) {
      failLocation("Этот браузер не поддерживает определение местоположения.");
      return;
    }
    if (!window.isSecureContext) {
      failLocation("Браузер разрешает GPS только на защищённых страницах.");
      return;
    }
    if (!geolocationAllowedByPolicy()) {
      failLocation("Встроенное окно не передаёт сайту разрешение на геолокацию.");
      return;
    }

    const requestId = ++locationRequestId;
    locateButton.disabled = true;
    locateButton.setAttribute("aria-pressed", "false");
    locateLabel.textContent = "Ищем…";
    navigator.geolocation.getCurrentPosition(position => {
      if (requestId !== locationRequestId) return;
      const userPosition = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
      applyUserLocation(userPosition, false);
    }, error => {
      if (requestId !== locationRequestId) return;
      const text = error.code === 1
        ? "Браузер не дал карте доступ к геопозиции. Разрешите доступ или откройте карту отдельно."
        : error.code === 3
          ? "Телефон не успел определить позицию. Повторите попытку или укажите место на карте."
          : "Устройство не смогло определить позицию. Проверьте, включена ли геолокация.";
      failLocation(text);
    }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 });
  }

  function showMessage(text, duration = 5600) {
    message.textContent = text;
    message.hidden = false;
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => { message.hidden = true; }, duration);
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const annotations = { readOnlyHint: true, untrustedContentHint: true };
    const waitForMap = () => new Promise(resolve => window.setTimeout(resolve, reduceMotion ? 0 : 750));

    const tools = [
      {
        name: "show_bus_route",
        title: "Показать автобусный маршрут",
        description: "Открывает на карте выбранную линию Подгорицы и одно из её направлений.",
        inputSchema: {
          type: "object",
          properties: {
            routeId: { type: "string", description: "ID линии, например 6a или 21." },
            directionId: { type: "integer", minimum: 0, maximum: 1, default: 0 },
            variantId: { type: "integer", minimum: 0, default: 0 }
          },
          required: ["routeId"],
          additionalProperties: false
        },
        annotations,
        async execute(input) {
          const route = routeById.get(String(input?.routeId ?? ""));
          if (!route) throw new Error("Маршрут с таким ID не найден.");
          const direction = route.directions.find(item => item.id === Number(input.directionId ?? 0));
          const variant = direction?.variants.find(item => item.id === Number(input.variantId ?? 0));
          if (!variant) throw new Error("Такого направления или варианта у маршрута нет.");
          showRoute(route.id, direction.id, variant.id, null, true);
          await waitForMap();
          return { routeId: route.id, line: route.short, from: variant.from, to: variant.to, stopCount: variant.stopIds.length };
        }
      },
      {
        name: "show_bus_stop",
        title: "Показать автобусную остановку",
        description: "Открывает остановку Подгорицы по ID и показывает все доступные с неё направления.",
        inputSchema: {
          type: "object",
          properties: { stopId: { type: "string", pattern: "^[0-9A-Za-z_-]+$" } },
          required: ["stopId"],
          additionalProperties: false
        },
        annotations,
        async execute(input) {
          const stop = stopById.get(String(input?.stopId ?? ""));
          if (!stop) throw new Error("Остановка с таким ID не найдена.");
          showStop(stop.id, true);
          await waitForMap();
          const routeLines = [...new Set((memberships.get(String(stop.id)) || []).map(item => item.route.short))];
          return { stopId: stop.id, name: stop.name, lines: routeLines };
        }
      }
    ];

    tools.forEach(tool => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(error => console.warn("WebMCP registration failed", error));
      } catch (error) {
        console.warn("WebMCP registration failed", error);
      }
    });
  }

  panel.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "overview") showOverview();
    if (action === "sources") renderSources();
    if (action === "cancel-location") cancelManualLocation();
    if (action === "retry-location") locateUser();
    if (action === "pick-location") beginManualLocation();
    if (action === "back-stop" || action === "stop") showStop(button.dataset.stopId, action === "stop");
    if (action === "route") showRoute(button.dataset.routeId, 0, 0, null, true);
    if (action === "route-choice") showRoute(button.dataset.routeId, button.dataset.directionId, button.dataset.variantId, routeContextStopId, true);
    if (action === "route-from-stop") showRoute(button.dataset.routeId, button.dataset.directionId, button.dataset.variantId, button.dataset.stopId, true);
  });

  locateButton.addEventListener("click", locateUser);
  sourcesButton.addEventListener("click", renderSources);
  map.on("click", event => useManualLocation(event.latlng));
  map.on("zoomend", updateStopMarkers);
  registerWebMcpTools();
})();
