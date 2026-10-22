// Excised & Rewired Neuromorphic Fruit Fly Brain for Autonomous Rover Navigation
// Derives directly from Central Complex (CX) and Lobula Columnar (LC) connectome topology:
// 1. EPG (Ellipsoid Body-Protocerebral Bridge-Gall) Compass Ring Attractor (Heading representation)
// 2. P-EN (Protocerebral Bridge-Ellipsoid Body-Noduli) Shifter cells (Angular velocity integration)
// 3. FB (Fan-Shaped Body) Goal Vector representation
// 4. PFL3 (Protocerebral Bridge-Fan-Shaped Body-Lateral Accessory Lobe) Steering Comparators
// 5. LC4 / LPLC2 Visual Looming Columnar Detectors
// 6. MDN (Moonwalker Descending Neuron) Backward Locomotion Override & Escape Reflex

export class ExcisedFlyBrain {
  constructor(opts = {}) {
    this.nEB = 16; // 16 EPG compass wedges covering 360 degrees (22.5 deg per wedge)
    this.angles = new Float32Array(this.nEB);
    for (let i = 0; i < this.nEB; i++) {
      this.angles[i] = -Math.PI + (i + 0.5) * (2 * Math.PI / this.nEB);
    }

    // EPG (Ellipsoid Body) Compass Ring Attractor state
    this.epg = new Float32Array(this.nEB);
    this.epgTarget = new Float32Array(this.nEB);
    this.initCompassBump(0); // Start facing North (heading = 0)

    // Recurrent connectivity matrix W (Mexican Hat kernel: local excitation, global inhibition)
    this.W = new Float32Array(this.nEB * this.nEB);
    for (let i = 0; i < this.nEB; i++) {
      for (let j = 0; j < this.nEB; j++) {
        let diff = Math.abs(this.angles[i] - this.angles[j]);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        // Excitatory within +/- 45 deg, inhibitory beyond
        const w = 1.8 * Math.cos(diff) - 0.7;
        this.W[i * this.nEB + j] = w;
      }
    }

    // Fan-Shaped Body (FB) goal profile (16 columns)
    this.fbGoal = new Float32Array(this.nEB);

    // PFL3 descending steering neurons (Left and Right pools)
    this.pfl3L = 0;
    this.pfl3R = 0;

    // Looming & Avoidance circuit
    this.lc4Threat = 0;      // Non-directional looming intensity
    this.lplc2Azimuth = 0;   // Directional looming azimuth [-1 (left) .. +1 (right)]
    this.opticalTau = 999.0; // Time-to-contact estimate in seconds
    this.mdnActive = false;  // Moonwalker reverse neuron active
    this.mdnTimer = 0;       // Duration of reverse bout in ms
    this.escapeDir = 1;      // Direction to spin/strafe during escape

    // Compass integration state
    this.currentHeading = 0; // Estimated internal heading in radians [-PI .. PI]
    this.goalHeading = 0;    // Target heading in radians

    // Tuning constants
    this.steerGain = opts.steerGain || 2.4;
    this.baseSpeed = opts.baseSpeed || 0.65;
    this.escapeSpeed = opts.escapeSpeed || 0.95;
    this.threatThreshold = opts.threatThreshold || 0.45; // optical tau < 0.45s triggers MDN
  }

  /**
   * Seed the EPG ring attractor with an initial Gaussian bump at azimuth theta0
   */
  initCompassBump(theta0) {
    this.currentHeading = theta0;
    let sum = 0;
    for (let i = 0; i < this.nEB; i++) {
      let diff = this.angles[i] - theta0;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const v = Math.max(0, Math.exp(-(diff * diff) / (2 * 0.45 * 0.45)));
      this.epg[i] = v;
      sum += v;
    }
    // Normalize bump peak
    if (sum > 0) {
      for (let i = 0; i < this.nEB; i++) this.epg[i] /= sum;
    }
  }

  /**
   * Update the internal compass via P-EN shifter neurons using angular velocity (gyro/encoders).
   * Also integrates visual cue if available (landmark / compass beacon).
   */
  updateCompass(angularVelocity, visualAzimuth = null, dt = 0.02) {
    // 1. P-EN Angular Velocity Integration:
    // P-EN-L and P-EN-R neurons receive angular velocity and shift the bump by delta_theta = omega * dt
    const shift = angularVelocity * dt;
    this.currentHeading += shift;
    while (this.currentHeading > Math.PI) this.currentHeading -= 2 * Math.PI;
    while (this.currentHeading < -Math.PI) this.currentHeading += 2 * Math.PI;

    // Shift bump continuously around the ring attractor
    const shifted = new Float32Array(this.nEB);
    for (let i = 0; i < this.nEB; i++) {
      let srcAngle = this.angles[i] - shift;
      while (srcAngle > Math.PI) srcAngle -= 2 * Math.PI;
      while (srcAngle < -Math.PI) srcAngle += 2 * Math.PI;

      // Find two nearest indices for linear interpolation
      const u = ((srcAngle + Math.PI) / (2 * Math.PI)) * this.nEB;
      const idx0 = (Math.floor(u) + this.nEB) % this.nEB;
      const idx1 = (idx0 + 1) % this.nEB;
      const frac = u - Math.floor(u);
      shifted[i] = (1 - frac) * this.epg[idx0] + frac * this.epg[idx1];
    }

    // 2. Recurrent Ring Attractor Dynamics (Mexican-hat relaxation):
    let maxVal = 0;
    for (let i = 0; i < this.nEB; i++) {
      let recurrent = 0;
      for (let j = 0; j < this.nEB; j++) {
        recurrent += this.W[i * this.nEB + j] * shifted[j];
      }
      let drive = shifted[i] * 0.7 + recurrent * 0.3;

      // Optional visual compass cue correction (resets drift)
      if (visualAzimuth !== null) {
        let cueDiff = this.angles[i] - visualAzimuth;
        while (cueDiff > Math.PI) cueDiff -= 2 * Math.PI;
        while (cueDiff < -Math.PI) cueDiff += 2 * Math.PI;
        const cue = Math.max(0, Math.cos(cueDiff));
        drive += cue * 0.25;
      }

      this.epg[i] = Math.max(0, drive);
      if (this.epg[i] > maxVal) maxVal = this.epg[i];
    }

    // Normalize attractor bump
    if (maxVal > 0) {
      let sum = 0;
      for (let i = 0; i < this.nEB; i++) {
        this.epg[i] = Math.pow(this.epg[i] / maxVal, 2.5); // Sharpen bump
        sum += this.epg[i];
      }
      if (sum > 0) {
        for (let i = 0; i < this.nEB; i++) this.epg[i] /= sum;
      }
    }

    // Calculate bump center of mass (circular mean)
    let sinSum = 0, cosSum = 0;
    for (let i = 0; i < this.nEB; i++) {
      sinSum += this.epg[i] * Math.sin(this.angles[i]);
      cosSum += this.epg[i] * Math.cos(this.angles[i]);
    }
    this.currentHeading = Math.atan2(sinSum, cosSum);
  }

  /**
   * Set the navigational target (goal position relative to robot or allocentric)
   */
  setGoal(goalX, goalY, robotX, robotY) {
    const dx = goalX - robotX;
    const dy = goalY - robotY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.goalHeading = Math.atan2(dy, dx);

    // Populate Fan-Shaped Body (FB) goal profile:
    for (let i = 0; i < this.nEB; i++) {
      let diff = this.angles[i] - this.goalHeading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      // Cosine tuning in FB columns
      this.fbGoal[i] = Math.max(0, Math.cos(diff));
    }
    return dist;
  }

  /**
   * Update LC4/LPLC2 visual looming circuit from stereo camera or synthetic threat
   * @param {Object} threatData - { looming: bool, tau: float, azimuth: float [-1..1], strength: float }
   */
  updateLooming(threatData, dt = 0.02) {
    if (!threatData) {
      this.lc4Threat = Math.max(0, this.lc4Threat - 4.0 * dt);
      this.opticalTau = 999.0;
      return;
    }

    this.lc4Threat = Math.min(1.0, (threatData.strength || 15) / 30.0);
    this.opticalTau = threatData.tau ?? 999.0;
    this.lplc2Azimuth = threatData.azimuth ?? 0;

    // If looming detected and optical tau is critical (< 0.55s), fire MDN (Moonwalker)!
    if (threatData.looming || this.opticalTau < this.threatThreshold || this.lc4Threat > 0.6) {
      if (!this.mdnActive) {
        this.mdnActive = true;
        this.mdnTimer = 0.85; // Moonwalk backward for 850ms
        // Choose escape spin/strafe direction opposite to threat azimuth
        this.escapeDir = this.lplc2Azimuth > 0 ? -1 : 1;
      }
    }
  }

  /**
   * Step the full neuromorphic circuit and compute motor commands.
   * Returns commands for both Differential Tank Drive and 4-Wheel Mecanum Drive.
   */
  step({ angularVelocity = 0, goalX = 0, goalY = 0, robotX = 0, robotY = 0, threat = null, dt = 0.02 }) {
    // 1. Integrate compass heading
    this.updateCompass(angularVelocity, null, dt);

    // 2. Update goal vector in FB
    const distToGoal = this.setGoal(goalX, goalY, robotX, robotY);

    // 3. Process visual looming detectors
    this.updateLooming(threat, dt);

    // 4. Update Moonwalker timer
    if (this.mdnActive) {
      this.mdnTimer -= dt;
      if (this.mdnTimer <= 0) {
        this.mdnActive = false;
      }
    }

    // 5. PFL3 Descending Steering Comparator:
    // PFL3 neurons compare heading bump (EB) with target vector (FB)
    let headingError = this.goalHeading - this.currentHeading;
    while (headingError > Math.PI) headingError -= 2 * Math.PI;
    while (headingError < -Math.PI) headingError += 2 * Math.PI;

    // PFL3-R fires when target is to the right; PFL3-L fires when target is to the left
    this.pfl3R = Math.max(0, -headingError); // Right turn bias
    this.pfl3L = Math.max(0, headingError);  // Left turn bias
    let steeringCmd = (this.pfl3L - this.pfl3R) * this.steerGain;
    steeringCmd = Math.max(-1.0, Math.min(1.0, steeringCmd));

    // Forward drive scaling with arrival deadband to prevent oscillation at the goal
    let fwdDrive = this.baseSpeed * Math.max(0.15, Math.cos(headingError));
    if (distToGoal < 0.08) {
      // Arrived inside deadband (< 8 cm): hold position, zero out steering chatter
      fwdDrive = 0.0;
      steeringCmd = 0.0;
    } else if (distToGoal < 0.35) {
      // Smooth arrival deceleration ramp
      const brakeFactor = Math.max(0, (distToGoal - 0.08) / (0.35 - 0.08));
      fwdDrive *= brakeFactor;
      if (distToGoal < 0.20) {
        steeringCmd *= brakeFactor; // Damp steering near origin
      }
    }

    // 6. Motor Command Generation:
    let tank = { left: 0, right: 0 };
    let mecanum = { vx: 0, vy: 0, omega: 0 };

    if (this.mdnActive) {
      // --- ESCAPE BEHAVIOR (MDN ACTIVE) ---
      // Robot shies away rapidly from approaching hand/camera stimulus!

      // Tank Drive: Full reverse + spin away from threat
      tank.left = -this.escapeSpeed + 0.35 * this.escapeDir;
      tank.right = -this.escapeSpeed - 0.35 * this.escapeDir;

      // Mecanum Drive: Omnidirectional escape!
      // Reverses backward (vx < 0) while strafing sideways (vy) away from looming hand!
      mecanum.vx = -this.escapeSpeed;
      mecanum.vy = this.escapeDir * this.escapeSpeed * 0.9;
      mecanum.omega = this.escapeDir * 0.8;
    } else {
      // --- NORMAL GOAL-SEEKING LOCOMOTION ---
      // Tank Drive differential steering:
      tank.left = Math.max(-1, Math.min(1, fwdDrive - steeringCmd * 0.45));
      tank.right = Math.max(-1, Math.min(1, fwdDrive + steeringCmd * 0.45));

      // Mecanum Drive:
      mecanum.vx = fwdDrive;
      mecanum.vy = 0; // Forward goal navigation
      mecanum.omega = steeringCmd * 1.2;
    }

    return {
      tank,
      mecanum,
      telemetry: {
        epg: Array.from(this.epg),
        currentHeading: this.currentHeading,
        goalHeading: this.goalHeading,
        distToGoal,
        pfl3L: this.pfl3L,
        pfl3R: this.pfl3R,
        steeringCmd,
        opticalTau: this.opticalTau,
        lc4Threat: this.lc4Threat,
        mdnActive: this.mdnActive,
        mdnTimer: this.mdnTimer
      }
    };
  }
}
