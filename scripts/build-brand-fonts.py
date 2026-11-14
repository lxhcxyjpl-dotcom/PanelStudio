"""Rebuild UI-only Latin WOFF2 files from checksum-pinned OFL sources.

Requires fonttools[woff], brotli. Pass --sources-dir to use the downloaded TTFs.
Does not modify the Noto fonts used to measure or export scientific artwork.
"""
from pathlib import Path
from io import BytesIO
import argparse
import hashlib
import json
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Options, Subsetter

root = Path(__file__).resolve().parents[1]
dest = root / 'apps/web/public/brand-fonts'
parser = argparse.ArgumentParser()
parser.add_argument('--sources-dir', type=Path)
args = parser.parse_args()
sources = json.loads((dest / 'sources.json').read_text(encoding='utf-8'))
fonts = {}
for source in sources:
    data = (args.sources_dir / (source['family'] + '.ttf')).read_bytes() if args.sources_dir else urllib.request.urlopen(source['source'], timeout=30).read()
    if hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError('Upstream font changed: ' + source['family'])
    fonts[source['family']] = data

specs = [
    ('Newsreader', {'opsz': 56, 'wght': (400, 500)}, 'Newsreader-latin.woff2'),
    ('Inter', {'opsz': 14, 'wght': 400}, 'Inter-latin.woff2'),
    ('Inter', {'opsz': 14, 'wght': 500}, 'Inter-medium.woff2'),
    ('Inter', {'opsz': 14, 'wght': 600}, 'Inter-semibold.woff2'),
    ('GeistMono', {'wght': 400}, 'GeistMono-latin.woff2'),
]
unicodes = set(range(0x20, 0x250)) | set(range(0x2000, 0x2070)) | set(range(0x2190, 0x2200)) | {0x2212}
output = []
for family, axes, name in specs:
    font = TTFont(BytesIO(fonts[family]), recalcTimestamp=False)
    instantiateVariableFont(font, axes, inplace=True)
    options = Options()
    options.name_IDs = ['*']; options.name_legacy = True; options.name_languages = ['*']
    subset = Subsetter(options=options); subset.populate(unicodes=unicodes); subset.subset(font)
    font.flavor = 'woff2'; font.save(dest / name)
    data = (dest / name).read_bytes()
    output.append({'file': name, 'family': family, 'axes': axes, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(dest / 'build.json').write_text(json.dumps({'unicode_ranges':['0020-024F','2000-206F','2190-21FF','2212'], 'outputs':output, 'total_bytes':sum(item['bytes'] for item in output)}, indent=2)+'\n', encoding='utf-8')
print(json.dumps(output, indent=2))
