"""Split the planning prototype into a public web app and private data.

Run from the project folder whenever a new factory_planning_v20*.html arrives:

    python3 scripts/prepare_source.py "factory_planning_v20 (1).html"

Outputs
  public/index.html                    safe to commit (no planning data)
  supabase/seed_baseline.private.sql   PRIVATE, git-ignored; run in Supabase SQL Editor
"""
import base64
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "factory_planning_v20 (1).html")
html = src.read_text(encoding="utf-8")


def take(pattern, repl=""):
    """Replace exactly one regex match and return the match."""
    global html
    m = re.search(pattern, html, flags=re.S)
    if not m:
        raise SystemExit(f"Pattern not found: {pattern[:60]}")
    html = html[: m.start()] + repl + html[m.end():]
    return m


def js_literal(name):
    """Remove `const NAME=<literal>;` and return the literal text (bracket-matched)."""
    global html
    m = re.search(r"const\s+" + name + r"\s*=\s*([\[{])", html)
    if not m:
        raise SystemExit(f"const {name} not found")
    i, depth, q, j = m.end() - 1, 0, None, m.end() - 1
    while j < len(html):
        c = html[j]
        if q:
            if c == "\\":
                j += 2
                continue
            if c == q:
                q = None
        elif c in "\"'`":
            q = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    literal = html[i : j + 1]
    end = j + 1
    if html[end : end + 1] == ";":
        end += 1
    html = html[: m.start()] + html[end:]
    return literal


def js_to_json(literal):
    """The factory list uses unquoted keys; quote them so json can parse it."""
    return json.loads(re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', literal))


# 1. Main dataset (6 workbook sheets) -------------------------------------
baseline_b64 = take(r'const EMBEDDED_GZ_B64="([^"]+)";',
                    "/* Planning data is fetched after Supabase authentication. */").group(1)
s = html.index("function loadEmbedded(){")
e = html.index("\nconst pages=[];", s)
fname = re.search(r"textContent='([^'(]+?)\s*(?:\(|')", html[s:e])
sheet_name = fname.group(1).strip() if fname else "baseline.xlsx"
html = html[:s] + html[e:]
take(re.escape("if(typeof pako!=='undefined')loadEmbedded();"),
     "/* Data loading is handled by cloud.js after authentication. */")

# 2. Factory master data hard-coded in the code ----------------------------
factories = js_to_json(js_literal("F"))
ybase = json.loads(js_literal("YBASE"))
js_literal("YPERFAC")  # unused by the app; removed so it is not published
spec_hol = json.loads(js_literal("SPEC_HOL"))

# Turn the three load-time `F.forEach(...)` initialisers into one function that
# cloud.js calls after login. Constant declarations in between stay where they are.
init_start = html.index("  F.forEach(f=>{f.days=DAYS.map(")
hol_start = html.index("  F.forEach(f=>{\n    f.specHol = (SPEC_HOL[")
init_end = html.index("\n  });", hol_start) + len("\n  });")
segment = html[init_start:init_end].split("\n")
loops, keep, in_loop, depth = [], [], False, 0
for line in segment:
    if line.startswith("  F.forEach("):
        in_loop, depth = True, 0
    (loops if in_loop else keep).append(line)
    if in_loop:
        code = re.sub(r"//.*$", "", re.sub(r"\"[^\"]*\"|'[^']*'", "", line))
        depth += code.count("(") + code.count("{") - code.count(")") - code.count("}")
        if depth == 0:
            in_loop = False
assert not in_loop and sum(l.startswith("  F.forEach(") for l in loops) == 3, "factory init loops changed shape"
loader = "\n".join(
    keep
    + ["  const F=[];",
       "  function loadFactoryMaster(M){",
       "    const YBASE=M.ybase, SPEC_HOL=M.specHol;",
       "    F.length=0; M.factories.forEach(x=>F.push({...x}));"]
    + ["  " + l for l in loops]
    + ["  }"]
)
html = html[:init_start] + loader + html[init_end:]
assert html.count("const F=[];") == 1

# 3. Demo login -> Supabase login -----------------------------------------
login = html.rindex("<script>\n(function(){")
if "pfp_accounts_v1" not in html[login:]:
    raise SystemExit("Demo login block not found")
html = html[:login] + (
    '<script src="/vendor/supabase.js"></script>\n'
    '<script src="/config.js"></script>\n'
    '<script src="/cloud.js"></script>\n</body>\n</html>\n'
)
take(re.escape("window.IW={"), """window.IW={
    loadFactoryMaster,
    exportCloudState(){ return {factories:F,generated}; },
    importCloudState(state){
      if(!state || !Array.isArray(state.factories))return;
      state.factories.forEach(saved=>{const f=F.find(x=>x.id===saved.id);if(f)Object.assign(f,saved);});
      generated=!!state.generated;
    },""")

# 4. Safety check: nothing large and data-like left behind -----------------
for name in ("EMBEDDED_GZ_B64", "YPERFAC", "SPEC_HOL={", "H4sI"):
    assert name not in html, f"{name} still present in public build"
assert not re.search(r"\{id:\d+,name:\"", html), "factory list still present in public build"
assert not re.search(r"\[(?:\s*-?\d+\.\d+\s*,){15,}", html), "array of figures left in build"

(ROOT / "public").mkdir(exist_ok=True)
(ROOT / "public/index.html").write_text(html, encoding="utf-8")

# 5. Private seed SQL --------------------------------------------------------
master_b64 = base64.b64encode(gzip.compress(json.dumps(
    {"factories": factories, "ybase": ybase, "specHol": spec_hol},
    ensure_ascii=False).encode("utf-8"))).decode()
sheet_name = re.sub(r"[^\w.\- ()]", "", sheet_name)
sql = f"""-- PRIVATE: real planning data. Never commit. Generated from {src.name}
-- Run in Supabase SQL Editor AFTER supabase/migrations/*.sql
insert into public.supply_datasets (id, name, payload_gzip, updated_at) values
 ('baseline', '{sheet_name}', '{baseline_b64}', now()),
 ('master',   'factory master', '{master_b64}', now())
on conflict (id) do update set name=excluded.name, payload_gzip=excluded.payload_gzip, updated_at=now();
"""
(ROOT / "supabase").mkdir(exist_ok=True)
(ROOT / "supabase/seed_baseline.private.sql").write_text(sql, encoding="utf-8")
print(f"public/index.html: {len(html):,} chars (no planning data)")
print(f"seed: {len(factories)} factories, {len(spec_hol)} holiday lists, baseline {len(baseline_b64):,} b64 chars")
