/**
 * Holds a rendered slip against the client's artwork and shows where they
 * disagree.
 *
 *   node scripts/diff-slip.mjs <rendered.png> <reference.jpg> <out-prefix>
 *
 * The client's standard is "no difference tolerated", which is not a thing an
 * opinion can check. This scales both to the same A5 page, writes a red/green
 * overlay (red = only in the reference, green = only in ours) and a strip of
 * the worst rows, so a drift of half a millimetre is visible rather than
 * argued about.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [rendered, reference, prefix = 'slip-diff'] = process.argv.slice(2);
if (!rendered || !reference) {
  console.error('usage: diff-slip.mjs <rendered.png> <reference.jpg> [out-prefix]');
  process.exit(1);
}

const script = `
import sys
from PIL import Image, ImageChops, ImageOps

rendered, reference, prefix = sys.argv[1], sys.argv[2], sys.argv[3]

ref = Image.open(reference).convert('L')
ours = Image.open(rendered).convert('L')

# One common page. The reference is the smaller of the two, so both go up to
# its width x the A5 ratio -- comparing at the reference's own resolution
# avoids inventing detail that is not in it.
W = ref.width
H = round(W * 210 / 148)
ref = ref.resize((W, H), Image.LANCZOS)
ours = ours.resize((W, H), Image.LANCZOS)

# Ink is dark on both; threshold so antialiasing and JPEG mush do not count.
ref_ink = ref.point(lambda v: 255 if v < 170 else 0)
our_ink = ours.point(lambda v: 255 if v < 170 else 0)

only_ref = ImageChops.subtract(ref_ink, our_ink)
only_our = ImageChops.subtract(our_ink, ref_ink)

overlay = Image.merge('RGB', [
    ImageOps.invert(only_our),          # red where only ours has ink
    ImageOps.invert(only_ref),          # green where only the reference has
    ImageOps.invert(ImageChops.lighter(only_ref, only_our)),
])
overlay.save(prefix + '-overlay.png')

side = Image.new('RGB', (W * 2 + 12, H), 'white')
side.paste(ref.convert('RGB'), (0, 0))
side.paste(ours.convert('RGB'), (W + 12, 0))
side.save(prefix + '-side.png')

# Where the disagreement is, band by band, in design pixels (560 x 794).
rows = []
band = max(1, H // 40)
for top in range(0, H, band):
    box = (0, top, W, min(H, top + band))
    diff = sum(ImageChops.lighter(only_ref, only_our).crop(box).point(lambda v: 1 if v > 0 else 0).getdata())
    rows.append((diff, round(top * 794 / H), round(min(H, top + band) * 794 / H)))

total = sum(r[0] for r in rows) or 1
print(f'ink disagreement: {total} px over {W}x{H}')
for diff, a, b in sorted(rows, reverse=True)[:8]:
    print(f'  design y {a:>4}-{b:<4}  {diff:>7} px  {100*diff/total:5.1f}%')
`;

const tmp = `/tmp/slip-diff-${process.pid}.py`;
writeFileSync(tmp, script);
execFileSync('python3', [tmp, rendered, reference, prefix], { stdio: 'inherit' });
