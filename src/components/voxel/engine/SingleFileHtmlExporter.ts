// SingleFileHtmlExporter.ts - Generates a rich self-contained single-file HTML Voxel Sandbox Game
export function generateSingleFileHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voxel Sandbox - 3D Craft World</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
    }
    body, html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #000;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #game-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    #crosshair {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 16px;
      height: 16px;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 10;
    }
    #crosshair::before, #crosshair::after {
      content: '';
      position: absolute;
      background: rgba(255, 255, 255, 0.85);
      box-shadow: 0 0 2px rgba(0,0,0,0.8);
    }
    #crosshair::before {
      top: 7px;
      left: 0;
      width: 16px;
      height: 2px;
    }
    #crosshair::after {
      top: 0;
      left: 7px;
      width: 2px;
      height: 16px;
    }
    #hud {
      position: absolute;
      top: 16px;
      left: 16px;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 12px 16px;
      color: #fff;
      font-family: monospace;
      font-size: 12px;
      z-index: 10;
      pointer-events: none;
    }
    #hud .title {
      color: #34d399;
      font-weight: bold;
      margin-bottom: 4px;
      font-size: 13px;
    }
    #health-bar {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .heart {
      width: 12px;
      height: 12px;
      background-color: #ef4444;
      border-radius: 50%;
      display: inline-block;
    }
    #hotbar {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      padding: 8px;
      display: flex;
      gap: 8px;
      z-index: 10;
    }
    .slot {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: all 0.15s ease;
    }
    .slot.active {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.2);
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.4);
      transform: scale(1.05);
    }
    .slot .key {
      position: absolute;
      top: 2px;
      left: 4px;
      font-size: 9px;
      color: #a0aec0;
      font-family: monospace;
    }
    .slot .color-box {
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    .slot .label {
      font-size: 8px;
      color: #e2e8f0;
      margin-top: 2px;
      white-space: nowrap;
      max-width: 44px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #overlay {
      position: absolute;
      inset: 0;
      background: rgba(10, 15, 25, 0.88);
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #fff;
      z-index: 20;
    }
    .card {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 20px;
      padding: 32px;
      text-align: center;
      max-width: 480px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }
    .card h1 {
      font-size: 26px;
      font-weight: 800;
      margin-bottom: 6px;
      background: linear-gradient(135deg, #10b981, #06b6d4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .controls-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      text-align: left;
      font-size: 12px;
      background: rgba(0,0,0,0.4);
      padding: 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      margin: 16px 0;
      font-family: monospace;
      color: #e2e8f0;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #10b981, #06b6d4);
      color: #fff;
      font-weight: bold;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      transition: transform 0.1s ease;
    }
    .btn:hover {
      transform: translateY(-1px);
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <canvas id="game-canvas"></canvas>
  <div id="crosshair"></div>

  <div id="hud">
    <div class="title">VOXEL SANDBOX 3D</div>
    <div id="hud-fps">FPS: 60</div>
    <div id="hud-pos">XYZ: 0, 0, 0</div>
    <div id="hud-clock">Time: 12:00</div>
    <div id="health-bar">
      <span>HP:</span>
      <div id="hearts-container" style="display: inline-flex; gap: 3px;"></div>
    </div>
  </div>

  <div id="hotbar"></div>

  <div id="overlay">
    <div class="card">
      <h1>VOXEL SANDBOX 3D</h1>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 2px;">Procedural Terrain • Day/Night Cycle • Mobs • Single HTML</p>
      <div class="controls-grid">
        <div><strong>WASD</strong> : Move</div>
        <div><strong>Mouse</strong> : Look</div>
        <div><strong>Space</strong> : Jump</div>
        <div><strong>Shift</strong> : Sneak</div>
        <div><strong>Left Click</strong> : Break</div>
        <div><strong>Right Click</strong> : Place/Interact</div>
        <div><strong>1-9</strong> : Select Hotbar</div>
        <div><strong>F</strong> : Toggle Fly</div>
      </div>
      <button class="btn" id="start-btn">Click to Start Playing</button>
    </div>
  </div>

  <script>
    // Embedded Engine Script
    const BlockType = {
      AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6, PLANK: 7, BRICK: 8, GLASS: 9, ORE_IRON: 10, ORE_COAL: 11, WATER: 12, BEDROCK: 13, TORCH: 14, DOOR: 15, BED: 16, WOOL: 17, FENCE: 18
    };

    const BLOCK_CONFIGS = {
      [BlockType.GRASS]: { name: 'Grass', color: '#5b8c31' },
      [BlockType.DIRT]: { name: 'Dirt', color: '#6e4f34' },
      [BlockType.STONE]: { name: 'Stone', color: '#787878' },
      [BlockType.SAND]: { name: 'Sand', color: '#d4be70' },
      [BlockType.WOOD]: { name: 'Oak Wood', color: '#583e26' },
      [BlockType.LEAVES]: { name: 'Leaves', color: '#316629', transparent: true },
      [BlockType.PLANK]: { name: 'Planks', color: '#a8814d' },
      [BlockType.BRICK]: { name: 'Bricks', color: '#9c4938' },
      [BlockType.GLASS]: { name: 'Glass', color: '#aaccff', transparent: true },
      [BlockType.TORCH]: { name: 'Torch', color: '#ffb703', transparent: true },
      [BlockType.DOOR]: { name: 'Door', color: '#a8814d', transparent: true },
      [BlockType.BED]: { name: 'Bed', color: '#c42828' },
      [BlockType.WOOL]: { name: 'White Wool', color: '#e8e8e8' },
      [BlockType.FENCE]: { name: 'Fence', color: '#8a5022', transparent: true }
    };

    const hotbarBlocks = [
      BlockType.GRASS, BlockType.DIRT, BlockType.STONE, BlockType.WOOD,
      BlockType.PLANK, BlockType.BRICK, BlockType.GLASS, BlockType.TORCH, BlockType.BED
    ];
    let activeSlot = 0;

    // Hotbar Setup
    const hotbarEl = document.getElementById('hotbar');
    hotbarBlocks.forEach((blockId, idx) => {
      const cfg = BLOCK_CONFIGS[blockId] || { name: 'Block', color: '#888' };
      const slot = document.createElement('div');
      slot.className = 'slot' + (idx === 0 ? ' active' : '');
      slot.innerHTML = '<span class="key">' + (idx + 1) + '</span><div class="color-box" style="background-color:' + cfg.color + '"></div><div class="label">' + cfg.name + '</div>';
      slot.onclick = () => selectSlot(idx);
      hotbarEl.appendChild(slot);
    });

    function selectSlot(idx) {
      activeSlot = idx;
      document.querySelectorAll('.slot').forEach((s, i) => {
        if (i === idx) s.classList.add('active');
        else s.classList.remove('active');
      });
    }

    // Health UI
    let playerHealth = 10;
    function updateHeartsUI() {
      const container = document.getElementById('hearts-container');
      container.innerHTML = '';
      for (let i = 0; i < 10; i++) {
        const h = document.createElement('div');
        h.className = 'heart';
        if (i >= playerHealth) h.style.opacity = '0.2';
        container.appendChild(h);
      }
    }
    updateHeartsUI();

    // Scene Initialization
    const canvas = document.getElementById('game-canvas');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#87ceeb');
    scene.fog = new THREE.FogExp2('#87ceeb', 0.015);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 0.95);
    sunLight.position.set(50, 100, 50);
    scene.add(sunLight);

    // Stars
    const starsGeom = new THREE.BufferGeometry();
    const starCoords = [];
    for (let i = 0; i < 300; i++) {
      starCoords.push((Math.random() - 0.5) * 500, Math.random() * 200 + 40, (Math.random() - 0.5) * 500);
    }
    starsGeom.setAttribute('position', new THREE.Float32BufferAttribute(starCoords, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0 });
    const starField = new THREE.Points(starsGeom, starsMat);
    scene.add(starField);

    // Voxel Terrain Data
    const SIZE_X = 80, SIZE_Y = 32, SIZE_Z = 80;
    const voxels = new Uint8Array(SIZE_X * SIZE_Y * SIZE_Z);

    function getIndex(x, y, z) { return x + y * SIZE_X + z * SIZE_X * SIZE_Y; }
    function getBlock(x, y, z) {
      if (x < 0 || x >= SIZE_X || y < 0 || y >= SIZE_Y || z < 0 || z >= SIZE_Z) return BlockType.AIR;
      return voxels[getIndex(x, y, z)];
    }
    function setBlock(x, y, z, type) {
      if (x < 0 || x >= SIZE_X || y < 0 || y >= SIZE_Y || z < 0 || z >= SIZE_Z) return;
      voxels[getIndex(x, y, z)] = type;
    }

    // Procedural Generation
    for (let x = 0; x < SIZE_X; x++) {
      for (let z = 0; z < SIZE_Z; z++) {
        const h = Math.floor(10 + Math.sin(x * 0.08) * 4 + Math.cos(z * 0.08) * 4);
        for (let y = 0; y <= h; y++) {
          if (y === 0) setBlock(x, y, z, BlockType.BEDROCK);
          else if (y === h) setBlock(x, y, z, h <= 9 ? BlockType.SAND : BlockType.GRASS);
          else if (y >= h - 2) setBlock(x, y, z, BlockType.DIRT);
          else setBlock(x, y, z, BlockType.STONE);
        }

        // Scatter Trees
        if (x > 5 && x < SIZE_X - 5 && z > 5 && z < SIZE_Z - 5 && h > 10 && Math.random() < 0.015) {
          const treeH = 4 + Math.floor(Math.random() * 2);
          for (let ty = 1; ty <= treeH; ty++) setBlock(x, h + ty, z, BlockType.WOOD);
          for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
              for (let ly = treeH - 1; ly <= treeH + 1; ly++) {
                if (Math.abs(lx) + Math.abs(lz) <= 3 && getBlock(x + lx, h + ly, z + lz) === BlockType.AIR) {
                  setBlock(x + lx, h + ly, z + lz, BlockType.LEAVES);
                }
              }
            }
          }
        }
      }
    }

    // Mesh Generator & Torch Light Tracker
    let worldMeshGroup = new THREE.Group();
    let torchLightsGroup = new THREE.Group();
    scene.add(worldMeshGroup);
    scene.add(torchLightsGroup);

    function rebuildWorld() {
      scene.remove(worldMeshGroup);
      scene.remove(torchLightsGroup);
      worldMeshGroup = new THREE.Group();
      torchLightsGroup = new THREE.Group();

      const matCache = {};
      function getMat(colorStr, trans) {
        if (!matCache[colorStr]) {
          matCache[colorStr] = new THREE.MeshStandardMaterial({
            color: new THREE.Color(colorStr),
            roughness: 0.8,
            transparent: trans,
            opacity: trans ? 0.6 : 1.0
          });
        }
        return matCache[colorStr];
      }

      for (let x = 0; x < SIZE_X; x++) {
        for (let y = 0; y < SIZE_Y; y++) {
          for (let z = 0; z < SIZE_Z; z++) {
            const b = getBlock(x, y, z);
            if (b === BlockType.AIR) continue;

            const cfg = BLOCK_CONFIGS[b] || { color: '#888888', transparent: false };
            const geom = new THREE.BoxGeometry(1, 1, 1);
            const mesh = new THREE.Mesh(geom, getMat(cfg.color, cfg.transparent));
            mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
            worldMeshGroup.add(mesh);

            if (b === BlockType.TORCH) {
              const tLight = new THREE.PointLight(0xffb703, 1.8, 12);
              tLight.position.set(x + 0.5, y + 0.8, z + 0.5);
              torchLightsGroup.add(tLight);
            }
          }
        }
      }
      scene.add(worldMeshGroup);
      scene.add(torchLightsGroup);
    }
    rebuildWorld();

    // Mobs Setup
    const mobs = [];
    function spawnMobs() {
      // Cow
      const cowGroup = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.6), new THREE.MeshStandardMaterial({ color: 0x5c3d2e }));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x3d291e }));
      head.position.set(0, 0.3, 0.9);
      cowGroup.add(body, head);
      cowGroup.position.set(40, 16, 40);
      scene.add(cowGroup);
      mobs.push({ mesh: cowGroup, isHostile: false, vel: new THREE.Vector3() });

      // Zombie
      const zombieGroup = new THREE.Group();
      const zBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x228b22 }));
      zBody.position.y = 0.7;
      zombieGroup.add(zBody);
      zombieGroup.position.set(48, 16, 48);
      scene.add(zombieGroup);
      mobs.push({ mesh: zombieGroup, isHostile: true, vel: new THREE.Vector3() });
    }
    spawnMobs();

    // Player Physics & Controls
    const player = { pos: new THREE.Vector3(40, 20, 40), vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: false, flying: false };
    const keys = {};

    window.onkeydown = (e) => {
      keys[e.code] = true;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) selectSlot(num - 1);
      if (e.code === 'KeyF') player.flying = !player.flying;
      if (e.code === 'Escape') {
        document.getElementById('overlay').style.display = 'flex';
      }
    };
    window.onkeyup = (e) => { keys[e.code] = false; };

    canvas.onmousemove = (e) => {
      if (document.pointerLockElement !== canvas) return;
      player.yaw -= e.movementX * 0.0022;
      player.pitch -= e.movementY * 0.0022;
      player.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, player.pitch));
    };

    const raycaster = new THREE.Raycaster();
    canvas.onmousedown = (e) => {
      if (document.pointerLockElement !== canvas) return;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersects = raycaster.intersectObjects(worldMeshGroup.children);

      if (intersects.length > 0 && intersects[0].distance < 7) {
        const hit = intersects[0];
        const normal = hit.face.normal;
        const p = hit.point.clone().addScaledVector(normal, -0.01);
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);

        if (e.button === 0) {
          // Break Block
          setBlock(bx, by, bz, BlockType.AIR);
          rebuildWorld();
        } else if (e.button === 2) {
          // Place Block or Interact
          const current = getBlock(bx, by, bz);
          if (current === BlockType.DOOR || current === BlockType.FENCE) {
            setBlock(bx, by, bz, BlockType.AIR);
            rebuildWorld();
            return;
          }
          if (current === BlockType.BED) {
            timeOfDay = 6.0;
            return;
          }

          const nx = bx + Math.round(normal.x);
          const ny = by + Math.round(normal.y);
          const nz = bz + Math.round(normal.z);

          setBlock(nx, ny, nz, hotbarBlocks[activeSlot]);
          rebuildWorld();
        }
      }
    };
    canvas.oncontextmenu = (e) => e.preventDefault();

    const overlay = document.getElementById('overlay');
    document.getElementById('start-btn').onclick = () => {
      canvas.requestPointerLock();
      overlay.style.display = 'none';
    };

    // Main Game Loop & Day/Night Cycle
    let timeOfDay = 12.0;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = performance.now();

    function animate() {
      requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.08);
      lastTime = now;

      frameCount++;
      if (now - fpsTimer > 1000) {
        document.getElementById('hud-fps').innerText = 'FPS: ' + frameCount;
        frameCount = 0;
        fpsTimer = now;
      }

      // Time progression
      timeOfDay = (timeOfDay + dt * 0.1) % 24;
      const hours = Math.floor(timeOfDay);
      const mins = Math.floor((timeOfDay - hours) * 60);
      document.getElementById('hud-clock').innerText = 'Time: ' + (hours < 10 ? '0' : '') + hours + ':' + (mins < 10 ? '0' : '') + mins;

      // Sun & Sky
      const sunAngle = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
      sunLight.position.set(Math.cos(sunAngle) * 200 + 40, Math.sin(sunAngle) * 200, 40);

      const isNight = timeOfDay < 5.5 || timeOfDay > 18.5;
      if (isNight) {
        scene.background.set('#070b19');
        scene.fog.color.set('#070b19');
        ambientLight.intensity = 0.2;
        starsMat.opacity = 0.85;
      } else {
        scene.background.set('#87ceeb');
        scene.fog.color.set('#87ceeb');
        ambientLight.intensity = 0.75;
        starsMat.opacity = 0;
      }

      // Movement
      const move = new THREE.Vector3();
      if (keys['KeyW']) move.z -= 1;
      if (keys['KeyS']) move.z += 1;
      if (keys['KeyA']) move.x -= 1;
      if (keys['KeyD']) move.x += 1;
      move.normalize();

      const moveRotated = new THREE.Vector3(
        move.x * Math.cos(player.yaw) - move.z * Math.sin(player.yaw),
        0,
        move.x * Math.sin(player.yaw) + move.z * Math.cos(player.yaw)
      );

      player.vel.x = moveRotated.x * 6;
      player.vel.z = moveRotated.z * 6;

      if (!player.flying) {
        player.vel.y -= 22 * dt;
        if (keys['Space'] && player.grounded) { player.vel.y = 8; player.grounded = false; }
      } else {
        player.vel.y = 0;
        if (keys['Space']) player.vel.y = 6;
        if (keys['ShiftLeft']) player.vel.y = -6;
      }

      player.pos.addScaledVector(player.vel, dt);
      const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y - 1.6), pz = Math.floor(player.pos.z);
      if (getBlock(px, py, pz) !== BlockType.AIR) {
        player.pos.y = py + 2.6;
        player.vel.y = 0;
        player.grounded = true;
      }

      camera.position.copy(player.pos);
      camera.rotation.set(0, 0, 0);
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;

      document.getElementById('hud-pos').innerText = 'XYZ: ' + Math.floor(player.pos.x) + ', ' + Math.floor(player.pos.y) + ', ' + Math.floor(player.pos.z);

      // Mob AI
      mobs.forEach((m) => {
        if (m.isHostile) {
          const dist = m.mesh.position.distanceTo(player.pos);
          if (dist < 14) {
            const dir = player.pos.clone().sub(m.mesh.position).setY(0).normalize();
            m.mesh.position.addScaledVector(dir, dt * 2.2);
            m.mesh.lookAt(player.pos.x, m.mesh.position.y, player.pos.z);

            if (dist < 1.4 && Math.random() < 0.05) {
              playerHealth = Math.max(0, playerHealth - 1);
              updateHeartsUI();
            }
          }
        }
      });

      renderer.render(scene, camera);
    }
    animate();

    window.onresize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
  </script>
</body>
</html>`;
}
