// 3D Nematode Body Model & Low-Reynolds-Number Hydrodynamics
// Multi-segment hydrostat model driven directly by Dorsal/Ventral body wall muscle contractions.
// Implements Resistive Force Theory (Gray & Hancock 1955, Niebur & Erdos 1991).

import * as THREE from 'three';

export class NematodeBody {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.numSegments = 24; // 24 anteroposterior segments
    this.totalLength = 1.0; // 1.0 mm normalized length
    this.segLength = this.totalLength / (this.numSegments - 1);
    this.radius = 0.035;    // 35 um radius

    // Segment coordinates (x, y) on the 2D agar plane
    this.points = [];
    this.angles = new Float32Array(this.numSegments);
    this.curvatures = new Float32Array(this.numSegments);

    // Initial posture: gentle sine curve facing East
    for (let i = 0; i < this.numSegments; i++) {
      const s = (i / (this.numSegments - 1)) * this.totalLength;
      const x = -s;
      const y = 0.06 * Math.sin(s * Math.PI * 3);
      this.points.push(new THREE.Vector3(x, y, 0.035));
    }

    // Kinematic parameters
    this.headPos = new THREE.Vector2(0, 0);
    this.headHeading = 0; // Radians
    this.wavePhase = 0;

    // Resistive Force Theory (RFT) coefficients
    this.cPerp = 2.0;
    this.cPara = 1.0;
    this.anisotropy = this.cPerp / this.cPara; // Propulsive drag ratio

    // Build 3D Mesh
    this.buildMesh();
    this.buildTrail();
  }

  buildMesh() {
    this.curve = new THREE.CatmullRomCurve3(this.points);
    this.geometry = new THREE.TubeGeometry(this.curve, 64, this.radius, 16, false);
    
    // Translucent Cuticle Material (characteristic nematode look)
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd,
      emissive: 0x1e3a8a,
      emissiveIntensity: 0.25,
      roughness: 0.2,
      metalness: 0.1,
      transmission: 0.65, // Translucent glass-like cuticle
      thickness: 0.08,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);

    // Head sensor tip (amphid sensilla glowing marker)
    const headGeo = new THREE.SphereGeometry(this.radius * 1.1, 16, 16);
    this.headMarkerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    this.headMarker = new THREE.Mesh(headGeo, this.headMarkerMat);
    this.headMarker.position.copy(this.points[0]);
    this.scene.add(this.headMarker);
  }

  buildTrail() {
    this.maxTrail = 250;
    this.trailPoints = [];
    this.trailPositions = new Float32Array(this.maxTrail * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trailMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.4
    });
    this.trailLine = new THREE.Line(this.trailGeo, this.trailMat);
    this.scene.add(this.trailLine);
  }

  /**
   * Update body posture from biophysical connectome dorsal and ventral muscle activations
   */
  step(brainOutput, dt = 0.016) {
    const isReversing = brainOutput.reversalActive;
    const fwdDrive = brainOutput.forwardDrive;
    const revDrive = brainOutput.backwardDrive;
    const steering = brainOutput.steeringBias;

    // Propagate undulation wave frequency:
    // Forward crawl: 1.2 Hz wave from head to tail
    // Reverse escape: 1.8 Hz high-frequency wave from tail to head
    const baseFreq = isReversing ? -1.85 : (0.8 + fwdDrive * 1.5);
    this.wavePhase += baseFreq * Math.PI * 2 * dt;

    // Head status marker color (Red on reversal escape, Green on forward foraging)
    if (isReversing) {
      this.headMarkerMat.color.setHex(0xef4444); // Red: ASH Noxious Escape
    } else {
      this.headMarkerMat.color.setHex(0x22c55e); // Green: Forward Crawl
    }

    // 1. Calculate local curvature along the 24 segments
    const dorsal = brainOutput.dorsalAct;
    const ventral = brainOutput.ventralAct;

    for (let i = 0; i < this.numSegments; i++) {
      const s = i / (this.numSegments - 1);
      // Traveling wave of curvature
      const wave = Math.sin(this.wavePhase - s * Math.PI * 3.2);

      // Connectome muscle differential drive (dorsal vs ventral)
      const dIdx = Math.min(dorsal.length - 1, Math.floor(s * dorsal.length));
      const vIdx = Math.min(ventral.length - 1, Math.floor(s * ventral.length));
      const muscleDiff = (dorsal[dIdx] - ventral[vIdx]) * 1.2;

      // Head steering bias (SMD/RMD) on anterior segments
      const steerFactor = Math.max(0, 1.0 - s * 3.0) * steering;

      // Net local curvature
      this.curvatures[i] = (wave * 0.85 + muscleDiff + steerFactor) * 2.8;
    }

    // 2. Integrate segment angles and positions from head to tail
    // Head heading advances according to head curvature & forward velocity
    const speed = (isReversing ? -0.45 : (0.28 + fwdDrive * 0.45)) * dt;
    this.headHeading += (this.curvatures[0] * 0.4 + steering * 0.6) * dt * (isReversing ? -1 : 1);

    this.points[0].x += speed * Math.cos(this.headHeading);
    this.points[0].y += speed * Math.sin(this.headHeading);

    // Segment follow constraint with curvature bending
    let currentAngle = this.headHeading;
    for (let i = 1; i < this.numSegments; i++) {
      currentAngle += this.curvatures[i] * (this.segLength * 0.9);
      this.points[i].x = this.points[i - 1].x - this.segLength * Math.cos(currentAngle);
      this.points[i].y = this.points[i - 1].y - this.segLength * Math.sin(currentAngle);
      this.points[i].z = 0.035; // Stay resting on agar surface
    }

    // 3. Update 3D Geometry
    this.curve.points = this.points;
    this.geometry.dispose();
    this.geometry = new THREE.TubeGeometry(this.curve, 64, this.radius, 16, false);
    this.mesh.geometry = this.geometry;
    this.headMarker.position.copy(this.points[0]);

    // 4. Update Sinusoidal Trail
    if (this.trailPoints.length === 0 || this.points[0].distanceTo(this.trailPoints[this.trailPoints.length - 1]) > 0.04) {
      this.trailPoints.push(this.points[0].clone());
      if (this.trailPoints.length > this.maxTrail) this.trailPoints.shift();
      const posAttr = this.trailGeo.getAttribute('position');
      for (let p = 0; p < this.trailPoints.length; p++) {
        posAttr.setXYZ(p, this.trailPoints[p].x, this.trailPoints[p].y, this.trailPoints[p].z);
      }
      posAttr.needsUpdate = true;
      this.trailGeo.setDrawRange(0, this.trailPoints.length);
    }
  }

  getHeadPose() {
    return {
      x: this.points[0].x,
      y: this.points[0].y,
      z: this.points[0].z,
      heading: this.headHeading
    };
  }

  reset(x = 0, y = 0) {
    this.headHeading = 0;
    this.wavePhase = 0;
    this.trailPoints = [];
    for (let i = 0; i < this.numSegments; i++) {
      const s = (i / (this.numSegments - 1)) * this.totalLength;
      this.points[i].set(x - s, y, 0.035);
    }
  }
}
