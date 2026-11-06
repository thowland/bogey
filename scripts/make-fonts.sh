#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds the self-hosted overlay fonts (spec §1, §7.2): Liberation Sans Regular and Bold 2.1.5
# (SIL OFL 1.1), metrically compatible with Helvetica, subset to WinAnsi (Windows-1252) since
# export uses the standard Helvetica font, which encodes nothing else (E4).
#
#   scripts/make-fonts.sh <dir containing LiberationSans-{Regular,Bold}.ttf>
#
# Needs fonttools and brotli (`pip install fonttools brotli`). Source:
# https://github.com/liberationfonts/liberation-fonts/releases (liberation-fonts-ttf-2.1.5.tar.gz,
# sha256 7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0).
set -euo pipefail
cd "$(dirname "$0")/.."
src="$1"
out="apps/web/src/assets/fonts"
# Every printable Windows-1252 character, as Unicode code points.
unicodes="$(python3 -c "
cps = set()
for b in list(range(0x20, 0x7f)) + list(range(0x80, 0x100)):
    try:
        cps.add(ord(bytes([b]).decode('cp1252')))
    except UnicodeDecodeError:
        pass
print(','.join('U+%04X' % c for c in sorted(cps)))
")"
for weight in Regular Bold; do
  pyftsubset "$src/LiberationSans-$weight.ttf" --unicodes="$unicodes" --flavor=woff2 \
    --layout-features='kern,liga' --output-file="$out/LiberationSans-$weight.woff2"
done
ls -l "$out"
