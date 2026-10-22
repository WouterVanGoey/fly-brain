// Main Application Controller: 3D Neuromorphic Rover Simulation
// Pairs the Excised Fruit Fly Brain (EPG compass + PFL3 steering + MDN looming escape)
// with the Differential Tank & 4-Wheel Mecanum 3D Robot Simulators.

import { RoverArena } from './arena.js';
import { RobotSimulator } from './robot.js';
import { ExcisedFlyBrain } from './brain.js';
import { CelegansConnectomeEngine } from '../sim/worm_brain.js';

class RoverApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.arena = new RoverArena(this.container);
    this.robot = new RobotSimulator(this.arena.scene, 'tank');
    this.flyBrain = new ExcisedFlyBrain({
      steerGain: 2.5,
      baseSpeed: 0.70,
      escapeSpeed: 1.0,
      threatThreshold: 0.50
    });
    this.wormBrain = null;
    this.brainType = 'fly'; // 'fly' or 'worm'

    this.running = true;
    this.lastTime = performance.now();
    this.fpsCount = 0;
    this.lastFpsTime = performance.now();

    // Vision / Camera feed state
    this.visionSource = 'touchplus'; // 'touchplus', 'webcam', 'sim_hand'
    this.cameraImg = new Image();
    this.cameraImg.crossOrigin = 'anonymous';
    this.cameraFrame = null;
    this.lastThreatData = null;
    this.videoElement = document.getElementById('camera-video');

    this.loadWormConnectome();
    this.initUI();
    this.initCompassCanvas();
    this.setupCameraStream();

    // Start simulation loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  loadWormConnectome() {
    fetch('/data/celegans_connectome.json')
      .then(r => r.json())
      .then(data => {
        this.wormBrain = new CelegansConnectomeEngine(data);
        console.log('C. elegans connectome loaded for rover navigation');
      })
      .catch(err => console.warn('Could not load worm connectome:', err));
  }

  initUI() {
    // Mode toggle
    const btnTank = document.getElementById('btn-mode-tank');
    const btnMecanum = document.getElementById('btn-mode-mecanum');
    btnTank.onclick = () => {
      this.robot.setMode('tank');
      btnTank.classList.add('active');
      btnMecanum.classList.remove('active');
      document.getElementById('lbl-mode').textContent = 'Differential Tank (Devastator)';
      document.getElementById('mecanum-speeds').style.display = 'none';
      document.getElementById('tank-speeds').style.display = 'grid';
    };
    btnMecanum.onclick = () => {
      this.robot.setMode('mecanum');
      btnMecanum.classList.add('active');
      btnTank.classList.remove('active');
      document.getElementById('lbl-mode').textContent = '4-Wheel Mecanum (goBILDA Strafer)';
      document.getElementById('tank-speeds').style.display = 'none';
      document.getElementById('mecanum-speeds').style.display = 'grid';
    };

    // Camera source selector
    const selSource = document.getElementById('vision-source');
    selSource.onchange = (e) => {
      this.visionSource = e.target.value;
      this.setupCameraStream();
    };

    // Brain connectome mode selector
    const selBrain = document.getElementById('brain-mode');
    if (selBrain) {
      selBrain.onchange = (e) => {
        this.brainType = e.target.value;
        const tag = document.getElementById('lbl-brain-tag');
        if (tag) {
          tag.textContent = this.brainType === 'worm' ? 'C. elegans Connectome (Cook 2019)' : 'Fly Central Complex (16-EPG CX)';
        }
      };
    }

    // Threat button
    document.getElementById('btn-threat').onclick = () => {
      this.arena.launchThreat(this.robot.getPose());
    };

    // Follow camera toggle
    const chkFollow = document.getElementById('chk-follow');
    chkFollow.onchange = (e) => {
      this.arena.followMode = e.target.checked;
    };

    // Randomize goal
    document.getElementById('btn-random-goal').onclick = () => {
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * (this.arena.radius - 1.1);
      this.arena.setGoal(r * Math.cos(a), r * Math.sin(a));
    };

    // Reset robot
    document.getElementById('btn-reset').onclick = () => {
      this.robot.x = 0;
      this.robot.y = 0;
      this.robot.yaw = 0;
      this.flyBrain.initCompassBump(0);
    };
  }

  initCompassCanvas() {
    this.compassCanvas = document.getElementById('compass-canvas');
    this.compassCtx = this.compassCanvas.getContext('2d');
  }

  setupCameraStream() {
    const statusEl = document.getElementById('cam-status');
    const camImgEl = document.getElementById('camera-preview-img');

    if (this.visionSource === 'touchplus') {
      if (this.videoStream) {
        this.videoStream.getTracks().forEach(t => t.stop());
        this.videoStream = null;
      }
      this.videoElement.style.display = 'none';
      camImgEl.style.display = 'block';
      statusEl.textContent = 'Touch+ Stereo Bridge (127.0.0.1:5174)';

      // Polling loop for live Touch+ bridge frame
      this.pollTouchPlus();
    } else if (this.visionSource === 'webcam') {
      camImgEl.style.display = 'none';
      this.videoElement.style.display = 'block';
      statusEl.textContent = 'Webcam / Leap Motion UVC';

      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        .then(stream => {
          this.videoStream = stream;
          this.videoElement.srcObject = stream;
          this.videoElement.play();
        })
        .catch(err => {
          statusEl.textContent = 'Webcam Error: ' + err.message;
        });
    } else {
      camImgEl.style.display = 'none';
      this.videoElement.style.display = 'none';
      statusEl.textContent = 'Virtual 3D Looming Threat Object';
    }
  }

  pollTouchPlus() {
    if (this.visionSource !== 'touchplus') return;
    const camImgEl = document.getElementById('camera-preview-img');
    const camStatusEl = document.getElementById('cam-status');

    this.cameraImg.onload = () => {
      if (this.visionSource !== 'touchplus') return;
      if (camImgEl) {
        camImgEl.style.display = 'block';
        camImgEl.src = this.cameraImg.src;
      }
      if (camStatusEl) {
        camStatusEl.textContent = 'Touch+ Live Stream (Active)';
        camStatusEl.style.color = '#22c55e';
      }

      // Optical expansion estimate from stereo frame
      this.estimateOpticalExpansion(this.cameraImg);

      setTimeout(() => this.pollTouchPlus(), 50); // 20 FPS
    };
    this.cameraImg.onerror = () => {
      if (camStatusEl) {
        camStatusEl.textContent = 'Touch+ Offline / Disconnected';
        camStatusEl.style.color = '#ef4444';
      }
      if (camImgEl) camImgEl.style.display = 'none';
      setTimeout(() => this.pollTouchPlus(), 500);
    };
    this.cameraImg.src = `http://127.0.0.1:5174/api/latest.png?t=${Date.now()}`;
  }

  estimateOpticalExpansion(img) {
    if (!this.analysisCanvas) {
      this.analysisCanvas = document.createElement('canvas');
      this.analysisCanvas.width = 64;
      this.analysisCanvas.height = 48;
      this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
      this.prevMean = null;
      this.prevDarkRadius = null;
    }
    const ctx = this.analysisCtx;
    ctx.drawImage(img, 0, 0, 64, 48);
    const data = ctx.getImageData(0, 0, 64, 48).data;

    let darkPixels = 0;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < 70) { // Dark object in IR (e.g. approaching hand)
        const px = (i / 4) % 64;
        const py = Math.floor((i / 4) / 64);
        darkPixels++;
        sumX += px;
        sumY += py;
      }
    }

    const radius = Math.sqrt(darkPixels / Math.PI);
    if (this.prevDarkRadius === null) {
      this.prevDarkRadius = radius;
      return;
    }
    const deltaRadius = radius - this.prevDarkRadius;
    if (this.prevDarkRadius > 3.0 && deltaRadius > 1.2) {
      const expansionRate = deltaRadius / 0.033;
      if (expansionRate > 15.0) {
        const tau = radius / expansionRate;
        const centerX = darkPixels > 0 ? (sumX / darkPixels) / 32 - 1.0 : 0;
        this.lastThreatData = {
          looming: true,
          tau: Math.max(0.08, tau),
          azimuth: centerX,
          strength: Math.min(30, expansionRate * 1.5)
        };
      }
    }
    this.prevDarkRadius = 0.85 * this.prevDarkRadius + 0.15 * radius;
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // 1. Process 3D threat swoop if active
    const simThreat = this.arena.updateThreat(now);
    const activeThreat = simThreat || this.lastThreatData;
    if (this.lastThreatData && !this.lastThreatData.looming) {
      this.lastThreatData = null;
    }

    // 2. Step Connectome Brain (Fruit Fly or C. elegans)
    const robotPose = this.robot.getPose();
    let brainOut;

    if (this.brainType === 'worm' && this.wormBrain) {
      const threatLevel = activeThreat ? (activeThreat.strength || 20) / 30 : 0;
      const dx = this.arena.goalPos.x - robotPose.x;
      const dy = this.arena.goalPos.y - robotPose.y;
      const distToGoal = Math.hypot(dx, dy);
      const targetAngle = Math.atan2(dy, dx);
      let headingErr = targetAngle - robotPose.yaw;
      while (headingErr > Math.PI) headingErr -= 2 * Math.PI;
      while (headingErr < -Math.PI) headingErr += 2 * Math.PI;

      const wormOut = this.wormBrain.step({
        noxiousHeadTouch: simThreat ? 1.0 : 0,
        anteriorLooming: this.lastThreatData ? this.lastThreatData.strength / 30 : 0,
        dt
      });

      let steer = Math.max(-1, Math.min(1, headingErr * 1.6 + wormOut.steeringBias * 0.4));
      let fwd = wormOut.reversalActive ? -0.85 : Math.max(0.12, 0.65 * Math.cos(headingErr));
      
      // Arrival deadband & deceleration ramp (< 8 cm stops chatter; < 35 cm slows smoothly)
      if (distToGoal < 0.08) {
        fwd = 0;
        steer = 0;
      } else if (distToGoal < 0.35) {
        const brakeFactor = Math.max(0, (distToGoal - 0.08) / (0.35 - 0.08));
        fwd *= brakeFactor;
        if (distToGoal < 0.20) steer *= brakeFactor;
      }

      const tank = {
        left: Math.max(-1, Math.min(1, fwd - steer * 0.45)),
        right: Math.max(-1, Math.min(1, fwd + steer * 0.45))
      };
      const mecanum = {
        vx: fwd,
        vy: wormOut.reversalActive ? (steer > 0 ? -0.7 : 0.7) : 0,
        omega: steer * 1.5
      };

      brainOut = {
        tank,
        mecanum,
        telemetry: {
          epg: new Array(16).fill(0).map((_, i) => Math.abs(i - 8) < 3 ? 0.8 : 0.1),
          currentHeading: robotPose.yaw,
          goalHeading: targetAngle,
          distToGoal,
          pfl3L: Math.max(0, -headingErr),
          pfl3R: Math.max(0, headingErr),
          steeringCmd: steer,
          opticalTau: activeThreat?.tau || 999,
          lc4Threat: threatLevel,
          mdnActive: wormOut.reversalActive,
          mdnTimer: wormOut.reversalActive ? 0.5 : 0
        }
      };
    } else {
      brainOut = this.flyBrain.step({
        angularVelocity: robotPose.omega,
        goalX: this.arena.goalPos.x,
        goalY: this.arena.goalPos.y,
        robotX: robotPose.x,
        robotY: robotPose.y,
        threat: activeThreat,
        dt
      });
    }

    // 3. Step Robot Kinematics
    this.robot.step(brainOut, dt, this.arena.radius);
    this.robot.setThreatStatus(!!activeThreat, brainOut.telemetry.mdnActive);

    // 4. Update Camera & Render 3D Scene
    this.arena.updateCamera(robotPose);
    this.arena.render();

    // 5. Update Neuromorphic HUD
    this.renderHUD(brainOut.telemetry, robotPose, now);

    // Decay transient live threat
    if (this.lastThreatData) {
      this.lastThreatData.strength *= 0.92;
      if (this.lastThreatData.strength < 5) this.lastThreatData = null;
    }
  }

  renderHUD(telemetry, robotPose, now) {
    // Render Circular EPG Compass Attractor
    const ctx = this.compassCtx;
    const w = this.compassCanvas.width;
    const h = this.compassCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const rOuter = w * 0.42;
    const rInner = w * 0.26;

    ctx.clearRect(0, 0, w, h);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // Draw 16 EPG Wedges
    const n = telemetry.epg.length;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI + (i / n) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2 / n);
      const val = telemetry.epg[i];

      ctx.beginPath();
      ctx.arc(cx, cy, rInner + val * (rOuter - rInner), a0, a1);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();

      // Heatmap color: Cyan -> Yellow -> Red
      const hue = 190 - val * 160;
      ctx.fillStyle = `hsl(${hue}, 90%, ${30 + val * 50}%)`;
      ctx.fill();
    }

    // Center Heading Needle (Estimated Internal Heading)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(telemetry.currentHeading) * (rInner - 4), cy + Math.sin(telemetry.currentHeading) * (rInner - 4));
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    // Goal Vector Needle (Green)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(telemetry.goalHeading) * (rOuter + 6), cy + Math.sin(telemetry.goalHeading) * (rOuter + 6));
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4ade80';
    ctx.stroke();

    // Update Telemetry Text & Gauges
    document.getElementById('lbl-dist').textContent = telemetry.distToGoal.toFixed(2) + ' m';
    document.getElementById('lbl-heading').textContent = (telemetry.currentHeading * 180 / Math.PI).toFixed(0) + '°';
    document.getElementById('lbl-goal-angle').textContent = (telemetry.goalHeading * 180 / Math.PI).toFixed(0) + '°';

    // PFL3 Steering Bars
    const pfl3L = Math.min(100, telemetry.pfl3L * 60);
    const pfl3R = Math.min(100, telemetry.pfl3R * 60);
    document.getElementById('bar-pfl3-l').style.width = pfl3L + '%';
    document.getElementById('bar-pfl3-r').style.width = pfl3R + '%';

    // MDN Moonwalker & Looming Alert
    const mdnEl = document.getElementById('mdn-alert');
    const tauEl = document.getElementById('lbl-tau');
    if (telemetry.mdnActive) {
      mdnEl.classList.add('active');
      mdnEl.textContent = '🚨 MOONWALKER ACTIVE: BACKWARD ESCAPE!';
      tauEl.textContent = telemetry.opticalTau < 10 ? telemetry.opticalTau.toFixed(2) + ' s' : 'CRITICAL';
      tauEl.style.color = '#ef4444';
    } else if (telemetry.lc4Threat > 0.3) {
      mdnEl.classList.remove('active');
      mdnEl.textContent = '⚠️ LC4 / LPLC2 Visual Looming Warning';
      mdnEl.style.background = 'rgba(245, 158, 11, 0.2)';
      mdnEl.style.borderColor = '#f59e0b';
      mdnEl.style.color = '#fbbf24';
      tauEl.textContent = telemetry.opticalTau.toFixed(2) + ' s';
      tauEl.style.color = '#f59e0b';
    } else {
      mdnEl.classList.remove('active');
      mdnEl.textContent = '🟢 Cruising / Goal Seeking';
      mdnEl.style.background = 'rgba(56, 189, 248, 0.1)';
      mdnEl.style.borderColor = 'rgba(56, 189, 248, 0.3)';
      mdnEl.style.color = '#38bdf8';
      tauEl.textContent = 'Safe (> 10s)';
      tauEl.style.color = '#94a3b8';
    }

    // Wheel speeds
    if (this.robot.mode === 'tank') {
      document.getElementById('spd-tank-l').textContent = (robotPose.wheelSpeeds[0] || 0).toFixed(2) + ' m/s';
      document.getElementById('spd-tank-r').textContent = (robotPose.wheelSpeeds[1] || 0).toFixed(2) + ' m/s';
    } else {
      document.getElementById('spd-mec-fl').textContent = (robotPose.wheelSpeeds[0] || 0).toFixed(2);
      document.getElementById('spd-mec-fr').textContent = (robotPose.wheelSpeeds[1] || 0).toFixed(2);
      document.getElementById('spd-mec-rl').textContent = (robotPose.wheelSpeeds[2] || 0).toFixed(2);
      document.getElementById('spd-mec-rr').textContent = (robotPose.wheelSpeeds[3] || 0).toFixed(2);
    }

    // FPS Counter
    this.fpsCount++;
    if (now - this.lastFpsTime >= 1000) {
      document.getElementById('lbl-fps').textContent = this.fpsCount;
      this.fpsCount = 0;
      this.lastFpsTime = now;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new RoverApp();
});
