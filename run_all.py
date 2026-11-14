"""One command, end to end:
    python run_all.py --zips "data/zips/*.zip" --weather "data/Weather_Data_Avangrid_Hackathon_.xlsx" \
                      --labels "data/EV_Heat Pump_Solar PV Customers.xlsx"
"""
import argparse, glob, os, subprocess, sys, time
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--zips", default=None, help="glob of AMI zip files")
ap.add_argument("--parquet", default=None, help="glob of already-converted parquet files")
ap.add_argument("--weather", required=True)
ap.add_argument("--labels", required=True, help="EV/HP/PV workbook (xlsx) or labels.csv")
ap.add_argument("--data", default="data")
ap.add_argument("--out", default="outputs")
ap.add_argument("--skip-load", action="store_true", help="reuse data/cube.npz from an earlier run")
a = ap.parse_args()
os.makedirs(a.data, exist_ok=True); os.makedirs(a.out, exist_ok=True)

lab = a.labels
if lab.endswith(".xlsx"):
    rows = []
    for sheet, t in [("EV Customers", "EV"), ("HP Customers", "HP"), ("PV Customers", "PV")]:
        d = pd.read_excel(lab, sheet_name=sheet); d.columns = ["cust"]; d["label"] = t; rows.append(d)
    lab = os.path.join(a.data, "labels.csv"); pd.concat(rows).to_csv(lab, index=False)

py = [sys.executable, "-I"]
steps = []
load = py + ["src/load.py", "--weather", a.weather, "--out", a.data]
load += (["--zips"] + sorted(glob.glob(a.zips))) if a.zips else ["--parquet", a.parquet]
if not (a.skip_load and os.path.exists(os.path.join(a.data, "cube.npz"))):
    steps.append(load)
cube = os.path.join(a.data, "cube.npz")
steps += [py + ["src/features.py", "--cube", cube, "--out", f"{a.out}/features.pkl"],
          py + ["src/classify.py", "--features", f"{a.out}/features.pkl", "--labels", lab, "--out", f"{a.out}/classification.csv"],
          py + ["src/segment.py", "--cube", cube, "--features", f"{a.out}/features.pkl", "--classification", f"{a.out}/classification.csv", "--out", f"{a.out}/segments.csv"],
          py + ["src/bess.py", "--cube", cube, "--features", f"{a.out}/features.pkl", "--classification", f"{a.out}/classification.csv", "--segments", f"{a.out}/segments.csv", "--out", f"{a.out}/bess.csv"],
          py + ["src/insights.py", "--cube", cube, "--out", a.out],
          py + ["src/peak_drivers.py", "--cube", cube, "--out", a.out],
          py + ["src/figures.py", "--cube", cube, "--out", a.out, "--fig", "figures"],
          py + ["src/figures_focal.py", "--cube", cube, "--out", a.out, "--fig", "figures"],
          py + ["src/export_results.py", "--out", a.out, "--results", "results"]]
for s in steps:
    t = time.time(); print(">>", " ".join(s[2:4]), flush=True)
    subprocess.run(s, check=True)
    print(f"   done in {time.time()-t:.0f}s", flush=True)
