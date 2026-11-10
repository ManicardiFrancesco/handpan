#!/usr/bin/env python3
"""Rebuild compact geometry from Ayasa's public model definitions.

Pass a directory of downloaded *.model.json files. No rendering code or audio
files are copied. The derived data includes every field's source shape and
contours, plus the original shell profiles.
"""
import argparse
import base64
import json
import struct
from pathlib import Path


def compact(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: compact(v) for key, v in value.items()}
    if isinstance(value, list):
        return [compact(v) for v in value]
    return value


def pack(points, floating=False):
    values = [v if floating else round(v * 100) for point in points for v in point]
    return base64.b64encode(struct.pack('<' + ('f' if floating else 'h') * len(values), *values)).decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--date', default='2026-11-10')
    args = parser.parse_args()
    models = {}
    for path in sorted(args.directory.glob('*.model.json')):
        source = json.loads(path.read_text())
        top, bottom = [source['shells'][side]['profile'] for side in ('top', 'bottom')]
        models[path.name.removesuffix('.model.json')] = {
            'radius': source['meta']['rimRadius'],
            'rimZ': (top[-1][1] + bottom[-1][1]) / 2,
            'shells': {side: pack(source['shells'][side]['profile'], True) for side in ('top', 'bottom')},
            'fields': [{
                **{key: f.get(key) for key in ('note', 'side', 'type', 'drawn', 'centre', 'ellipse',
                    'plane', 'frame', 'h1', 'tier1', 'tier2', 'dimple')},
                'boundary': pack(f['boundary']), 'inner': pack(f.get('inner', [])),
            } for f in source['fields']],
        }
    if not models:
        parser.error('No model definitions found.')
    text = f'// Published Ayasa geometry, retrieved {args.date}. Coordinates in mm.\n'
    text += '// Contours: int16 pairs at 0.01 mm. Shell profiles: float32 mm pairs.\nexport const GEOMETRY_DATA = {\n'
    text += ',\n'.join(json.dumps(key) + ':' + json.dumps(compact(value), separators=(',', ':')) for key, value in models.items())
    text += '\n};\n'
    target = Path(__file__).resolve().parent.parent / 'geometry-data.mjs'
    target.write_text(text)
    print(f'{len(models)} models, {sum(len(m["fields"]) for m in models.values())} fields, {len(text)} bytes.')


if __name__ == '__main__':
    main()
