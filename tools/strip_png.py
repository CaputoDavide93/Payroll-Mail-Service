#!/usr/bin/env python3
"""Drop every ancillary chunk (text, time, colour profile, EXIF) from the PNGs given.

Keeps only the chunks a decoder needs: IHDR, PLTE, IDAT, IEND, tRNS. Run by
`make screenshots` and `make social-preview` so no metadata ships in the repo.
"""
import struct
import sys
from pathlib import Path

KEEP = {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS"}
SIGNATURE = b"\x89PNG\r\n\x1a\n"


def strip(path: Path) -> bool:
    data = path.read_bytes()
    if not data.startswith(SIGNATURE):
        raise SystemExit(f"{path}: not a PNG")
    out, pos = [SIGNATURE], len(SIGNATURE)
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + length
        if kind in KEEP:
            out.append(data[pos:end])
        pos = end
    result = b"".join(out)
    if result == data:
        return False
    path.write_bytes(result)
    return True


if __name__ == "__main__":
    changed = sum(strip(Path(p)) for p in sys.argv[1:])
    print(f"stripped metadata from {changed} of {len(sys.argv) - 1} files")
