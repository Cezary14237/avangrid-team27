"""Copy the aggregate results into results/ so they can be committed.

Only portfolio-level numbers are exported (counts, shares, kW, $ per tier and segment, model
diagnostics). Customer-level files (outputs/customer_master.csv, classification.csv, bess.csv,
features.pkl) stay in outputs/, which is git-ignored, because the hackathon data terms do not
allow sharing meter data outside the event.
"""
import argparse, json, os, shutil
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="outputs")
ap.add_argument("--results", default="results")
a = ap.parse_args()
os.makedirs(a.results, exist_ok=True)

S = json.load(open(f"{a.out}/summary.json"))
json.dump(S, open(f"{a.results}/summary.json", "w"), indent=1, default=float)
pd.DataFrame(S["tiers"]).to_csv(f"{a.results}/tiers.csv", index=False)
pd.DataFrame(S["segments"]).to_csv(f"{a.results}/segments.csv", index=False)
pd.Series(S["inventory"], name="homes").rename_axis("technology").to_csv(f"{a.results}/inventory.csv")
pd.DataFrame(S["validation"]).T.rename_axis("technology").to_csv(f"{a.results}/validation.csv")
pd.DataFrame(S["peak_flip_curve"], columns=["heat_pump_share", "winter_peak_kw_per_home", "summer_peak_kw_per_home"]).to_csv(f"{a.results}/peak_flip_curve.csv", index=False)
for f in ["classification_meta.json", "segments_meta.json", "classification_importance_EV.csv", "classification_importance_HP.csv"]:
    if os.path.exists(f"{a.out}/{f}"):
        shutil.copy(f"{a.out}/{f}", f"{a.results}/{f}")
print("results exported to", a.results, sorted(os.listdir(a.results)))
