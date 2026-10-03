export function createCitySimulation(THREE, scene, options = {}) {
  const {
    roadLines,
    roadWidth,
    state,
    windTrees = [],
    signalHeads = [],
    hud = null,
    getPlayerPosition = () => null,
  } = options;

  const signalRoads = roadLines.filter((line) => Math.abs(line) <= 42);
  const junctions = new Map();
  const junctionKey = (x, z) => `${x}:${z}`;
  const schedule = [
    ['NS_GREEN', 14],
    ['NS_YELLOW', 3],
    ['NS_CLEAR', 3],
    ['EW_GREEN', 14],
    ['EW_YELLOW', 3],
    ['EW_CLEAR', 3],
    ['WALK', 7],
    ['PED_CLEAR', 16],
    ['ALL_RED', 1],
  ];
  const cycleLength = schedule.reduce((sum, phase) => sum + phase[1], 0);

  let junctionIndex = 0;
  for (const x of signalRoads) {
    for (const z of signalRoads) {
      junctions.set(junctionKey(x, z), {
        x,
        z,
        offset: (junctionIndex * 6.7) % cycleLength,
      });
      junctionIndex += 1;
    }
  }

  let elapsed = 0;
  let hudCooldown = 0;
  let randomSeed = 193781;
  const random = () => {
    randomSeed = (randomSeed * 16807) % 2147483647;
    return (randomSeed - 1) / 2147483646;
  };

  function phaseAt(key) {
    const junction = junctions.get(key);
    if (!junction) return { phase: 'ALL_RED', remaining: 0 };
    let time = (elapsed + junction.offset) % cycleLength;
    for (const [phase, duration] of schedule) {
      if (time < duration) return { phase, remaining: duration - time };
      time -= duration;
    }
    return { phase: 'ALL_RED', remaining: 0 };
  }

  const offColors = { red: 0x4d211e, amber: 0x594319, green: 0x1b3d27 };
  const onColors = { red: 0xff493e, amber: 0xffcb4c, green: 0x59f28b };
  const onEmissive = { red: 0xff251a, amber: 0xffa51a, green: 0x23ed62 };
  function setLamp(head, activeColor) {
    for (const color of ['red', 'amber', 'green']) {
      const material = head.lamps[color];
      const on = color === activeColor;
      material.color.setHex(on ? onColors[color] : offColors[color]);
      material.emissive.setHex(on ? onEmissive[color] : 0x080808);
      material.emissiveIntensity = on ? 2.1 : 0.05;
    }
  }

  function updateSignals() {
    for (const head of signalHeads) {
      const phase = phaseAt(head.junctionKey).phase;
      let color = 'red';
      if (head.axis === 'NS') {
        if (phase === 'NS_GREEN') color = 'green';
        else if (phase === 'NS_YELLOW') color = 'amber';
      } else {
        if (phase === 'EW_GREEN') color = 'green';
        else if (phase === 'EW_YELLOW') color = 'amber';
      }
      setLamp(head, color);
    }
  }

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(1, 10, 8);
  const limbMaterial = (color) => new THREE.MeshLambertMaterial({ color });
  function addBox(parent, material, width, height, depth, x, y, z) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.scale.set(width, height, depth);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }
  function addSphere(parent, material, radius, x, y, z, scaleX = 1, scaleY = 1, scaleZ = 1) {
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.scale.set(radius * scaleX, radius * scaleY, radius * scaleZ);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  const clothing = [0x365b73, 0x8a4a3b, 0x53664b, 0x735e43, 0x55456b, 0x3f6260, 0x9a743e, 0x59616b];
  const trousers = [0x303945, 0x51483d, 0x344638, 0x3d394b, 0x65513e, 0x394b5a];
  const hairColors = [0x28231f, 0x4c3324, 0x65615a, 0x211e1a, 0x8b6844];
  const skinColors = [0xd5a783, 0xb98262, 0xe1bd98, 0x95654e, 0xc99373];
  const shirtMaterials = clothing.map(limbMaterial);
  const trouserMaterials = trousers.map(limbMaterial);
  const hairMaterials = hairColors.map(limbMaterial);
  const skinMaterials = skinColors.map(limbMaterial);
  const shoeMaterials = [0x252522, 0x3b3028, 0x4a4440].map(limbMaterial);
  const whiteEye = limbMaterial(0xf1eee4);
  const pupil = limbMaterial(0x191a18);
  const beltMaterial = limbMaterial(0x47382a);
  const bagMaterials = [0x2b3435, 0x433a31, 0x414641].map(limbMaterial);

  function makePerson(styleIndex) {
    const root = new THREE.Group();
    const shirt = shirtMaterials[styleIndex % shirtMaterials.length];
    const pants = trouserMaterials[styleIndex % trouserMaterials.length];
    const hair = hairMaterials[styleIndex % hairMaterials.length];
    const skin = skinMaterials[styleIndex % skinMaterials.length];
    const shoe = shoeMaterials[styleIndex % shoeMaterials.length];

    const torso = addBox(root, shirt, 0.43, 0.62, 0.27, 0, 1.08, 0);
    addBox(root, beltMaterial, 0.44, 0.07, 0.29, 0, 0.77, 0);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.13, 7), skin);
    neck.position.set(0, 1.46, 0);
    neck.castShadow = false;
    root.add(neck);
    addSphere(root, skin, 0.18, 0, 1.63, 0.015, 0.93, 1.03, 0.9);
    addSphere(root, hair, 0.18, 0, 1.72, -0.005, 1.02, 0.48, 1.0);
    addBox(root, skin, 0.055, 0.075, 0.075, 0, 1.59, 0.165);
    for (const side of [-1, 1]) {
      addSphere(root, whiteEye, 0.027, side * 0.061, 1.655, 0.157);
      addSphere(root, pupil, 0.012, side * 0.061, 1.653, 0.18);
    }

    const arms = [];
    const legs = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.255, 1.34, 0);
      root.add(arm);
      addBox(arm, shirt, 0.145, 0.34, 0.16, 0, -0.17, 0);
      const forearm = new THREE.Group();
      forearm.position.set(0, -0.33, 0);
      arm.add(forearm);
      addBox(forearm, shirt, 0.125, 0.29, 0.14, 0, -0.135, 0.015);
      addSphere(forearm, skin, 0.07, 0, -0.29, 0.02, 0.86, 0.78, 0.8);
      arms.push(arm);

      const leg = new THREE.Group();
      leg.position.set(side * 0.115, 0.76, 0);
      root.add(leg);
      addBox(leg, pants, 0.17, 0.39, 0.18, 0, -0.18, 0);
      const lowerLeg = new THREE.Group();
      lowerLeg.position.set(0, -0.36, 0);
      leg.add(lowerLeg);
      addBox(lowerLeg, pants, 0.145, 0.34, 0.155, 0, -0.16, 0);
      addBox(lowerLeg, shoe, 0.19, 0.11, 0.29, 0, -0.34, 0.055);
      legs.push(leg);
    }

    if (styleIndex % 3 === 0) {
      addBox(root, bagMaterials[styleIndex % bagMaterials.length], 0.3, 0.38, 0.13, 0, 1.12, -0.2);
      addBox(root, bagMaterials[styleIndex % bagMaterials.length], 0.075, 0.42, 0.07, -0.15, 1.14, -0.13);
      addBox(root, bagMaterials[styleIndex % bagMaterials.length], 0.075, 0.42, 0.07, 0.15, 1.14, -0.13);
    }

    scene.add(root);
    return { root, torso, arms, legs };
  }

  const nodes = new Map();
  const nodeKey = (ix, iz, sx, sz) => `${ix},${iz},${sx},${sz}`;
  function getNode(ix, iz, sx, sz) {
    const key = nodeKey(ix, iz, sx, sz);
    if (nodes.has(key)) return nodes.get(key);
    const px = roadLines[ix];
    const pz = roadLines[iz];
    const position = new THREE.Vector3(
      px + sx * (roadWidth(px) / 2 + 1.25),
      0,
      pz + sz * (roadWidth(pz) / 2 + 1.25),
    );
    const node = { key, ix, iz, sx, sz, position, edges: [] };
    nodes.set(key, node);
    return node;
  }
  for (let ix = 0; ix < roadLines.length; ix += 1) {
    for (let iz = 0; iz < roadLines.length; iz += 1) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) getNode(ix, iz, sx, sz);
      }
    }
  }

  function connect(a, b, points, kind = 'sidewalk', key = null) {
    const forward = { from: a, to: b, points, kind, junctionKey: key };
    const reverse = { from: b, to: a, points: [...points].reverse(), kind, junctionKey: key };
    a.edges.push(forward);
    b.edges.push(reverse);
  }
  for (let ix = 0; ix < roadLines.length - 1; ix += 1) {
    for (let iz = 0; iz < roadLines.length; iz += 1) {
      for (const sz of [-1, 1]) {
        connect(getNode(ix, iz, 1, sz), getNode(ix + 1, iz, -1, sz), [
          getNode(ix, iz, 1, sz).position,
          getNode(ix + 1, iz, -1, sz).position,
        ]);
      }
    }
  }
  for (let ix = 0; ix < roadLines.length; ix += 1) {
    for (let iz = 0; iz < roadLines.length - 1; iz += 1) {
      for (const sx of [-1, 1]) {
        connect(getNode(ix, iz, sx, 1), getNode(ix, iz + 1, sx, -1), [
          getNode(ix, iz, sx, 1).position,
          getNode(ix, iz + 1, sx, -1).position,
        ]);
      }
    }
  }

  function addCrossing(ix, iz, direction, side) {
    const px = roadLines[ix];
    const pz = roadLines[iz];
    const wx = roadWidth(px);
    const wz = roadWidth(pz);
    const key = junctionKey(px, pz);
    if (direction === 'across-ns') {
      const a = getNode(ix, iz, -1, side);
      const b = getNode(ix, iz, 1, side);
      const crossZ = pz + side * (wz / 2 + 2.25);
      const points = [
        a.position,
        new THREE.Vector3(px - wx / 2 - 0.28, 0, crossZ),
        new THREE.Vector3(px + wx / 2 + 0.28, 0, crossZ),
        b.position,
      ];
      connect(a, b, points, 'crossing', key);
    } else {
      const a = getNode(ix, iz, side, -1);
      const b = getNode(ix, iz, side, 1);
      const crossX = px + side * (wx / 2 + 2.25);
      const points = [
        a.position,
        new THREE.Vector3(crossX, 0, pz - wz / 2 - 0.28),
        new THREE.Vector3(crossX, 0, pz + wz / 2 + 0.28),
        b.position,
      ];
      connect(a, b, points, 'crossing', key);
    }
  }
  for (let ix = 1; ix <= 3; ix += 1) {
    for (let iz = 1; iz <= 3; iz += 1) {
      for (const side of [-1, 1]) {
        addCrossing(ix, iz, 'across-ns', side);
        addCrossing(ix, iz, 'across-ew', side);
      }
    }
  }

  function pathBetween(startKey, targetKey) {
    if (startKey === targetKey) return [];
    const queue = [startKey];
    const previous = new Map([[startKey, null]]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = nodes.get(queue[cursor]);
      for (const edge of current.edges) {
        if (previous.has(edge.to.key)) continue;
        previous.set(edge.to.key, edge);
        if (edge.to.key === targetKey) {
          const path = [];
          let at = targetKey;
          while (at !== startKey) {
            const step = previous.get(at);
            if (!step) return [];
            path.push(step);
            at = step.from.key;
          }
          return path.reverse();
        }
        queue.push(edge.to.key);
      }
    }
    return [];
  }

  const nodeKeys = [...nodes.keys()];
  function newRoute(fromKey) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const targetKey = nodeKeys[Math.floor(random() * nodeKeys.length)];
      if (targetKey === fromKey) continue;
      const path = pathBetween(fromKey, targetKey);
      if (path.length) return { targetKey, path };
    }
    const node = nodes.get(fromKey);
    const edge = node?.edges.find((candidate) => candidate.kind === 'sidewalk');
    return edge ? { targetKey: edge.to.key, path: [edge] } : { targetKey: fromKey, path: [] };
  }

  const pedestrians = [];
  const pedestrianCount = 18;
  for (let i = 0; i < pedestrianCount; i += 1) {
    const startKey = nodeKeys[Math.floor(random() * nodeKeys.length)];
    const model = makePerson(i);
    const start = nodes.get(startKey).position;
    model.root.position.set(start.x, 0.02, start.z);
    model.root.rotation.y = random() * Math.PI * 2;
    const route = newRoute(startKey);
    pedestrians.push({
      ...model,
      currentNode: startKey,
      targetNode: route.targetKey,
      path: route.path,
      edgeIndex: 0,
      segmentIndex: 0,
      inCrossing: false,
      speed: 1.12 + random() * 0.34,
      gait: random() * Math.PI * 2,
      walking: false,
    });
  }

  const carColors = [0x647b7e, 0x8a4e42, 0x566c4d, 0xa28b68, 0x465d74, 0x8b8276, 0x7a5f7d, 0x445e58, 0xb1a99a, 0x6b7173];
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x536970, metalness: 0.1, roughness: 0.32 });
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222321, roughness: 0.8 });
  const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xffe8a8, emissive: 0xffbd55, emissiveIntensity: 0.5 });
  const tailLightMaterial = new THREE.MeshStandardMaterial({ color: 0x92362d, emissive: 0x49100b, emissiveIntensity: 0.28 });
  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10);

  function makeCar(color) {
    const car = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.57, metalness: 0.12 });
    addBox(car, bodyMaterial, 2.05, 0.67, 4.3, 0, 0.69, 0);
    addBox(car, bodyMaterial, 1.78, 0.12, 3.15, 0, 1.055, -0.08);
    addBox(car, glassMaterial, 1.64, 0.68, 2.12, 0, 1.36, -0.19);
    addBox(car, bodyMaterial, 1.58, 0.1, 1.78, 0, 1.73, -0.22);
    addBox(car, glassMaterial, 1.48, 0.48, 0.08, 0, 1.36, 0.91);
    addBox(car, glassMaterial, 1.46, 0.43, 0.08, 0, 1.34, -1.28);
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.02, 0.36, end * 1.35);
        wheel.castShadow = false;
        car.add(wheel);
        car.userData.wheels ||= [];
        car.userData.wheels.push(wheel);
      }
      addBox(car, headlightMaterial, 0.34, 0.16, 0.08, side * 0.67, 0.75, 2.17);
      addBox(car, tailLightMaterial, 0.34, 0.17, 0.08, side * 0.67, 0.75, -2.17);
    }
    scene.add(car);
    return car;
  }

  const vehicles = [];
  let vehicleIndex = 0;
  for (const axis of ['NS', 'EW']) {
    for (let i = 0; i < roadLines.length; i += 1) {
      const line = roadLines[i];
      for (const direction of [-1, 1]) {
        const along = -104 + ((vehicleIndex * 37 + 9) % 208);
        const car = makeCar(carColors[vehicleIndex % carColors.length]);
        const yaw = axis === 'NS'
          ? (direction > 0 ? 0 : Math.PI)
          : (direction > 0 ? Math.PI / 2 : -Math.PI / 2);
        car.rotation.y = yaw;
        vehicles.push({
          mesh: car,
          axis,
          line,
          direction,
          along,
          speed: 5.0 + (vehicleIndex % 4) * 0.32,
          wheelRotation: 0,
        });
        vehicleIndex += 1;
      }
    }
  }

  function nextSignal(vehicle) {
    if (Math.abs(vehicle.line) > 42) return null;
    let nearest = null;
    for (const coordinate of signalRoads) {
      const distance = (coordinate - vehicle.along) * vehicle.direction;
      if (distance > 0.2 && (!nearest || distance < nearest.distance)) {
        nearest = { coordinate, distance };
      }
    }
    if (!nearest) return null;
    const key = vehicle.axis === 'NS'
      ? junctionKey(vehicle.line, nearest.coordinate)
      : junctionKey(nearest.coordinate, vehicle.line);
    return { ...nearest, key };
  }

  function updateVehicles(dt) {
    for (const vehicle of vehicles) {
      const next = nextSignal(vehicle);
      let along = vehicle.along;
      const proposed = along + vehicle.direction * vehicle.speed * dt;
      if (next) {
        const phase = phaseAt(next.key).phase;
        const greenPhase = vehicle.axis === 'NS' ? 'NS_GREEN' : 'EW_GREEN';
        const yellowPhase = vehicle.axis === 'NS' ? 'NS_YELLOW' : 'EW_YELLOW';
        const approachOffset = roadWidth(next.coordinate) / 2 + 2.25 + 2.65;
        const stopLine = next.coordinate - vehicle.direction * approachOffset;
        const distanceToStop = (stopLine - along) * vehicle.direction;
        const mayEnter = phase === greenPhase || (phase === yellowPhase && distanceToStop <= vehicle.speed * 0.65);
        const proposedDistance = (stopLine - proposed) * vehicle.direction;
        if (!mayEnter && distanceToStop >= 0 && proposedDistance < 0) along = stopLine;
        else along = proposed;
      } else {
        along = proposed;
      }
      if (along > 116) along = -116;
      else if (along < -116) along = 116;
      vehicle.along = along;
      if (vehicle.axis === 'NS') {
        vehicle.mesh.position.set(vehicle.line + vehicle.direction * 1.35, 0, along);
      } else {
        vehicle.mesh.position.set(along, 0, vehicle.line - vehicle.direction * 1.35);
      }
      vehicle.wheelRotation += vehicle.direction * vehicle.speed * dt / 0.34;
      for (const wheel of vehicle.mesh.userData.wheels || []) wheel.rotation.x = vehicle.wheelRotation;
    }
  }

  function updatePedestrian(pedestrian, dt) {
    let budget = pedestrian.speed * dt;
    pedestrian.walking = false;
    for (let guard = 0; budget > 0.001 && guard < 8; guard += 1) {
      let edge = pedestrian.path[pedestrian.edgeIndex];
      if (!edge) {
        const route = newRoute(pedestrian.currentNode);
        pedestrian.targetNode = route.targetKey;
        pedestrian.path = route.path;
        pedestrian.edgeIndex = 0;
        pedestrian.segmentIndex = 0;
        pedestrian.inCrossing = false;
        edge = pedestrian.path[0];
        if (!edge) break;
      }

      if (edge.kind === 'crossing' && pedestrian.segmentIndex === 1 && !pedestrian.inCrossing) {
        if (phaseAt(edge.junctionKey).phase !== 'WALK') break;
        pedestrian.inCrossing = true;
      }

      const target = edge.points[pedestrian.segmentIndex + 1];
      const dx = target.x - pedestrian.root.position.x;
      const dz = target.z - pedestrian.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.015) {
        if (edge.kind === 'crossing' && pedestrian.segmentIndex === 1) pedestrian.inCrossing = false;
        pedestrian.segmentIndex += 1;
        if (pedestrian.segmentIndex >= edge.points.length - 1) {
          pedestrian.currentNode = edge.to.key;
          pedestrian.edgeIndex += 1;
          pedestrian.segmentIndex = 0;
        }
        continue;
      }

      pedestrian.walking = true;
      pedestrian.root.rotation.y = Math.atan2(dx, dz);
      const step = Math.min(distance, budget);
      pedestrian.root.position.x += (dx / distance) * step;
      pedestrian.root.position.z += (dz / distance) * step;
      budget -= step;
      if (step >= distance - 0.001) {
        pedestrian.root.position.x = target.x;
        pedestrian.root.position.z = target.z;
        if (edge.kind === 'crossing' && pedestrian.segmentIndex === 1) pedestrian.inCrossing = false;
        pedestrian.segmentIndex += 1;
        if (pedestrian.segmentIndex >= edge.points.length - 1) {
          pedestrian.currentNode = edge.to.key;
          pedestrian.edgeIndex += 1;
          pedestrian.segmentIndex = 0;
        }
      }
    }

    pedestrian.gait += dt * (pedestrian.walking ? 8.8 : 1.5);
    const swing = pedestrian.walking ? Math.sin(pedestrian.gait) * 0.48 : Math.sin(pedestrian.gait) * 0.025;
    pedestrian.arms[0].rotation.x = swing;
    pedestrian.arms[1].rotation.x = -swing;
    pedestrian.arms[0].rotation.z = -0.04;
    pedestrian.arms[1].rotation.z = 0.04;
    pedestrian.legs[0].rotation.x = -swing * 0.95;
    pedestrian.legs[1].rotation.x = swing * 0.95;
    pedestrian.torso.position.y = 1.08 + (pedestrian.walking ? Math.abs(swing) * 0.035 : Math.sin(pedestrian.gait) * 0.003);
    pedestrian.root.position.y = 0.02 + (pedestrian.walking ? Math.abs(Math.sin(pedestrian.gait * 2)) * 0.018 : 0);
  }

  function updateTrees(dt) {
    const t = elapsed;
    for (const { tree, phase = 0 } of windTrees) {
      tree.rotation.z = Math.sin(t * 0.73 + phase) * 0.034;
      tree.rotation.x = Math.cos(t * 0.57 + phase * 1.3) * 0.021;
    }
  }

  function updateHud(dt) {
    if (!hud) return;
    hudCooldown -= dt;
    if (hudCooldown > 0) return;
    hudCooldown = 0.3;
    let nearestKey = junctionKey(0, 0);
    let nearestDistance = Infinity;
    const position = getPlayerPosition?.();
    if (position) {
      for (const junction of junctions.values()) {
        const distance = (junction.x - position.x) ** 2 + (junction.z - position.z) ** 2;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestKey = junctionKey(junction.x, junction.z);
        }
      }
    }
    const current = phaseAt(nearestKey);
    let label = 'Kavşak temizleniyor';
    if (current.phase === 'NS_GREEN') label = 'K–G araçları yeşil · yayalar bekliyor';
    else if (current.phase === 'NS_YELLOW') label = 'K–G araçları sarı · yayalar bekliyor';
    else if (current.phase === 'EW_GREEN') label = 'D–B araçları yeşil · yayalar bekliyor';
    else if (current.phase === 'EW_YELLOW') label = 'D–B araçları sarı · yayalar bekliyor';
    else if (current.phase === 'WALK') label = 'Araçlar kırmızı · yaya geçidi açık';
    else if (current.phase === 'PED_CLEAR') label = 'Araçlar kırmızı · yayalar geçidi boşaltıyor';
    else if (current.phase.endsWith('CLEAR')) label = 'Araçlar kırmızı · kavşak boşalıyor';
    hud.textContent = `${vehicles.length} araç · ${pedestrians.length} yaya  |  ${label} · ${Math.ceil(current.remaining)} sn`;
  }

  function update(dt) {
    elapsed += dt;
    updateSignals();
    updateVehicles(dt);
    for (const pedestrian of pedestrians) updatePedestrian(pedestrian, dt);
    updateTrees(dt);
    updateHud(dt);
  }

  function animationFrame(now) {
    requestAnimationFrame(animationFrame);
    const dt = Math.min(0.06, Math.max(0, (now - (animationFrame.last || now)) / 1000));
    animationFrame.last = now;
    if (state?.screen === 'game' && state.playing && !state.paused) update(dt);
  }
  requestAnimationFrame(animationFrame);

  return {
    junctions,
    vehicles,
    pedestrians,
    phaseAt,
    step: update,
    get elapsed() { return elapsed; },
  };
}
