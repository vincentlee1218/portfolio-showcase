import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/* =========================================================
   CONFIG — the stuff you'll actually want to tweak
   ========================================================= */
const NAME = "VINCENT LEE";    // <-- put whatever name/text you want spelled out
const FONT = "bold 200px Arial";
const PARTICLE_GAP = 4;        // sample every N px from the text bitmap (lower = denser + slower)
const PARTICLE_SIZE = 2.2;
const PARTICLE_COLOR = 0xffffff;

const MOUSE_RADIUS = 60;       // world-unit radius where the mouse pushes particles
const REPEL_STRENGTH = 26;     // how hard particles get pushed away
const RETURN_SPEED = 0.05;     // how eagerly particles pull back toward their target
const DAMPING = 0.9;           // velocity decay per frame (higher = floatier)

const EDGE_SPAWN_MARGIN = 60;  // how far past the visible edge particles start from
const INTRO_DURATION = 2.2;    // seconds each particle takes to fly from its edge start to home
const INTRO_STAGGER = 0.6;     // random extra delay (0 to this many seconds) before a particle starts flying in, for an organic arrival
const WANDER_SPEED_MIN = 0.4;  // idle-motion speed range (radians/sec-ish, randomized per particle)
const WANDER_SPEED_MAX = 1.1;
const WANDER_AMPLITUDE_MIN = 1.5; // idle-motion radius range, in world units — keep small so the shape stays readable
const WANDER_AMPLITUDE_MAX = 3.5;

/* ========================================================= */

const heroSection = document.getElementById("hero");
const canvas = document.getElementById("particle-canvas");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  heroSection.clientWidth / heroSection.clientHeight,
  0.1,
  1000
);
camera.position.z = 300;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(heroSection.clientWidth, heroSection.clientHeight);

/* -----------------------------------------------------------
   1. Draw the name to an offscreen canvas and sample the
      bright pixels into a set of target 3D points.
   ----------------------------------------------------------- */
function getTextPoints(text) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  c.width = 1024;
  c.height = 256;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = FONT;
  ctx.fillText(text, c.width / 2, c.height / 2);

  const imageData = ctx.getImageData(0, 0, c.width, c.height).data;
  const points = [];

  for (let y = 0; y < c.height; y += PARTICLE_GAP) {
    for (let x = 0; x < c.width; x += PARTICLE_GAP) {
      const idx = (y * c.width + x) * 4;
      const brightness = imageData[idx]; // red channel (text is white on black)
      if (brightness > 128) {
        points.push(
          new THREE.Vector3(
            (x - c.width / 2) * 0.6,
            -(y - c.height / 2) * 0.6,
            0
          )
        );
      }
    }
  }
  return points;
}

const targetPoints = getTextPoints(NAME);
const count = targetPoints.length;

console.log(`[particles] hero size: ${heroSection.clientWidth}x${heroSection.clientHeight}`);
console.log(`[particles] sampled ${count} points for "${NAME}"`);
if (heroSection.clientWidth === 0 || heroSection.clientHeight === 0) {
  console.warn("[particles] hero section has zero size — check that css/style.css is loading correctly.");
}
if (count === 0) {
  console.warn("[particles] no points sampled — check that the FONT is available and NAME isn't empty.");
}

const positions = new Float32Array(count * 3);
const spawnPositions = new Float32Array(count * 3); // untouched copy of the edge-start positions, used as the lerp origin during intro
const homePositions = new Float32Array(count * 3);
const velocities = new Float32Array(count * 3);

// per-particle idle-wander parameters, so the gathered shape keeps drifting
const wanderPhaseX = new Float32Array(count);
const wanderPhaseY = new Float32Array(count);
const wanderSpeed = new Float32Array(count);
const wanderAmp = new Float32Array(count);
const introDelay = new Float32Array(count); // random per-particle head start delay, for a staggered arrival

// where particles fly in from — a random point just past one of the
// four viewport edges, computed at the particle plane's distance (z=0)
function randomEdgeStartPosition() {
  const vFov = (camera.fov * Math.PI) / 180;
  const dist = camera.position.z;
  const halfHeight = Math.tan(vFov / 2) * dist;
  const halfWidth = halfHeight * camera.aspect;

  const edge = Math.floor(Math.random() * 4); // 0 top, 1 bottom, 2 left, 3 right
  const reach = 200; // how far beyond the edge they can start (adds variety/depth)
  let x, y;

  if (edge === 0) {
    x = (Math.random() * 2 - 1) * (halfWidth + reach);
    y = halfHeight + EDGE_SPAWN_MARGIN + Math.random() * reach;
  } else if (edge === 1) {
    x = (Math.random() * 2 - 1) * (halfWidth + reach);
    y = -halfHeight - EDGE_SPAWN_MARGIN - Math.random() * reach;
  } else if (edge === 2) {
    x = -halfWidth - EDGE_SPAWN_MARGIN - Math.random() * reach;
    y = (Math.random() * 2 - 1) * (halfHeight + reach);
  } else {
    x = halfWidth + EDGE_SPAWN_MARGIN + Math.random() * reach;
    y = (Math.random() * 2 - 1) * (halfHeight + reach);
  }

  return new THREE.Vector3(x, y, (Math.random() - 0.5) * 80);
}

for (let i = 0; i < count; i++) {
  const home = targetPoints[i];
  homePositions[i * 3] = home.x;
  homePositions[i * 3 + 1] = home.y;
  homePositions[i * 3 + 2] = home.z;

  const start = randomEdgeStartPosition();
  positions[i * 3] = start.x;
  positions[i * 3 + 1] = start.y;
  positions[i * 3 + 2] = start.z;
  spawnPositions[i * 3] = start.x;
  spawnPositions[i * 3 + 1] = start.y;
  spawnPositions[i * 3 + 2] = start.z;

  wanderPhaseX[i] = Math.random() * Math.PI * 2;
  wanderPhaseY[i] = Math.random() * Math.PI * 2;
  wanderSpeed[i] = WANDER_SPEED_MIN + Math.random() * (WANDER_SPEED_MAX - WANDER_SPEED_MIN);
  wanderAmp[i] = WANDER_AMPLITUDE_MIN + Math.random() * (WANDER_AMPLITUDE_MAX - WANDER_AMPLITUDE_MIN);
  introDelay[i] = Math.random() * INTRO_STAGGER;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

/* -----------------------------------------------------------
   2. Soft circular sprite so particles look like dots, not
      hard squares.
   ----------------------------------------------------------- */
function makeCircleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const material = new THREE.PointsMaterial({
  size: PARTICLE_SIZE,
  color: PARTICLE_COLOR,
  map: makeCircleTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);

/* -----------------------------------------------------------
   3. Mouse tracking — raycast onto a z=0 plane so we get a
      world-space position to repel particles from.
   ----------------------------------------------------------- */
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(9999, 9999);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const mouseWorld = new THREE.Vector3();
let mouseActive = false;
const clock = new THREE.Clock();

heroSection.addEventListener("mousemove", (e) => {
  const rect = heroSection.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  mouseActive = true;
});

heroSection.addEventListener("mouseleave", () => {
  mouseActive = false;
});

/* -----------------------------------------------------------
   4. Animation loop — push particles away from the mouse,
      always spring them back toward their home position.
   ----------------------------------------------------------- */
function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();

  if (mouseActive) {
    raycaster.setFromCamera(mouseNDC, camera);
    raycaster.ray.intersectPlane(groundPlane, mouseWorld);
  }

  const posAttr = geometry.attributes.position;
  const arr = posAttr.array;

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    const iy = i * 3 + 1;
    const iz = i * 3 + 2;

    // the shape keeps its form, but each particle idly drifts around
    // its home position so the whole thing feels alive, not static
    const driftX = Math.sin(t * wanderSpeed[i] + wanderPhaseX[i]) * wanderAmp[i];
    const driftY = Math.cos(t * wanderSpeed[i] + wanderPhaseY[i]) * wanderAmp[i];
    const targetX = homePositions[ix] + driftX;
    const targetY = homePositions[iy] + driftY;

    // 0 -> 1 over INTRO_DURATION seconds, starting after this particle's random stagger delay
    const introProgress = Math.min(Math.max((t - introDelay[i]) / INTRO_DURATION, 0), 1);

    if (introProgress < 1) {
      // explicit eased flight from the edge spawn point to home — guaranteed to be
      // slow enough to see, regardless of the spring constants used once it arrives
      const eased = 1 - Math.pow(1 - introProgress, 3); // ease-out cubic
      arr[ix] = spawnPositions[ix] + (targetX - spawnPositions[ix]) * eased;
      arr[iy] = spawnPositions[iy] + (targetY - spawnPositions[iy]) * eased;
      arr[iz] = spawnPositions[iz] + (homePositions[iz] - spawnPositions[iz]) * eased;
      velocities[ix] = 0;
      velocities[iy] = 0;
      velocities[iz] = 0;
      continue;
    }

    if (mouseActive) {
      const dx = arr[ix] - mouseWorld.x;
      const dy = arr[iy] - mouseWorld.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < MOUSE_RADIUS && dist > 0.001) {
        const force = (1 - dist / MOUSE_RADIUS) * REPEL_STRENGTH;
        velocities[ix] += (dx / dist) * force;
        velocities[iy] += (dy / dist) * force;
      }
    }

    // spring back toward the (drifting) target
    velocities[ix] += (targetX - arr[ix]) * RETURN_SPEED;
    velocities[iy] += (targetY - arr[iy]) * RETURN_SPEED;
    velocities[iz] += (homePositions[iz] - arr[iz]) * RETURN_SPEED;

    // damping
    velocities[ix] *= DAMPING;
    velocities[iy] *= DAMPING;
    velocities[iz] *= DAMPING;

    arr[ix] += velocities[ix];
    arr[iy] += velocities[iy];
    arr[iz] += velocities[iz];
  }

  posAttr.needsUpdate = true;
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = heroSection.clientWidth / heroSection.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(heroSection.clientWidth, heroSection.clientHeight);
});
