// 3D Robot Models and Idealized Kinematics Engine
// Supports both:
// 1. Dual-Tread Differential Tank Drive (Devastator style)
// 2. 4-Wheel Mecanum Omnidirectional Drive (goBILDA Strafer style)

import * as THREE from 'three';

export class RobotSimulator {
  constructor(scene, mode = 'tank') {
    this.scene = scene;
    this.mode = mode; // 'tank' or 'mecanum'

    // Robot state in world coordinates
    this.x = 0;
    this.y = 0;
    this.z = 0.08;
    this.yaw = 0; // Heading in radians (0 = +X, PI/2 = +Y)
    this.vx = 0;
    this.vy = 0;
    this.omega = 0; // Angular velocity (rad/s)

    // Wheel speeds
    this.wheelSpeeds = [0, 0, 0, 0]; // [FL, FR, RL, RR] or [L, R]

    // Physical dimensions (meters)
    this.width = 0.32;
    this.length = 0.38;
    this.wheelRadius = 0.055;
    this.trackBase = 0.28;
    this.maxSpeed = 1.2; // m/s at 1.0 motor command
    this.maxOmega = 3.5; // rad/s

    // 3D Mesh Groups
    this.root = new THREE.Group();
    this.tankGroup = new THREE.Group();
    this.mecanumGroup = new THREE.Group();

    this.scene.add(this.root);
    this.root.add(this.tankGroup);
    this.root.add(this.mecanumGroup);

    this.buildTankMesh();
    this.buildMecanumMesh();
    this.buildCameraSensors();

    this.setMode(mode);
    this.updateTransform();
  }

  setMode(mode) {
    this.mode = mode;
    this.tankGroup.visible = (mode === 'tank');
    this.mecanumGroup.visible = (mode === 'mecanum');
  }

  buildCameraSensors() {
    // Front Stereo Camera Mast (representing Touch+ / Leap Motion)
    const mastGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 16);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(0.12, 0, 0.14);
    mast.rotation.z = Math.PI / 2;
    this.root.add(mast);

    // Camera Bar
    const barGeo = new THREE.BoxGeometry(0.025, 0.14, 0.02);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.8 });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(0.13, 0, 0.20);
    this.root.add(bar);

    // Stereo Lenses (Left and Right IR apertures)
    const lensGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.008, 16);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.9 });
    
    const lensL = new THREE.Mesh(lensGeo, lensMat);
    lensL.position.set(0.145, 0.045, 0.20);
    lensL.rotation.z = Math.PI / 2;
    this.root.add(lensL);

    const lensR = new THREE.Mesh(lensGeo, lensMat);
    lensR.position.set(0.145, -0.045, 0.20);
    lensR.rotation.z = Math.PI / 2;
    this.root.add(lensR);

    // Center IR Illuminator / Status Indicator
    const irGeo = new THREE.SphereGeometry(0.006, 12, 12);
    this.statusLedMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const led = new THREE.Mesh(irGeo, this.statusLedMat);
    led.position.set(0.145, 0, 0.20);
    this.root.add(led);
  }

  buildTankMesh() {
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4, metalness: 0.6 }); // Devastator Yellow
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.3 });
    const treadMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9, metalness: 0.1 });

    // Main Chassis Hull
    const hullGeo = new THREE.BoxGeometry(0.26, 0.18, 0.08);
    const hull = new THREE.Mesh(hullGeo, chassisMat);
    hull.position.set(0, 0, 0.08);
    hull.castShadow = true;
    this.tankGroup.add(hull);

    // Upper Electronics Bay / Deck
    const deckGeo = new THREE.BoxGeometry(0.20, 0.14, 0.04);
    const deck = new THREE.Mesh(deckGeo, darkMat);
    deck.position.set(-0.02, 0, 0.14);
    this.tankGroup.add(deck);

    // Left and Right Continuous Treads & Sprockets
    this.tankWheels = [];
    [-0.13, 0.13].forEach((yOffset, sideIdx) => {
      // Tread Box
      const trackGeo = new THREE.BoxGeometry(0.32, 0.045, 0.09);
      const track = new THREE.Mesh(trackGeo, treadMat);
      track.position.set(0, yOffset, 0.06);
      track.castShadow = true;
      this.tankGroup.add(track);

      // Sprocket Wheels (3 per side)
      const sprockets = [];
      [-0.11, 0, 0.11].forEach(xOffset => {
        const sprocGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16);
        const sproc = new THREE.Mesh(sprocGeo, darkMat);
        sproc.position.set(xOffset, yOffset, 0.06);
        sproc.rotation.x = Math.PI / 2;
        this.tankGroup.add(sproc);
        sprockets.push(sproc);
      });
      this.tankWheels.push(sprockets);
    });
  }

  buildMecanumMesh() {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3, metalness: 0.8 }); // goBILDA Blue
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4, metalness: 0.7 });
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.8, metalness: 0.2 });

    // Chassis Frame (Channel layout)
    const frameGeo = new THREE.BoxGeometry(0.30, 0.19, 0.05);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 0, 0.075);
    frame.castShadow = true;
    this.mecanumGroup.add(frame);

    // Battery / Controller Stack
    const battGeo = new THREE.BoxGeometry(0.18, 0.12, 0.06);
    const battMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
    const batt = new THREE.Mesh(battGeo, battMat);
    batt.position.set(-0.02, 0, 0.13);
    this.mecanumGroup.add(batt);

    // 4 Mecanum Wheels with 45-degree rollers
    this.mecanumWheelMeshes = [];
    const wheelPositions = [
      { x: 0.12, y: 0.14, name: 'FL', angle: 45 },
      { x: 0.12, y: -0.14, name: 'FR', angle: -45 },
      { x: -0.12, y: 0.14, name: 'RL', angle: -45 },
      { x: -0.12, y: -0.14, name: 'RR', angle: 45 }
    ];

    wheelPositions.forEach(pos => {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(pos.x, pos.y, 0.055);

      // Central Rim/Hub
      const hubGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.x = Math.PI / 2;
      hub.castShadow = true;
      wheelGroup.add(hub);

      // 6 Angled Rollers per Mecanum Wheel
      const numRollers = 6;
      for (let r = 0; r < numRollers; r++) {
        const theta = (r / numRollers) * Math.PI * 2;
        const rollerGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.038, 12);
        const roller = new THREE.Mesh(rollerGeo, rollerMat);
        roller.position.set(0.04 * Math.cos(theta), 0, 0.04 * Math.sin(theta));
        roller.rotation.x = Math.PI / 2;
        roller.rotation.z = (pos.angle * Math.PI) / 180;
        wheelGroup.add(roller);
      }

      this.mecanumGroup.add(wheelGroup);
      this.mecanumWheelMeshes.push(wheelGroup);
    });
  }

  /**
   * Update kinematics and wheel animations given brain motor commands
   */
  step(commands, dt = 0.02, arenaRadius = 2.4) {
    if (this.mode === 'tank') {
      const leftCmd = commands.tank.left;
      const rightCmd = commands.tank.right;

      const vL = leftCmd * this.maxSpeed;
      const vR = rightCmd * this.maxSpeed;

      this.wheelSpeeds = [vL, vR];

      // Tank Forward & Turn Kinematics:
      const vFwd = (vR + vL) / 2.0;
      this.omega = (vR - vL) / this.trackBase;

      // Update position
      this.yaw += this.omega * dt;
      this.x += vFwd * Math.cos(this.yaw) * dt;
      this.y += vFwd * Math.sin(this.yaw) * dt;

      // Animate sprocket wheels
      this.tankWheels[0].forEach(w => { w.rotation.y += vL * dt * 8; });
      this.tankWheels[1].forEach(w => { w.rotation.y += vR * dt * 8; });

    } else {
      // Mecanum Omnidirectional Kinematics:
      const cmdVx = commands.mecanum.vx * this.maxSpeed;
      const cmdVy = commands.mecanum.vy * this.maxSpeed;
      this.omega = commands.mecanum.omega * this.maxOmega;

      // Inverse Kinematics for 4 Mecanum wheels:
      // v1 (FL) = vx - vy - omega*(Lx+Ly)
      // v2 (FR) = vx + vy + omega*(Lx+Ly)
      // v3 (RL) = vx + vy - omega*(Lx+Ly)
      // v4 (RR) = vx - vy + omega*(Lx+Ly)
      const geom = 0.26; // Lx + Ly
      const vFL = cmdVx - cmdVy - this.omega * geom;
      const vFR = cmdVx + cmdVy + this.omega * geom;
      const vRL = cmdVx + cmdVy - this.omega * geom;
      const vRR = cmdVx - cmdVy + this.omega * geom;

      this.wheelSpeeds = [vFL, vFR, vRL, vRR];

      // Update position in world frame:
      this.yaw += this.omega * dt;
      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);

      const worldVx = cmdVx * cosY - cmdVy * sinY;
      const worldVy = cmdVx * sinY + cmdVy * cosY;

      this.x += worldVx * dt;
      this.y += worldVy * dt;

      // Animate Mecanum wheel hubs
      if (this.mecanumWheelMeshes) {
        this.mecanumWheelMeshes[0].rotation.y += vFL * dt * 6;
        this.mecanumWheelMeshes[1].rotation.y += vFR * dt * 6;
        this.mecanumWheelMeshes[2].rotation.y += vRL * dt * 6;
        this.mecanumWheelMeshes[3].rotation.y += vRR * dt * 6;
      }
    }

    // Keep heading normalized
    while (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    while (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;

    // Arena boundary containment:
    const distFromCenter = Math.sqrt(this.x * this.x + this.y * this.y);
    const maxRadius = arenaRadius - 0.22;
    if (distFromCenter > maxRadius) {
      const angle = Math.atan2(this.y, this.x);
      this.x = maxRadius * Math.cos(angle);
      this.y = maxRadius * Math.sin(angle);
    }

    this.updateTransform();
  }

  updateTransform() {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.z = this.yaw;
  }

  setThreatStatus(threatDetected, mdnActive) {
    if (mdnActive) {
      this.statusLedMat.color.setHex(0xef4444); // Bright Red (Escape / Reverse)
    } else if (threatDetected) {
      this.statusLedMat.color.setHex(0xf59e0b); // Amber (Looming Warning)
    } else {
      this.statusLedMat.color.setHex(0x38bdf8); // Sky Blue (Normal Cruising)
    }
  }

  getPose() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      omega: this.omega,
      wheelSpeeds: this.wheelSpeeds
    };
  }
}
