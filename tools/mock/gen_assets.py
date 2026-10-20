import random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
R = random.Random(7)
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FS = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
def font(p, s): return ImageFont.truetype(p, s)
PAL = [(231,76,60),(46,134,222),(39,174,96),(243,156,18),(142,68,173),(22,160,133),(211,84,0),(52,73,94),(192,57,43),(41,128,185),(241,196,15),(236,240,241)]
def grad(w,h,c1,c2,vertical=True):
    im = Image.new('RGB',(w,h),c1); d = ImageDraw.Draw(im)
    n = h if vertical else w
    for i in range(n):
        t = i/max(1,n-1); c = tuple(int(c1[k]+(c2[k]-c1[k])*t) for k in range(3))
        if vertical: d.line([(0,i),(w,i)], fill=c)
        else: d.line([(i,0),(i,h)], fill=c)
    return im
words = ['ATLAS','MEDINA','SAHARA','OASIS','KASBAH','RIVIERA','NOVA','ORBIT','DUNE','CEDAR','ZENITH','PULSE','VERTEX','HORIZON','MARINA','SOUK']
for i in range(48):
    kind = i % 3
    w,h = [(400,300),(600,220),(360,360)][kind]
    im = Image.new('RGBA',(w,h),(0,0,0,0)); d = ImageDraw.Draw(im)
    c = PAL[i % len(PAL)]; txt = words[i % len(words)][:R.choice([2,3,4])] + (str(i%9+1) if i%4==0 else '')
    if kind == 0:
        d.rounded_rectangle([10,40,w-10,h-40], radius=40, fill=c+(255,))
        f = font(F, 110 if len(txt)<4 else 84); tw = d.textlength(txt, font=f)
        d.text(((w-tw)/2, h/2-62), txt, font=f, fill=(255,255,255,255))
    elif kind == 1:
        d.ellipse([10,20,h-20,h-20], fill=c+(255,))
        f = font(F, 96); d.text((h+10, h/2-58), txt, font=f, fill=c+(255,))
    else:
        d.ellipse([20,20,w-20,w-20], fill=c+(255,), outline=(255,255,255,255), width=10)
        f = font(F, 100); tw = d.textlength(txt, font=f); d.text(((w-tw)/2, w/2-60), txt, font=f, fill=(255,255,255,255))
    im.save(f'assets/logos/{i}.png')
titles = ['Last Light','Desert Wind','Paper Harbor','The Quiet Signal','Salt & Iron','Blue Medina','Night Ferry','Glass Mountain','The Long Orbit','Cedar Road','Ninth Wave','Atlas Run','Red Lantern Bay','The Cartographer','Echo Valley','Midnight Souk','Silver Coast','Iron Tide','Hollow Crown','Falling North']
for i in range(80):
    w,h = 400,600
    c1 = PAL[i % len(PAL)]; c2 = tuple(max(0,int(v*0.25)) for v in PAL[(i*5+3) % len(PAL)])
    im = grad(w,h,c1,c2); d = ImageDraw.Draw(im)
    for k in range(6):
        x,y,r = R.randint(-50,w),R.randint(0,h-200),R.randint(30,160)
        d.ellipse([x-r,y-r,x+r,y+r], outline=(255,255,255), width=R.choice([2,4,8]))
    im = im.filter(ImageFilter.GaussianBlur(1.2)); d = ImageDraw.Draw(im)
    t = titles[i % len(titles)].upper(); f = font(F, 46)
    lines = t.split(' ') if len(t) > 12 else [t]
    y = h-80-len(lines)*52
    for ln in lines:
        tw = d.textlength(ln, font=f); d.text(((w-tw)/2, y), ln, font=f, fill=(255,255,255)); y += 52
    im.save(f'assets/posters/{i}.jpg', quality=82)
for i in range(24):
    w,h = 1280,720
    c1 = PAL[(i*3) % len(PAL)]; c2 = (8,12,24)
    im = grad(w,h,tuple(int(v*0.8) for v in c1),c2); d = ImageDraw.Draw(im)
    base = h*0.62
    for layer in range(3):
        pts = [(0,h)]
        for x in range(0,w+40,40):
            pts.append((x, base + layer*70 + 50*math.sin(x/(140+layer*60)+i+layer)))
        pts.append((w,h)); d.polygon(pts, fill=tuple(int(v*(0.35-layer*0.1)) for v in c1))
    d.ellipse([w*0.7-60,h*0.25-60,w*0.7+60,h*0.25+60], fill=(255,236,200))
    im = im.filter(ImageFilter.GaussianBlur(2)); im.save(f'assets/backdrops/{i}.jpg', quality=80)
for i in range(30):
    im = grad(640,360,PAL[(i*7)%len(PAL)],(10,10,20),vertical=False); d = ImageDraw.Draw(im)
    d.rectangle([60,60,580,300], outline=(255,255,255), width=3)
    im.save(f'assets/stills/{i}.jpg', quality=80)
print('ok')
