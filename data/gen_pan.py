
import json, math, struct
from PIL import Image

img = Image.open("public/samples/touchplus_latest.png").convert("L")
w, h = img.size
half_w = w // 2
left_crop = img.crop((0, 0, half_w, h))

with open("public/vision/flyvis_map.json") as f:
    m = json.load(f)
dirs = m["eyes"]["L"]["dirs"]
n_col = len(dirs)

fov_h = 75.0 * math.pi / 180.0
fl = (half_w / 2.0) / math.tan(fov_h / 2.0)

def sample_crop(shift_x):
    lum = []
    for x, y, z in dirs:
        if x <= 0.05:
            lum.append(0.2)
            continue
        u = half_w / 2.0 - fl * (y / x) + shift_x
        v = h / 2.0 - fl * (z / x)
        if 0 <= u < half_w and 0 <= v < h:
            lum.append(left_crop.getpixel((int(u), int(v))) / 255.0)
        else:
            lum.append(0.2)
    return lum

steps = 30
with open("data/touchplus_pan_right.bin", "wb") as f_r, open("data/touchplus_pan_left.bin", "wb") as f_l:
    for t in range(steps):
        # 12px shift per step (~3.5-5 deg/step across 75 deg FOV)
        s_r = (t - steps // 2) * 12
        s_l = -(t - steps // 2) * 12
        for val in sample_crop(s_r):
            f_r.write(struct.pack('f', val))
        for val in sample_crop(s_l):
            f_l.write(struct.pack('f', val))

print("Exported 30 pan steps to binary using struct.")
