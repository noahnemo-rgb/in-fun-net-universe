import * as THREE from "three";
import { places, RIO } from "./places";

export type WorldFocus =
  | { readonly kind: "peer"; readonly name: string; readonly x: number; readonly y: number; readonly feetY: number }
  | { readonly kind: "sign"; readonly line: string; readonly x: number; readonly y: number }
  | null;

export type WorldFrame = {
  readonly phase: "gateway" | "crossing" | "ground";
  readonly focus: WorldFocus;
};

type Bulb = { mesh: THREE.Mesh; phase: number; base: number };

const CORE_FROM_TOP = 561 / 1248;
const MARK_ASPECT = 832 / 1248;
const PORTAL_Z = 22;
const BOUNDS = 24;

export function mountWorld(
  canvas: HTMLCanvasElement,
  options: {
    readonly skipGateway: boolean;
    readonly onFrame: (frame: WorldFrame) => void;
    readonly onFlash: (opacity: number) => void;
    readonly onReady: () => void;
  },
): { enter: () => void; dispose: () => void } {
  let disposed = false;
  let cleanup = () => {};
  let enterImpl = () => {};

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.08, 400);
  camera.rotation.order = "YXZ";

  const fair = new THREE.Group();
  const sky = new THREE.Group();
  scene.add(fair, sky);

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();

  const loader = new THREE.TextureLoader();
  loader.load("/mark.jpg", (texture) => {
    if (disposed) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    void document.fonts.ready.then(() => {
      if (disposed) return;
      cleanup = start(texture);
      options.onReady();
    });
  });

  function start(texture: THREE.Texture) {
    const family =
      getComputedStyle(document.documentElement).getPropertyValue("--font-outfit").trim() || "sans-serif";

    const fitDistance = 9.2;
    const portalHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * fitDistance * 0.96;
    const portalWidth = portalHeight * MARK_ASPECT;
    const coreLocalY = (0.5 - CORE_FROM_TOP) * portalHeight;
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(portalWidth, portalHeight),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    portal.position.set(0, 1.65 - coreLocalY, PORTAL_Z);
    scene.add(portal);

    const skyDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(portalWidth * 4.4, portalHeight * 4.4),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
    );
    skyDisc.position.set(0, 36, -4);
    skyDisc.rotation.x = Math.PI / 2;
    sky.add(skyDisc);

    const sparks = makeSparks();
    sky.add(sparks);

    buildFair(fair, family);
    const bulbs = fair.userData.bulbs as Bulb[];
    const wheel = fair.userData.wheel as THREE.Group;
    const cabins = fair.userData.cabins as THREE.Object3D[];
    const carousel = fair.userData.carousel as THREE.Group;
    const rio = fair.userData.rio as THREE.Group;
    const ground = fair.userData.ground as THREE.Mesh;
    const signs = fair.userData.signs as { line: string; position: THREE.Vector3; board: THREE.Object3D }[];
    const marker = fair.userData.marker as THREE.Mesh;

    const clock = new THREE.Clock();
    let phase: WorldFrame["phase"] = options.skipGateway ? "ground" : "gateway";
    let yaw = 0;
    let pitch = options.skipGateway ? -0.28 : 0;
    const keys = new Set<string>();
    const walkTarget = new THREE.Vector3();
    let walking = false;
    let crossing = 0;
    const pointer = { down: false, moved: false, x: 0, y: 0 };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

  const gatewayPos = new THREE.Vector3(0, 1.65, PORTAL_Z + fitDistance);
  const groundPos = new THREE.Vector3(0, 1.65, 6.4);
  camera.position.copy(phase === "ground" ? groundPos : gatewayPos);

    const showPlace = (visible: boolean) => {
      fair.visible = visible;
      sky.visible = visible;
    };
    showPlace(phase === "ground");

    const project = (point: THREE.Vector3) => {
      const vector = point.clone().project(camera);
      if (vector.z > 1) return null;
      return {
        x: (vector.x * 0.5 + 0.5) * canvas.clientWidth,
        y: (-vector.y * 0.5 + 0.5) * canvas.clientHeight,
      };
    };

    const focusOf = (): WorldFocus => {
      if (phase !== "ground") return null;
      const peerPoint = rio.position.clone();
      peerPoint.y = 2.15;
      const peerDistance = horizontalDistance(camera.position, rio.position);
      if (peerDistance < 3.4) {
        const screen = project(peerPoint);
        const feet = project(new THREE.Vector3(rio.position.x, 0.15, rio.position.z));
        if (!screen || !feet) return null;
        return { kind: "peer", name: RIO.name, x: screen.x, y: screen.y, feetY: feet.y };
      }
      let closest: (typeof signs)[number] | null = null;
      let closestDistance = 3.6;
      for (const sign of signs) {
        const distance = horizontalDistance(camera.position, sign.position);
        if (distance < closestDistance) {
          closest = sign;
          closestDistance = distance;
        }
      }
      if (!closest) return null;
      const screen = project(closest.position.clone().setY(2.15));
      if (!screen) return null;
      return { kind: "sign", line: closest.line, x: screen.x, y: screen.y };
    };

    const enter = () => {
      if (phase !== "gateway") return;
      phase = "crossing";
      crossing = 0;
    };

    const onKey = (event: KeyboardEvent, down: boolean) => {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
      if (down) keys.add(key);
      else keys.delete(key);
      if (down && phase === "gateway" && (key === "enter" || key === " ")) enter();
    };
    const onKeyDown = (event: KeyboardEvent) => onKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => onKey(event, false);

    const onPointerDown = (event: PointerEvent) => {
      pointer.down = true;
      pointer.moved = false;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.down || phase === "crossing") return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (Math.hypot(dx, dy) > 3) pointer.moved = true;
      if (!pointer.moved || phase !== "ground") return;
      yaw -= dx * 0.005;
      pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -0.95, 0.65);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      walking = false;
    };
    const onPointerUp = (event: PointerEvent) => {
      const wasDrag = pointer.moved;
      pointer.down = false;
      if (wasDrag) return;
      if (phase === "gateway") {
        enter();
        return;
      }
      if (phase !== "ground") return;
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(ground, false);
      const hit = hits[0];
      if (!hit) return;
      walkTarget.copy(hit.point);
      walkTarget.y = 0;
      walking = true;
      marker.visible = true;
      marker.position.set(walkTarget.x, 0.04, walkTarget.z);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    let frameId = 0;
    const tick = () => {
      frameId = window.requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;

      if (phase === "crossing") {
        crossing += dt / 2.5;
        const t = THREE.MathUtils.clamp(crossing, 0, 1);
        const eased = t * t * (3 - 2 * t);
        camera.position.lerpVectors(gatewayPos, groundPos, eased);
        pitch = THREE.MathUtils.lerp(0, -0.28, eased);
        yaw = 0;
        options.onFlash(Math.sin(Math.min(t, 1) * Math.PI) * 0.92);
        showPlace(t > 0.42);
        if (t >= 1) {
          phase = "ground";
          options.onFlash(0);
          camera.position.copy(groundPos);
        }
      } else if (phase === "ground") {
        let forward = 0;
        let strafe = 0;
        if (keys.has("w") || keys.has("arrowup")) forward += 1;
        if (keys.has("s") || keys.has("arrowdown")) forward -= 1;
        if (keys.has("d") || keys.has("arrowright")) strafe += 1;
        if (keys.has("a") || keys.has("arrowleft")) strafe -= 1;
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;
        if (forward !== 0 || strafe !== 0) {
          walking = false;
          marker.visible = false;
          const direction = new THREE.Vector3();
          camera.getWorldDirection(direction);
          direction.y = 0;
          direction.normalize();
          const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
          camera.position.addScaledVector(direction, forward * 4.4 * dt);
          camera.position.addScaledVector(right, strafe * 4.4 * dt);
        } else if (walking) {
          const offset = walkTarget.clone().sub(camera.position);
          offset.y = 0;
          const distance = offset.length();
          if (distance < 0.2) {
            walking = false;
            marker.visible = false;
          } else {
            offset.normalize();
            camera.position.addScaledVector(offset, Math.min(4.4 * dt, distance));
            const heading = Math.atan2(-offset.x, -offset.z);
            yaw = dampAngle(yaw, heading, dt);
          }
        }
        const flat = Math.hypot(camera.position.x, camera.position.z);
        if (flat > BOUNDS) {
          camera.position.x *= BOUNDS / flat;
          camera.position.z *= BOUNDS / flat;
        }
        camera.position.y = 1.65;
      } else {
        camera.position.copy(gatewayPos);
        yaw = 0;
        pitch = 0;
      }

      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      wheel.rotation.z = time * 0.28;
      for (const cabin of cabins) cabin.rotation.z = -wheel.rotation.z;
      carousel.rotation.y = time * 0.35;
      rio.position.y = Math.sin(time * 1.5) * 0.025;
      rio.lookAt(camera.position.x, rio.position.y, camera.position.z);
      for (const sign of signs) {
        sign.board.lookAt(camera.position.x, sign.board.position.y, camera.position.z);
      }
      for (const bulb of bulbs) {
        const pulse = 0.55 + Math.sin(time * 3 + bulb.phase) * 0.45;
        const material = bulb.mesh.material as THREE.MeshBasicMaterial;
        material.color.setHSL(bulb.base, 0.85, 0.35 + pulse * 0.35);
      }
      sparks.rotation.y = time * 0.03;
      if (marker.visible) marker.rotation.z = time * 1.5;

      renderer.render(scene, camera);
      options.onFrame({ phase, focus: focusOf() });
    };
    enterImpl = enter;
    tick();

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      renderer.dispose();
      texture.dispose();
    };
  }

  const api = {
    enter: () => enterImpl(),
    dispose: () => {
      disposed = true;
      cleanup();
    },
  };

  return api;
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function dampAngle(current: number, target: number, dt: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, dt * 4);
}

function makeSparks() {
  const count = 240;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const t = index / count;
    const angle = t * Math.PI * 12;
    const radius = 6 + t * 48;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 4 + Math.sin(t * 20) * 3 + t * 18;
    positions[index * 3 + 2] = Math.sin(angle) * radius * 0.72;
    const color = new THREE.Color().setHSL(t, 0.8, 0.62);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
  );
}

function buildFair(fair: THREE.Group, family: string) {
  const bulbs: Bulb[] = [];
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(28, 72),
    new THREE.MeshStandardMaterial({
      map: groundTexture(),
      color: 0xffffff,
      emissive: 0x2a2418,
      emissiveIntensity: 0.55,
      roughness: 0.92,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  fair.add(ground);

  fair.add(new THREE.AmbientLight(0xffffff, 0.28));
  fair.add(new THREE.HemisphereLight(0x222244, 0x000000, 0.45));

  const wheelRig = new THREE.Group();
  wheelRig.position.set(-8.2, 0, -6.5);
  const wheel = new THREE.Group();
  wheel.position.y = 6.4;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.4, 0.07, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0x88724a, emissiveIntensity: 0.35, metalness: 0.45, roughness: 0.4 }),
  );
  wheel.add(ring);
  const cabins: THREE.Object3D[] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.045, 0.045),
      new THREE.MeshStandardMaterial({ color: 0xcbb992, metalness: 0.4, roughness: 0.45 }),
    );
    spoke.geometry.translate(2.7, 0, 0);
    spoke.rotation.z = angle;
    wheel.add(spoke);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.48, 0.55),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(index / 10, 0.65, 0.45),
        emissive: new THREE.Color().setHSL(index / 10, 0.7, 0.2),
        roughness: 0.5,
      }),
    );
    cabin.position.set(Math.cos(angle) * 5.4, Math.sin(angle) * 5.4, 0);
    wheel.add(cabin);
    cabins.push(cabin);
    addBulb(wheel, Math.cos(angle) * 5.4, Math.sin(angle) * 5.4, 0.4, index / 10, bulbs);
  }
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2418, metalness: 0.3, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.4, 0.12), legMaterial);
    leg.position.set(side * 1.4, 3.2, 0);
    wheelRig.add(leg);
  }
  wheelRig.add(wheel);
  fair.add(wheelRig);
  fair.add(point(0xff6688, 8, 14, new THREE.Vector3(-8.2, 6.4, -6.5)));

  const carousel = new THREE.Group();
  carousel.position.set(8.4, 0, -4.2);
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.2, 0.28, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a140e, emissive: 0x3a2a18, emissiveIntensity: 0.3, roughness: 0.7 }),
  );
  deck.position.y = 0.2;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.5, 1.3, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0xaa8855, emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.5 }),
  );
  roof.position.y = 3.15;
  const spinning = new THREE.Group();
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xfff5d6, metalness: 0.5, roughness: 0.35 }),
    );
    pole.position.set(Math.cos(angle) * 2.1, 1.5, Math.sin(angle) * 2.1);
    const horse = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.28, 0.22),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(index / 6, 0.7, 0.5),
        emissive: new THREE.Color().setHSL(index / 6, 0.8, 0.18),
      }),
    );
    horse.position.set(Math.cos(angle) * 2.1, 0.85, Math.sin(angle) * 2.1);
    horse.lookAt(0, 0.85, 0);
    spinning.add(pole, horse);
    addBulb(spinning, Math.cos(angle) * 2.6, 2.7, Math.sin(angle) * 2.6, index / 6, bulbs);
  }
  carousel.add(deck, roof, spinning);
  fair.add(carousel);

  const rio = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.92, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0xfff5d6, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.15 }),
  );
  body.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  head.position.y = 1.82;
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  heart.position.y = 1.22;
  rio.add(body, head, heart);
  rio.position.set(0.6, 0, -0.4);
  fair.add(rio);
  fair.add(point(0xfff5d6, 6, 7, new THREE.Vector3(0.6, 1.5, -0.4)));

  for (const [x, z, hue] of [
    [-3.2, -12.5, 0.02],
    [0.2, -13.4, 0.55],
    [3.6, -12.2, 0.12],
  ] as const) {
    fair.add(stall(x, z, hue));
  }

  fair.add(cable(new THREE.Vector3(-10, 4.2, 6), new THREE.Vector3(0, 4.6, -2), bulbs));
  fair.add(cable(new THREE.Vector3(0, 4.6, -2), new THREE.Vector3(10, 4.2, 5), bulbs));
  fair.add(cable(new THREE.Vector3(-6, 3.6, -10), new THREE.Vector3(6, 3.6, -10), bulbs));
  fair.add(point(0xffaa66, 18, 22, new THREE.Vector3(0, 3.2, -1)));
  fair.add(cable(new THREE.Vector3(-2.4, 3.1, 10), new THREE.Vector3(0.4, 2.8, 0.2), bulbs));
  fair.add(cable(new THREE.Vector3(2.6, 3.1, 10), new THREE.Vector3(0.8, 2.8, 0.2), bulbs));

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.12, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x24180f, roughness: 0.75 }),
  );
  table.position.set(-1.2, 0.78, 4.2);
  fair.add(table);
  for (let index = 0; index < 4; index += 1) {
    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff5d6 }),
    );
    lantern.position.set(-2.4 + index * 1.1, 1.15, 4.2);
    fair.add(lantern);
    bulbs.push({ mesh: lantern, phase: index, base: 0.12 });
  }

  const signs = places
    .filter((place) => place.status === "next" && place.signAngle !== undefined)
    .map((place) => {
      const angle = place.signAngle ?? 0;
      const position = new THREE.Vector3(Math.cos(angle) * 11, 0, Math.sin(angle) * 11);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8),
        new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0x665433, emissiveIntensity: 0.2 }),
      );
      post.position.copy(position);
      post.position.y = 0.85;
      const board = label(place.name, "opens next", family, 3.4);
      board.position.copy(position);
      board.position.y = 1.85;
      fair.add(post, board);
      return { line: place.line, position, board };
    });

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.36, 28),
    new THREE.MeshBasicMaterial({ color: 0xfff5d6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  fair.add(marker);

  fair.userData.bulbs = bulbs;
  fair.userData.wheel = wheel;
  fair.userData.cabins = cabins;
  fair.userData.carousel = spinning;
  fair.userData.rio = rio;
  fair.userData.ground = ground;
  fair.userData.signs = signs;
  fair.userData.marker = marker;
}

function point(color: number, intensity: number, distance: number, position: THREE.Vector3) {
  const light = new THREE.PointLight(color, intensity, distance);
  light.position.copy(position);
  return light;
}

function addBulb(parent: THREE.Object3D, x: number, y: number, z: number, hue: number, bulbs: Bulb[]) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.8, 0.6) }));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  bulbs.push({ mesh, phase: hue * 12, base: hue });
}

function cable(from: THREE.Vector3, to: THREE.Vector3, bulbs: Bulb[]) {
  const group = new THREE.Group();
  const count = 14;
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const position = new THREE.Vector3().lerpVectors(from, to, t);
    position.y -= Math.sin(t * Math.PI) * 0.55;
    addBulb(group, position.x, position.y, position.z, t, bulbs);
  }
  return group;
}

function stall(x: number, z: number, hue: number) {
  const group = new THREE.Group();
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x140f0c, roughness: 0.86 }),
  );
  counter.position.y = 0.5;
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(2.45, 0.08, 1.35),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.75, 0.5) }),
  );
  awning.position.y = 1.65;
  group.add(counter, awning);
  group.position.set(x, 0, z);
  return group;
}

function label(title: string, subtitle: string, family: string, worldWidth: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldWidth * 0.3));
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.fillStyle = "#fff5d6";
  context.font = `300 78px ${family}`;
  context.fillText(title, 512, 130, 980);
  context.globalAlpha = 0.75;
  context.font = `200 42px ${family}`;
  context.fillText(subtitle, 512, 210, 980);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(worldWidth, worldWidth * (320 / 1024)),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.FrontSide }),
  );
  return mesh;
}

function groundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = "#07060b";
  context.fillRect(0, 0, 1024, 1024);
  context.strokeStyle = "rgba(255, 245, 214, 0.85)";
  context.lineWidth = 8;
  context.beginPath();
  context.arc(512, 512, 470, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(512, 512, 210, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 2;
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    context.beginPath();
    context.moveTo(512, 512);
    context.lineTo(512 + Math.cos(angle) * 470, 512 + Math.sin(angle) * 470);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
