"""
Measures RAM / CPU / time / temp-file usage of the running service under realistic loads.
Usage: python tests/resource_check.py        (starts its own uvicorn on :8011 with OCR_API_KEY=bench)
"""
import concurrent.futures as cf
import glob
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.docgen import degrade_noise, make_pdf, rasterize, rotate, scan_pdf, to_jpg  # noqa: E402

PORT = 8011
KEY = "bench"


def tree_pids(root: int) -> list[int]:
    pids, todo = [], [root]
    while todo:
        p = todo.pop()
        pids.append(p)
        try:
            with open(f"/proc/{p}/task/{p}/children") as f:
                todo += [int(x) for x in f.read().split()]
        except Exception:
            pass
    return pids


def rss_mb(pids) -> float:
    total = 0
    for p in pids:
        try:
            with open(f"/proc/{p}/statm") as f:
                total += int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
        except Exception:
            pass
    return total / 1024 / 1024


def cpu_seconds(pids) -> float:
    t = 0.0
    for p in pids:
        try:
            f = open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()
            t += (int(f[11]) + int(f[12]) + int(f[13]) + int(f[14])) / os.sysconf("SC_CLK_TCK")  # utime+stime+cutime+cstime
        except Exception:
            pass
    return t


def post(data: bytes, name="f.pdf"):
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/ocr", data=body, headers={"X-API-Key": KEY, "Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    env = {**os.environ, "OCR_API_KEY": KEY, "OCR_TIMEOUT_SECONDS": "200"}
    srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app_factory", "--factory", "--port", str(PORT), "--log-level", "warning"],
                           cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), env=env)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2); break
        except Exception:
            time.sleep(0.2)
    tmp_before = set(glob.glob(os.path.join(tempfile.gettempdir(), "*")))
    idle = rss_mb(tree_pids(srv.pid))
    print(f"idle service RSS: {idle:.0f} MB")
    peak = {"v": 0.0}
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            peak["v"] = max(peak["v"], rss_mb(tree_pids(srv.pid)))
            time.sleep(0.03)

    def scenario(name, fn):
        peak["v"] = 0.0
        stop.clear()
        th = threading.Thread(target=sampler); th.start()
        c0, t0 = cpu_seconds(tree_pids(srv.pid)), time.time()
        res = fn()
        wall = time.time() - t0
        cpu = cpu_seconds(tree_pids(srv.pid)) - c0
        stop.set(); th.join()
        time.sleep(0.3)
        after = rss_mb(tree_pids(srv.pid))
        print(f"{name:34} status={res!s:<18} wall={wall:5.1f}s cpu={cpu:5.1f}s peak_RSS={peak['v']:5.0f}MB after={after:4.0f}MB")

    pdf, _ = make_pdf()
    pdf5, _ = make_pdf(pages=5)
    pdf20, _ = make_pdf(pages=20)
    scan1 = scan_pdf(pdf)
    scan5 = scan_pdf(pdf5)
    scan20 = scan_pdf(pdf20)
    big_png = rasterize(pdf, 600)  # 4960x7016 px photo-sized scan
    import io
    b = io.BytesIO(); big_png.save(b, "PNG"); big = b.getvalue()
    noisy = scan_pdf(pdf, jpeg_quality=40, transform=lambda im: degrade_noise(rotate(im, 2.5)))

    scenario("digital PDF (text layer)", lambda: post(pdf))
    scenario("scanned 1 page", lambda: post(scan1))
    scenario("scanned 5 pages", lambda: post(scan5))
    scenario("scanned 20 pages (limit)", lambda: post(scan20))
    scenario(f"huge image 4960x7016 ({len(big)//1024//1024} MB PNG)", lambda: post(big, "big.png"))
    scenario("noisy + skewed scan (2-pass)", lambda: post(noisy))
    scenario("4 concurrent uploads", lambda: sorted(cf.ThreadPoolExecutor(4).map(lambda _: post(scan1), range(4))))
    scenario("8 concurrent uploads (queue 4)", lambda: sorted(cf.ThreadPoolExecutor(8).map(lambda _: post(scan1), range(8))))
    time.sleep(1)
    tmp_after = set(glob.glob(os.path.join(tempfile.gettempdir(), "*")))
    print(f"idle RSS after all jobs: {rss_mb(tree_pids(srv.pid)):.0f} MB (started at {idle:.0f} MB)")
    print(f"new files left in {tempfile.gettempdir()}: {sorted(tmp_after - tmp_before) or 'none'}")
    srv.terminate()


if __name__ == "__main__":
    main()
