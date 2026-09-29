import pymupdf as fitz, sys
out = sys.argv[1]
def inv(path, title="TAX INVOICE"):
    d = fitz.open(); p = d.new_page()
    t = p.insert_text
    t((40,50), "ARIB GLOBAL FZE", fontsize=16)
    t((40,68), "Warehouse 12, JAFZA, Dubai, UAE", fontsize=9)
    t((400,50), title, fontsize=16)
    t((400,70), "Invoice No: INV-2026-00417", fontsize=10)
    t((400,84), "Date: 14/03/2026", fontsize=10)
    t((40,120), "Bill To:", fontsize=10)
    t((40,134), "Lumina Cameras Pvt Ltd", fontsize=10)
    t((40,148), "22 MG Road, Bengaluru, India", fontsize=10)
    t((40,190), "Description         SKU        Qty   Unit Price    Amount", fontsize=10)
    rows = [("Sony FX3 Camera Body","SNY-FX3",2,3899.00),("Godox V1 Flash","GDX-V1",10,249.50),("Manfrotto Tripod 190","MAN-190",5,120.75)]
    y=210
    for n,s,q,u in rows:
        t((40,y), f"{n:<24}{s:<12}{q:<6}{u:>10,.2f}   {q*u:>10,.2f}", fontsize=10); y+=16
    sub=sum(q*u for _,_,q,u in rows)
    t((350,y+20), f"Subtotal: USD {sub:,.2f}", fontsize=10)
    t((350,y+36), f"Freight: USD 150.00", fontsize=10)
    t((350,y+52), f"VAT (5%): USD {sub*0.05:,.2f}", fontsize=10)
    t((350,y+68), f"Grand Total: USD {sub*1.05+150:,.2f}", fontsize=11)
    d.save(path); return d
inv(out+"/digital.pdf")
# image render
d = fitz.open(out+"/digital.pdf"); d[0].get_pixmap(dpi=150).save(out+"/invoice.png")
# scanned pdf: image-only
im = fitz.open(); pg = im.new_page(); pg.insert_image(pg.rect, filename=out+"/invoice.png"); im.save(out+"/scanned.pdf")
# low quality: downscale + blur + jpeg
from PIL import Image, ImageFilter
i = Image.open(out+"/invoice.png").convert("L"); i = i.resize((i.width//2, i.height//2)).filter(ImageFilter.GaussianBlur(0.8)); i.save(out+"/lowq.jpg", quality=25)
