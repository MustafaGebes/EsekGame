const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = value => value * value * (3 - 2 * value);
const lerp = (a, b, t) => a + (b - a) * t;

const COLOR_STOPS = [
  { at: 0.00, sky: 0x08111f, ground: 0x48515d, hemiSky: 0x293d5c, hemiGround: 0x191e27, hemi: 0.82, ambient: 0.34, ambientColor: 0x91a4c7, sun: 0.025, sunColor: 0x9bb3dc, warmWindows: 1.85, coolWindows: 0.48, streetLights: 2.15 },
  { at: 0.14, sky: 0x142440, ground: 0x4c535f, hemiSky: 0x3a5274, hemiGround: 0x202631, hemi: 1.00, ambient: 0.40, ambientColor: 0x9aabc9, sun: 0.06, sunColor: 0x9eafd0, warmWindows: 1.75, coolWindows: 0.50, streetLights: 1.85 },
  { at: 0.18, sky: 0x35465f, ground: 0x646973, hemiSky: 0x63728d, hemiGround: 0x30333a, hemi: 1.22, ambient: 0.46, ambientColor: 0xb0b7c8, sun: 0.18, sunColor: 0xc5b2b1, warmWindows: 1.45, coolWindows: 0.58, streetLights: 1.45 },
  { at: 0.22, sky: 0x806a78, ground: 0x76716a, hemiSky: 0xa28891, hemiGround: 0x48413e, hemi: 1.62, ambient: 0.48, ambientColor: 0xe0b7a4, sun: 0.70, sunColor: 0xffa66f, warmWindows: 1.10, coolWindows: 0.70, streetLights: 0.95 },
  { at: 0.25, sky: 0xc98569, ground: 0x847767, hemiSky: 0xe1ad8c, hemiGround: 0x5b4e43, hemi: 2.00, ambient: 0.43, ambientColor: 0xffd0a0, sun: 1.55, sunColor: 0xffa76d, warmWindows: 0.92, coolWindows: 0.84, streetLights: 0.48 },
  { at: 0.31, sky: 0xa9c6d5, ground: 0x8a867b, hemiSky: 0xdbe7eb, hemiGround: 0x514b40, hemi: 2.50, ambient: 0.28, ambientColor: 0xffffff, sun: 2.85, sunColor: 0xffd8ad, warmWindows: 0.82, coolWindows: 0.92, streetLights: 0.18 },
  { at: 0.50, sky: 0xadb9bb, ground: 0x827d72, hemiSky: 0xeaf0ed, hemiGround: 0x514b40, hemi: 2.65, ambient: 0.28, ambientColor: 0xffffff, sun: 3.35, sunColor: 0xffdfb0, warmWindows: 0.82, coolWindows: 1.00, streetLights: 0.12 },
  { at: 0.66, sky: 0xb6c3c5, ground: 0x898277, hemiSky: 0xe4e8e3, hemiGround: 0x514b40, hemi: 2.48, ambient: 0.28, ambientColor: 0xffffff, sun: 2.82, sunColor: 0xffd5a7, warmWindows: 0.84, coolWindows: 0.96, streetLights: 0.18 },
  { at: 0.71, sky: 0xd09a7a, ground: 0x827162, hemiSky: 0xe9b597, hemiGround: 0x54483e, hemi: 2.12, ambient: 0.36, ambientColor: 0xffdfc0, sun: 2.20, sunColor: 0xffa66e, warmWindows: 0.98, coolWindows: 0.84, streetLights: 0.34 },
  { at: 0.75, sky: 0xc58069, ground: 0x76675f, hemiSky: 0xd59b83, hemiGround: 0x50433e, hemi: 1.82, ambient: 0.42, ambientColor: 0xffc9a7, sun: 1.38, sunColor: 0xff9866, warmWindows: 1.10, coolWindows: 0.72, streetLights: 0.62 },
  { at: 0.78, sky: 0x796579, ground: 0x66606b, hemiSky: 0x9b8294, hemiGround: 0x3d3b42, hemi: 1.48, ambient: 0.48, ambientColor: 0xd9b3b0, sun: 0.48, sunColor: 0xd99482, warmWindows: 1.32, coolWindows: 0.62, streetLights: 1.05 },
  { at: 0.82, sky: 0x3a4b69, ground: 0x555c68, hemiSky: 0x566b8a, hemiGround: 0x252b35, hemi: 1.14, ambient: 0.43, ambientColor: 0xa2b0ce, sun: 0.15, sunColor: 0x9fadd0, warmWindows: 1.60, coolWindows: 0.52, streetLights: 1.55 },
  { at: 0.86, sky: 0x172743, ground: 0x4d5561, hemiSky: 0x3c5273, hemiGround: 0x1d232c, hemi: 0.94, ambient: 0.38, ambientColor: 0x91a5cc, sun: 0.04, sunColor: 0x8ca7d8, warmWindows: 1.82, coolWindows: 0.48, streetLights: 1.95 },
  { at: 0.91, sky: 0x0a1322, ground: 0x48515d, hemiSky: 0x293d5c, hemiGround: 0x191e27, hemi: 0.82, ambient: 0.34, ambientColor: 0x91a4c7, sun: 0.025, sunColor: 0x9bb3dc, warmWindows: 1.85, coolWindows: 0.48, streetLights: 2.15 },
  { at: 1.00, sky: 0x08111f, ground: 0x48515d, hemiSky: 0x293d5c, hemiGround: 0x191e27, hemi: 0.82, ambient: 0.34, ambientColor: 0x91a4c7, sun: 0.025, sunColor: 0x9bb3dc, warmWindows: 1.85, coolWindows: 0.48, streetLights: 2.15 }
];

export function createDayNightCycle(THREE, {
  scene,
  hemisphere,
  ambient,
  sun,
  warmWindows = null,
  coolWindows = null,
  groundMaterial = null,
  streetLights = [],
  cycleSeconds = 240,
  startProgress = 0.30
}) {
  if (!scene || !hemisphere || !ambient || !sun) {
    throw new Error('DayNightCycle requires a scene, hemisphere, ambient and sun light.');
  }

  const duration = Math.max(60, Number(cycleSeconds) || 240);
  const stops = COLOR_STOPS.map(stop => ({
    ...stop,
    skyColor: new THREE.Color(stop.sky),
    groundColor: new THREE.Color(stop.ground),
    hemiSkyColor: new THREE.Color(stop.hemiSky),
    hemiGroundColor: new THREE.Color(stop.hemiGround),
    ambientTint: new THREE.Color(stop.ambientColor),
    sunTint: new THREE.Color(stop.sunColor)
  }));
  const sky = new THREE.Color();
  const ground = new THREE.Color();
  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();
  const ambientTint = new THREE.Color();
  const sunTint = new THREE.Color();
  let elapsed = ((Number(startProgress) || 0) % 1) * duration;

  function apply(progress) {
    const phase = ((progress % 1) + 1) % 1;
    let index = stops.findIndex((stop, i) => i < stops.length - 1 && phase >= stop.at && phase <= stops[i + 1].at);
    if (index < 0) index = stops.length - 2;
    const from = stops[index];
    const to = stops[index + 1];
    const blend = smoothstep(clamp((phase - from.at) / (to.at - from.at), 0, 1));

    sky.copy(from.skyColor).lerp(to.skyColor, blend);
    ground.copy(from.groundColor).lerp(to.groundColor, blend);
    hemiSky.copy(from.hemiSkyColor).lerp(to.hemiSkyColor, blend);
    hemiGround.copy(from.hemiGroundColor).lerp(to.hemiGroundColor, blend);
    ambientTint.copy(from.ambientTint).lerp(to.ambientTint, blend);
    sunTint.copy(from.sunTint).lerp(to.sunTint, blend);

    scene.background.copy(sky);
    if (scene.fog) scene.fog.color.copy(sky);
    if (groundMaterial) groundMaterial.color.copy(ground);
    hemisphere.color.copy(hemiSky);
    hemisphere.groundColor.copy(hemiGround);
    hemisphere.intensity = lerp(from.hemi, to.hemi, blend);
    ambient.color.copy(ambientTint);
    ambient.intensity = lerp(from.ambient, to.ambient, blend);
    sun.color.copy(sunTint);
    sun.intensity = lerp(from.sun, to.sun, blend);

    const angle = phase * Math.PI * 2;
    sun.position.set(Math.cos(angle) * 78, Math.sin(angle - Math.PI / 2) * 64, Math.sin(angle) * 78);

    if (warmWindows) warmWindows.emissiveIntensity = lerp(from.warmWindows, to.warmWindows, blend);
    if (coolWindows) coolWindows.emissiveIntensity = lerp(from.coolWindows, to.coolWindows, blend);
    const lampGlow = lerp(from.streetLights, to.streetLights, blend);
    for (const material of streetLights) material.emissiveIntensity = lampGlow;

    return phase;
  }

  elapsed = clamp(elapsed, 0, duration - 0.001);
  apply(elapsed / duration);

  return {
    update(deltaSeconds) {
      if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) elapsed = (elapsed + deltaSeconds) % duration;
      return apply(elapsed / duration);
    },
    get progress() { return elapsed / duration; },
    get cycleSeconds() { return duration; },
    get phase() {
      const progress = elapsed / duration;
      if (progress < 0.14 || progress >= 0.86) return 'Gece';
      if (progress < 0.25) return 'Şafak';
      if (progress < 0.68) return 'Gündüz';
      if (progress < 0.78) return 'Günbatımı';
      return 'Alacakaranlık';
    }
  };
}
