#!/usr/bin/env python3
"""Retake docs/assets/screenshots/ from a throwaway copy of the app.

Starts the real server on a temporary DATA_DIR, points it at a fake SMTP server
that accepts and discards every message, feeds it made-up employees at
example.com and dummy one-page PDFs, and drives the pages with Playwright in
light and dark. Needs node 22+, qpdf on PATH and the packages in requirements.txt.
Run it through `make screenshots`.
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

import openpyxl
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "assets" / "screenshots"
PORT = 3917
SMTP_PORT = 2587
BASE = f"http://127.0.0.1:{PORT}"
VIEWPORT = {"width": 1200, "height": 820}

EMPLOYEES = [
    ("E001", "Alice Smith", "AB123456C"), ("E002", "Bob Jones", "CD234567D"),
    ("E003", "Carla Ruiz", "EF345678A"), ("E004", "Dev Patel", "GH456789B"),
    ("E005", "Emma Clarke", "JK567890C"), ("E006", "Farid Haddad", "LM678901D"),
    ("E007", "Grace O'Neill", "NP789012A"), ("E008", "Hiro Tanaka", "RS890123B"),
    ("E009", "Isla Murray", "TW901234C"), ("E010", "Jonas Weber", "YZ012345D"),
    ("E011", "Kemi Adeyemi", "AA112233A"), ("E012", "Liam Byrne", "BB223344B"),
    ("E013", "Maya Cohen", "CC334455C"), ("E014", "Nico Rossi", "DD445566D"),
]


def email_for(name: str) -> str:
    return name.lower().replace("'", "").replace(" ", ".") + "@example.com"


class FakeSmtp(socketserver.StreamRequestHandler):
    """Accepts any login and any message, keeps nothing."""

    def send(self, line: str) -> None:
        self.wfile.write((line + "\r\n").encode())

    def handle(self) -> None:
        self.send("220 demo ESMTP")
        in_data = False
        for raw in self.rfile:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if in_data:
                if line == ".":
                    in_data = False
                    self.send("250 queued")
                continue
            cmd = line.upper()
            if cmd.startswith("EHLO"):
                self.wfile.write(b"250-demo\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n")
            elif cmd.startswith("AUTH PLAIN"):
                self.send("235 ok")
            elif cmd.startswith("AUTH LOGIN"):
                self.send("334 VXNlcm5hbWU6")
                self.rfile.readline()
                self.send("334 UGFzc3dvcmQ6")
                self.rfile.readline()
                self.send("235 ok")
            elif cmd.startswith("DATA"):
                in_data = True
                self.send("354 go")
            elif cmd.startswith("QUIT"):
                self.send("221 bye")
                return
            else:
                self.send("250 ok")


def one_page_pdf(title: str) -> bytes:
    text = f"BT /F1 18 Tf 72 720 Td ({title}) Tj ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(text)} >>\nstream\n{text}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def build_demo_files(folder: Path) -> tuple[Path, Path, Path, Path]:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["EENo", "FullName", "NI No", "Email Address"])
    # Nico Rossi has no payslip in the ZIP, so the review step shows a skipped recipient.
    for no, name, ni in EMPLOYEES:
        ws.append([no, name, ni, email_for(name)])
    excel = folder / "employees-demo.xlsx"
    wb.save(excel)

    zpath = folder / "payslips-2026-08.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        for _, name, _ in EMPLOYEES[:-1]:
            fname = "Payslip_" + name.replace("'", "").replace(" ", "_") + "_2026-08.pdf"
            z.writestr(fname, one_page_pdf(f"Demo payslip, {name}, August 2026"))
        z.writestr("Payslip_Contractor_Temp_2026-08.pdf", one_page_pdf("Demo payslip, spare file"))

    csv = folder / "recipients-demo.csv"
    csv.write_text("name,email,department\n" + "".join(
        f"{n},{email_for(n)},{d}\n" for n, d in
        [("Alice Smith", "Engineering"), ("Bob Jones", "Finance"), ("Carla Ruiz", "Marketing"),
         ("Dev Patel", "Engineering"), ("Emma Clarke", "People")]) )
    guide = folder / "Benefits_Guide_2026.pdf"
    guide.write_bytes(one_page_pdf("Demo benefits guide 2026"))
    return excel, zpath, csv, guide


def api(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def wait_for(fn, what: str, timeout: float = 60):
    end = time.time() + timeout
    while time.time() < end:
        try:
            value = fn()
            if value:
                return value
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit(f"timed out waiting for {what}")


def shoot(page, name: str, **kw) -> None:
    for scheme in ("light", "dark"):
        page.emulate_media(color_scheme=scheme)
        page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"{name}-{scheme}.png"), **kw)
        print("wrote", f"{name}-{scheme}.png")


def main() -> None:
    if not shutil.which("qpdf"):
        raise SystemExit("qpdf is needed on PATH (brew install qpdf / apt install qpdf)")
    OUT.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="payroll-shots-"))
    excel, zpath, csv, guide = build_demo_files(work)

    smtp = socketserver.ThreadingTCPServer(("127.0.0.1", SMTP_PORT), FakeSmtp)
    smtp.daemon_threads = True
    threading.Thread(target=smtp.serve_forever, daemon=True).start()

    env = {**os.environ, "PORT": str(PORT), "DATA_DIR": str(work / "data"),
           "SMTP_HOST_ALLOWLIST": "*", "NODE_ENV": "development"}
    server = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for(lambda: api("GET", "/api/config") is not None, "the server")
        api("POST", "/api/settings", {
            "smtp_host": "127.0.0.1", "smtp_port": SMTP_PORT, "smtp_secure": False,
            "smtp_user": "payroll@example.com", "smtp_pass": "demo-app-password",
            "from_email": "payroll@example.com", "from_name": "Payroll Team", "daily_limit": 1800,
        })

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1, locale="en-GB",
                                      timezone_id="Europe/London")
            page = ctx.new_page()

            # A finished campaign first, so the Sends list has history.
            page.goto(BASE + "/")
            page.fill("input[name=name]", "Benefits guide 2026")
            page.fill("input[name=subject]", "Your 2026 benefits guide, {name}")
            page.fill("textarea[name=body]", "Hi {name},\n\nThe 2026 benefits guide is attached.\n\nBest regards,\nThe Payroll Team")
            page.set_input_files("#recipientsFile", str(csv))
            page.set_input_files("#attachmentFile", str(guide))
            page.fill("input[name=batch_interval_seconds]", "0")
            page.click("#createBtn")
            wait_for(lambda: all(c["status"] == "completed" for c in api("GET", "/api/campaigns")),
                     "the demo campaign to finish")

            # Screen 2: settings dialog, filled with the values a Gmail setup uses (never saved).
            page.goto(BASE + "/")
            page.click("#settingsBtn")
            page.wait_for_selector("#settingsDialog[open]")
            form = page.locator("#settingsForm")
            form.locator("[name=smtp_host]").fill("smtp.gmail.com")
            form.locator("[name=smtp_port]").select_option("465")
            form.locator("[name=smtp_user]").fill("payroll@example.com")
            form.locator("[name=smtp_pass]").fill("abcdabcdabcdabcd")
            shoot(page, "settings")
            page.click("#settingsClose")

            # Screen 1: the new-send form, filled in.
            page.goto(BASE + "/")
            page.fill("input[name=name]", "June announcement")
            page.fill("input[name=subject]", "Your June update, {name}")
            page.fill("textarea[name=body]", "Hi {name},\n\nThe June update for {department} is attached.\n\nBest regards,\nThe Payroll Team")
            page.set_input_files("#recipientsFile", str(csv))
            page.set_input_files("#attachmentFile", str(guide))
            page.evaluate("window.scrollTo(0, 0)")
            shoot(page, "campaign-new")

            # Payslip wizard.
            page.goto(BASE + "/payslips.html")
            page.set_input_files("#excelFile", str(excel))
            page.set_input_files("#zipFile", str(zpath))
            shoot(page, "payslips-upload")
            page.click("#prepareBtn")
            page.wait_for_selector("#step2", state="visible", timeout=60000)
            page.wait_for_timeout(300)
            shoot(page, "payslips-review", full_page=True)
            page.click("#sendSetupBtn")
            page.wait_for_selector("#step3", state="visible")
            page.fill("#campaignName", "Payslips August 2026")
            page.fill("#emailSubject", "Your August 2026 payslip")
            page.fill("#emailBody", "Dear {name},\n\nYour August 2026 payslip is attached. The PDF is protected with your NI number.\n\nKind regards,\nPayroll")
            page.fill("#batchSize", "6")
            page.fill("#batchInterval", "3600")
            shoot(page, "payslips-send", full_page=True)
            page.click("#sendBtn")

            def first_batch_done():
                for c in api("GET", "/api/campaigns"):
                    if c["name"] == "Payslips August 2026":
                        s = api("GET", f"/api/campaigns/{c['id']}")["stats"]
                        return s["sent"] == 6
                return False
            wait_for(first_batch_done, "the first payslip batch")

            # Screen 3: the Sends list, one run mid-way.
            page.goto(BASE + "/")
            page.wait_for_selector(".campaign")
            page.evaluate("document.querySelector('#campaignList').scrollIntoView()")
            shoot(page, "campaign-progress")
            browser.close()
    finally:
        server.terminate()
        smtp.shutdown()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
