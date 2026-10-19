#!/usr/bin/env python3
"""
Touch+ Web Bridge Server (Localhost only: 127.0.0.1:5174)
Provides truthful hardware status, live stereo frames, and IMU data
bridged directly with TouchPlus Workbench and the Touch+ camera.
"""

import os
import sys
import time
import math
import json
import subprocess
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Paths
SDK_ROOT = Path("/Users/wouter/Code/TouchPlus")
SESSIONS_DIR = Path("/Users/wouter/Documents/TouchPlus/Sessions")
PREPARE_TOOL = SDK_ROOT / "build/TouchPlus Workbench.app/Contents/Helpers/TouchPlusPrepare"
FALLBACK_PNG = Path("/Users/wouter/Code/fly-brain/public/samples/touchplus_latest.png")

# Global state lock
lock = threading.Lock()
state = {
    "device_present": False,
    "workbench_running": False,
    "active_session": None,
    "session_state": "idle",
    "sequence": 0,
    "latest_png_sequence": 0,
    "preview_updates": 0,
    "message": "Initializing bridge...",
    "mode": "disconnected",
    "simulated": False,
    "ax": 0.0,
    "ay": 0.0,
    "az": 0.0,
    "pitch": 0.0,
    "roll": 0.0,
    "raw_hex": None,
    "last_update": time.time(),
}


def check_usb_presence():
    """Inspect whether Touch+ is physically present on USB."""
    if PREPARE_TOOL.is_file():
        try:
            res = subprocess.run([str(PREPARE_TOOL), "--inspect"], capture_output=True, text=True, timeout=2)
            if res.returncode == 0:
                data = json.loads(res.stdout)
                devices = data.get("devices", [])
                return len(devices) > 0
        except Exception:
            pass
    # Fallback to system_profiler check
    try:
        res = subprocess.run(["ioreg", "-p", "IOUSB", "-l"], capture_output=True, text=True, timeout=2)
        if "0x0107" in res.stdout or "0x1e4e" in res.stdout:
            return True
    except Exception:
        pass
    return False


def is_workbench_running():
    """Check if TouchPlusWorkbench process is running."""
    try:
        res = subprocess.run(["pgrep", "-f", "TouchPlusWorkbench"], capture_output=True, text=True, timeout=1)
        return res.returncode == 0
    except Exception:
        return False


def get_latest_session_dir():
    """Find the most recently modified TouchPlus session directory."""
    if not SESSIONS_DIR.is_dir():
        return None
    sessions = [p for p in SESSIONS_DIR.iterdir() if p.is_dir() and not p.name.startswith(".")]
    if not sessions:
        return None
    sessions.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return sessions[0]


def accel_to_pitch_roll(ax, ay, az):
    norm = math.sqrt(ax * ax + ay * ay + az * az)
    if norm < 1e-6:
        return 0.0, 0.0
    ax, ay, az = ax / norm, ay / norm, az / norm
    pitch = math.atan2(ay, math.sqrt(ax * ax + az * az))
    roll = math.atan2(-ax, az)
    return math.degrees(pitch), math.degrees(roll)


def background_monitor():
    """Continuously monitors USB status and TouchPlus Workbench session."""
    global state
    print("Touch+ Bridge monitor thread running.")

    while True:
        try:
            present = check_usb_presence()
            wb_running = is_workbench_running()
            sess_dir = get_latest_session_dir()

            with lock:
                state["device_present"] = present
                state["workbench_running"] = wb_running
                state["last_update"] = time.time()

                if sess_dir:
                    state["active_session"] = str(sess_dir)
                    app_state_file = sess_dir / "app-state.json"
                    if app_state_file.is_file():
                        try:
                            with open(app_state_file, "r") as f:
                                app_state = json.load(f)
                            state["session_state"] = app_state.get("state", "unknown")
                            state["sequence"] = app_state.get("sequence", 0)
                            state["latest_png_sequence"] = app_state.get("latest_png_sequence", 0)
                            state["preview_updates"] = app_state.get("preview_updates", 0)
                            state["message"] = app_state.get("message", "")
                        except Exception:
                            pass

                    # Read last IMU result if available
                    imu_file = sess_dir / "last-control-result.json"
                    if imu_file.is_file():
                        try:
                            with open(imu_file, "r") as f:
                                imu_data = json.load(f)
                            if imu_data.get("action") == "read_imu" and imu_data.get("status") == 0:
                                raw_hex = imu_data.get("raw_hex", "")
                                if len(raw_hex) >= 12:
                                    raw = bytes.fromhex(raw_hex)
                                    ax = int.from_bytes(raw[0:2], byteorder="little", signed=True)
                                    ay = int.from_bytes(raw[2:4], byteorder="little", signed=True)
                                    az = int.from_bytes(raw[4:6], byteorder="little", signed=True)
                                    p, r = accel_to_pitch_roll(ax, ay, az)
                                    state["ax"] = ax
                                    state["ay"] = ay
                                    state["az"] = az
                                    state["pitch"] = round(p, 1)
                                    state["roll"] = round(r, 1)
                                    state["raw_hex"] = raw_hex
                        except Exception:
                            pass

                # Classify truthful operating mode
                if not present:
                    state["mode"] = "disconnected"
                elif wb_running:
                    sess_st = state.get("session_state")
                    if sess_st == "streaming":
                        state["mode"] = "live_hardware"
                    elif sess_st == "error":
                        if "536870199" in state.get("message", "") or "Stop other camera users" in state.get("message", ""):
                            state["mode"] = "usb_locked_by_macos"
                        else:
                            state["mode"] = "workbench_error"
                    else:
                        state["mode"] = f"workbench_{sess_st}"
                else:
                    state["mode"] = "camera_connected_workbench_idle"

        except Exception as e:
            print(f"Monitor error: {e}")

        time.sleep(0.2)


class BridgeHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path in ("/api/imu", "/imu"):
            with lock:
                body = json.dumps(state).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path in ("/api/status", "/status"):
            with lock:
                body = json.dumps(state).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path.startswith("/api/latest.png"):
            # Serve the newest stereo frame from active session or fallback
            png_bytes = None
            seq = 0
            with lock:
                sess_path = state.get("active_session")
                seq = state.get("latest_png_sequence", 0)

            if sess_path:
                session_png = Path(sess_path) / "latest.png"
                if session_png.is_file():
                    try:
                        png_bytes = session_png.read_bytes()
                    except Exception:
                        pass

            if png_bytes is None and FALLBACK_PNG.is_file():
                try:
                    png_bytes = FALLBACK_PNG.read_bytes()
                except Exception:
                    pass

            if png_bytes:
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(png_bytes)))
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("X-Sequence", str(seq))
                self.end_headers()
                self.wfile.write(png_bytes)
            else:
                self.send_response(404)
                self.end_headers()

        elif self.path == "/api/demo":
            # Explicit synthetic math demonstration
            elapsed = time.time()
            sim_pitch = 0.45 * math.sin(elapsed * 1.5)
            sim_roll = 0.60 * math.sin(elapsed * 1.0)
            g = 9.81
            sim_ax = -g * math.sin(sim_roll) * math.cos(sim_pitch)
            sim_ay = g * math.sin(sim_pitch)
            sim_az = g * math.cos(sim_roll) * math.cos(sim_pitch)
            demo_payload = {
                "mode": "synthetic_harmonic_demo",
                "simulated": True,
                "note": "Mathematical sine wave demonstration, not physical sensor.",
                "pitch": round(math.degrees(sim_pitch), 1),
                "roll": round(math.degrees(sim_roll), 1),
                "ax": round(sim_ax, 2),
                "ay": round(sim_ay, 2),
                "az": round(sim_az, 2),
            }
            body = json.dumps(demo_payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path in ("/api/command", "/command"):
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                cmd_obj = json.loads(post_data.decode("utf-8"))
            except Exception:
                cmd_obj = {}

            action = cmd_obj.get("action", "")
            cmd_id = cmd_obj.get("id", f"web_{int(time.time()*1000)}")

            with lock:
                sess_path = state.get("active_session")
                wb_running = state.get("workbench_running", False)

            if not wb_running or not sess_path:
                resp = {"accepted": False, "error": "TouchPlus Workbench is not running or no active session found."}
            else:
                session_dir = Path(sess_path)
                cmd_file = session_dir / "command.json"
                result_file = session_dir / "command-result.json"

                # Clean prior result
                if result_file.is_file():
                    try:
                        result_file.unlink()
                    except Exception:
                        pass

                # Write command for Workbench
                try:
                    with open(cmd_file, "w") as f:
                        json.dump({"id": cmd_id, "action": action}, f)

                    # Wait up to 1.5s for command-result.json
                    t0 = time.time()
                    resp = None
                    while time.time() - t0 < 1.5:
                        if result_file.is_file():
                            try:
                                with open(result_file, "r") as f:
                                    resp = json.load(f)
                                break
                            except Exception:
                                pass
                        time.sleep(0.05)

                    if resp is None:
                        resp = {"accepted": False, "error": "Workbench command timeout"}
                except Exception as e:
                    resp = {"accepted": False, "error": str(e)}

            body = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def run_server(port=5174):
    server_address = ("127.0.0.1", port)
    httpd = ThreadingHTTPServer(server_address, BridgeHandler)
    print(f"Touch+ Bridge Server running on http://127.0.0.1:{port} (localhost only)")

    # Launch background monitor
    t = threading.Thread(target=background_monitor, daemon=True)
    t.start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down bridge server.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    p = 5174
    if len(sys.argv) > 1:
        try:
            p = int(sys.argv[1])
        except ValueError:
            pass
    run_server(p)
