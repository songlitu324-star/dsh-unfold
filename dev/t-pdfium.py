import sys, time, os
sys.path.insert(0, r"C:\Users\tuson\Desktop\zy\dsh-unfold\vendor\pylib")
import pypdfium2 as pdfium

pdf_path = r"C:\Users\tuson\Desktop\zy\dsh-unfold\vendor\test.pdf"
out = r"C:\Users\tuson\Desktop\zy\dsh-unfold\.tmp\crop.png"
t0 = time.time()
doc = pdfium.PdfDocument(pdf_path)
page = doc[1]
W, H = page.get_size()
print("pages", len(doc), "size", W, H, "load_ms", round((time.time()-t0)*1000))

# region in top-origin coords: (x, y_top, w, h)
x, y_top, w, h = 60, 120, W - 120, 180
x0, x1 = x, x + w
y1_top, y0_top = y_top + h, y_top          # top-origin
obj_bottom = H - y1_top
obj_top = H - y0_top
crop = (x0, obj_bottom, W - x1, H - obj_top)   # cut-from-each-side margins

t1 = time.time()
bmp = page.render(scale=2.2, crop=crop)
img = bmp.to_pil()
print("render_ms", round((time.time()-t1)*1000), "px", img.size)
img.save(out, optimize=True)
print("png_bytes", os.path.getsize(out), "png_dims", img.size)

tp = page.get_textpage()
print("text_head", repr(tp.get_text_range(0, 100)))
