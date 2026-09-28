# -*- coding: utf-8 -*-
"""生成 electron-builder 应用图标：build/icon.png（512x512，builder 自动转 ico/icns）
设计：深蓝渐变圆角底 + 白色纸张 + 高亮文字行 + 光标，主题"改 PDF 文字"。"""
from PIL import Image, ImageDraw

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 深蓝底（圆角方块，垂直渐变）
grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
top, bot = (36, 84, 168), (24, 56, 122)
for y in range(S):
    t = y / S
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (S, y)], fill=c)
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([16, 16, S - 16, S - 16], radius=96, fill=255)
img.paste(grad, (0, 0), mask)

# 白色纸张（右侧微微倾斜出阴影感）
paper = [(150, 96), (390, 96), (390, 416), (150, 416)]
d.rounded_rectangle([146, 92, 394, 420], radius=18, fill=(244, 247, 252))
d.rounded_rectangle([146, 92, 394, 420], radius=18, outline=(210, 220, 235), width=3)

# 折角
d.polygon([(322, 92), (394, 164), (322, 164)], fill=(214, 226, 242))
d.polygon([(322, 92), (322, 164), (394, 164)], outline=(190, 205, 228), width=2)

# 文字行：第一行高亮（选中态浅蓝底），后面灰蓝行
d.rounded_rectangle([176, 150, 368, 190], radius=8, fill=(210, 234, 255))
d.rectangle([188, 162, 300, 178], fill=(46, 128, 210))  # 选中文字
for i, y in enumerate([218, 254, 290, 326]):
    d.rounded_rectangle([176, y, 368 - (i % 2) * 46, y + 18], radius=6, fill=(176, 190, 210))

# 光标（竖线 + 三角，强调"直接编辑文字"）
d.rectangle([252, 142, 258, 198], fill=(255, 152, 0))
d.polygon([(258, 198), (258, 220), (276, 209)], fill=(255, 152, 0))

img.save(r"D:\xm\zcode\test\pdf-editor\build\icon.png")
print("icon saved", img.size)
