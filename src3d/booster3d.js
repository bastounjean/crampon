// Booster en vraie 3D (modèle Blender .glb) : on le fait tourner au doigt, la lumière se reflète sur le
// plastique, et la languette du haut s'arrache avec un trait de lumière qui suit la déchirure.
// Fichier source : le site charge la version assemblée public/booster3d.js (seulement sur la page des boosters).
// Pour la reconstruire : npm i --no-save three@0.170.0 esbuild@0.24.0
//   npx esbuild src3d/booster3d.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=public/booster3d.js
// Le modèle public/visuels/booster.glb vient de Blender (boosterclassique.glb), allégé avec gltf-transform (meshopt).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// un modèle par booster (la Légende reprend le classique, en irisé, en attendant le sien)
// Le booster Or contient l'animation d'ouverture faite dans Blender (booster3d/arrachage.py) :
// la languette est attachée à un squelette, et le doigt fait avancer l'animation.
const MODELS = { base: '/visuels/booster.glb?v=1', gold: '/visuels/booster-or-ouverture.glb?v=1' };
// pas de trait de lumière pendant la déchirure : Baptiste veut voir seulement son animation
const TEAR_LIGHT = false;
const TEAR_END = 48 / 60; // part de l'animation où la déchirure atteint l'autre bout (FIN_DECHIRE / FIN dans arrachage.py)
const CUT = 0.885; // hauteur (0 = bas, 1 = haut) de la ligne de déchirure, juste sous la soudure du haut
const loaded = {};
const loadModel = (kind) => {
  const url = MODELS[kind] || MODELS.base;
  return (loaded[url] ||= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url));
};

// texture ronde et douce pour les halos de lumière
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Studio sombre copié de la scène Blender (booster3d/booster.py) : fond presque noir et
// les 4 lampes de Blender en panneaux lumineux. Le sachet est très métallique : sa couleur
// vient surtout de ce qu'il reflète, d'où le studio sombre (une pièce blanche le délave).
// Repère : Blender (x, y, z) → three.js (x, z − 0.7, −y), la caméra Blender regarde vers +Y.
const STUDIO = [
  // [largeur, hauteur, couleur, force, position]
  [1.2, 1.2, 0xffeed9, 22, [-1.6, 1.3, 2.2]], // Key : principale, chaude, avant gauche
  [2.0, 2.0, 0xcce0ff, 3, [2.0, 0.1, 1.8]], //   Fill : débouchage froid, avant droite
  [0.4, 0.4, 0xffffff, 60, [1.2, 1.5, -1.0]], // Rim : contre-jour, derrière
  [0.08, 2.0, 0xffffff, 40, [0.9, 0.9, 1.5]], // Strip : bande fine, la ligne de reflet sur les plis
];
function blenderStudio() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0.012, 0.012, 0.018);
  for (const [w, h, color, k, pos] of STUDIO) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  }
  return s;
}

export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

// Monte le booster dans `host` (un élément positionné). Renvoie un contrôleur.
export async function mount(host, { kind = 'base', interactive = true } = {}) {
  const gltf = await loadModel(kind);
  const W = () => host.clientWidth, H = () => host.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; // le même rendu des couleurs que Blender
  renderer.toneMappingExposure = 1;
  renderer.domElement.className = 'b3d-canvas';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const legend = kind === 'legend'; // la Légende irisée garde la pièce claire, qui fait briller ses reflets
  const envScene = legend ? new RoomEnvironment() : blenderStudio();
  const envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = legend ? 0.9 : 1;

  const camera = new THREE.PerspectiveCamera(30, W() / H(), 0.1, 50);
  camera.position.set(0, 0, 3.4);

  // lumières : une principale qui suit le pointeur, plus le débouchage et le contre-jour de Blender
  // (la Légende garde ses contre-jours colorés)
  const key = new THREE.DirectionalLight(legend ? 0xffffff : 0xffeed9, legend ? 2.2 : 1.6);
  key.position.set(1, 1.5, 3);
  scene.add(key);
  const rimA = new THREE.DirectionalLight(legend ? 0xff5ea8 : 0xcce0ff, legend ? 1.6 : 0.5);
  rimA.position.set(legend ? -3 : 2, legend ? 1 : 0.1, legend ? -1 : 1.8);
  const rimB = new THREE.DirectionalLight(legend ? 0x5ecbff : 0xffffff, legend ? 1.4 : 1.2);
  rimB.position.set(legend ? 3 : 1.2, legend ? -1 : 1.5, -1);
  scene.add(rimA, rimB, new THREE.AmbientLight(0xffffff, legend ? 0.25 : 0.05));

  // le modèle, posé droit et centré
  const src = cloneSkinned(gltf.scene); // copie qui garde le squelette de la languette
  const clip = gltf.animations && gltf.animations[0];
  let skinned = null;
  src.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
  const anim = clip && skinned ? { clip } : null;
  const root = new THREE.Group(); // tourne avec le doigt
  const model = new THREE.Group(); // recentre le modèle
  root.add(model);
  model.add(src);
  scene.add(root);
  src.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const s = 1.5 / size.y;
  model.scale.setScalar(s);
  model.position.set(-ctr.x * s, -ctr.y * s, -ctr.z * s);

  // matériaux selon le booster
  src.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = o.geometry.clone(); // chaque booster a sa propre copie (on la découpe plus bas)
    const m = o.material.clone();
    if (!(m instanceof THREE.MeshPhysicalMaterial)) Object.setPrototypeOf(m, THREE.MeshPhysicalMaterial.prototype);
    m.envMapIntensity = 1;
    // Alu métallisé comme dans Blender (Métallique 0.9). L'export .glb a perdu ce réglage
    // (sa texture de métal est à 0 partout), on le remet ici.
    if (!legend) { m.metalnessMap = null; m.metalness = 0.88; }
    if (kind === 'legend') { m.iridescence = 1; m.iridescenceIOR = 1.35; m.iridescenceThicknessRange = [180, 620]; m.metalness = 0.35; m.color = new THREE.Color(0.92, 0.94, 1); }
    o.material = m;
  });

  // la languette : soit animée dans Blender (squelette), soit découpée ici dans le modèle
  let yCut = box.min.y + size.y * CUT; // en coordonnées du monde (avant recentrage)
  let arm = null;
  if (anim) {
    skinned.frustumCulled = false;
    yCut = new THREE.Box3().setFromObject(skinned).min.y;
    arm = skinned.skeleton.bones[0];
    while (arm.parent && arm.parent !== src && arm.parent.parent) arm = arm.parent; // le nœud du squelette
    anim.mixer = new THREE.AnimationMixer(src);
    anim.action = anim.mixer.clipAction(clip);
    anim.action.setLoop(THREE.LoopOnce, 1);
    anim.action.clampWhenFinished = true;
    anim.action.play();
    anim.dur = clip.duration;
    anim.mixer.setTime(0);
  }
  const tab = new THREE.Group(); // pivot de la languette
  const tabInner = new THREE.Group();
  tab.add(tabInner);
  model.add(tab);
  const meshes = [];
  if (!anim) src.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const v = new THREE.Vector3();
  for (const o of meshes) {
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const keep = [], top = [];
    const wy = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) wy[i] = v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      ((wy[a] + wy[b] + wy[c]) / 3 > yCut ? top : keep).push(a, b, c);
    }
    const gTop = g.clone(); gTop.setIndex(top);
    g.setIndex(keep);
    const mTop = new THREE.Mesh(gTop, o.material);
    mTop.matrixAutoUpdate = false;
    mTop.matrix.copy(o.matrixWorld); // la pièce garde la place du sachet
    tabInner.add(mTop);
  }
  const left = box.min.x, right = box.max.x, front = box.max.z;
  const setPivot = (dir) => { // on arrache vers la droite : la languette pivote sur le coin droit
    const px = dir > 0 ? right : left;
    tab.position.set(px, yCut, ctr.z);
    tabInner.position.set(-px, -yCut, -ctr.z);
  };
  setPivot(1);

  // lumière de la déchirure : un trait qui suit le doigt, un halo au bout, une lumière qui fuit du sachet
  const gtex = glowTexture();
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffc21a, map: gtex, transparent: true, depthWrite: false, toneMapped: false }));
  line.visible = false;
  model.add(line);
  const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: 0xffe680, transparent: true, depthWrite: false, toneMapped: false }));
  tip.visible = false;
  model.add(tip);
  const tipLight = new THREE.PointLight(0xfff1b8, 0, 1.5 / s, 2);
  model.add(tipLight);
  const leak = new THREE.PointLight(0xffe9a8, 0, 3 / s, 2);
  leak.position.set(ctr.x, yCut, ctr.z);
  model.add(leak);
  const burstGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  burstGlow.position.set(ctr.x, yCut, front);
  burstGlow.scale.set(size.x * 2.2, size.y * 0.6, 1);
  model.add(burstGlow);

  // état et rendu
  const st = { yaw: 0, pitch: 0, vyaw: 0, tyaw: 0, tpitch: 0, k: 0, dir: 1, mx: 0, my: 0, idle: 0, dead: false, flying: null, glow: new THREE.Color(0xffe9a8) };
  let last = performance.now();
  function frame(now) {
    if (st.dead) return;
    if (!host.isConnected) { ctrl.dispose(); return; } // la page a changé : on libère la carte graphique
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    st.idle += dt;
    if (!drag) {
      st.tyaw += st.vyaw * dt; st.vyaw *= Math.pow(0.04, dt); // élan, puis ralentit
      st.tyaw *= Math.pow(0.25, dt); // revient doucement de face
      st.tpitch *= Math.pow(0.1, dt);
    }
    const sway = st.k > 0 || drag ? 0 : Math.sin(st.idle * 0.9) * 0.12;
    st.yaw += (st.tyaw + sway - st.yaw) * Math.min(1, dt * 10);
    st.pitch += (st.tpitch + Math.sin(st.idle * 0.7) * 0.04 - st.pitch) * Math.min(1, dt * 10);
    root.rotation.set(st.pitch, st.yaw, 0);
    key.position.set(st.mx * 3, 1.5 - st.my * 2, 3);
    if (st.flying) st.flying(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);
  const onResize = () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(onResize);
  ro.observe(host);

  // la languette suit la progression k (0 → 1) de la déchirure
  function setTear(k, dir = 1) {
    if (anim) dir = 1; // l'animation de Blender part toujours du coin gauche
    if (dir !== st.dir) { st.dir = dir; setPivot(dir); }
    st.k = k;
    if (anim) anim.mixer.setTime(k * anim.dur * TEAR_END);
    else {
      tab.rotation.set(-k * 0.5, 0, dir * k * 0.55);
      tab.position.z = ctr.z + k * 0.05 * size.y;
    }
    const x0 = dir > 0 ? left : right, x1 = x0 + dir * (right - left) * k;
    line.visible = tip.visible = TEAR_LIGHT && k > 0.01;
    line.position.set((x0 + x1) / 2, yCut, front + 0.002);
    line.scale.set(Math.max(1e-4, Math.abs(x1 - x0)), size.y * 0.035, 1);
    tip.position.set(x1, yCut, front + 0.01);
    tip.scale.setScalar(size.x * (0.35 + 0.25 * Math.sin(performance.now() / 60)));
    tipLight.position.set(x1, yCut, front + 0.05 * size.y);
    tipLight.intensity = TEAR_LIGHT && k > 0.01 ? 2.5 : 0;
    leak.intensity = TEAR_LIGHT ? k * 3 : 0;
    return toScreen(x1, yCut, front);
  }
  const p = new THREE.Vector3();
  function toScreen(x, y, z) {
    p.set(x, y, z);
    model.localToWorld(p).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height];
  }
  // la ligne de déchirure à l'écran, pour savoir si le doigt attrape la languette
  function onTop(cx, cy) {
    const [, ty] = toScreen(ctr.x, box.max.y, front), [, cyy] = toScreen(ctr.x, yCut, front), [, by] = toScreen(ctr.x, box.min.y, front);
    return cy < cyy + (by - cyy) * 0.12 && cy > ty - 30;
  }
  function reset() {
    const k0 = st.k, d = st.dir, t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 380), e = 1 - Math.pow(1 - t, 3);
      setTear(k0 * (1 - e), d);
      if (t < 1 && !st.dead) requestAnimationFrame(step); else { line.visible = tip.visible = false; tipLight.intensity = leak.intensity = 0; }
    };
    requestAnimationFrame(step);
  }
  // ouverture : la languette s'envole, la lumière jaillit à la couleur de la meilleure carte
  function fly(dir = st.dir) {
    setTear(1, dir);
    if (anim) { // fin de l'animation de Blender (la languette part vers nous), puis elle s'envole
      let t = 0;
      const a0 = anim.dur * TEAR_END;
      return new Promise((done) => {
        st.flying = (dt) => {
          t += dt;
          anim.mixer.setTime(a0 + (anim.dur - a0) * Math.min(1, t / 0.35));
          if (t > 0.3) {
            arm.position.x += 0.9 * size.x * dt;
            arm.position.y += 1.4 * size.y * dt;
            arm.position.z += 1.2 * size.y * dt;
          }
          line.material.opacity = tip.material.opacity = Math.max(0, 1 - t * 2);
          if (t > 0.8) { skinned.visible = false; st.flying = null; done(); }
        };
      });
    }
    let t = 0, vx = dir * 1.6 * size.x, vy = 1.8 * size.y;
    return new Promise((done) => {
      st.flying = (dt) => {
        t += dt;
        vy -= 2.5 * size.y * dt;
        tab.position.x += vx * dt; tab.position.y += vy * dt; tab.position.z += 0.6 * size.y * dt;
        tab.rotation.z += dir * 4 * dt; tab.rotation.x -= 3 * dt;
        line.material.opacity = tip.material.opacity = Math.max(0, 1 - t * 2);
        if (t > 0.7) { tab.visible = false; st.flying = null; done(); }
      };
    });
  }
  function charge(color, strength = 1) {
    st.glow.set(color);
    leak.color.copy(st.glow); burstGlow.material.color.copy(st.glow);
    const t0 = performance.now();
    return new Promise((done) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 700);
        leak.intensity = 3 + t * 30 * strength;
        burstGlow.material.opacity = t * 0.95;
        burstGlow.scale.set(size.x * (2.2 + t * 2 * strength), size.y * (0.6 + t * 1.2 * strength), 1);
        if (t < 1 && !st.dead) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }

  // le doigt : glisser sur la languette déchire, ailleurs fait tourner le booster
  let drag = null;
  const el = renderer.domElement;
  const api = { onTearStart: null, onTear: null, onTearEnd: null };
  function down(e) {
    if (!interactive || st.flying) return;
    drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, mode: api.canTear && api.canTear() && onTop(e.clientX, e.clientY) ? 'tear' : 'spin', yaw0: st.tyaw, pitch0: st.tpitch, t: performance.now() };
    if (drag.mode === 'tear') { st.tyaw = st.tpitch = 0; api.onTearStart && api.onTearStart(); }
    el.setPointerCapture(e.pointerId);
  }
  function move(e) {
    const r = el.getBoundingClientRect();
    st.mx = (e.clientX - r.left) / r.width - 0.5;
    st.my = (e.clientY - r.top) / r.height - 0.5;
    st.idle = 0;
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (drag.mode === 'spin') {
      const now = performance.now();
      st.vyaw = ((e.clientX - drag.x) / Math.max(1, now - drag.t)) * 10;
      drag.x = e.clientX; drag.t = now;
      st.tyaw = drag.yaw0 + dx * 0.012;
      st.tpitch = Math.max(-0.5, Math.min(0.5, drag.pitch0 + (e.clientY - drag.y0) * 0.006));
    } else api.onTear && api.onTear(dx, e);
  }
  function up() {
    if (!drag) return;
    const m = drag.mode;
    drag = null;
    if (m === 'tear') api.onTearEnd && api.onTearEnd();
  }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', () => { st.mx = st.my = 0; });

  const ctrl = Object.assign(api, {
    canvas: el, setTear, reset, fly, charge, toScreen, width: () => el.getBoundingClientRect().width,
    tipScreen: () => toScreen(tip.position.x, tip.position.y, tip.position.z),
    tearCenter: () => toScreen(ctr.x, yCut, front),
    dispose() {
      if (st.dead) return;
      st.dead = true; cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((o) => { if (o.isMesh || o.isSprite) { if (o.geometry && o.geometry !== undefined && o.parent === tabInner) o.geometry.dispose(); } });
      envRT.dispose(); pmrem.dispose(); gtex.dispose(); renderer.dispose(); el.remove();
    },
  });
  return ctrl;
}
