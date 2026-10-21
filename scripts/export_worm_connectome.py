#!/usr/bin/env python3
"""Export Cook et al. 2019 C. elegans hermaphrodite connectome to public/data/celegans_connectome.json.
Packs chemical synapses, gap junctions, Dale neurotransmitter signs, and muscle mappings.
"""
import json
import os
import sys
import numpy as np

sys.path.insert(0, 'scripts')
import connectome_ir as IR

base = 'data/ir'
chem_csv = f'{base}/herm_chemical_corrected/edges.csv'
gap_csv = f'{base}/herm_gap_junction_corrected/edges.csv'
nt_csv = f'{base}/nt_dump.csv'

print("Loading C. elegans Cook et al. 2019 connectome...")
ir = IR.load_worm(chem_csv, gap_csv, nt_csv)

N = int(ir['N'])
names = [str(n) for n in ir['names']]
types = [str(t) for t in ir['types']]
scns = [str(s) for s in ir['scn']]
signs = [float(s) for s in ir['sign']]

# Identify key functional classes
sensory_idx = [i for i, sc in enumerate(scns) if sc == 'sensory']
inter_idx = [i for i, sc in enumerate(scns) if sc == 'interneuron']
motor_idx = [i for i, sc in enumerate(scns) if sc == 'motor_neuron']
muscle_idx = [i for i, sc in enumerate(scns) if sc == 'muscle']

# Map muscle segments: dBWM (dorsal) and vBWM (ventral)
dorsal_muscles = {}
ventral_muscles = {}
for i, name in enumerate(names):
    if name.startswith('dBWM'):
        dorsal_muscles[name] = i
    elif name.startswith('vBWM'):
        ventral_muscles[name] = i

# Specific neurons for command and sensory circuits
named_indices = {name: i for i, name in enumerate(names)}

# Chemical graph CSR
indptr = [int(x) for x in ir['indptr']]
indices = [int(x) for x in ir['indices']]
weights = [float(x) for x in ir['weights']]

# Gap junction graph CSR
gap_indptr = [int(x) for x in ir['gap_indptr']] if ir['gap_indptr'] is not None else []
gap_indices = [int(x) for x in ir['gap_indices']] if ir['gap_indices'] is not None else []
gap_weights = [float(x) for x in ir['gap_weights']] if ir['gap_weights'] is not None else []

out_data = {
    'name': 'C. elegans adult hermaphrodite (Cook et al. 2019)',
    'N': N,
    'names': names,
    'types': types,
    'superclasses': scns,
    'signs': signs,
    'named_indices': named_indices,
    'dorsal_muscles': dorsal_muscles,
    'ventral_muscles': ventral_muscles,
    'chem': {
        'indptr': indptr,
        'indices': indices,
        'weights': weights,
        'nnz': len(indices)
    },
    'gap': {
        'indptr': gap_indptr,
        'indices': gap_indices,
        'weights': gap_weights,
        'nnz': len(gap_indices)
    },
    'meta': ir['meta']
}

out_path = 'public/data/celegans_connectome.json'
os.makedirs('public/data', exist_ok=True)
with open(out_path, 'w') as f:
    json.dump(out_data, f)

print(f"Exported C. elegans connectome to {out_path}:")
print(f"  Total cells: {N}")
print(f"  Chemical edges: {len(indices)} (synapses: {sum(weights):.0f})")
print(f"  Gap junctions: {len(gap_indices)} (junctions: {sum(gap_weights):.0f})")
print(f"  Dorsal muscles: {len(dorsal_muscles)}, Ventral muscles: {len(ventral_muscles)}")
