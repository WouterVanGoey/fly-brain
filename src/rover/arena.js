// 3D Arena Scene, Lighting, Target Beacon, and Interactive Looming Threat for Neuromorphic Rover

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class RoverArena {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.radius = 2.6; // Arena radius in meters

    // Scene & Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Camera & Controls
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
    this.camera.position.set(0, -3.2, 3.0);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0.2);

    this.followMode = false;
    this.followOffset = new THREE.Vector3(-1.2, 0, 0.85);

    // Goal Target & Threat
    this.goalPos = { x: 1.2, y: 1.0 };
    this.threatAnim = null;

    this.setupLighting();
    this.buildFloor();
    this.buildGoalBeacon();
    this.buildThreatObject();
    this.setupInteraction();

    window.addEventListener('resize', () => this.onWindowResize());
  }

  setupLighting() {
    const ambientLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.6);
    this.scene.add(ambientLight);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.position.set(2, 3, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.width = 2048;
    this.sun.shadow.mapSize.height = 2048;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 15;
    this.sun.shadow.camera.left = -3;
    this.sun.shadow.camera.right = 3;
    this.sun.shadow.camera.top = 3;
    this.sun.shadow.camera.bottom = -3;
    this.scene.add(this.sun);
  }

  buildFloor() {
    // Circular Floor Disk
    const floorGeo = new THREE.CircleGeometry(this.radius, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.8,
      metalness: 0.2
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Arena Perimeter Ring
    const ringGeo = new THREE.RingGeometry(this.radius - 0.03, this.radius + 0.05, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = 0.002;
    this.scene.add(ring);

    // High-contrast Polar & Cartesian Grid Lines
    const grid = new THREE.GridHelper(this.radius * 2, 20, 0x38bdf8, 0x1f2937);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.001;
    this.scene.add(grid);
  }

  buildGoalBeacon() {
    this.goalGroup = new THREE.Group();
    this.goalGroup.position.set(this.goalPos.x, this.goalPos.y, 0);

    // Glowing Target Cylinder / Pillar
    const pillarGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 16);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.3, metalness: 0.7 });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.rotation.x = Math.PI / 2;
    pillar.position.z = 0.175;
    pillar.castShadow = true;
    this.goalGroup.add(pillar);

    // Beacon Orb
    const orbGeo = new THREE.SphereGeometry(0.08, 16, 16);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.z = 0.38;
    this.goalGroup.add(orb);

    // Glowing Concentric Target Rings on Floor
    const targetRingGeo = new THREE.RingGeometry(0.08, 0.22, 32);
    const targetRingMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    const targetRing = new THREE.Mesh(targetRingGeo, targetRingMat);
    targetRing.position.z = 0.003;
    this.goalGroup.add(targetRing);

    // Target Light
    this.goalLight = new THREE.PointLight(0x4ade80, 1.5, 2.5);
    this.goalLight.position.set(0, 0, 0.45);
    this.goalGroup.add(this.goalLight);

    this.scene.add(this.goalGroup);
  }

  buildThreatObject() {
    this.threatGroup = new THREE.Group();

    // 3D Looming Hand / Threat Sphere with fingers/palm
    const palmGeo = new THREE.SphereGeometry(0.18, 24, 24);
    const palmMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.4,
      metalness: 0.3,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.3
    });
    this.threatMesh = new THREE.Mesh(palmGeo, palmMat);
    this.threatMesh.castShadow = true;
    this.threatGroup.add(this.threatMesh);

    // Threat Halo Ring
    const haloGeo = new THREE.RingGeometry(0.22, 0.26, 32);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    this.threatGroup.add(halo);

    this.threatGroup.position.set(0, 0, -5); // Start hidden below floor
    this.threatGroup.visible = false;
    this.scene.add(this.threatGroup);
  }

  setGoal(x, y) {
    const dist = Math.sqrt(x * x + y * y);
    const maxR = this.radius - 0.25;
    if (dist > maxR) {
      x = (x / dist) * maxR;
      y = (y / dist) * maxR;
    }
    this.goalPos.x = x;
    this.goalPos.y = y;
    this.goalGroup.position.set(x, y, 0);
  }

  /**
   * Launch an interactive swooping looming threat directly toward the robot's front camera
   */
  launchThreat(robotPose) {
    const rX = robotPose.x;
    const rY = robotPose.y;
    const yaw = robotPose.yaw;

    // Approach from 1.8m in front of the robot toward its camera nose
    const startX = rX + 1.8 * Math.cos(yaw) + 0.3 * Math.sin(yaw);
    const startY = rY + 1.8 * Math.sin(yaw) - 0.3 * Math.cos(yaw);
    const startZ = 0.9;

    const endX = rX + 0.15 * Math.cos(yaw);
    const endY = rY + 0.15 * Math.sin(yaw);
    const endZ = 0.22;

    this.threatAnim = {
      t0: performance.now(),
      duration: 650, // 650ms high-speed approach (simulates reaching hand)
      start: new THREE.Vector3(startX, startY, startZ),
      end: new THREE.Vector3(endX, endY, endZ)
    };
    this.threatGroup.visible = true;
  }

  updateThreat(now) {
    if (!this.threatAnim) return null;
    const u = (now - this.threatAnim.t0) / this.threatAnim.duration;
    if (u >= 1.0) {
      // Threat has finished approach, linger briefly then retreat
      if (u > 1.8) {
        this.threatAnim = null;
        this.threatGroup.visible = false;
        return null;
      }
      this.threatGroup.position.copy(this.threatAnim.end);
      return {
        looming: true,
        tau: 0.15,
        azimuth: 0.1,
        strength: 28
      };
    }

    // Accelerating swoop: k = u^2
    const k = u * u;
    const pos = new THREE.Vector3().lerpVectors(this.threatAnim.start, this.threatAnim.end, k);
    this.threatGroup.position.copy(pos);

    // Optical tau calculation (theta / theta_dot)
    const dist = pos.distanceTo(this.threatAnim.end) + 0.05;
    const velocity = (this.threatAnim.start.distanceTo(this.threatAnim.end) * 2 * u) / (this.threatAnim.duration / 1000);
    const tau = velocity > 0.01 ? dist / velocity : 999;

    return {
      looming: true,
      tau: Math.max(0.05, tau),
      azimuth: 0.05,
      strength: 25 * (1.0 - u * 0.5)
    };
  }

  setupInteraction() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      // Only process left click without drag
      this.pointerDownTime = performance.now();
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dt = performance.now() - this.pointerDownTime;
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dt < 300 && dist < 5) {
        // Simple click on arena floor
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObject(this.floor);
        if (hits.length > 0) {
          const p = hits[0].point;
          this.setGoal(p.x, p.y);
        }
      }
    });
  }

  updateCamera(robotPose) {
    if (this.followMode) {
      const cosY = Math.cos(robotPose.yaw);
      const sinY = Math.sin(robotPose.yaw);
      const targetCamPos = new THREE.Vector3(
        robotPose.x + this.followOffset.x * cosY - this.followOffset.y * sinY,
        robotPose.y + this.followOffset.x * sinY + this.followOffset.y * cosY,
        robotPose.z + this.followOffset.z
      );
      this.camera.position.lerp(targetCamPos, 0.12);
      this.controls.target.lerp(new THREE.Vector3(robotPose.x, robotPose.y, robotPose.z + 0.1), 0.15);
    }
    this.controls.update();
  }

  render() {
    // Pulse target beacon light
    const t = performance.now() * 0.004;
    this.goalLight.intensity = 1.2 + 0.4 * Math.sin(t);
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
