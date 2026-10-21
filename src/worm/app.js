// Main Application Controller: C. elegans Connectome Simulation
// Embodies the frozen Cook et al. 2019 connectome into a 3D hydrostat nematode body.

import { CelegansConnectomeEngine } from '../sim/worm_brain.js';
import { NematodeBody } from './body.js';
import { WormArena } from './arena.js';

class WormApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.arena = new WormArena(this.container);
    this.body = new NematodeBody(this.arena.scene);
    this.brain = null;

    this.lastTime = performance.now();
    this.fpsCount = 0;
    this.lastFpsTime = performance.now();

    // Camera vision state
    this.visionSource = 'touchplus';
    this.cameraImg = new Image();
    this.cameraImg.crossOrigin = 'anonymous';
    this.videoElement = document.getElementById('camera-video');
    this.lastThreatLevel = 0;

    this.initHUDCanvases();
    this.initUI();
    this.loadConnectome();
  }

  initHUDCanvases() {
    this.muscleCanvas = document.getElementById('muscle-canvas');
    this.muscleCtx = this.muscleCanvas.getContext('2d');
  }

  async loadConnectome() {
    try {
      const res = await fetch('/data/celegans_connectome.json');
      const data = await res.json();
      this.brain = new CelegansConnectomeEngine(data);
      document.getElementById('status-text').textContent = 'Cook et al. 2019 Connectome Loaded (454 Cells)';
      
      // Start simulation loop once connectome is ready
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
      this.setupCameraStream();
    } catch (err) {
      console.error('Failed to load C. elegans connectome:', err);
      document.getElementById('status-text').textContent = 'Error loading connectome: ' + err.message;
    }
  }

  initUI() {
    // Scramble null-model control toggle
    const btnIntact = document.getElementById('btn-intact');
    const btnScramble = document.getElementById('btn-scramble');
    btnIntact.onclick = () => {
      if (this.brain) this.brain.setScramble(false);
      btnIntact.classList.add('active');
      btnScramble.classList.remove('active');
      document.getElementById('lbl-graph-mode').textContent = 'Intact Biological Wiring';
      document.getElementById('lbl-graph-mode').style.color = '#38bdf8';
    };
    btnScramble.onclick = () => {
      if (this.brain) this.brain.setScramble(true);
      btnScramble.classList.add('active');
      btnIntact.classList.remove('active');
      document.getElementById('lbl-graph-mode').textContent = 'Degree-Matched Scramble (Null Control)';
      document.getElementById('lbl-graph-mode').style.color = '#f59e0b';
    };

    // Gap junction toggle
    const chkGap = document.getElementById('chk-gap');
    chkGap.onchange = (e) => {
      if (this.brain) this.brain.setGapDisabled(!e.target.checked);
    };

    // Threat button
    document.getElementById('btn-threat').onclick = () => {
      this.arena.launchThreat(this.body.getHeadPose());
    };

    // Chase cam toggle
    document.getElementById('chk-follow').onchange = (e) => {
      this.arena.followMode = e.target.checked;
    };

    // Randomize food
    document.getElementById('btn-random-food').onclick = () => {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * (this.arena.radius - 0.9);
      this.arena.setFood(r * Math.cos(a), r * Math.sin(a));
    };

    // Reset worm
    document.getElementById('btn-reset').onclick = () => {
      this.body.reset(0, 0);
    };

    // Vision source selector
    document.getElementById('vision-source').onchange = (e) => {
      this.visionSource = e.target.value;
      this.setupCameraStream();
    };
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
      statusEl.textContent = 'Virtual 3D Pipette Threat';
    }
  }

  pollTouchPlus() {
    if (this.visionSource !== 'touchplus') return;
    const camImgEl = document.getElementById('camera-preview-img');

    this.cameraImg.onload = () => {
      if (this.visionSource !== 'touchplus') return;
      camImgEl.src = this.cameraImg.src;
      this.estimateOpticalExpansion(this.cameraImg);
      setTimeout(() => this.pollTouchPlus(), 33);
    };
    this.cameraImg.onerror = () => {
      setTimeout(() => this.pollTouchPlus(), 200);
    };
    this.cameraImg.src = `http://127.0.0.1:5174/api/latest.png?t=${Date.now()}`;
  }

  estimateOpticalExpansion(img) {
    if (!this.analysisCanvas) {
      this.analysisCanvas = document.createElement('canvas');
      this.analysisCanvas.width = 64;
      this.analysisCanvas.height = 48;
      this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
      this.prevDark = null;
    }
    const ctx = this.analysisCtx;
    ctx.drawImage(img, 0, 0, 64, 48);
    const data = ctx.getImageData(0, 0, 64, 48).data;

    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum < 70) dark++;
    }
    const radius = Math.sqrt(dark / Math.PI);
    if (this.prevDark === null) {
      this.prevDark = radius;
      return;
    }

    const deltaRadius = radius - this.prevDark;
    // An approaching looming object causes rapid expansion: deltaRadius > 1.2 in 33ms
    if (this.prevDark > 3.0 && deltaRadius > 1.2) {
      const rate = deltaRadius / 0.033;
      if (rate > 15.0) {
        this.lastThreatLevel = Math.min(1.0, rate * 0.04);
      }
    }
    this.prevDark = 0.85 * this.prevDark + 0.15 * radius;
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // 1. Process threat
    const simThreat = this.arena.updateThreat(now);
    const totalThreat = Math.max(simThreat, this.lastThreatLevel);

    // 2. Step C. elegans biophysical connectome
    const headPose = this.body.getHeadPose();
    const distToFood = Math.hypot(this.arena.foodPos.x - headPose.x, this.arena.foodPos.y - headPose.y);

    const brainOut = this.brain.step({
      noxiousHeadTouch: simThreat,
      anteriorLooming: this.lastThreatLevel,
      foodOdor: Math.max(0, 1.0 - distToFood / 1.5),
      dt
    });

    // 3. Step 3D Nematode Body Kinematics
    this.body.step(brainOut, dt);

    // 4. Update Camera & Render 3D Scene
    this.arena.updateCamera(headPose);
    this.arena.render();

    // 5. Update HUD Telemetry
    this.renderHUD(brainOut, headPose, distToFood, now);

    // Decay transient threat
    this.lastThreatLevel *= 0.93;
  }

  renderHUD(brainOut, headPose, distToFood, now) {
    const telem = brainOut.telemetry;

    // AVA vs AVB Command Bars
    const avaPct = Math.min(100, telem.meanAVA * 100);
    const avbPct = Math.min(100, telem.meanAVB * 100);
    document.getElementById('bar-ava').style.width = avaPct + '%';
    document.getElementById('bar-avb').style.width = avbPct + '%';

    // State Alert Box
    const alertEl = document.getElementById('command-alert');
    if (telem.reversalActive) {
      alertEl.className = 'threat-box active';
      alertEl.textContent = '🚨 REVERSAL ESCAPE: AVA/AVD Active!';
    } else {
      alertEl.className = 'threat-box';
      alertEl.textContent = '🟢 FORWARD CRAWL: AVB/PVC Active';
    }

    // Sensory & Steering telemetry
    document.getElementById('lbl-ash').textContent = telem.ashActivity.toFixed(2);
    document.getElementById('lbl-dist-food').textContent = distToFood.toFixed(2) + ' mm';
    document.getElementById('lbl-head-turn').textContent = (telem.steeringBias * 10).toFixed(1);

    // Render Dorsal vs Ventral Muscle Waveform Canvas
    const ctx = this.muscleCtx;
    const w = this.muscleCanvas.width;
    const h = this.muscleCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const dorsal = brainOut.dorsalAct;
    const ventral = brainOut.ventralAct;
    const num = Math.min(dorsal.length, ventral.length);

    ctx.lineWidth = 2;
    // Dorsal wave (Cyan)
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    for (let i = 0; i < num; i++) {
      const x = (i / (num - 1)) * w;
      const y = h * 0.45 - (dorsal[i] - 0.15) * h * 0.8;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Ventral wave (Magenta)
    ctx.beginPath();
    ctx.strokeStyle = '#ec4899';
    for (let i = 0; i < num; i++) {
      const x = (i / (num - 1)) * w;
      const y = h * 0.55 + (ventral[i] - 0.15) * h * 0.8;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Center divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // FPS
    this.fpsCount++;
    if (now - this.lastFpsTime >= 1000) {
      document.getElementById('lbl-fps').textContent = this.fpsCount;
      this.fpsCount = 0;
      this.lastFpsTime = now;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new WormApp();
});
