import sys, os
sys.path.insert(0, os.path.abspath("."))
from src.score_service import CLAIMS_STORE

res = CLAIMS_STORE.list_claims('all', None, None, None, None, 'score', 'desc', 1, 5000)
rows = res['items']
header = ["claim_id","ts","identity_key","merchant_id","category","amount","score","risk_level","action","status","assigned_to"]
csv_rows = []
for r in rows:
    csv_rows.append(",".join(['"' + str(r.get(k, '') if r.get(k) is not None else '').replace('"', '""') + '"' for k in header]))

csv_content = "\r\n".join([",".join(['"' + h + '"' for h in header])] + csv_rows)

out_file = "test_export.csv"
with open(out_file, "w", encoding="utf-8-sig", newline="") as f:
    f.write(csv_content)

print(f"Generated {out_file}: {len(rows)} rows, {os.path.getsize(out_file)} bytes")
print("First 3 rows:")
with open(out_file, "r", encoding="utf-8-sig") as f:
    for i in range(4):
        print(f.readline().strip())
