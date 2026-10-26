"""Reads a PDF and prints JSON: {pages, text, images:[{page,w,h}], }. Used by the e2e suites to inspect generated documents."""
import sys, json
try:
    import pymupdf as fitz
except ImportError:
    import fitz
d = fitz.open(sys.argv[1])
out = {'pages': len(d), 'text': '\n'.join(p.get_text() for p in d), 'images': []}
for i, p in enumerate(d):
    for im in p.get_images(full=True):
        out['images'].append({'page': i + 1, 'w': im[2], 'h': im[3]})
if len(sys.argv) > 2:
    for i, p in enumerate(d):
        p.get_pixmap(dpi=110).save(f'{sys.argv[2]}-p{i+1}.png')
print(json.dumps(out))
