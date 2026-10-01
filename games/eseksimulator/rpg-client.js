(function (root) {
  'use strict';

  root.createEsekRpgClient = function createEsekRpgClient(ctx) {
    const data = ctx.data;
    let currentCategory = 'weapons';
    let panelMode = '';
    let rpgState = { xp: 0, level: 1, xpInLevel: 0, xpToNext: 80, coins: 250, bagLevel: 0, bagCapacity: 3, inventory: [], equippedWeapon: null, equippedWeaponType: 'none', magazines: 0, equippedArmor: null, petId: null, buffs: {}, stats: { maxHealth: 9, maxStamina: 100, speedMultiplier: 1 } };
    let shopItems = data.items;
    let shopCategories = data.categories;
    let boundSocket = null;
    let initializedSocket = null;
    const hostileModels = new Map();
    const hostileStates = new Map();
    const zoneMarkers = new Map();
    const HOSTILE_RENDER_DISTANCE = 190;
    function hostileIsNearPlayer(state) {
      const pos = ctx.getPlayerPosition();
      return !pos || Math.hypot(Number(state.x) - pos.x, Number(state.z) - pos.z) <= HOSTILE_RENDER_DISTANCE;
    }
    const owned = id => (rpgState.inventory || []).some(entry => entry.id === id && entry.quantity > 0);
    const itemById = id => data.items.find(item => item.id === id);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const style = document.createElement('style');
    style.textContent = `
      #rpgHud{position:fixed;right:14px;top:14px;z-index:210;display:none;flex-direction:column;gap:7px;width:min(270px,48vw);padding:11px 13px;border:1px solid rgba(235,202,119,.46);border-radius:14px;background:rgba(20,24,29,.88);color:#fff;box-shadow:0 8px 28px #0007;backdrop-filter:blur(7px);font:700 12px Arial;pointer-events:none}
      #rpgHud .rpg-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.rpg-level{font-size:13px;color:#ffe7a0}.rpg-coins{font-size:14px;color:#ffd768;white-space:nowrap}.rpg-xp-track{height:10px;border-radius:9px;background:#ffffff20;overflow:hidden;margin-top:7px}.rpg-xp-fill{height:100%;width:0;background:linear-gradient(90deg,#77d887,#d5ed86);transition:width .22s}.rpg-xp-caption{display:flex;justify-content:space-between;margin-top:4px;color:#d5ded7;font-size:10px}.rpg-buffs{display:flex;flex-direction:column;gap:3px;margin-top:2px;color:#b9f1c4;font-size:10px}.rpg-buff-row{display:flex;justify-content:space-between;gap:8px}
      #rpgPanel{position:fixed;inset:0;z-index:350;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(7,11,13,.72);color:#f5f6f1;font:14px Arial;pointer-events:auto;touch-action:pan-y}#rpgPanel *{box-sizing:border-box}#rpgWindow{display:flex;flex-direction:column;width:min(980px,96vw);height:min(760px,92vh);overflow:hidden;border:1px solid rgba(222,190,112,.48);border-radius:18px;background:linear-gradient(145deg,#202a28,#12191a);box-shadow:0 24px 80px #000b}#rpgHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid #ffffff18;background:#ffffff08}#rpgTitle{font-size:20px;font-weight:900;color:#ffe6a0}#rpgSubtitle{margin-top:3px;color:#b9c4bd;font-size:11px}#rpgClose{width:40px;height:38px;border:0;border-radius:10px;background:#ffffff18;color:white;font-size:26px;line-height:1;cursor:pointer}#rpgBody{display:flex;min-height:0;flex:1}#rpgNav{display:flex;flex:0 0 150px;flex-direction:column;gap:7px;padding:12px;border-right:1px solid #ffffff18;background:#ffffff04;overflow:auto}#rpgNav button{display:flex;align-items:center;gap:8px;width:100%;padding:10px 9px;border:1px solid transparent;border-radius:10px;background:transparent;color:#c9d1cd;text-align:left;font-weight:800;cursor:pointer}#rpgNav button.active{border-color:#d9bc6a66;background:#d9bc6a18;color:#ffe8a0}#rpgContent{min-width:0;flex:1;overflow:auto;padding:16px}#rpgSummary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.rpg-chip{padding:6px 9px;border:1px solid #ffffff20;border-radius:999px;background:#ffffff0b;color:#d8e0db;font-size:11px;font-weight:800}.rpg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:10px}.rpg-card{display:flex;flex-direction:column;gap:7px;min-height:156px;padding:12px;border:1px solid #ffffff1c;border-radius:13px;background:linear-gradient(145deg,#ffffff0d,#ffffff04)}.rpg-card-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:900;color:#fff0c3}.rpg-icon{font-size:24px}.rpg-desc{flex:1;line-height:1.42;color:#c4cec8;font-size:11px}.rpg-meta{display:flex;justify-content:space-between;gap:8px;color:#ffe18b;font-size:11px;font-weight:800}.rpg-buy,.rpg-action{width:100%;min-height:36px;padding:8px 10px;border:1px solid #d9b86188;border-radius:9px;background:#715523;color:#fff4d3;font-weight:900;cursor:pointer}.rpg-buy:disabled,.rpg-action:disabled{border-color:#ffffff16;background:#ffffff0b;color:#87918b;cursor:default}.rpg-section{margin:0 0 18px}.rpg-section h3{margin:0 0 9px;color:#ffe7a2;font-size:14px}.rpg-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:7px}.rpg-slot{display:flex;min-height:72px;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:7px;border:1px dashed #ffffff32;border-radius:10px;background:#ffffff05;color:#a8b3ad;text-align:center;font-size:10px}.rpg-slot.filled{border-style:solid;border-color:#d9bc6a55;background:#d9bc6a10;color:#fff0c3}.rpg-slot-icon{font-size:21px}.rpg-inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}.rpg-inv-item{display:flex;align-items:center;gap:8px;padding:9px;border:1px solid #ffffff19;border-radius:10px;background:#ffffff08}.rpg-inv-item .rpg-icon{font-size:22px}.rpg-inv-copy{min-width:0;flex:1}.rpg-inv-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.rpg-inv-copy span{display:block;margin-top:3px;color:#afbbb3;font-size:10px}.rpg-mini-btn{flex:0 0 auto;padding:7px 8px;border:1px solid #d9bc6a66;border-radius:8px;background:#4e482f;color:#ffedbd;font-size:10px;font-weight:900;cursor:pointer}.rpg-empty{padding:13px;border:1px dashed #ffffff24;border-radius:10px;color:#aeb8b1;font-size:11px}#rpgMobileBag{position:fixed;left:14px;bottom:calc(112px + env(safe-area-inset-bottom));z-index:205;display:none;padding:10px 12px;border:1px solid #f1d17a88;border-radius:12px;background:#292b28e8;color:#ffeba9;font-weight:900;box-shadow:0 6px 20px #0007;touch-action:manipulation}#rpgMobileBag:active{transform:scale(.96)}
      .rpg-zone-label{font:900 18px Arial;letter-spacing:1px}
      @media(max-width:650px){#rpgHud{box-sizing:border-box;right:8px;top:8px;width:min(225px,calc(100vw - 132px));padding:8px 9px;border-radius:11px}.rpg-coins{font-size:12px}#rpgPanel{padding:0}#rpgWindow{width:100vw;height:100dvh;max-height:100dvh;border-radius:0}#rpgHeader{padding:11px 13px}#rpgTitle{font-size:17px}#rpgBody{flex-direction:column}#rpgNav{flex:0 0 auto;flex-direction:row;gap:5px;padding:7px 9px;border-right:0;border-bottom:1px solid #ffffff18;overflow-x:auto}#rpgNav button{flex:0 0 auto;width:auto;min-width:88px;padding:9px 10px;font-size:11px}#rpgContent{padding:11px}.rpg-cards{grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px}.rpg-card{min-height:146px;padding:10px}.rpg-inv-grid{grid-template-columns:1fr}.rpg-slots{grid-template-columns:repeat(auto-fill,minmax(58px,1fr))}#rpgMobileBag{font-size:12px}}
    `;
    style.textContent += '@media(max-width:650px){#rpgMobileBag{left:auto;right:8px;top:calc(178px + env(safe-area-inset-top));bottom:auto;width:84px;height:44px;padding:8px 7px;font-size:11px}}@media(orientation:landscape) and (max-width:1000px){#rpgMobileBag{left:auto;right:12px;top:150px;bottom:auto;width:84px;height:44px}}@media(orientation:landscape) and (max-width:650px){#rpgMobileBag{left:114px;right:auto;top:8px;bottom:auto;width:40px;height:40px;padding:0;font-size:0}#rpgMobileBag::before{content:"🎒";font-size:20px}}@media(orientation:landscape) and (max-width:360px){#rpgHud{width:158px;padding:6px 7px}#rpgHud .rpg-top{flex-direction:column;align-items:flex-start;gap:2px}.rpg-level,.rpg-coins{font-size:10px}}';
    document.head.appendChild(style);

    const hud = document.createElement('aside');
    hud.id = 'rpgHud';
    hud.innerHTML = `<div class="rpg-top"><span class="rpg-level" id="rpgHudLevel">SEVİYE 1</span><span class="rpg-coins" id="rpgHudCoins">🪙 250</span></div><div class="rpg-xp-track"><div class="rpg-xp-fill" id="rpgHudXpFill"></div></div><div class="rpg-xp-caption"><span id="rpgHudXp">0 / 100 XP</span><span>MAX 100</span></div><div class="rpg-buffs" id="rpgHudBuffs"></div>`;
    document.body.appendChild(hud);
    const panel = document.createElement('div');
    panel.id = 'rpgPanel';
    panel.innerHTML = `<div id="rpgWindow"><header id="rpgHeader"><div><div id="rpgTitle">Tüccar</div><div id="rpgSubtitle">Eşek maceran için ekipman ve erzak</div></div><button id="rpgClose" aria-label="Kapat">×</button></header><div id="rpgBody"><nav id="rpgNav"></nav><main id="rpgContent"></main></div></div>`;
    document.body.appendChild(panel);
    const mobileBag = document.createElement('button');
    mobileBag.id = 'rpgMobileBag'; mobileBag.type = 'button'; mobileBag.textContent = '🎒 ÇANTA'; document.body.appendChild(mobileBag);
    const nav = panel.querySelector('#rpgNav'), content = panel.querySelector('#rpgContent');

    function setHud() {
      hud.style.display = ctx.isGameStarted() && !ctx.isDead() ? 'flex' : 'none';
      mobileBag.style.display = ctx.isGameStarted() && !ctx.isDead() && ctx.isMobile() ? 'block' : 'none';
      const level = Number(rpgState.level) || 1, current = Math.max(0, Number(rpgState.xpInLevel) || 0), next = Number(rpgState.xpToNext) || 0;
      hud.querySelector('#rpgHudLevel').textContent = `SEVİYE ${level}`;
      hud.querySelector('#rpgHudCoins').textContent = `🪙 ${Math.max(0, Number(rpgState.coins) || 0).toLocaleString('tr-TR')}`;
      hud.querySelector('#rpgHudXp').textContent = level >= data.maxLevel ? 'MAKSİMUM SEVİYE' : `${Math.floor(current)} / ${next} XP`;
      hud.querySelector('#rpgHudXpFill').style.width = level >= data.maxLevel ? '100%' : `${next ? Math.max(0, Math.min(100, current / next * 100)) : 100}%`;
      const buffs = Object.entries(rpgState.buffs || {}).filter(([, buff]) => Number(buff.expiresAt) > Date.now());
      hud.querySelector('#rpgHudBuffs').innerHTML = buffs.map(([key, buff]) => {
        const seconds = Math.max(0, Math.ceil((buff.expiresAt - Date.now()) / 1000));
        const mins = String(Math.floor(seconds / 60)).padStart(2, '0'), secs = String(seconds % 60).padStart(2, '0');
        const names = { damage: '⚔️ Hasar', speed: '💨 Hız', staminaRegen: '⚡ Enerji' };
        return `<div class="rpg-buff-row"><span>${names[key] || esc(buff.label)}</span><span>${mins}:${secs}</span></div>`;
      }).join('');
    }

    function inventorySummary() {
      const level = Number(rpgState.level) || 1;
      return `<div class="rpg-chip">⭐ Seviye ${level}</div><div class="rpg-chip">🪙 ${Number(rpgState.coins || 0).toLocaleString('tr-TR')} coin</div><div class="rpg-chip">🎒 ${rpgState.inventory.length}/${rpgState.bagCapacity} yuva</div>`;
    }
    function addNav() {
      const categories = panelMode === 'shop' ? shopCategories : [
        { id: 'bag', name: 'Çanta', icon: '🎒' },
        { id: 'weapons', name: 'Silahlar', icon: '⚔️' },
        { id: 'ammo', name: 'Şarjörler', icon: '🧰' },
        { id: 'armor', name: 'Zırh', icon: '🛡️' },
        { id: 'pets', name: 'Petler', icon: '🐾' },
        { id: 'food', name: 'Yiyecek', icon: '🍲' }
      ];
      nav.innerHTML = categories.map(category => `<button type="button" data-category="${esc(category.id)}" class="${currentCategory === category.id ? 'active' : ''}"><span>${category.icon}</span><span>${esc(category.name)}</span></button>`).join('');
      nav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { currentCategory = button.dataset.category; render(); }));
    }
    function buttonLabel(item) {
      if (item.kind === 'ammo' && owned(item.id)) return `➕ Şarjör al · 🪙 ${item.price.toLocaleString('tr-TR')}`;
      if (item.kind === 'bag') return item.bagLevel <= rpgState.bagLevel ? '✓ Satın alındı' : item.bagLevel !== rpgState.bagLevel + 1 ? 'Önceki çanta gerekir' : `🎒 ${item.capacity} yuvaya yükselt`;
      if (owned(item.id)) return '✓ Çantanda';
      return `Satın al · 🪙 ${item.price.toLocaleString('tr-TR')}`;
    }
    function replacementEntries(item) {
      if (item.kind === 'weapon') return rpgState.inventory.filter(entry => { const old = itemById(entry.id); return old && old.kind === 'weapon' && old.weaponType === item.weaponType; });
      if (item.kind === 'armor') return rpgState.inventory.filter(entry => itemById(entry.id)?.kind === 'armor');
      return [];
    }
    function tradeInValue(item) {
      return replacementEntries(item).reduce((total, entry) => total + Math.floor((itemById(entry.id)?.price || 0) * 0.25), 0);
    }
    function canBuy(item) {
      if ((Number(rpgState.level) || 1) < item.requiredLevel || Number(rpgState.coins || 0) + tradeInValue(item) < item.price) return false;
      if (item.kind === 'bag') return item.bagLevel === rpgState.bagLevel + 1;
      if (item.kind !== 'food' && owned(item.id)) return false;
      const replacementCount = replacementEntries(item).length;
      const stackExists = rpgState.inventory.some(entry => entry.id === item.id);
      return stackExists || rpgState.inventory.length - replacementCount < rpgState.bagCapacity;
    }
    function renderShop() {
      const items = shopItems.filter(item => item.category === currentCategory).sort((a, b) => a.requiredLevel - b.requiredLevel || a.price - b.price);
      if (!items.length) { content.innerHTML += '<div class="rpg-empty">Bu bölümde ürün yok.</div>'; return; }
      content.innerHTML += `<div class="rpg-cards">${items.map(item => {
        const levelLocked = (Number(rpgState.level) || 1) < item.requiredLevel;
        const already = item.kind === 'bag' ? item.bagLevel <= rpgState.bagLevel : !['food', 'ammo'].includes(item.kind) && owned(item.id);
        const tradeIn = tradeInValue(item), afford = Number(rpgState.coins || 0) + tradeIn >= item.price;
        const detail = item.kind === 'weapon' ? `Seviye ${item.requiredLevel} · ${item.weaponType === 'gun' ? 'Menzilli' : 'Yakın dövüş'} ×${item.damageMultiplier}` : item.kind === 'armor' ? `Seviye ${item.requiredLevel} · +${item.healthBonus} can · %${Math.round(item.damageReduction * 100)} koruma` : item.kind === 'bag' ? `Seviye ${item.requiredLevel} · ${item.capacity} yuva` : item.kind === 'pet' ? item.description : `Seviye ${item.requiredLevel} · ${item.description}`;
        const disabled = already || levelLocked || !canBuy(item);
        return `<article class="rpg-card"><div class="rpg-card-title"><span class="rpg-icon">${item.icon}</span><span>${esc(item.name)}</span></div><div class="rpg-desc">${esc(item.description)}</div><div class="rpg-meta"><span>${esc(detail)}${tradeIn ? ` · takas +🪙${tradeIn}` : ''}</span><span>🪙 ${item.price.toLocaleString('tr-TR')}</span></div><button class="rpg-buy" data-buy="${esc(item.id)}" ${disabled ? 'disabled' : ''}>${levelLocked ? `🔒 Seviye ${item.requiredLevel}` : !afford ? 'Yeterli coin yok' : buttonLabel(item)}</button></article>`;
      }).join('')}</div>`;
      content.querySelectorAll('[data-buy]').forEach(button => button.addEventListener('click', () => ctx.send('rpg_buy', { itemId: button.dataset.buy })));
    }
    function getKind(id) { return itemById(id)?.kind || 'eşya'; }
    function renderBagSlots() {
      const inventory = rpgState.inventory || [], capacity = Math.max(data.bagSlotsBase, Number(rpgState.bagCapacity) || data.bagSlotsBase);
      const slots = Array.from({ length: capacity }, (_, index) => {
        const entry = inventory[index], item = entry && itemById(entry.id);
        return entry && item ? `<div class="rpg-slot filled"><span class="rpg-slot-icon">${item.icon}</span><strong>${esc(item.name)}</strong><span>${entry.quantity > 1 ? `×${entry.quantity}` : esc(getKind(item.id))}</span></div>` : `<div class="rpg-slot"><span class="rpg-slot-icon">·</span><span>Boş yuva</span></div>`;
      }).join('');
      return `<div class="rpg-section"><h3>🎒 Çanta · ${inventory.length}/${capacity} yuva</h3><div class="rpg-slots">${slots}</div></div>`;
    }
    function renderOwnedKind(kind, title, slot) {
      const items = (rpgState.inventory || []).filter(entry => itemById(entry.id)?.kind === kind);
      if (!items.length) return `<section class="rpg-section"><h3>${title}</h3><div class="rpg-empty">Henüz yok. Tüccardan satın alabilirsin.</div></section>`;
      return `<section class="rpg-section"><h3>${title}</h3><div class="rpg-inv-grid">${items.map(entry => {
        const item = itemById(entry.id), equipped = slot === 'weapon' ? rpgState.equippedWeapon === item.id : slot === 'armor' ? rpgState.equippedArmor === item.id : slot === 'pet' ? rpgState.petId === item.id : false;
        const action = ['food', 'ammo'].includes(kind) ? `<button class="rpg-mini-btn" data-use="${item.id}">${kind === 'ammo' ? 'Şarjör tak' : 'Kullan'}</button>` : `<button class="rpg-mini-btn" data-equip="${slot}" data-item="${item.id}" ${equipped ? 'disabled' : ''}>${equipped ? 'Takılı' : slot === 'pet' ? 'Pet yap' : 'Kuşan'}</button>`;
        const count = entry.quantity > 1 ? ` · ×${entry.quantity}` : '';
        const extra = kind === 'ammo' ? ` · ${entry.quantity || 0} şarjör` : kind === 'weapon' ? ` · ${item.weaponType === 'gun' ? `Mermi ${rpgState.ammo || 0}` : `×${item.damageMultiplier} hasar`}` : kind === 'armor' ? ` · +${item.healthBonus} can · %${Math.round(item.damageReduction * 100)} koruma` : '';
        return `<div class="rpg-inv-item"><span class="rpg-icon">${item.icon}</span><div class="rpg-inv-copy"><strong>${esc(item.name)}</strong><span>${esc(item.description)}${count}${extra}</span></div>${action}</div>`;
      }).join('')}</div></section>`;
    }
    function renderInventory() {
      content.innerHTML = `<div id="rpgSummary">${inventorySummary()}</div>${renderBagSlots()}${renderOwnedKind('weapon', '⚔️ Silahlar', 'weapon')}${renderOwnedKind('armor', '🛡️ Eşeğe giydirilen zırh', 'armor')}${renderOwnedKind('pet', '🐾 Petler', 'pet')}${renderOwnedKind('ammo', '🧰 Şarjörler', 'ammo')}${renderOwnedKind('food', '🍲 Yiyecekler', 'food')}`;
      content.querySelectorAll('[data-equip]').forEach(button => button.addEventListener('click', () => ctx.send('rpg_equip', { slot: button.dataset.equip, itemId: button.dataset.item })));
      content.querySelectorAll('[data-use]').forEach(button => button.addEventListener('click', () => ctx.send('rpg_use', { itemId: button.dataset.use })));
    }
    function render() {
      if (!panelMode) return;
      addNav();
      panel.querySelector('#rpgTitle').textContent = panelMode === 'shop' ? 'Tüccar' : 'Çanta ve Ekipman';
      panel.querySelector('#rpgSubtitle').textContent = panelMode === 'shop' ? 'Silah, zırh, çanta, pet ve yiyecek satın al' : 'Eşyalarını düzenle, eşek zırhını kuşan ve yiyecek kullan';
      content.innerHTML = `<div id="rpgSummary">${inventorySummary()}</div>`;
      if (panelMode === 'shop') renderShop();
      else if (currentCategory === 'bag') renderInventory();
      else {
        const categoryMap = { weapons: ['weapon', '⚔️ Silahlar', 'weapon'], armor: ['armor', '🛡️ Eşeğe giydirilen zırh', 'armor'], pets: ['pet', '🐾 Petler', 'pet'], ammo: ['ammo', '🧰 Şarjörler', 'ammo'], food: ['food', '🍲 Yiyecekler', 'food'] };
        const [kind, title, slot] = categoryMap[currentCategory] || categoryMap.food;
        content.innerHTML += renderOwnedKind(kind, title, slot);
      }
      if (panelMode === 'inventory' && currentCategory !== 'bag') {
        content.querySelectorAll('[data-equip]').forEach(button => button.addEventListener('click', () => ctx.send('rpg_equip', { slot: button.dataset.equip, itemId: button.dataset.item })));
        content.querySelectorAll('[data-use]').forEach(button => button.addEventListener('click', () => ctx.send('rpg_use', { itemId: button.dataset.use })));
      }
    }
    function openPanel(mode) {
      if (!ctx.isGameStarted() || ctx.isDead()) return;
      panelMode = mode;
      currentCategory = mode === 'shop' ? 'weapons' : 'bag';
      panel.style.display = 'flex';
      render();
      if (mode === 'shop') ctx.send('rpg_shop_request', {});
    }
    function closePanel() { panel.style.display = 'none'; panelMode = ''; }
    function openTrader(open) { if (open === false) closePanel(); else openPanel('shop'); }
    function applyRpgState(state) {
      if (!state || typeof state !== 'object') return;
      rpgState = { ...rpgState, ...state, inventory: Array.isArray(state.inventory) ? state.inventory : rpgState.inventory, buffs: state.buffs || {}, stats: { ...rpgState.stats, ...(state.stats || {}) } };
      if (typeof ctx.applyPetState === 'function') ctx.applyPetState(rpgState.petId);
      if (typeof ctx.applyNeeds === 'function') {
        const staminaBuff = rpgState.buffs && rpgState.buffs.staminaRegen && rpgState.buffs.staminaRegen.expiresAt > Date.now() ? rpgState.buffs.staminaRegen.multiplier : 1;
        ctx.applyNeeds({ maxHealth: rpgState.stats.maxHealth, maxStamina: rpgState.stats.maxStamina, speedMultiplier: rpgState.stats.speedMultiplier, staminaRegenBuffMultiplier: staminaBuff, xp: rpgState.xp, level: rpgState.level, xpInLevel: rpgState.xpInLevel, xpToNext: rpgState.xpToNext, coins: rpgState.coins, buffs: rpgState.buffs });
      }
      if (typeof ctx.setHeldWeapon === 'function') ctx.setHeldWeapon(rpgState.equippedWeaponType || 'none', rpgState.ammo || 0, rpgState.equippedWeapon, itemById(rpgState.equippedWeapon), rpgState.magazines || 0);
      applyPlayerArmor(ctx.getPlayerModel(), rpgState.equippedArmor);
      setHud();
      if (panelMode) render();
    }
    function applyNeeds(dataNeeds) {
      if (!dataNeeds || typeof dataNeeds !== 'object') return;
      if (dataNeeds.xp !== undefined) rpgState.xp = dataNeeds.xp;
      if (dataNeeds.level !== undefined) rpgState.level = dataNeeds.level;
      if (dataNeeds.xpInLevel !== undefined) rpgState.xpInLevel = dataNeeds.xpInLevel;
      if (dataNeeds.xpToNext !== undefined) rpgState.xpToNext = dataNeeds.xpToNext;
      if (dataNeeds.coins !== undefined) rpgState.coins = dataNeeds.coins;
      if (dataNeeds.buffs !== undefined) rpgState.buffs = dataNeeds.buffs || {};
      if (dataNeeds.maxHealth !== undefined) rpgState.stats.maxHealth = dataNeeds.maxHealth;
      if (dataNeeds.maxStamina !== undefined) rpgState.stats.maxStamina = dataNeeds.maxStamina;
      if (dataNeeds.speedMultiplier !== undefined) rpgState.stats.speedMultiplier = dataNeeds.speedMultiplier;
      if (dataNeeds.staminaRegenBuffMultiplier !== undefined) rpgState.stats.staminaRegenBuffMultiplier = dataNeeds.staminaRegenBuffMultiplier;
      setHud();
    }

    function makeSign(text, width, height, color, fontSize) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const g = canvas.getContext('2d'); g.fillStyle = 'rgba(20,24,24,.92)'; g.fillRect(0, 0, width, height); g.strokeStyle = color; g.lineWidth = 10; g.strokeRect(5, 5, width - 10, height - 10);
      g.fillStyle = '#fff0bd'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${fontSize}px Arial`; g.fillText(text, width / 2, height / 2, width - 34);
      const sprite = new ctx.THREE.Sprite(new ctx.THREE.SpriteMaterial({ map: new ctx.THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
      sprite.scale.set(6.5, 1.65, 1); return sprite;
    }
    function addTraderWorldProps() {
      const { x, z } = data.trader, ground = ctx.terrainHeightAt(x, z), T = ctx.THREE;
      const wood = new T.MeshStandardMaterial({ color: 0x704a2d, roughness: 0.84 }), pale = new T.MeshStandardMaterial({ color: 0xb7894e, roughness: 0.8 }), cloth = new T.MeshStandardMaterial({ color: 0x416d58, roughness: 0.92 });
      const rootGroup = new T.Group(); rootGroup.position.set(x, ground, z);
      const addBox = (w, h, d, material, px, py, pz) => { const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material); mesh.position.set(px, py, pz); mesh.castShadow = true; mesh.receiveShadow = true; rootGroup.add(mesh); return mesh; };
      addBox(6.6, 0.22, 4.5, wood, 0, 0.12, 0);
      addBox(5.5, 0.17, 3.4, pale, 0, 0.33, 0);
      addBox(5.2, 1.05, 0.52, wood, 0, 0.92, 1.26);
      for (const px of [-2.45, 2.45]) {
        addBox(0.2, 2.65, 0.2, pale, px, 1.45, -1.0);
        addBox(0.2, 2.65, 0.2, pale, px, 1.45, 1.0);
      }
      addBox(5.45, 0.18, 0.2, wood, 0, 2.82, -1.0);
      const canopy = new T.Mesh(new T.BoxGeometry(5.8, 0.18, 2.75), cloth); canopy.position.set(0, 2.72, 0); canopy.rotation.x = -0.03; canopy.castShadow = true; rootGroup.add(canopy);
      const sign = makeSign('TÜCCAR · E', 768, 192, '#e0b84f', 54); sign.position.set(0, 3.85, -1.16); rootGroup.add(sign);
      for (const px of [-1.6, 0, 1.6]) {
        const crate = new T.Mesh(new T.BoxGeometry(0.65, 0.55, 0.55), px === 0 ? pale : wood); crate.position.set(px, 0.7, 0.15); crate.castShadow = true; rootGroup.add(crate);
      }
      ctx.scene.add(rootGroup);
    }
    function applyPlayerArmor(model, armorId) {
      if (!model || !model.userData) return;
      const nextArmorId = armorId || null;
      if (model.userData.rpgArmorId === nextArmorId) return;
      model.userData.rpgArmorId = nextArmorId;
      if (model.userData.rpgArmorVisual) { model.remove(model.userData.rpgArmorVisual); model.userData.rpgArmorVisual.traverse(node => { if (node.geometry) node.geometry.dispose(); if (node.material) node.material.dispose(); }); model.userData.rpgArmorVisual = null; }
      const item = itemById(armorId); if (!item || item.kind !== 'armor') return;
      const T = ctx.THREE, group = new T.Group(), base = new T.MeshStandardMaterial({ color: item.color || '#9a633c', metalness: 0.42, roughness: 0.48 }), trim = new T.MeshStandardMaterial({ color: 0xd8c27a, metalness: 0.62, roughness: 0.35 });
      const blanket = new T.Mesh(new T.BoxGeometry(1.38, 0.72, 1.82), base); blanket.position.set(0, 1.65, -0.04); group.add(blanket);
      for (const side of [-1, 1]) { const plate = new T.Mesh(new T.BoxGeometry(0.08, 0.62, 1.5), trim); plate.position.set(side * 0.71, 1.58, -0.04); group.add(plate); }
      const chest = new T.Mesh(new T.BoxGeometry(1.33, 0.18, 0.28), trim); chest.position.set(0, 1.76, 0.87); group.add(chest);
      group.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
      model.add(group); model.userData.rpgArmorVisual = group;
    }
    function colorEnemyModel(model, color, armorColor, level) {
      const T = ctx.THREE, baseColor = new T.Color(color || '#8a6d50'), materialMap = new Map();
      model.traverse(node => {
        if (!node.isMesh || !node.material) return;
        const original = Array.isArray(node.material) ? node.material : [node.material];
        const updated = original.map(material => {
          if (!material.color || material.color.getHex() !== 0x808080) return material;
          if (!materialMap.has(material)) { const clone = material.clone(); clone.color.copy(baseColor); materialMap.set(material, clone); }
          return materialMap.get(material);
        });
        node.material = Array.isArray(node.material) ? updated : updated[0];
      });
      const armor = new T.Group(), metal = new T.MeshStandardMaterial({ color: armorColor || '#b99d72', metalness: 0.62, roughness: 0.36 });
      if (level >= 20) {
        const plate = new T.Mesh(new T.BoxGeometry(1.42, 0.65, 1.86), metal); plate.position.set(0, 1.63, -0.02); armor.add(plate);
        for (const side of [-1, 1]) { const guard = new T.Mesh(new T.BoxGeometry(0.10, 0.67, 1.42), metal); guard.position.set(side * 0.75, 1.59, -0.02); armor.add(guard); }
      }
      if (level >= 60) {
        const spikeMat = new T.MeshStandardMaterial({ color: armorColor || '#e0bd53', metalness: 0.7, roughness: 0.28 });
        for (const side of [-1, 1]) { const spike = new T.Mesh(new T.ConeGeometry(0.20, 0.72, 6), spikeMat); spike.position.set(side * 0.38, 3.07, 0.96); spike.rotation.z = side * -0.42; armor.add(spike); }
      }
      if (level >= 100) { const crown = new T.Mesh(new T.ConeGeometry(0.52, 0.48, 8), new T.MeshStandardMaterial({ color: 0xffdc66, metalness: 0.72, roughness: 0.25 })); crown.position.set(0, 3.34, 0.97); armor.add(crown); }
      model.add(armor); model.userData.hostileArmor = armor;
    }
    function makeEnemyStatus(model, state) {
      const respawnSeconds = state.alive ? 0 : Math.max(0, Math.ceil((state.respawnAt - Date.now()) / 1000));
      const statusKey = `${state.level}|${state.name}|${Math.round(state.health)}|${state.maxHealth}|${state.alive}|${respawnSeconds}`;
      if (model.userData.hostileStatusKey === statusKey) return;
      model.userData.hostileStatusKey = statusKey;
      let canvas = model.userData.hostileLabelCanvas, sprite = model.userData.hostileLabel;
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 150;
        sprite = new ctx.THREE.Sprite(new ctx.THREE.SpriteMaterial({ map: new ctx.THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
        sprite.position.set(0, 5.55, 0); sprite.scale.set(state.boss ? 5.6 : 4.7, 1.4, 1); model.add(sprite);
        model.userData.hostileLabelCanvas = canvas; model.userData.hostileLabel = sprite;
      }
      const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); g.fillStyle = 'rgba(11,15,18,.88)'; g.beginPath(); g.roundRect(8, 6, 496, 138, 18); g.fill();
      g.fillStyle = state.boss ? '#ffe18a' : '#f6e7bd'; g.font = '900 28px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`SEVİYE ${state.level} · ${state.name}`, 256, 34, 470);
      g.fillStyle = '#492c29'; g.fillRect(62, 72, 388, 22); g.fillStyle = '#c8483e'; g.fillRect(62, 72, 388 * Math.max(0, Math.min(1, state.health / state.maxHealth)), 22);
      g.strokeStyle = '#f6ead0'; g.lineWidth = 3; g.strokeRect(62, 72, 388, 22);
      g.fillStyle = state.alive ? '#edf0e9' : '#f4c7bd'; g.font = 'bold 19px Arial'; g.fillText(state.alive ? `${Math.ceil(state.health)} / ${state.maxHealth} CAN` : `YENİDEN DOĞUYOR · ${respawnSeconds} sn`, 256, 119);
      sprite.material.map.needsUpdate = true;
    }
    function createEnemy(state) {
      const model = ctx.createDonkeyModel();
      model.scale.setScalar(state.boss ? 1.18 : 0.82 + Math.min(state.level / 100, 1) * 0.25);
      model.position.set(state.x, ctx.terrainHeightAt(state.x, state.z), state.z); model.userData.hostileId = state.id; model.userData.hostileState = { ...state };
      colorEnemyModel(model, state.color, state.armorColor, state.level); makeEnemyStatus(model, state); ctx.scene.add(model);
      hostileModels.set(state.id, model); hostileStates.set(state.id, { ...state });
      return model;
    }
    function setEnemyHitFlash(model, on) {
      model.traverse(node => {
        if (!node.isMesh || !node.material) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (!material.emissive) continue;
          if (material.__baseEmissive === undefined) material.__baseEmissive = material.emissive.getHex();
          material.emissive.setHex(on ? 0xff2020 : material.__baseEmissive);
        }
      });
    }
    function updateEnemyHitFlash(model, now) {
      if (!model || !model.userData.hitUntil) return;
      if (now < model.userData.hitUntil) setEnemyHitFlash(model, Math.floor((model.userData.hitUntil - now) / 90) % 2 === 0);
      else { setEnemyHitFlash(model, false); model.userData.hitUntil = 0; }
    }
    function applyEnemyState(state) {
      if (!state || !state.id) return;
      const merged = { ...(hostileStates.get(state.id) || {}), ...state };
      hostileStates.set(state.id, merged);
      let model = hostileModels.get(state.id);
      if (!model && (!ctx.isGameStarted() || !hostileIsNearPlayer(merged))) return;
      if (!model) model = createEnemy(merged);
      const previous = model.userData.hostileState || {};
      if (Number(merged.health) < Number(previous.health)) model.userData.hitUntil = performance.now() + 360;
      model.userData.hostileState = { ...previous, ...merged };
      if (merged.x != null && merged.z != null) { model.userData.networkTarget = { x: Number(merged.x), z: Number(merged.z) }; }
      model.visible = hostileIsNearPlayer(merged);
      model.userData.hostileState = { ...model.userData.hostileState, health: Number(merged.health) || 0, maxHealth: Number(merged.maxHealth) || 1, alive: !!merged.alive, respawnAt: Number(merged.respawnAt) || 0 };
      makeEnemyStatus(model, model.userData.hostileState);
      if (merged.alive) { model.rotation.z = 0; }
      else { model.rotation.z = Math.PI / 2; }
    }
    function makeZoneMarker(zone) {
      if (zoneMarkers.has(zone.id)) return;
      const T = ctx.THREE, group = new T.Group(), y = ctx.terrainHeightAt(zone.x, zone.z), color = new T.Color(zone.color || '#cc4a3d');
      group.position.set(zone.x, y + 0.02, zone.z);
      const disc = new T.Mesh(new T.CircleGeometry(zone.radius, 48), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, side: T.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; group.add(disc);
      const ring = new T.Mesh(new T.RingGeometry(zone.radius - 0.8, zone.radius, 64), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.52, side: T.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; group.add(ring);
      const banner = makeSign(`BÖLGE ${zone.level} · ${zone.level === 100 ? 'BOSS' : `SEVİYE ${zone.level}`}`, 768, 144, zone.armorColor || '#e0b84f', 45); banner.position.set(0, 11, 0); banner.scale.set(zone.level === 100 ? 10 : 8, 1.5, 1); group.add(banner);
      ctx.scene.add(group); zoneMarkers.set(zone.id, group);
    }
    function applyEnemies(zones, enemies) {
      for (const zone of zones || data.enemyZones) makeZoneMarker(zone);
      for (const state of enemies || []) applyEnemyState(state);
    }
    function updateEnemyModels(now) {
      if (!ctx.isGameStarted()) return;
      const player = ctx.getPlayerPosition();
      for (const [id, state] of hostileStates) {
        if (!state) continue;
        let model = hostileModels.get(id);
        const distance = player ? Math.hypot(Number(state.x) - player.x, Number(state.z) - player.z) : 0;
        if (distance > HOSTILE_RENDER_DISTANCE) {
          if (model) { model.visible = false; model.position.set(state.x, ctx.terrainHeightAt(state.x, state.z), state.z); model.userData.networkTarget = null; }
          continue;
        }
        if (!model) {
          model = createEnemy(state);
          if (!state.alive) model.rotation.z = Math.PI / 2;
          continue;
        }
        model.visible = true;
        model.userData.hostileState = { ...(model.userData.hostileState || {}), ...state };
        const target = model.userData.networkTarget;
        if (state.alive && target) {
          const dx = target.x - model.position.x, dz = target.z - model.position.z, d = Math.hypot(dx, dz);
          if (d > 0.04) { model.position.x += dx * Math.min(1, 0.18); model.position.z += dz * Math.min(1, 0.18); model.rotation.y = Math.atan2(dx, dz); }
          const gait = Math.sin(now * 0.012 + id.length) * Math.min(0.35, d * 0.12);
          if (model.userData.legs) model.userData.legs.forEach((leg, index) => { leg.rotation.x = gait * (index % 2 ? -1 : 1); });
          model.position.y = ctx.terrainHeightAt(model.position.x, model.position.z);
        }
        if (!state.alive) model.rotation.z = Math.PI / 2;
        updateEnemyHitFlash(model, now);
        makeEnemyStatus(model, state);
      }
    }
    function getNearestHostile(range) {
      const pos = ctx.getPlayerPosition(); if (!pos) return null;
      let best = null, bestDistance = range + 0.001;
      for (const [id, state] of hostileStates) {
        if (!state.alive) continue;
        const model = hostileModels.get(id); if (!model || !model.visible) continue;
        const distance = Math.hypot(model.position.x - pos.x, model.position.z - pos.z);
        if (distance <= range && distance < bestDistance) { bestDistance = distance; best = { type: 'hostileDonkey', hostileId: id, position: model.position.clone(), distance, d: distance }; }
      }
      return best;
    }
    function attachSocket() {
      const socket = ctx.getSocket();
      if (!socket || socket === boundSocket) return;
      boundSocket = socket;
      socket.addEventListener('message', event => {
        let message; try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.type === 'join_accepted') {
          ctx.send('rpg_state_request', {}); ctx.send('hostile_donkeys_request', {});
        } else if (message.type === 'rpg_state') applyRpgState(message.state);
        else if (message.type === 'needs') applyNeeds(message);
        else if (message.type === 'rpg_shop_open') { shopItems = message.items || data.items; shopCategories = message.categories || data.categories; applyRpgState(message.state); render(); }
        else if (message.type === 'rpg_action_result') { if (message.message) ctx.showWarning(message.message); }
        else if (message.type === 'rpg_reward') { if (message.message) ctx.showWarning(message.message); rpgState.coins = Number(rpgState.coins || 0) + Number(message.coins || 0); rpgState.xp = Number(rpgState.xp || 0) + Number(message.xp || 0); setHud(); }
        else if (message.type === 'rpg_level_up') { if (message.message) ctx.showWarning(message.message); }
        else if (message.type === 'hostile_donkeys') applyEnemies(message.zones, message.enemies);
        else if (message.type === 'hostile_donkey_state') applyEnemyState(message.enemy);
        else if (message.type === 'players') {
          for (const [id, player] of Object.entries(message.players || {})) if (id !== ctx.getPlayerId()) applyPlayerArmor(ctx.getOtherPlayerModel(id), player.equippedArmor);
        }
      });
      socket.addEventListener('open', () => { if (ctx.isGameStarted()) { ctx.send('rpg_state_request', {}); ctx.send('hostile_donkeys_request', {}); } });
      if (socket.readyState === 1 && ctx.isGameStarted()) { ctx.send('rpg_state_request', {}); ctx.send('hostile_donkeys_request', {}); }
    }
    function requestInitialState() {
      const socket = ctx.getSocket();
      if (!socket || socket.readyState !== 1 || !ctx.isGameStarted() || initializedSocket === socket) return;
      initializedSocket = socket;
      ctx.send('rpg_state_request', {});
      ctx.send('hostile_donkeys_request', {});
    }

    panel.addEventListener('click', event => { if (event.target === panel) closePanel(); else event.stopPropagation(); });
    panel.querySelector('#rpgClose').addEventListener('click', closePanel);
    mobileBag.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); openPanel('inventory'); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel.style.display === 'flex') { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); return; }
      if (event.key && event.key.toLowerCase() === 'b' && ctx.isGameStarted() && !ctx.isDead() && !event.repeat && !(event.target && event.target.closest('input,textarea,button,#chatPanel'))) {
        event.preventDefault(); event.stopImmediatePropagation(); if (panelMode === 'inventory') closePanel(); else openPanel('inventory');
      }
    }, true);
    root.addEventListener('keydown', event => {
      if (panel.style.display !== 'flex' || event.target && event.target.closest && event.target.closest('#rpgPanel')) return;
      if (/^(w|a|s|d|arrowup|arrowdown|arrowleft|arrowright|shift|space|e)$/i.test(event.key || '')) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    root.addEventListener('resize', setHud);
    setInterval(() => { attachSocket(); requestInitialState(); setHud(); if (panelMode && (!ctx.isGameStarted() || ctx.isDead())) closePanel(); }, 250);
    const animationLoop = () => { updateEnemyModels(performance.now()); requestAnimationFrame(animationLoop); };
    requestAnimationFrame(animationLoop);
    setHud();

    return {
      openTrader,
      closePanel,
      openInventory: () => openPanel('inventory'),
      addTraderWorldProps,
      getNearestHostile,
      applyRpgState,
      applyNeeds,
      applyPlayerArmor
    };
  };
})(window);
