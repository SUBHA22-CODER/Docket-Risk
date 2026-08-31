import json
import re

with open("dashboard/index.html", encoding="utf-8") as fh:
    html = fh.read()
m = re.search(r"const GRAPH = (\{.*?\});\n", html, re.DOTALL)
g = json.loads(m.group(1))
idents = [n for n in g["nodes"] if n["kind"] == "ident"]
infra = [n for n in g["nodes"] if n["kind"] == "infra"]
print(f"graph nodes: {len(g['nodes'])} ({len(idents)} identities, {len(infra)} infra), edges: {len(g['edges'])}")
