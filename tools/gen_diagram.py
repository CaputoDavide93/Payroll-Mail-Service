#!/usr/bin/env python3
"""Draw every diagram in this repository as SVG, one file per colour scheme.

  docs/assets/<name>-light.svg
  docs/assets/<name>-dark.svg

These replace the Mermaid flowchart the README used to carry. GitHub renders
Mermaid with its own version and its own theme, decodes HTML entities before
parsing, and lays the graph out however it likes. Drawn here, each picture says
one thing and stays put.

**GitHub sanitises SVG in markdown**, so there is no <style>, no <script>, no
web font and no <foreignObject>. Everything is a presentation attribute and the
type is a system stack. Each pair is served from one <picture>, which GitHub
switches on prefers-color-scheme.

Layout is explicit rather than solved: the diagrams are small enough that
placing them by hand is cheaper than a layout engine nobody can predict.

House rules: a slate scale, a single accent on the one thing that matters in
each picture, drawn icons rather than emoji, monospace for anything that is
literally typed (paths, endpoints, env vars), a footer sentence under every
diagram, and text contrast at or above 4.5:1 in both schemes.

The app is Node; this script needs only the Python standard library. Run it
after changing a diagram (python3 tools/gen_diagram.py) and commit the SVGs it
writes; test/diagrams.test.js checks the pages that embed them.
"""
from __future__ import annotations

import pathlib
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parents[1]
SANS = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace"

SCHEMES = {
    "light": dict(card="#ffffff", border="#d8dee4", title="#0f172a", sub="#5b6673",
                  accent="#2b59c3", on_accent="#ffffff", soft="#f1f4f9",
                  line="#94a3b8", rule="#e6e9ee", chip="#475569",
                  warn="#9a3412", warn_soft="#fff4ed", group="#f7f9fb"),
    "dark":  dict(card="#161b22", border="#30363d", title="#e6edf3", sub="#9aa4b0",
                  accent="#4c7ef3", on_accent="#ffffff", soft="#1b2230",
                  line="#6b7684", rule="#232a33", chip="#aeb7c2",
                  warn="#ffa657", warn_soft="#2a1d14", group="#11151b"),
}

# Stroked glyphs on a 24x24 grid, drawn rather than typed.
ICONS = {
    "user":     "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7",
    "screen":   "M3 4h18v12H3z M8 20h8 M12 16v4 M7 12l3-3 2 2 4-4",
    "server":   "M4 4h16v7H4z M4 13h16v7H4z M8 7.5h1 M8 16.5h1",
    "database": "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 "
                "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    "mail":     "M3 5h18v14H3z M3 6l9 7 9-7",
    "file":     "M6 3h8l4 4v14H6z M14 3v4h4 M9 13h6 M9 17h4",
    "sparkle":  "M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9z "
                "M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z",
    "lock":     "M6 11h12v10H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    "key":      "M8 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h9 M18 12v3 M15 12v2",
    "package":  "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
    "globe":    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 "
                "M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
    "terminal": "M3 5h18v14H3z M7 10l3 2.5L7 15 M12 15h5",
    "shield":   "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z M9 12l2 2 4-4",
    "rewind":   "M11 6 4 12l7 6z M20 6l-7 6 7 6z",
}


class Canvas:
    """Parts plus a size. No layout engine, on purpose."""

    def __init__(self, w: int, h: int, scheme: str, label: str) -> None:
        self.w, self.h, self.c, self.label = w, h, SCHEMES[scheme], label
        self.parts: list[str] = []

    def add(self, *svg: str) -> "Canvas":
        self.parts.extend(svg)
        return self

    # ── primitives ────────────────────────────────────────────────────────
    def icon(self, name, x, y, colour, size=21):
        s = size / 24
        return (f'<g transform="translate({x:.1f},{y:.1f}) scale({s:.4f})" fill="none" '
                f'stroke="{colour}" stroke-width="1.7" stroke-linecap="round" '
                f'stroke-linejoin="round"><path d="{ICONS[name]}"/></g>')

    def text(self, x, y, s, *, size=13, colour=None, font=None, weight=None,
             anchor="start", opacity=None):
        c = colour or self.c["sub"]
        extra = (f' font-weight="{weight}"' if weight else "") + \
                (f' opacity="{opacity}"' if opacity else "")
        return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{font or SANS}" '
                f'font-size="{size}" fill="{c}" text-anchor="{anchor}"{extra}>'
                f'{escape(s)}</text>')

    def box(self, x, y, w, h, title, subs=(), *, icon=None, tone="plain", rx=10):
        c = self.c
        fill, edge, tt = c["card"], c["border"], c["title"]
        st, op = c["sub"], ""
        if tone == "accent":
            fill = edge = c["accent"]; tt = st = c["on_accent"]; op = "0.85"
        elif tone == "soft":
            fill = c["soft"]
        elif tone == "warn":
            fill, edge, tt, st = c["warn_soft"], c["warn"], c["warn"], c["warn"]
        out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
               f'stroke="{edge}" stroke-width="1"/>']
        tx = x + 16
        ty = y + (28 if subs else h / 2 + 5)
        if icon:
            out.append(self.icon(icon, x + 16, y + (13 if subs else h / 2 - 10), tt))
            tx = x + 47
        out.append(self.text(tx, ty, title, size=15 if subs else 14,
                             colour=tt, weight="600"))
        for i, s in enumerate(subs):
            out.append(self.text(x + 16, y + 52 + i * 18, s, size=12.5,
                                 colour=st, opacity=op or None))
        return "".join(out)

    def diamond(self, cx, cy, w, h, lines):
        c = self.c
        pts = f"{cx},{cy - h/2} {cx + w/2},{cy} {cx},{cy + h/2} {cx - w/2},{cy}"
        out = [f'<polygon points="{pts}" fill="{c["soft"]}" stroke="{c["border"]}" '
               f'stroke-width="1"/>']
        n = len(lines)
        for i, s in enumerate(lines):
            out.append(self.text(cx, cy - (n - 1) * 7 + i * 14 + 4, s, size=12,
                                 colour=c["title"], anchor="middle"))
        return "".join(out)

    def pill(self, cx, cy, text, *, tone="plain", pad=16, size=13):
        c = self.c
        w = len(text) * size * 0.58 + pad * 2
        h = 32
        fill, edge, col = c["card"], c["border"], c["title"]
        if tone == "accent":
            fill = edge = c["accent"]; col = c["on_accent"]
        elif tone == "soft":
            fill = c["soft"]
        return (f'<rect x="{cx - w/2:.1f}" y="{cy - h/2}" width="{w:.1f}" height="{h}" '
                f'rx="{h/2}" fill="{fill}" stroke="{edge}" stroke-width="1"/>'
                + self.text(cx, cy + 4.5, text, size=size, colour=col, anchor="middle",
                            weight="500")), w

    def edge(self, pts, *, label=None, dash=False, both=False, label_at=0.5,
             label_dy=-9, label_anchor="middle", mono=True):
        c = self.c
        d = ' stroke-dasharray="5 4"' if dash else ""
        path = " ".join(f"{x},{y}" for x, y in pts)
        out = [f'<polyline points="{path}" fill="none" stroke="{c["line"]}" '
               f'stroke-width="1.5"{d} marker-end="url(#a)"'
               + (' marker-start="url(#a)"' if both else "") + "/>"]
        if label:
            (x1, y1), (x2, y2) = pts[0], pts[-1]
            lx = x1 + (x2 - x1) * label_at
            ly = y1 + (y2 - y1) * label_at
            out.append(self.text(lx, ly + label_dy, label, size=11.5,
                                 colour=c["chip"], font=MONO if mono else SANS,
                                 anchor=label_anchor))
        return "".join(out)

    def group(self, x, y, w, h, title):
        c = self.c
        return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" '
                f'fill="{c["group"]}" stroke="{c["border"]}" stroke-width="1" '
                f'stroke-dasharray="6 5"/>'
                + self.text(x + 18, y + 24, title, size=12, colour=c["sub"],
                            weight="600"))

    def footer(self, note):
        return (f'<line x1="24" y1="{self.h - 52}" x2="{self.w - 24}" y2="{self.h - 52}" '
                f'stroke="{self.c["rule"]}" stroke-width="1"/>'
                + self.text(24, self.h - 26, note, size=12.5, colour=self.c["sub"]))

    def render(self) -> str:
        c = self.c
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}" role="img" aria-label="{escape(self.label)}">'
            f'<defs>'
            f'<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
            f'markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0 0 10 5 0 10z" fill="{c["line"]}"/></marker>'
            f'</defs>' + "".join(self.parts) + "</svg>"
        )


# ── the diagrams ──────────────────────────────────────────────────────────

def architecture(scheme):
    """One Node process, one SQLite file. The send loop is what survives."""
    k = Canvas(1180, 440, scheme,
               "The browser talks to the Express API in a single Node process. The API keeps "
               "settings, campaigns and recipients in SQLite under DATA_DIR and hands payslip "
               "preparation to a worker thread, which can ask the Anthropic API to match PDFs and "
               "encrypts each one with qpdf. A send loop claims batches from SQLite and sends "
               "them over SMTP.")
    c = k.c
    ax, bx, w = 276, 596, 238
    r1, r2, h = 84, 236, 84
    k.add(
        k.group(252, 40, 606, 304, "ONE NODE PROCESS"),
        k.box(24, r1, 180, h, "Browser", ["campaigns and", "payslips pages"], icon="screen"),
        k.box(ax, r1, w, h, "Express API", ["the UI and /api routes,", "APP_PASSWORD gate"],
              icon="server"),
        k.box(bx, r1, w, h, "DATA_DIR", ["SQLite: campaigns, recipients,", "settings; payslip PDFs"],
              icon="database"),
        k.box(ax, r2, w, h, "Payslip thread", ["matches PDFs to people,", "encrypts each with qpdf"],
              icon="lock"),
        k.box(bx, r2, w, h, "Send loop", ["every 2 s: claims a batch,", "keeps to the daily cap"],
              icon="mail", tone="accent"),
        k.box(24, r2, 180, h, "Anthropic API", ["name matching,", "optional"], icon="sparkle"),
        k.box(930, r2, 226, h, "SMTP server", ["Gmail or Workspace,", "App Password"], icon="mail"),
        k.edge([(204 + 8, r1 + h / 2), (ax - 8, r1 + h / 2)], label="/api", label_at=0.3),
        k.edge([(ax + w + 8, r1 + h / 2), (bx - 8, r1 + h / 2)], both=True),
        k.edge([(ax + w / 2, r1 + h + 8), (ax + w / 2, r2 - 8)]),
        k.text(ax + w / 2 + 12, (r1 + h + r2) / 2 + 4, "/api/payslips/prepare", size=11.5,
               font=MONO, colour=c["chip"]),
        k.edge([(ax - 8, r2 + h / 2), (204 + 8, r2 + h / 2)], dash=True),
        k.edge([(bx + w / 2, r1 + h + 8), (bx + w / 2, r2 - 8)]),
        k.text(bx + w / 2 + 12, (r1 + h + r2) / 2 + 4, "claim batch", size=11.5, font=MONO,
               colour=c["chip"]),
        k.edge([(bx + w + 8, r2 + h / 2), (930 - 8, r2 + h / 2)]),
        k.footer("The browser can close at any time: the send loop takes its queue from SQLite, "
                 "so a restart resumes where it stopped."),
    )
    return k.render()


def aws_deployment(scheme):
    """The Terraform deployment: one instance, reachable from the office only."""
    k = Canvas(1180, 608, scheme,
               "An office browser reaches nginx on one EC2 instance over HTTPS; nginx proxies to "
               "the app container. Secrets Manager supplies the .env at boot. ./deploy.sh pushes "
               "the image to ECR and tells the instance over SSM to run payroll-update, which "
               "pulls the tag, health-checks it and rolls back on failure. payroll-cert keeps the "
               "Let's Encrypt certificate current using a Route53 DNS-01 challenge.")
    c = k.c
    ax, bx, w = 354, 616, 210
    r1, r2 = 84, 240
    k.add(
        k.group(330, 40, 520, 332, "EC2 INSTANCE, AMAZON LINUX 2023"),
        k.box(ax, r1, w, 84, "nginx", ["TLS on 443,", "80 redirects to 443"], icon="shield"),
        k.box(bx, r1, w, 84, "App container", ["SQLite and payslips on", "the mail-data volume"],
              icon="package", tone="accent"),
        k.box(ax, r2, w, 100, "payroll-cert", ["issues and renews the", "certificate, twice daily"],
              icon="lock"),
        k.box(bx, r2, w, 100, "payroll-update", ["pulls a tag, health-checks,", "rolls back on failure"],
              icon="rewind"),
        k.edge([(ax + w + 8, r1 + 42), (bx - 8, r1 + 42)], label=":3000"),
        k.edge([(ax + w / 2, r2 - 8), (ax + w / 2, r1 + 84 + 8)]),
        k.text(ax + w / 2 + 12, (r1 + 84 + r2) / 2 + 4, "certificate", size=11.5, font=MONO,
               colour=c["chip"]),
        k.edge([(bx + w / 2, r2 - 8), (bx + w / 2, r1 + 84 + 8)]),
        k.text(bx + w / 2 + 12, (r1 + 84 + r2) / 2 + 4, "restarts", size=11.5, font=MONO,
               colour=c["chip"]),
        # Outside the box, left: who comes in, and who vouches for the certificate.
        k.box(24, r1, 226, 84, "Office browser", ["office CIDRs only,", "no SSH at all"], icon="user"),
        k.edge([(250 + 8, r1 + 42), (ax - 8, r1 + 42)], label=":443"),
        k.box(24, r2, 226, 100, "Let's Encrypt", ["issues the certificate", "for domain_name"],
              icon="shield"),
        k.edge([(ax - 8, r2 + 50), (250 + 8, r2 + 50)], label="DNS-01"),
        # Right: what the instance pulls from.
        k.box(940, r1, 216, 84, "Secrets Manager", ["app config, written", "to .env at boot"],
              icon="key"),
        k.edge([(940 - 8, r1 + 42), (bx + w + 8, r1 + 42)], dash=True),
        k.box(940, r2, 216, 100, "ECR", ["scan on push; keeps", ":latest and :base"], icon="package"),
        k.edge([(940 - 8, r2 + 50), (bx + w + 8, r2 + 50)], label="pull"),
    )
    by = 432
    k.add(
        k.box(24, by, 226, 84, "Route53", ["A record to the Elastic IP,", "TXT for the challenge"],
              icon="globe"),
        k.edge([(ax + w / 2, r2 + 100 + 8), (ax + w / 2, by + 42), (250 + 8, by + 42)]),
        k.text(ax + w / 2 - 12, by + 33, "TXT record", size=11.5, font=MONO, colour=c["chip"],
               anchor="end"),
        k.box(940, by, 216, 84, "./deploy.sh", ["builds and pushes,", "then rolls the instance"],
              icon="terminal"),
        k.edge([(1048, by - 8), (1048, r2 + 100 + 8)]),
        k.text(1036, by - 26, "push :sha, :latest, :base", size=11.5, font=MONO, colour=c["chip"], anchor="end"),
        k.edge([(940 - 8, by + 42), (bx + w / 2, by + 42), (bx + w / 2, r2 + 100 + 8)]),
        k.text(bx + w / 2 + 12, by + 33, "SSM: payroll-update <sha>", size=11.5, font=MONO,
               colour=c["chip"]),
        k.footer("Only the office reaches the instance, on 443 and 80. Releases arrive over SSM, "
                 "not SSH, and one that fails its health check rolls itself back."),
    )
    return k.render()


DIAGRAMS = {
    "architecture": architecture,
    "aws-deployment": aws_deployment,
}


def main() -> None:
    out = ROOT / "docs" / "assets"
    out.mkdir(parents=True, exist_ok=True)
    for name, fn in DIAGRAMS.items():
        for scheme in SCHEMES:
            path = out / f"{name}-{scheme}.svg"
            path.write_text(fn(scheme), encoding="utf-8")
    print(f"{len(DIAGRAMS)} diagrams x {len(SCHEMES)} schemes -> docs/assets/")


if __name__ == "__main__":
    main()
