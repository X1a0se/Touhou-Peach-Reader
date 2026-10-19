"""生成 1024x1024 应用图标：深梅色底 + 桃子 + 书页。"""
from PIL import Image, ImageDraw, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 背景：圆角方形，深梅色渐变
bg = Image.new("RGBA", (S, S), (24, 18, 30, 255))
top = (58, 26, 48, 255)
grad = Image.new("RGBA", (S, S), top)
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=220, fill=255)
gradient = Image.new("RGBA", (S, S))
for y in range(S):
    t = y / (S - 1)
    r = int(58 * (1 - t) + 24 * t)
    g = int(26 * (1 - t) + 18 * t)
    b = int(48 * (1 - t) + 30 * t)
    ImageDraw.Draw(gradient).line([(0, y), (S, y)], fill=(r, g, b, 255))
img.paste(gradient, (0, 0), mask)

d = ImageDraw.Draw(img)

# 桃子：两个相交的圆做出心形轮廓
peach = (255, 170, 170, 255)
peach_dark = (235, 120, 140, 255)
cx, cy, r = S // 2, 560, 250
d.ellipse([cx - r - 40, cy - r + 10, cx + 40, cy + r + 10], fill=peach)
d.ellipse([cx - 40, cy - r + 10, cx + r + 40, cy + r + 10], fill=peach)
d.ellipse([cx - 120, cy - 90, cx + 120, cy + 200], fill=peach)

# 桃子的缝与高光
d.arc([cx - 70, cy - 120, cx + 70, cy + 180], start=250, end=290, fill=(210, 90, 115, 255), width=10)
d.ellipse([cx - 150, cy + 20, cx - 40, cy + 150], fill=(255, 205, 205, 90))

# 叶子
d.ellipse([cx + 40, cy - r - 110, cx + 250, cy - r + 30], fill=(120, 200, 150, 255))
d.line([(cx + 60, cy - r - 40), (cx + 220, cy - r - 70)], fill=(70, 150, 110, 255), width=8)

# 书页：底部白色弧
d.rounded_rectangle([cx - 210, 760, cx + 210, 850], radius=24, fill=(250, 245, 238, 235))
d.line([(cx, 772), (cx, 838)], fill=(200, 180, 170, 255), width=6)
d.line([(cx + 26, 786), (cx + 170, 786)], fill=(190, 170, 165, 255), width=8)
d.line([(cx + 26, 814), (cx + 140, 814)], fill=(190, 170, 165, 255), width=8)
d.line([(cx - 170, 786), (cx - 26, 786)], fill=(190, 170, 165, 255), width=8)
d.line([(cx - 140, 814), (cx - 26, 814)], fill=(190, 170, 165, 255), width=8)

img = img.filter(ImageFilter.SMOOTH)
img.save("apps/desktop/src-tauri/icons/source.png")
print("written")
