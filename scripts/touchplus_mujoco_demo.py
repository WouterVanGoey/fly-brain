#!/usr/bin/env python3
"""
Touch+ 3D MuJoCo Visualizer & IMU Simulator Demo
Visualizes the Touch+ stereo camera bar in 3D physics space,
driven by 3-axis accelerometer gravity vectors (pitch & roll).
"""

import sys
import time
import math
import argparse
import numpy as np

try:
    import mujoco
    import mujoco.viewer
except ImportError:
    print("Error: mujoco is not installed in this environment. Run with .venv/bin/python.")
    sys.exit(1)


def euler_to_quat(roll, pitch, yaw):
    """Convert roll, pitch, yaw (in radians) to quaternion [w, x, y, z]."""
    cy = math.cos(yaw * 0.5)
    sy = math.sin(yaw * 0.5)
    cp = math.cos(pitch * 0.5)
    sp = math.sin(pitch * 0.5)
    cr = math.cos(roll * 0.5)
    sr = math.sin(roll * 0.5)

    w = cr * cp * cy + sr * sp * sy
    x = sr * cp * cy - cr * sp * sy
    y = cr * sp * cy + sr * cp * sy
    z = cr * cp * sy - sr * sp * cy
    return np.array([w, x, y, z], dtype=np.float64)


def accel_to_pitch_roll(ax, ay, az):
    """
    Calculate pitch and roll from 3-axis accelerometer gravity vector.
    Touch+ coordinate convention:
      X: lateral (right positive)
      Y: vertical (up positive)
      Z: optical boresight (forward positive)
    """
    norm = math.sqrt(ax * ax + ay * ay + az * az)
    if norm < 1e-6:
        return 0.0, 0.0
    ax, ay, az = ax / norm, ay / norm, az / norm
    pitch = math.atan2(ay, math.sqrt(ax * ax + az * az))
    roll = math.atan2(-ax, az)
    return pitch, roll


def run_demo(model_path="models/touchplus.xml", mode="demo"):
    print(f"Loading MuJoCo model: {model_path}")
    model = mujoco.MjModel.from_xml_path(model_path)
    data = mujoco.MjData(model)

    print("Starting Touch+ 3D MuJoCo viewer...")
    print("Controls: Drag with Left Mouse to rotate camera, Right Mouse to zoom, Middle to pan.")
    print("Press ESC or close window to exit.\n")

    # Fixed height above ground
    base_pos = np.array([0.0, 0.0, 0.16])

    with mujoco.viewer.launch_passive(model, data) as viewer:
        start_time = time.time()
        step = 0

        while viewer.is_running():
            step_start = time.time()
            elapsed = time.time() - start_time

            if mode == "demo":
                # Smooth harmonic motion demonstrating pitch and roll
                pitch = 0.45 * math.sin(elapsed * 1.5)  # +/- 25 degrees pitch
                roll = 0.60 * math.sin(elapsed * 1.0)   # +/- 35 degrees roll
                yaw = 0.20 * math.sin(elapsed * 0.5)    # slight yaw sweep

                # Simulated accelerometer gravity vector in sensor frame
                g = 9.81
                sim_ax = -g * math.sin(roll) * math.cos(pitch)
                sim_ay = g * math.sin(pitch)
                sim_az = g * math.cos(roll) * math.cos(pitch)

                quat = euler_to_quat(roll, pitch, yaw)
            else:
                quat = np.array([1.0, 0.0, 0.0, 0.0])
                sim_ax, sim_ay, sim_az = 0.0, 0.0, 9.81

            # Update Touch+ body position and orientation
            data.qpos[0:3] = base_pos
            data.qpos[3:7] = quat

            # Forward kinematics and sensor computation
            mujoco.mj_forward(model, data)

            # Sync viewer
            viewer.sync()

            if step % 60 == 0:
                p_deg = math.degrees(pitch)
                r_deg = math.degrees(roll)
                print(f"[Touch+ IMU] Pitch: {p_deg:+6.1f}° | Roll: {r_deg:+6.1f}° | Accel: ({sim_ax:+5.2f}, {sim_ay:+5.2f}, {sim_az:+5.2f}) m/s²")

            step += 1
            # Maintain ~60 Hz update rate
            elapsed_step = time.time() - step_start
            sleep_time = max(0.0, (1.0 / 60.0) - elapsed_step)
            time.sleep(sleep_time)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Touch+ 3D MuJoCo Visualizer")
    parser.add_argument("--model", default="models/touchplus.xml", help="Path to touchplus.xml")
    parser.add_argument("--mode", default="demo", choices=["demo", "static"], help="Demo mode")
    args = parser.parse_args()

    run_demo(model_path=args.model, mode=args.mode)
