# AMI Customer Intelligence and BTM Battery Targeting
**Team 27, D4G Cornell 4 · 2026 Avangrid Energy Innovation Hackathon**
Cezary Pendras · Lorraine Yang · Aronya Sarker

A transparent, reproducible pipeline that turns one year of hourly AMI data and weather into

1. a customer-level **technology inventory** with a confidence score for every flag,
2. **load-shape archetypes and business segments**, each mapped to a utility program, and
3. a ranked, sized and valued list of **behind-the-meter battery (BTM BESS)** and demand-flexibility candidates.

```
AMI files ──► load.py ──► cube [customer × 365 days × 24 h] ──► features.py (~120 physics features per home)
weather   ──┘                                                     ├─► classify.py   PU learning + physics rules
labels (EV / HP / PV) ────────────────────────────────────────────┤
                                                                  ├─► segment.py    k-means archetypes + business segments
                                                                  ├─► bess.py       hour-by-hour battery and flex simulation, ranking
                                                                  └─► insights.py, figures*.py, export_results.py
```

## Headline results (all 34,238 meters in the dataset, 33,796 active)

| Question | Answer |
|---|---|
| Who has what? | 740 EVs (477 Level 2), 352 heat pumps, 3,028 homes with primary and 5,606 with supplemental electric heat, 23,354 with AC, 402 pools, 516 solar homes |
| Found beyond Avangrid's lists | **119 unregistered solar systems**, 39 installed during the year, 1,325 part-year homes |
| How good is detection? | Out-of-fold, our top 10% holds 93% of known solar homes (9.3x random), 58% of labeled EVs (5.8x) and 42% of labeled heat-pump homes (4.2x) |
| When is the peak? | 2.35 kW per home (79.4 MW in total) on Jul 2, 5 to 6 pm, 92°F. All 100 highest hours fall in Jun to Aug |
| When does it flip? | Winter peak is 1.70 kW per home today. At **12% heat-pump adoption** winter becomes the system peak |
| Who drives it? | Peak demand contributors and high-electrification homes are 14% of customers but 28% of peak load |
| Where does a battery pay? | Tier 1 (top 5%, 1,624 homes) earns **$361 per battery per year vs $138 in Tier 4 (2.6x)** and relieves 3,503 kW (4.4% of the peak). Tiers 1 and 2 relieve 9,749 kW (12.3%) |
| What about electrification? | With a battery, 100% of homes can add a Level 2 charger within the 3 kVA rule (1% without). For a heat pump: 82% vs 14% |
| Flexibility without hardware | 12,626 kW (16% of the peak): thermostats 10,934 kW, EV charging 694 kW, pool pumps and water heaters 1,011 kW |

All numbers are in [`results/`](results) and come straight out of the code. They are team estimates from the
hackathon dataset, not measured savings.

## Repository layout

| Path | Contents |
|---|---|
| `run_all.py` | End-to-end runner (one command) |
| `src/` | Pipeline steps: `load`, `features`, `classify`, `segment`, `bess`, `insights`, `figures`, `figures_focal`, `export_results` |
| `results/` | Aggregate results: `summary.json`, `tiers.csv`, `segments.csv`, `inventory.csv`, `validation.csv`, `peak_flip_curve.csv`, model diagnostics |
| `figures/` | Charts used in the README and the deck |
| `deck/` | Generator of the submission deck (`prep.py` collects numbers, `build_deck_focal.js` builds the slides) |
| `data/`, `outputs/` | Local only, git-ignored: raw meter data and customer-level outputs |

**Data policy.** The hackathon data terms do not allow sharing meter data outside the event, so raw data and all
customer-level files (`outputs/customer_master.csv`, `classification.csv`, `bess.csv`, `features.pkl`) are never
committed. Running the pipeline recreates them locally.

## Quick start

Python 3.13 (3.12 also works).

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
```

Put the four AMI zip files in `data/zips/` and the two workbooks in `data/`, then:

```bash
python run_all.py --zips "data/zips/*.zip" \
                  --weather "data/Weather Data_Avangrid_Hackathon .xlsx" \
                  --labels  "data/EV_Heat Pump_Solar PV Customers.xlsx"
```

Runtime is about 16 minutes on a 2-core laptop with 8 GB RAM (peak memory about 5 GB). Add `--skip-load` to reuse
`data/cube.npz` from an earlier run. The main customer-level output is `outputs/customer_master.csv`: one row per
customer with technologies, probabilities, segment, battery recommendation, priority index and tier.

**Windows note.** If Smart App Control is on, Windows blocks the unsigned binary modules of scipy and lightgbm. Run
the pipeline on a machine without it (or in WSL, macOS or Linux).

## 1. Data preparation (`src/load.py`)
* CSV parts are converted to Parquet with DuckDB, then to a dense float32 cube `[customer, day, hour]`
  (34,238 × 365 × 24, about 1.2 GB), one file at a time to keep memory low.
* Only complete hours are kept (`IS_COMPLETE_HOUR = 1` or at least 3 of 4 intervals). DST duplicates are averaged.
  Gaps are filled with the same hour on the adjacent day, then with the customer's hour-of-day median.
* Weather (temperature, humidity, wind) is aligned to the same grid (hour ending k uses the observation at k−1:00).
* Accounts with under 600 kWh a year, or over 50% zero hours not explained by solar, are flagged **inactive**.

## 2. Features (`src/features.py`): every feature has a physical meaning
| Family | Examples | Detects |
|---|---|---|
| Level and shape | annual kWh, base load (P5), P99, load factor, night, evening and midday share | size, occupancy |
| Weather response | change-point regression `kWh_d = b0 + bH·max(0, Th − T_d) + bC·max(0, T_d − Tc)` with balance points searched per customer, hourly temperature slopes by season, temperature-binned load curve | AC, electric heat, heat pumps |
| Plateau events | flat blocks above a rolling floor: 1.0 to 2.2 kW for 5 to 14 h, 3 to 5 kW, 5 to 12.5 kW for 1 to 8 h, jumps of 5 kW or more, share at night and on warm days | EV Level 1 and 2, strip heat |
| Seasonal schedule | 6-hour block uplift on cool summer days vs shoulder months, block contrast, temperature independence | pool pumps |
| Net-load zeros | solar days (midday near zero while the home draws power at night), first month with solar days, evening zero runs | PV, new PV, PV with battery |
| Occupancy | longest run of days below 35% of normal use | part-year homes |

## 3. Classification (`src/classify.py`)
**EV and heat pump: positive-unlabeled (PU) learning.** Avangrid's lists are a random sample of about 25% of each
population, so everyone else is unlabeled, not negative. LightGBM is trained on labeled vs unlabeled homes
(out-of-fold, 5 folds × 3 seeds), converted to `P(tech | x) = g(x) / c` (Elkan and Noto, KDD 2008), and the
log-odds are shifted so that the probabilities add up to `labeled / 0.25`. The EV score blends the model (60%) with
plateau evidence (40%). The heat-pump score is 30% model and 70% heating physics. A home is flagged if it is labeled
or ranks inside the known population size.

**Other technologies: physics rules** with a confidence of `σ((feature − threshold) / scale)`: AC (hot-hour uplift
above 0.5 kW, central if 1.8 kW or more), primary electric heat (at least about 4,000 kWh a year of cold-driven load
and 25% of use), supplemental electric heat (1,500 to 4,000 kWh a year), heat pump vs resistance heat, electric
water heater, pool, hot tub (heuristic), solar PV, unregistered PV, PV installed mid-year, PV with battery,
part-year homes and always-on high loads.

## 4. Segmentation (`src/segment.py`)
* **Archetypes:** k-means on each home's normalised seasonal average day (winter, summer, shoulder × 24 h = 72 values),
  k chosen by silhouette with a floor of 6, named automatically from the centroid shape.
* **Business segments** (one primary segment per home): Peak demand contributor (top 10% by load at the 100 highest
  system hours), High electrification, Flexible load, Likely tech adopter, Emerging electrification candidate,
  Solar prosumer, Seasonal or part-year, Inactive, Baseline.

## 5. Battery and demand flexibility (`src/bess.py`)
Battery = program spec: 2 × Enphase IQ 10C (20.16 kWh, 7.68 kW, 89.4% round trip), 10% backup reserve, so 18.1 kWh
usable per day.
* **Customer peak shaving:** each day, the lowest cap θ with energy above θ at most 18.1 kWh and peak minus θ at most
  7.68 kW. Recharge goes into the lowest-load hours without exceeding θ. Run for 1 and 2 units to size the system.
* **Utility peak window:** discharge 3 to 8 pm, highest load first, no export. Value = kW cut at the 100 highest system
  hours × $100 per kW-year + TOU savings on NYSEG SC12 supply prices (peak $0.16, off-peak $0.09 per kWh, peak
  months Dec to Feb and Jun to Aug).
* **Flexibility without a battery:** managed EV charging, smart thermostats (30% of AC kW), pool-pump timers,
  water-heater control (0.4 kW).
* **Electrification enablement:** add a Level 2 charger (7.2 kW, 6 to 9 pm) or a ducted heat pump (0.12 kW per °F
  below 55°F, at most 6 kW) to every home and test the rise in annual peak against the **3 kVA** rule, with and
  without the battery.
* **Sizing:** demand flexibility only if one unit cuts under 1 kW, one unit if a second adds under 1 kW, otherwise two.
* **Battery Priority Index (0 to 100)** = 30% kW cut at system peak + 25% customer peak cut + 15% energy shifted +
  15% electrification + 10% persistent peak days (above 6 kW) + 5% solar pairing.
  Tier 1 = top 5% of eligible homes (deploy), Tier 2 = next 10% (offer), Tier 3 = at least 0.5 kW of flexible load
  (DR program), Tier 4 = monitor. Homes above 38.4 kW (beyond a 200 A service) and part-year homes are excluded.

## Assumptions and limitations
* Hourly data understates instant peaks. Dispatch assumes perfect daily foresight, so battery results are an upper bound.
* TOU prices are 12-month averages and must be verified. $100 per kW-year is a placeholder for Avangrid's avoided cost.
* Labels are "likely", not verified, so validation numbers are lower bounds. Heat pump vs resistance heat is the
  weakest call. 15-minute data, gas-account flags and rebate records would help most.
* Hot tub and water-heater detection are heuristic.
* No feeder or transformer IDs were provided, so ranking is per customer. The index aggregates directly once GIS keys are joined.
* Customer numbers run to 35,725, but 34,238 meters have reads.

## Rebuilding the submission deck
```bash
CUBE=data/cube.npz python deck/prep.py      # collects every number into deck/deck_data.json
cd deck && npm install && cd ..
node deck/build_deck_focal.js                # writes "27_D4G Cornell 4_Final Submission.pptx"
```
Every number on the slides is read from `deck/deck_data.json`, so a rerun on new data regenerates the deck.

## AI use
Claude (Anthropic) assisted with code, analysis and slide drafting. The team reviewed the method, and every number
can be reproduced from this repository.
