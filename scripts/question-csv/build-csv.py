# Python port of build-csv.ts for sessions where npm cannot install papaparse.
# Same PRNG (IEEE doubles), same answer positions and the same quoted output byte for byte;
# the round trip is checked with Python's csv module instead of Papa.parse.
# usage: python3 scripts/question-csv/build-csv.py <in.mcq.json> <out.csv> <seed>
import json, math, sys, csv, io
inp, out, seed = sys.argv[1], sys.argv[2], float(sys.argv[3]) or 1.0
qs = json.load(open(inp, encoding="utf8"))
def rnd():
    global seed
    seed = math.fmod(seed * 1103515245.0 + 12345.0, 2147483648.0)
    return seed / 2147483648.0
def letters(n):
    while True:
        pool = [i % 4 for i in range(n)]
        for i in range(len(pool) - 1, 0, -1):
            j = math.floor(rnd() * (i + 1)); pool[i], pool[j] = pool[j], pool[i]
        if not any(i >= 2 and x == pool[i-1] and x == pool[i-2] for i, x in enumerate(pool)): return pool
target = letters(len(qs))
H = ["questionText","optionA","optionB","optionC","optionD","correctAnswer","difficulty","explanation"]
rows = []
for i, q in enumerate(qs):
    opts = [o for o in q["options"] if o != q["correctAnswer"]]; opts.insert(target[i], q["correctAnswer"])
    rows.append([q["questionText"], *opts, q["correctAnswer"], q["difficulty"], q["explanation"]])
qf = lambda v: '"' + v.replace('"', '""') + '"'
text = "\n".join(",".join(qf(v) for v in r) for r in [H] + rows) + "\n"
open(out, "w", encoding="utf8", newline="").write(text)
# round trip like the importer
p = list(csv.DictReader(io.StringIO(text)))
bad = []
for i, r in enumerate(p):
    r = {k.strip(): v.strip() for k, v in r.items()}
    o = [r["optionA"], r["optionB"], r["optionC"], r["optionD"]]
    if r["correctAnswer"] not in o or o[target[i]] != qs[i]["correctAnswer"] or sorted(o) != sorted(qs[i]["options"]) or r["questionText"] != qs[i]["questionText"] or r["explanation"] != qs[i]["explanation"]: bad.append(i)
if len(p) != len(qs) or bad: print("ROUND TRIP FAILED", bad); sys.exit(1)
print(f"OK {out.split('/')[-1]}: {len(p)} rows; positions " + " ".join(f"{l}={target.count(k)}" for k, l in enumerate("ABCD")))
