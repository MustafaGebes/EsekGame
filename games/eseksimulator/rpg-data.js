(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.EsekRpgData = data;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const levels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const swordNames = [
    ['bronze_sword', 'Bronz Kılıç'], ['iron_sword', 'Demir Kılıç'], ['raider_sabre', 'Akıncı Palası'],
    ['redsteel_blade', 'Kızıl Çelik Kılıç'], ['warrior_greatsword', 'Savaşçı Büyük Kılıcı'],
    ['black_guard_sword', 'Kara Muhafız Kılıcı'], ['night_slicer', 'Gece Biçağı'],
    ['storm_sword', 'Fırtına Kılıcı'], ['ash_edge', 'Kül Keseni'], ['mythic_blade', 'Efsanevi Kılıç'],
    ['king_sword', 'Eşek Kralının Kılıcı']
  ];
  const gunNames = [
    ['old_revolver', 'Eski Tabanca'], ['hunter_rifle', 'Avcı Tüfeği'], ['bandit_rifle', 'Akıncı Tüfeği'],
    ['red_scope_rifle', 'Kızıl Nişancı'], ['steel_longgun', 'Çelik Uzun Tüfek'],
    ['black_powder_gun', 'Kara Barut Silahı'], ['night_hunter', 'Gece Avcısı'],
    ['storm_rifle', 'Fırtına Tüfeği'], ['ash_repeater', 'Kül Tekrarlayıcı'],
    ['mythic_rifle', 'Efsanevi Tüfek'], ['king_cannon', 'Kral Topu']
  ];
  const weaponPrices = [120, 300, 520, 800, 1150, 1550, 2000, 2500, 3100, 3800, 4600];
  const swords = swordNames.map(([id, name], index) => ({
    id, category: 'weapons', kind: 'weapon', weaponType: 'sword', name,
    icon: index < 2 ? '🗡️' : '⚔️', price: weaponPrices[index], requiredLevel: levels[index],
    damageMultiplier: 1 + index * 0.48, weaponTier: index, color: ['#c8d0d8','#dfe7ef','#e07b45','#d94d43','#9ba9b4','#6c7185','#59a4c0','#58c7c7','#bd75d1','#f0c45b','#ffe08a'][index],
    description: `Seviye ${levels[index]} kademesi. Yakın dövüş hasarı ×${(1 + index * 0.48).toFixed(2)}.`
  }));
  const guns = gunNames.map(([id, name], index) => ({
    id, category: 'weapons', kind: 'weapon', weaponType: 'gun', name,
    icon: index < 2 ? '🔫' : '🎯', price: weaponPrices[index] + 80, requiredLevel: levels[index],
    damageMultiplier: 1 + index * 0.43, weaponTier: index, color: ['#65727a','#9aa5ad','#c78238','#d94d43','#9ba9b4','#6c7185','#59a4c0','#58c7c7','#bd75d1','#f0c45b','#ffe08a'][index], ammo: 12,
    description: `Seviye ${levels[index]} kademesi. Menzilli hasar ×${(1 + index * 0.43).toFixed(2)}; şarjör 12 mermi.`
  }));
  const armorNames = [
    ['leather_armor', 'Deri Eşek Zırhı'], ['raider_armor', 'Akıncı Zırhı'], ['ranger_armor', 'Korucu Zırhı'],
    ['redsteel_armor', 'Kızıl Çelik Zırh'], ['warrior_armor', 'Savaşçı Zırhı'], ['black_guard_armor', 'Kara Muhafız Zırhı'],
    ['night_armor', 'Gece Zırhı'], ['storm_armor', 'Fırtına Zırhı'], ['ash_armor', 'Kül Zırhı'],
    ['mythic_armor', 'Efsanevi Zırh'], ['guardian_armor', 'Eşek Kralının Zırhı']
  ];
  const armorPrices = [160, 260, 390, 540, 720, 930, 1170, 1440, 1740, 2070, 2450];
  const armors = armorNames.map(([id, name], index) => ({
    id, category: 'armor', kind: 'armor', name, icon: index < 2 ? '🦺' : '🛡️',
    price: armorPrices[index], requiredLevel: levels[index],
    color: ['#9a633c', '#9a633c', '#4e7a55', '#a84e3f', '#66747d', '#4f4d58', '#3f5668', '#71808d', '#56525c', '#754f82', '#d1ad4f'][index],
    healthBonus: Math.min(6, 1 + Math.floor(index / 2)), staminaBonus: 12 + index * 5,
    damageReduction: 0.08 + index * 0.032,
    hungerDrainMultiplier: Math.max(0.70, 0.95 - index * 0.025),
    thirstDrainMultiplier: Math.max(0.70, 0.95 - index * 0.025),
    speedMultiplier: 1.03 + index * 0.004,
    description: `Seviye ${levels[index]} zırhı: +${Math.min(6, 1 + Math.floor(index / 2))} can, +${12 + index * 5} enerji ve %${Math.round((0.08 + index * 0.032) * 100)} hasar azaltma.`
  }));
  return {
    maxLevel: 100,
    startingCoins: 250,
    xpBase: 80,
    xpPerLevel: 20,
    bagSlotsBase: 3,
    bagSlotsPerUpgrade: 4,
    respawnMs: 10000,
    // Mountains form two rings near radii 470 and 500 in the client map (MAP_LIMIT=510).
    // Keep hostile spawn and AI coordinates inside this radius to avoid the mountain wall.
    enemySafeRadius: 410,
    trader: { x: 177, z: 247, range: 9 },
    categories: [
      { id: 'weapons', name: 'Silahlar', icon: '⚔️' },
      { id: 'ammo', name: 'Şarjörler', icon: '🧰' },
      { id: 'armor', name: 'Zırhlar', icon: '🛡️' },
      { id: 'bags', name: 'Çantalar', icon: '🎒' },
      { id: 'pets', name: 'Petler', icon: '🐾' },
      { id: 'food', name: 'Yiyecekler', icon: '🍲' }
    ],
    items: [
      ...swords, ...guns, ...armors,
      { id: 'small_bag', category: 'bags', kind: 'bag', name: 'Küçük Heybe', icon: '🎒', price: 100, requiredLevel: 1, bagLevel: 1, capacity: 7, description: 'Çanta kapasiteni 3 yuvadan 7 yuvaya çıkarır.' },
      { id: 'trail_bag', category: 'bags', kind: 'bag', name: 'Gezgin Heybesi', icon: '🧳', price: 350, requiredLevel: 10, bagLevel: 2, capacity: 11, description: 'Kapasiteyi 11 yuvaya çıkarır; önce Küçük Heybe gerekir.' },
      { id: 'large_bag', category: 'bags', kind: 'bag', name: 'Büyük Sırt Çantası', icon: '🎒', price: 850, requiredLevel: 30, bagLevel: 3, capacity: 15, description: 'En yüksek kapasite: 15 yuva.' },
      { id: 'dog', category: 'pets', kind: 'pet', name: 'Bekçi Köpek', icon: '🐕', price: 170, requiredLevel: 1, damageMultiplier: 1.25, description: 'Saldırı gücünü artırır.' },
      { id: 'rabbit', category: 'pets', kind: 'pet', name: 'Çevik Tavşan', icon: '🐇', price: 240, requiredLevel: 1, speedMultiplier: 1.12, description: 'Daha hızlı koşmana ve enerjini daha iyi kullanmana yardım eder.' },
      { id: 'turtle', category: 'pets', kind: 'pet', name: 'Sağlam Kaplumbağa', icon: '🐢', price: 280, requiredLevel: 1, damageTakenMultiplier: 0.8, description: 'Gelen hasarı azaltır.' },
      { id: 'bread', category: 'food', kind: 'food', name: 'Köy Ekmeği', icon: '🍞', price: 20, requiredLevel: 1, hunger: 2.2, description: '+2,2 açlık. Süreli özellik vermez.' },
      { id: 'water_bottle', category: 'food', kind: 'food', name: 'Matara Suyu', icon: '🧴', price: 20, requiredLevel: 1, thirst: 2.8, description: '+2,8 susuzluk.' },
      { id: 'hearty_stew', category: 'food', kind: 'food', name: 'Doyurucu Güveç', icon: '🍲', price: 55, requiredLevel: 1, hunger: 2.4, thirst: 1.1, description: '+2,4 açlık ve +1,1 susuzluk.' },
      { id: 'swift_berry', category: 'food', kind: 'food', name: 'Çeviklik Dutlu İçecek', icon: '🫐', price: 90, requiredLevel: 5, hunger: 1, thirst: 0.5, durationMs: 60000, buffs: { speed: 1.14, staminaRegen: 1.3 }, description: '60 sn boyunca %14 hız ve %30 enerji yenilenmesi.' },
      { id: 'war_oats', category: 'food', kind: 'food', name: 'Savaş Yulafı', icon: '🌾', price: 100, requiredLevel: 5, hunger: 2, thirst: 0.2, durationMs: 60000, buffs: { damage: 1.25 }, description: '60 sn boyunca %25 saldırı gücü.' },
      { id: 'ammo_magazine', category: 'ammo', kind: 'ammo', name: '12’li Şarjör', icon: '🧰', price: 55, requiredLevel: 1, quantity: 1, description: 'Çantanda taşınır. Silahın boşaldığında kullanarak 12 mermi doldurur.' },
      { id: 'spring_tea', category: 'food', kind: 'food', name: 'Enerji Çayı', icon: '🍵', price: 75, requiredLevel: 1, thirst: 2, stamina: 40, durationMs: 60000, buffs: { staminaRegen: 1.5 }, description: '+40 enerji ve 60 sn boyunca %50 enerji yenilenmesi.' }
    ],
    enemyZones: [
      { id: 'zone-10', level: 10, x: 300, z: 180, radius: 44, count: 5, name: 'Çayır Eşeği', color: '#8a6d50', armorColor: '#b99d72' },
      { id: 'zone-20', level: 20, x: 350, z: 20, radius: 44, count: 5, name: 'Kabadayı Eşek', color: '#98654b', armorColor: '#c78238' },
      { id: 'zone-30', level: 30, x: 330, z: -160, radius: 44, count: 5, name: 'Kızıl Akıncı', color: '#a84e3f', armorColor: '#d17a50' },
      { id: 'zone-40', level: 40, x: 80, z: -375, radius: 44, count: 5, name: 'Çelik Yelekli', color: '#66747d', armorColor: '#9fb4c1' },
      { id: 'zone-50', level: 50, x: -80, z: -375, radius: 44, count: 5, name: 'Kara Muhafız', color: '#4f4d58', armorColor: '#9992ad' },
      { id: 'zone-60', level: 60, x: -380, z: 0, radius: 44, count: 5, name: 'Gece Baskıncısı', color: '#3f5668', armorColor: '#58a0b3' },
      { id: 'zone-70', level: 70, x: -300, z: 230, radius: 44, count: 5, name: 'Savaş Reisi', color: '#72604a', armorColor: '#d6a43d' },
      { id: 'zone-80', level: 80, x: -120, z: 350, radius: 44, count: 5, name: 'Fırtına Eşeği', color: '#71808d', armorColor: '#74c1d1' },
      { id: 'zone-90', level: 90, x: 170, z: 340, radius: 44, count: 5, name: 'Kül Savaşçısı', color: '#56525c', armorColor: '#c77963' },
      { id: 'zone-100', level: 100, x: 0, z: 380, radius: 46, count: 5, name: 'Kral Muhafızı', bossName: 'Efsanevi Kral Eşek', color: '#382d40', armorColor: '#8c719c', bossColor: '#211a2a', bossArmorColor: '#e0bd53', boss: true }
    ]
  };
});
