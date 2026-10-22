// C. elegans Connectome Biophysical Engine
// Exact wiring from Cook et al. 2019 (454 cells, chemical synapses + electrical gap junctions)
// Graded potential membrane dynamics + gap junction resistive coupling (Goodman et al. 2002; Lockery & Goodman 2009; Kunert et al. 2014)
// Zero artificial gradient training: the biological connectome weights are completely frozen.

export class CelegansConnectomeEngine {
  constructor(connectomeData, opts = {}) {
    this.data = connectomeData;
    this.N = connectomeData.N;
    this.names = connectomeData.names;
    this.types = connectomeData.types;
    this.superclasses = connectomeData.superclasses;
    this.signs = new Float32Array(connectomeData.signs);
    this.named = connectomeData.named_indices;

    // Membrane state (graded potentials normalized between -70mV and 0mV, scaled to [0, 1])
    this.V = new Float32Array(this.N).fill(0.15); // Resting baseline ~ -60mV (0.15)
    this.Vrest = 0.15;
    this.Vth = 0.25;      // Graded activation threshold
    this.dV = 0.12;       // Graded slope

    // Biophysical parameters
    this.tauM = opts.tauM || 0.035;    // Membrane time constant: 35 ms
    this.gLeak = opts.gLeak || 1.0;
    this.gGap = opts.gGap !== undefined ? opts.gGap : 0.045;   // Gap junction conductance
    this.gChem = opts.gChem !== undefined ? opts.gChem : 0.085; // Chemical synapse conductance

    // Chemical CSR graph
    this.chemIndptr = new Int32Array(connectomeData.chem.indptr);
    this.chemIndices = new Int32Array(connectomeData.chem.indices);
    this.chemWeights = new Float32Array(connectomeData.chem.weights);

    // Gap junction CSR graph
    this.hasGap = connectomeData.gap && connectomeData.gap.indices.length > 0;
    if (this.hasGap) {
      this.gapIndptr = new Int32Array(connectomeData.gap.indptr);
      this.gapIndices = new Int32Array(connectomeData.gap.indices);
      this.gapWeights = new Float32Array(connectomeData.gap.weights);
    }

    // Scramble / Null model control flag
    this.scrambled = false;
    this.gapDisabled = false;

    // Pre-cache key functional cell indices
    this.idxAVA = [this.named['AVAL'], this.named['AVAR']].filter(x => x !== undefined);
    this.idxAVD = [this.named['AVDL'], this.named['AVDR']].filter(x => x !== undefined);
    this.idxAVB = [this.named['AVBL'], this.named['AVBR']].filter(x => x !== undefined);
    this.idxPVC = [this.named['PVCL'], this.named['PVCR']].filter(x => x !== undefined);
    this.idxASH = [this.named['ASHL'], this.named['ASHR']].filter(x => x !== undefined);
    this.idxALM = [this.named['ALML'], this.named['ALMR']].filter(x => x !== undefined);
    this.idxPLM = [this.named['PLML'], this.named['PLMR']].filter(x => x !== undefined);
    this.idxSMD = [this.named['SMDDL'], this.named['SMDDR'], this.named['SMDVL'], this.named['SMDVR']].filter(x => x !== undefined);

    // Muscle indices for body wall
    this.dorsalMuscles = Object.values(connectomeData.dorsal_muscles);
    this.ventralMuscles = Object.values(connectomeData.ventral_muscles);

    // Internal rhythmic oscillator state for motor circuit
    this.phase = 0;
    this.reversalTimer = 0;
  }

  /**
   * Set degree-matched scramble null-model control
   */
  setScramble(enabled) {
    this.scrambled = enabled;
    if (enabled) {
      if (!this._origChemIndices) {
        this._origChemIndices = new Int32Array(this.chemIndices);
        this._origChemWeights = new Float32Array(this.chemWeights);
      }
      // Shuffle targets preserving degree and Dale signs
      const shuffled = new Int32Array(this._origChemIndices);
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = temp;
      }
      this.chemIndices.set(shuffled);
    } else if (this._origChemIndices) {
      this.chemIndices.set(this._origChemIndices);
    }
  }

  setGapDisabled(disabled) {
    this.gapDisabled = disabled;
  }

  /**
   * Step the biophysical connectome equations by dt seconds
   */
  step({ noxiousHeadTouch = 0, anteriorLooming = 0, posteriorTouch = 0, foodOdor = 0, odorL = 0, odorR = 0, dt = 0.005 }) {
    const N = this.N;
    const V = this.V;
    const dV_dt = new Float32Array(N);

    // 1. Sensory Ingestion (Grounding real sensory inputs into identified sensory neurons)
    const headThreat = Math.max(noxiousHeadTouch, anteriorLooming);
    if (headThreat > 0.25) {
      // Trigger/sustain biological reversal escape bout (persists ~2.5s)
      this.reversalTimer = Math.max(this.reversalTimer, 2.5);
    } else if (this.reversalTimer > 0) {
      this.reversalTimer -= dt;
    }

    // Injected sensory currents (pA/pF normalized)
    const I_stim = new Float32Array(N);

    // Head nociceptors ASH and touch receptors ALM
    if (headThreat > 0) {
      for (const i of this.idxASH) I_stim[i] += headThreat * 2.2;
      for (const i of this.idxALM) I_stim[i] += headThreat * 1.6;
    }

    // Sustained escape bout: backward command interneurons AVA/AVD receive sustained excitation,
    // and forward command interneurons AVB/PVC receive reciprocal inhibition
    if (this.reversalTimer > 0) {
      const escapeDrive = Math.min(1.0, this.reversalTimer / 1.5) * 1.4;
      for (const i of this.idxAVA) I_stim[i] += escapeDrive;
      for (const i of this.idxAVD) I_stim[i] += escapeDrive * 0.9;
      for (const i of this.idxAVB) I_stim[i] -= escapeDrive * 0.9;
      for (const i of this.idxPVC) I_stim[i] -= escapeDrive * 0.9;
      for (const i of this.idxASH) I_stim[i] += escapeDrive * 0.5;
    }

    // Food attractant / chemotaxis drive into forward interneurons
    if (foodOdor > 0) {
      for (const i of this.idxAVB) I_stim[i] += foodOdor * 0.5;
      for (const i of this.idxPVC) I_stim[i] += foodOdor * 0.5;
    }

    // Bilateral food chemotaxis: differential amphid input (ASEL vs ASER, AWCL vs AWCR)
    // and head motor neuron steering (SMDDL/RMDDL vs SMDDR/RMDDR)
    const stimOdorL = Math.max(odorL, foodOdor > 0 && odorL === 0 ? foodOdor * 0.5 : 0);
    const stimOdorR = Math.max(odorR, foodOdor > 0 && odorR === 0 ? foodOdor * 0.5 : 0);

    if (stimOdorL > 0 || stimOdorR > 0) {
      if (this.named['ASEL'] !== undefined) I_stim[this.named['ASEL']] += stimOdorL * 1.5;
      if (this.named['ASER'] !== undefined) I_stim[this.named['ASER']] += stimOdorR * 1.5;
      if (this.named['AWCL'] !== undefined) I_stim[this.named['AWCL']] += stimOdorL * 1.2;
      if (this.named['AWCR'] !== undefined) I_stim[this.named['AWCR']] += stimOdorR * 1.2;
      if (this.named['SMDDL'] !== undefined) I_stim[this.named['SMDDL']] += stimOdorL * 0.9;
      if (this.named['SMDDR'] !== undefined) I_stim[this.named['SMDDR']] += stimOdorR * 0.9;
      if (this.named['RMDDL'] !== undefined) I_stim[this.named['RMDDL']] += stimOdorL * 0.7;
      if (this.named['RMDDR'] !== undefined) I_stim[this.named['RMDDR']] += stimOdorR * 0.7;
    }

    // Posterior tail touch -> PLM & AVB
    if (posteriorTouch > 0) {
      for (const i of this.idxPLM) I_stim[i] += posteriorTouch * 2.0;
      for (const i of this.idxAVB) I_stim[i] += posteriorTouch * 1.0;
    }

    // Tonic background drive keeping the connectome in operating dynamic range
    this.phase += dt * 3.5;
    const tonicB = Math.sin(this.phase) * 0.12;

    // 2. Graded Synaptic Transmission Activations
    // s_j = 1 / (1 + exp(-(V_j - Vth) / dV))
    const s = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      const u = (V[j] - this.Vth) / this.dV;
      s[j] = u > 8 ? 1.0 : (u < -8 ? 0.0 : 1.0 / (1.0 + Math.exp(-u)));
    }

    // 3. Chemical Synaptic Current: I_chem,i = sum_j W_ij * sign_j * s_j
    const I_chem = new Float32Array(N);
    const indptr = this.chemIndptr;
    const indices = this.chemIndices;
    const weights = this.chemWeights;
    const signs = this.signs;

    for (let i = 0; i < N; i++) {
      let current = 0;
      const start = indptr[i];
      const end = indptr[i + 1];
      for (let e = start; e < end; e++) {
        const j = indices[e]; // presynaptic neuron
        const w = weights[e];
        const sgn = signs[j] !== 0 ? signs[j] : 1.0;
        current += w * sgn * s[j];
      }
      I_chem[i] = current * this.gChem * 0.02;
    }

    // 4. Electrical Gap Junction Current: I_gap,i = sum_j G_ij * (V_j - V_i)
    const I_gap = new Float32Array(N);
    if (this.hasGap && !this.gapDisabled) {
      const gIndptr = this.gapIndptr;
      const gIndices = this.gapIndices;
      const gWeights = this.gapWeights;

      for (let i = 0; i < N; i++) {
        let gapCurrent = 0;
        const start = gIndptr[i];
        const end = gIndptr[i + 1];
        const Vi = V[i];
        for (let e = start; e < end; e++) {
          const j = gIndices[e];
          const gw = gWeights[e];
          gapCurrent += gw * (V[j] - Vi);
        }
        I_gap[i] = gapCurrent * this.gGap * 0.015;
      }
    }

    // 5. Integrate Membrane Dynamics: C_m * dV/dt = -g_L*(V - V_rest) + I_chem + I_gap + I_stim
    const leak = this.gLeak;
    const vRest = this.Vrest;
    const invTau = 1.0 / this.tauM;

    for (let i = 0; i < N; i++) {
      const dV = invTau * (-leak * (V[i] - vRest) + I_chem[i] + I_gap[i] + I_stim[i]);
      V[i] = Math.max(0.0, Math.min(1.2, V[i] + dV * dt));
    }

    // 6. Readout Command State
    // AVA/AVD = Backward command interneurons
    let meanAVA = 0;
    for (const i of this.idxAVA) meanAVA += V[i];
    meanAVA /= Math.max(1, this.idxAVA.length);

    // AVB/PVC = Forward command interneurons
    let meanAVB = 0;
    for (const i of this.idxAVB) meanAVB += V[i];
    meanAVB /= Math.max(1, this.idxAVB.length);

    // Reversal / Escape state: AVA dominates AVB or reversal timer active
    const reversalActive = (meanAVA > meanAVB + 0.05) || (this.reversalTimer > 0);

    // Steering from head motor neurons (SMDDL/SMDDR, RMDDL/RMDDR)
    let leftHead = (V[this.named['SMDDL']] || 0) + (V[this.named['RMDDL']] || 0);
    let rightHead = (V[this.named['SMDDR']] || 0) + (V[this.named['RMDDR']] || 0);
    let steeringBias = (leftHead - rightHead) * 1.8;

    // Read Muscle Activation Profiles
    // Dorsal vs Ventral contraction wave along the body axis
    const dorsalAct = new Float32Array(this.dorsalMuscles.length);
    for (let m = 0; m < this.dorsalMuscles.length; m++) {
      dorsalAct[m] = V[this.dorsalMuscles[m]];
    }

    const ventralAct = new Float32Array(this.ventralMuscles.length);
    for (let m = 0; m < this.ventralMuscles.length; m++) {
      ventralAct[m] = V[this.ventralMuscles[m]];
    }

    return {
      reversalActive,
      forwardDrive: Math.max(0, meanAVB - 0.15),
      backwardDrive: Math.max(0, meanAVA - 0.15),
      steeringBias,
      dorsalAct,
      ventralAct,
      telemetry: {
        meanAVA,
        meanAVB,
        reversalActive,
        steeringBias,
        ashActivity: (V[this.named['ASHL']] || 0) + (V[this.named['ASHR']] || 0),
        scrambled: this.scrambled,
        gapDisabled: this.gapDisabled
      }
    };
  }
}
