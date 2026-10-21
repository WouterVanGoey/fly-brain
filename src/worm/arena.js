// 3D Agar Petri Dish Arena and Microenvironment for C. elegans Simulation

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class WormArena {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.radius = 2.2; // Petri dish radius (mm scale normalized)

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060913);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 50);
    this.camera.position.set(0, -2.6, 2.2);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);

    this.followMode = false;
    this.foodPos = new THREE.Vector2(0.9, 0.7);
    this.threatAnim = null;

    this.setupLighting();
    this.buildPetriDish();
    this.buildFoodPatch();
    this.buildThreatIndicator();
    this.setupInteraction();

    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupLighting() {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.7);
    this.scene.add(ambient);

    const light = new THREE.DirectionalLight(0xffffff, 1.4);
    light.position.set(2, 3, 4);
    light.castShadow = true;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    this.scene.add(light);
  }

  buildPetriDish() {
    // Agar Gel Floor
    const agarGeo = new THREE.CircleGeometry(this.radius, 64);
    const agarMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.1
    });
    this.agarMesh = new THREE.Mesh(agarGeo, agarMat);
    this.agarMesh.receiveShadow = true;
    this.scene.add(this.agarMesh);

    // Glass Petri Dish Rim
    const rimGeo = new THREE.CylinderGeometry(this.radius + 0.04, this.radius + 0.04, 0.25, 64, 1, true);
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1,
      transmission: 0.9,
      thickness: 0.1,
      side: THREE.DoubleSide
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.z = 0.12;
    this.scene.add(rim);

    // Grid lines for micro-scale scale reference (0.2mm grid)
    const grid = new THREE.GridHelper(this.radius * 2, 22, 0x1e3a8a, 0x0f172a);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.001;
    this.scene.add(grid);
  }

  buildFoodPatch() {
    this.foodGroup = new THREE.Group();
    this.foodGroup.position.set(this.foodPos.x, this.foodPos.y, 0.002);

    // Glowing Bacterial Lawn (OP50 E. coli lawn)
    const lawnGeo = new THREE.CircleGeometry(0.35, 32);
    const lawnMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide
    });
    const lawn = new THREE.Mesh(lawnGeo, lawnMat);
    this.foodGroup.add(lawn);

    // Food gradient halo
    const haloGeo = new THREE.RingGeometry(0.35, 0.75, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    this.foodGroup.add(halo);

    this.scene.add(this.foodGroup);
  }

  buildThreatIndicator() {
    // 3D Threat Object (e.g. approaching pipette tip / metal needle / looming hand)
    const threatGeo = new THREE.ConeGeometry(0.08, 0.45, 16);
    const threatMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.4
    });
    this.threatMesh = new THREE.Mesh(threatGeo, threatMat);
    this.threatMesh.rotation.x = Math.PI; // Pointed down at agar
    this.threatMesh.position.set(0, 0, -5);
    this.threatMesh.visible = false;
    this.scene.add(this.threatMesh);
  }

  setFood(x, y) {
    const d = Math.hypot(x, y);
    const maxR = this.radius - 0.4;
    if (d > maxR) {
      x = (x / d) * maxR;
      y = (y / d) * maxR;
    }
    this.foodPos.set(x, y);
    this.foodGroup.position.set(x, y, 0.002);
  }

  launchThreat(headPose) {
    const startX = headPose.x + 0.5 * Math.cos(headPose.heading);
    const startY = headPose.y + 0.5 * Math.sin(headPose.heading);
    const startZ = 0.7;

    const endX = headPose.x + 0.05 * Math.cos(headPose.heading);
    const endY = headPose.y + 0.05 * Math.sin(headPose.heading);
    const endZ = 0.06;

    this.threatAnim = {
      t0: performance.now(),
      dur: 1400,
      start: new THREE.Vector3(startX, startY, startZ),
      end: new THREE.Vector3(endX, endY, endZ)
    };
    this.threatMesh.visible = true;
  }

  updateThreat(now) {
    if (!this.threatAnim) return 0;
    const elapsed = now - this.threatAnim.t0;
    const u = elapsed / this.threatAnim.dur;
    if (u >= 1.0) {
      if (u > 2.2) {
        this.threatAnim = null;
        this.threatMesh.visible = false;
        return 0;
      }
      this.threatMesh.position.copy(this.threatAnim.end);
      return 1.0; // Maximum sustained noxious head stimulus
    }
    const k = u * u;
    this.threatMesh.position.lerpVectors(this.threatAnim.start, this.threatAnim.end, k);
    return Math.min(1.0, u * 1.2);
  }

  setupInteraction() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObject(this.agarMesh);
      if (hits.length > 0) {
        const p = hits[0].point;
        this.setFood(p.x, p.y);
      }
    });
  }

  updateCamera(headPose) {
    if (this.followMode) {
      const target = new THREE.Vector3(headPose.x, headPose.y, 0.05);
      this.controls.target.lerp(target, 0.1);
      const offset = new THREE.Vector3(headPose.x, headPose.y - 1.2, 1.0);
      this.camera.position.lerp(offset, 0.08);
    }
    this.controls.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
