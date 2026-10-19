// Stereo visual input pipeline for FlyBrain:
// Projects binocular camera frames (e.g. Touch+ stereo or live webcam)
// onto the 2 x 721 ommatidia directions of Drosophila melanogaster.

export class StereoVisionBridge {
  constructor(flyvisMap, ui = {}) {
    this.map = flyvisMap;
    this.ui = ui;
    this.nCol = flyvisMap.eyes.L.dirs.length; // 721
    this.lumEye = [new Float32Array(this.nCol), new Float32Array(this.nCol)];
    
    // Offscreen rendering canvas for image extraction
    this.canvasL = document.createElement('canvas');
    this.ctxL = this.canvasL.getContext('2d', { willReadFrequently: true });
    this.canvasR = document.createElement('canvas');
    this.ctxR = this.canvasR.getContext('2d', { willReadFrequently: true });

    // Video element for live webcam / camera stream
    this.video = ui.previewVideo || document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.videoStream = null;

    this.activeSource = 'sim';
    this.mappingMode = 'pinhole'; // 'pinhole' (75 deg) or 'vr_panoramic' (180 deg)
    this.running = false;
    this.animId = null;
    this.onFrameCallback = null;

    // Synthetic stimulus states
    this.loomRadius = 5;
    this.gratingPhase = 0;
    this.fpsCount = 0;
    this.lastFpsTime = performance.now();
  }

  setStatus(msg, isError = false) {
    if (this.ui.statusEl) {
      this.ui.statusEl.textContent = msg;
      this.ui.statusEl.style.background = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)';
      this.ui.statusEl.style.borderColor = isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.4)';
      this.ui.statusEl.style.color = isError ? '#f87171' : '#38bdf8';
    }
  }

  setMappingMode(mode) {
    this.mappingMode = mode;
  }

  /**
   * Sample 721 ommatidia luminance from image data
   * @param {ImageData} imgData 
   * @param {'L'|'R'} side 
   * @returns {Float32Array}
   */
  sampleEye(imgData, side) {
    const { width: W, height: H, data } = imgData;
    const dirs = this.map.eyes[side].dirs;
    const out = new Float32Array(this.nCol);
    const isL = side === 'L';

    if (this.mappingMode === 'vr_panoramic') {
      // Cylindrical/spherical field mapping across eye visual field:
      for (let i = 0; i < this.nCol; i++) {
        const [x, y, z] = dirs[i];
        const az = Math.atan2(y, x) * 180 / Math.PI;
        const el = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
        
        const u = isL ? (165 - az) / 175 : (10 - az) / 175;
        const v = (69 - el) / 129;

        const px = Math.max(0, Math.min(W - 1, Math.floor(u * W)));
        const py = Math.max(0, Math.min(H - 1, Math.floor(v * H)));
        const idx = (py * W + px) * 4;
        out[i] = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255.0;
      }
    } else {
      // Pinhole camera projection:
      const fovH = 75 * Math.PI / 180;
      const f = (W / 2) / Math.tan(fovH / 2);
      const ambient = 0.2;

      for (let i = 0; i < this.nCol; i++) {
        const [x, y, z] = dirs[i];
        if (x <= 0.05) {
          out[i] = ambient;
          continue;
        }

        const u = W / 2 - f * (y / x);
        const v = H / 2 - f * (z / x);

        if (u >= 0 && u < W && v >= 0 && v < H) {
          const px = Math.floor(u);
          const py = Math.floor(v);
          const idx = (py * W + px) * 4;
          out[i] = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255.0;
        } else {
          out[i] = ambient;
        }
      }
    }
    return out;
  }

  processSideBySide(image) {
    const W = image.naturalWidth || image.videoWidth || image.width;
    const H = image.naturalHeight || image.videoHeight || image.height;
    if (!W || !H) return this.lumEye;
    const halfW = Math.floor(W / 2);

    this.canvasL.width = halfW;
    this.canvasL.height = H;
    this.ctxL.drawImage(image, 0, 0, halfW, H, 0, 0, halfW, H);
    const dataL = this.ctxL.getImageData(0, 0, halfW, H);

    this.canvasR.width = halfW;
    this.canvasR.height = H;
    this.ctxR.drawImage(image, halfW, 0, halfW, H, 0, 0, halfW, H);
    const dataR = this.ctxR.getImageData(0, 0, halfW, H);

    this.lumEye[0] = this.sampleEye(dataL, 'L');
    this.lumEye[1] = this.sampleEye(dataR, 'R');
    return this.lumEye;
  }

  generateLoom() {
    const W = 320, H = 240;
    this.canvasL.width = W; this.canvasL.height = H;
    this.ctxL.fillStyle = '#ffffff';
    this.ctxL.fillRect(0, 0, W, H);
    this.ctxL.fillStyle = '#000000';
    this.ctxL.beginPath();
    this.ctxL.arc(W / 2, H / 2, this.loomRadius, 0, Math.PI * 2);
    this.ctxL.fill();

    const data = this.ctxL.getImageData(0, 0, W, H);
    this.lumEye[0] = this.sampleEye(data, 'L');
    this.lumEye[1] = this.sampleEye(data, 'R');

    this.loomRadius += 3;
    if (this.loomRadius > 140) this.loomRadius = 5;

    return this.lumEye;
  }

  generateGrating() {
    const W = 320, H = 240;
    this.canvasL.width = W; this.canvasL.height = H;
    const period = 30;
    this.gratingPhase = (this.gratingPhase + 2) % period;

    for (let x = 0; x < W; x++) {
      const v = ((x + this.gratingPhase) % period) < (period / 2) ? 255 : 20;
      this.ctxL.fillStyle = `rgb(${v},${v},${v})`;
      this.ctxL.fillRect(x, 0, 1, H);
    }

    const data = this.ctxL.getImageData(0, 0, W, H);
    this.lumEye[0] = this.sampleEye(data, 'L');
    this.lumEye[1] = this.sampleEye(data, 'R');
    return this.lumEye;
  }

  async startWebcam(deviceId = null) {
    this.stopWebcam();
    this.setStatus('🟡 Requesting camera access...');
    try {
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 }, height: { ideal: 480 } }
      };
      this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.videoStream;
      await this.video.play();

      if (this.ui.previewContainer) this.ui.previewContainer.hidden = false;
      if (this.ui.deviceRow) this.ui.deviceRow.hidden = false;
      if (this.video) this.video.hidden = false;
      const imgEl = document.getElementById('camImgPreview');
      if (imgEl) imgEl.hidden = true;

      // Populate camera devices list if available
      if (this.ui.deviceSelect && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        this.ui.deviceSelect.innerHTML = videoDevices.map(d =>
          `<option value="${d.deviceId}" ${d.deviceId === deviceId ? 'selected' : ''}>${d.label || 'Camera ' + d.deviceId.slice(0, 5)}</option>`
        ).join('');
      }

      const track = this.videoStream.getVideoTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      const w = settings.width || this.video.videoWidth || 1280;
      const h = settings.height || this.video.videoHeight || 480;
      const label = track.label || 'Camera';
      this.setStatus(`🟢 Active: ${label} (${w}×${h})`);
    } catch (err) {
      this.setStatus(`❌ Camera error: ${err.message || 'Permission denied'}`, true);
      console.warn('Webcam access error:', err);
      throw err;
    }
  }

  stopWebcam() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
      this.videoStream = null;
      this.video.srcObject = null;
    }
  }

  async setSource(sourceName, onFrame) {
    this.activeSource = sourceName;
    this.onFrameCallback = onFrame;

    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }

    if (sourceName === 'sim') {
      this.stopWebcam();
      if (this.ui.previewContainer) this.ui.previewContainer.hidden = true;
      if (this.ui.deviceRow) this.ui.deviceRow.hidden = true;
      this.setStatus('Source: Simulated 3D arena (Raycasting)');
      if (this.onFrameCallback) this.onFrameCallback(null);
      return;
    }

    if (sourceName === 'webcam') {
      await this.startWebcam();
      this.fpsCount = 0;
      this.lastFpsTime = performance.now();
      const tick = () => {
        if (this.activeSource !== 'webcam') return;
        if (this.video.readyState >= 2) {
          const eyes = this.processSideBySide(this.video);
          if (this.onFrameCallback) this.onFrameCallback(eyes);

          this.fpsCount++;
          const now = performance.now();
          if (now - this.lastFpsTime >= 1000) {
            const fps = Math.round(this.fpsCount * 1000 / (now - this.lastFpsTime));
            this.fpsCount = 0;
            this.lastFpsTime = now;
            if (this.ui.metaEl) {
              this.ui.metaEl.textContent = `${this.video.videoWidth}×${this.video.videoHeight} @ ${fps} FPS`;
            }
          }
        }
        this.animId = requestAnimationFrame(tick);
      };
      this.animId = requestAnimationFrame(tick);
      return;
    }

    if (sourceName === 'loom') {
      this.stopWebcam();
      if (this.ui.previewContainer) this.ui.previewContainer.hidden = true;
      if (this.ui.deviceRow) this.ui.deviceRow.hidden = true;
      this.setStatus('⚡ Synthetic Looming Disc Stimulus Active');
      const tick = () => {
        if (this.activeSource !== 'loom') return;
        const eyes = this.generateLoom();
        if (this.onFrameCallback) this.onFrameCallback(eyes);
        setTimeout(() => { if (this.activeSource === 'loom') this.animId = requestAnimationFrame(tick); }, 30);
      };
      this.animId = requestAnimationFrame(tick);
      return;
    }

    if (sourceName === 'grating') {
      this.stopWebcam();
      if (this.ui.previewContainer) this.ui.previewContainer.hidden = true;
      if (this.ui.deviceRow) this.ui.deviceRow.hidden = true;
      this.setStatus('⚡ Moving Optomotor Grating Stimulus Active');
      const tick = () => {
        if (this.activeSource !== 'grating') return;
        const eyes = this.generateGrating();
        if (this.onFrameCallback) this.onFrameCallback(eyes);
        setTimeout(() => { if (this.activeSource === 'grating') this.animId = requestAnimationFrame(tick); }, 30);
      };
      this.animId = requestAnimationFrame(tick);
      return;
    }

    if (sourceName === 'touchplus_live') {
      this.stopWebcam();
      if (this.ui.previewContainer) this.ui.previewContainer.hidden = false;
      if (this.ui.deviceRow) this.ui.deviceRow.hidden = true;
      if (this.video) this.video.hidden = true;
      const imgEl = document.getElementById('camImgPreview');
      if (imgEl) imgEl.hidden = false;
      this.setStatus('🟢 Touch+ Live Stream (Bridge 127.0.0.1:5174) Active');

      this.fpsCount = 0;
      this.lastFpsTime = performance.now();
      let pollActive = true;
      this.pollActive = true;

      const liveImg = new Image();
      liveImg.crossOrigin = 'anonymous';

      let inFlight = false;
      const pollLive = () => {
        if (this.activeSource !== 'touchplus_live' || !this.pollActive) return;
        if (inFlight) {
          setTimeout(pollLive, 25);
          return;
        }
        inFlight = true;

        liveImg.onload = () => {
          if (this.activeSource !== 'touchplus_live') return;
          const eyes = this.processSideBySide(liveImg);
          if (this.onFrameCallback) this.onFrameCallback(eyes);

          if (imgEl && imgEl.src !== liveImg.src) {
            imgEl.src = liveImg.src;
          }

          this.fpsCount++;
          const now = performance.now();
          if (now - this.lastFpsTime >= 1000) {
            const fps = Math.round(this.fpsCount * 1000 / (now - this.lastFpsTime));
            this.fpsCount = 0;
            this.lastFpsTime = now;
            if (this.ui.metaEl) {
              this.ui.metaEl.textContent = `${liveImg.naturalWidth}×${liveImg.naturalHeight} @ ${fps} FPS`;
            }
          }
          inFlight = false;
          setTimeout(pollLive, 30); // ~30 Hz
        };

        liveImg.onerror = () => {
          inFlight = false;
          if (this.activeSource === 'touchplus_live') {
            this.setStatus('🟡 Touch+ Bridge connecting (start scripts/touchplus_bridge_server.py)...');
            setTimeout(pollLive, 500);
          }
        };

        liveImg.src = `http://127.0.0.1:5174/api/latest.png?t=${performance.now()}`;
      };

      pollLive();
      return;
    }

    // Static sample images (e.g. touchplus_latest, touchplus_leds_on, touchplus_leds_off)
    this.stopWebcam();
    if (this.ui.deviceRow) this.ui.deviceRow.hidden = true;
    if (this.video) this.video.hidden = true;
    const imgEl = document.getElementById('camImgPreview');
    if (this.ui.previewContainer) this.ui.previewContainer.hidden = false;
    if (imgEl) imgEl.hidden = false;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const eyes = this.processSideBySide(img);
      if (this.onFrameCallback) this.onFrameCallback(eyes);
      if (imgEl) imgEl.src = img.src;
      if (this.ui.metaEl) this.ui.metaEl.textContent = `${img.naturalWidth}×${img.naturalHeight} (Static Stereo Pair)`;
    };

    if (sourceName === 'touchplus_latest') {
      this.setStatus('📷 Touch+ Snapshot: 1280×480 stereo (MacBook keyboard) Active');
      img.src = '/samples/touchplus_latest.png';
    } else if (sourceName === 'touchplus_leds_on') {
      this.setStatus('💡 Touch+ Active IR Illuminated Stereo Pair Active');
      img.src = '/samples/touchplus_leds_on.png';
    } else if (sourceName === 'touchplus_leds_off') {
      this.setStatus('🌙 Touch+ IR Off Stereo Pair Active');
      img.src = '/samples/touchplus_leds_off.png';
    }
  }
}
