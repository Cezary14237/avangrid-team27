"""Step 1: AMI CSV parts -> Parquet -> dense cube [customer, day, hour] (float32 kWh).

Usage:
    python src/load.py --zips data/zips/*.zip --out data/
The cube makes every later step a fast numpy operation and scales linearly with customers
(35,725 customers x 8,760 h x 4 B ~= 1.25 GB).
"""
import argparse, glob, os, zipfile, tempfile
import duckdb, numpy as np, pandas as pd

START = pd.Timestamp("2025-09-01")
NDAYS = 365


def csv_to_parquet(csv_files, dst: str) -> None:
    files = ", ".join("'" + f.replace("\\", "/") + "'" for f in csv_files)
    dst = dst.replace("\\", "/")
    con = duckdb.connect()
    con.execute("SET threads=2")
    con.execute(f"""
    COPY (SELECT CAST(CUSTOMER_NUMBER AS INTEGER) cust, CAST(usage_date AS DATE) d,
                 CAST(hour_ending AS TINYINT) he, CAST(hourly_kwh AS FLOAT) kwh,
                 CAST(interval_count AS TINYINT) ic, CAST(is_complete_hour AS TINYINT) complete
          FROM read_csv([{files}], header=true, union_by_name=true))
    TO '{dst}' (FORMAT PARQUET, COMPRESSION ZSTD)""")
    con.close()


def _cube_from(con, src: str):
    df = con.execute(f"""
        SELECT CAST(cust AS INTEGER) cust, CAST(date_diff('day', DATE '2025-09-01', d) AS SMALLINT) AS di,
               CAST(he - 1 AS TINYINT) AS h, CAST(avg(kwh) AS FLOAT) AS kwh   -- DST duplicates averaged
        FROM read_parquet('{src}')
        WHERE (complete = 1 OR ic >= 3) AND d >= DATE '2025-09-01' AND d < DATE '2025-09-01' + INTERVAL {NDAYS} DAY
        GROUP BY 1,2,3""").df()
    custs = np.sort(df.cust.unique())
    idx = pd.Series(np.arange(len(custs)), index=custs)
    cube = np.full((len(custs), NDAYS, 24), np.nan, dtype=np.float32)
    cube[idx[df.cust].values, df.di.values.astype(np.int64), df.h.values.astype(np.int64)] = df.kwh.values
    del df
    # gap fill: same hour previous/next day, then customer-hour median
    for _ in range(3):
        m = np.isnan(cube)
        if not m.any():
            break
        prev = np.roll(cube, 1, axis=1); nxt = np.roll(cube, -1, axis=1)
        fill = np.where(np.isnan(prev), nxt, prev)
        cube[m] = fill[m]
        del prev, nxt, fill
    m = np.isnan(cube)
    if m.any():
        med = np.nanmedian(cube, axis=1, keepdims=True)
        cube = np.where(m, np.broadcast_to(med, cube.shape), cube)
    return custs, np.nan_to_num(cube, nan=0.0)


def build_cube(parquet_glob: str):
    """One parquet file at a time (each AMI file covers its own customer range) to keep memory low."""
    con = duckdb.connect()
    files = sorted(glob.glob(parquet_glob)) or [parquet_glob]
    parts = []
    for f in files:
        parts.append(_cube_from(con, f.replace("\\", "/")))
        print(f"  {os.path.basename(f)}: {len(parts[-1][0])} customers", flush=True)
    custs = np.concatenate([p[0] for p in parts])
    cube = np.concatenate([p[1] for p in parts]).astype(np.float32, copy=False)
    order = np.argsort(custs, kind="stable")
    custs, cube = custs[order], cube[order]
    if len(np.unique(custs)) != len(custs):
        raise SystemExit("same customer found in two AMI files, merge them before running")
    return custs, cube


def load_weather(xlsx: str) -> np.ndarray:
    """Returns temperature array [day, hour] in deg F aligned to hour-ending (HE k <- obs at k-1:00)."""
    w = pd.read_excel(xlsx)
    w["ts"] = pd.to_datetime(w["date"]).dt.normalize() + pd.to_timedelta(w["time"].astype(str))
    w = w.drop_duplicates("ts").set_index("ts").sort_index()[["temp", "humidity", "windspeed"]]
    w = w.apply(pd.to_numeric, errors="coerce")
    full = pd.date_range(START, periods=NDAYS * 24, freq="h")
    w = w.reindex(full).interpolate(limit_direction="both")
    return {c: w[c].values.reshape(NDAYS, 24).astype(np.float32) for c in ["temp", "humidity", "windspeed"]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--zips", nargs="*", default=[])
    ap.add_argument("--parquet", default=None, help="existing parquet glob (skip unzip)")
    ap.add_argument("--weather", required=True)
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    pq = a.parquet
    if a.zips:
        for z in a.zips:
            dst = os.path.join(a.out, os.path.basename(z).replace(".zip", ".parquet").replace(" ", "_"))
            if os.path.exists(dst):
                continue
            with tempfile.TemporaryDirectory() as td:
                zipfile.ZipFile(z).extractall(td)
                csvs = sorted(f for f in glob.glob(os.path.join(td, "**", "*.csv"), recursive=True) if "__MACOSX" not in f and not os.path.basename(f).startswith("._"))
                if not csvs:
                    raise SystemExit(f"no CSV files found inside {z}")
                print(f"{os.path.basename(z)}: {len(csvs)} CSV file(s)", flush=True)
                csv_to_parquet(csvs, dst)
        pq = os.path.join(a.out, "*.parquet").replace("\\", "/")
    custs, cube = build_cube(pq)
    wx = load_weather(a.weather)
    np.savez(os.path.join(a.out, "cube.npz"), custs=custs, cube=cube, **wx)
    print(f"cube {cube.shape}, customers {len(custs)}, annual kWh median {np.median(cube.sum((1,2))):.0f}")
