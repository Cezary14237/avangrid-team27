# Avangrid Energy Innovation Hackathon 2026: Team 27 (D4G Cornell 4)

Cezary Pendras, Lorraine Yang, Aronya Sarker

We built a tool that takes a year of hourly smart meter (AMI) data plus weather and answers three questions
for every customer:

1. Which technologies does the home have (EV, heat pump, electric heat, AC, pool, solar and a few others)?
2. Which load segment does it belong to, and which utility program fits it?
3. Is it a good site for a behind-the-meter battery, what size, and how much is it worth?

Everything runs from one script and every flag can be traced back to a feature you can check by looking at the
home's load.

## Results

Run on all 34,238 meters in the dataset (33,796 active).

- **Inventory.** 740 EVs (477 Level 2), 352 heat pumps, 3,028 homes with primary and 5,606 with supplemental
  electric heat, 23,354 with AC, 402 pools and 516 with solar.
- **Not on Avangrid's lists.** 119 homes have a clear solar signature but are not registered, and 39 systems were
  installed during the year. 1,325 homes are only occupied part of the year.
- **Validation.** On held-out labels, our top 10% contains 93% of known solar homes, 58% of labeled EVs and 42% of
  labeled heat-pump homes (9.3x, 5.8x and 4.2x better than random).
- **Peak.** 2.35 kW per home (79.4 MW total) on July 2 between 5 and 6 pm at 92°F. All of the 100 highest hours
  are in June to August. The winter peak is 1.70 kW, and it overtakes summer once about 12% of homes have heat pumps.
- **Segments.** Peak demand contributors and high-electrification homes are 14% of customers and 28% of peak load.
- **Batteries.** The top 5% of homes (Tier 1, 1,624 homes) are worth $361 per battery per year against $138 in
  Tier 4. Tier 1 cuts 3,503 kW at the system peak (4.4%), Tiers 1 and 2 together 9,749 kW (12.3%).
- **Electrification.** With a battery, practically every home can add a Level 2 charger without breaking the 3 kVA
  rule (1% without one). For a heat pump it is 82% vs 14%.
- **Flexibility without new hardware.** About 12.6 MW (16% of the peak), mostly smart thermostats.

The numbers are in `results/` and the charts in `figures/`. They are our estimates from the hackathon data, not
measured savings.

## What's in the repo

```
run_all.py        runs the whole pipeline
src/
  load.py         zips -> parquet -> customer x day x hour array
  features.py     ~120 features per home
  classify.py     technology flags and probabilities
  segment.py      load archetypes and business segments
  bess.py         battery and flexibility simulation, priority index, tiers
  insights.py     summary numbers
  figures*.py     charts
  export_results.py  copies the aggregate results to results/
results/          aggregate results (json and csv)
figures/          charts
deck/             scripts that build the submission slides from the results
```

Raw meter data and anything at customer level (`outputs/customer_master.csv` and friends) are not in the repo
because the data terms don't allow sharing them outside the hackathon. Running the pipeline recreates them locally.

## How to run

Python 3.13 (3.12 works too).

```bash
python -m venv .venv
source .venv/bin/activate          # on Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
```

Put the four AMI zips in `data/zips/` and the weather and label workbooks in `data/`, then:

```bash
python run_all.py --zips "data/zips/*.zip" \
                  --weather "data/Weather Data_Avangrid_Hackathon .xlsx" \
                  --labels  "data/EV_Heat Pump_Solar PV Customers.xlsx"
```

It takes around 16 minutes on a 2-core laptop and needs about 5 GB of RAM. `--skip-load` reuses `data/cube.npz`
if you've already loaded the data once. The main output is `outputs/customer_master.csv`, one row per customer.

On Windows with Smart App Control turned on, scipy and lightgbm get blocked, so use another machine or WSL.

## How it works

**Data.** We keep complete hours only, average the duplicate DST hour and fill gaps from the same hour on the
neighbouring day. Weather is aligned to the same hourly grid. Homes using under 600 kWh a year are marked inactive.

**Features.** Most of the signal comes from a few physical ideas:
- a change-point model of daily kWh vs temperature (`base + heating slope × degrees below Th + cooling slope ×
  degrees above Tc`), fitted per home, which picks up AC and electric heating,
- flat blocks of 5 to 12.5 kW lasting 1 to 8 hours above the home's normal floor (Level 2 charging) and long
  1 to 2 kW blocks (Level 1),
- a fixed 6-hour block that only shows up in summer and doesn't follow temperature (pool pumps),
- midday net load at zero while the home uses power at night (solar),
- long runs of near-empty days (part-year homes).

**Classification.** Avangrid gave us EV and heat-pump lists that are a random ~25% sample of each population, so
the remaining homes are unlabeled rather than negative. We used positive-unlabeled learning (Elkan and Noto, 2008)
with LightGBM, then rescaled the probabilities so they add up to the known population size (labels / 0.25). The EV
score mixes the model with the charging-block evidence, and the heat-pump score leans mostly on the heating
physics because the labels are noisy. The other technologies use simple threshold rules with a sigmoid confidence.

**Segments.** k-means on each home's average winter, summer and shoulder-season day gives six load archetypes.
On top of that every home gets one business segment (peak demand contributor, high electrification, flexible
load, likely adopter and so on) based on its load at the 100 highest system hours and its technologies.

**Batteries.** The program battery is 2 × Enphase IQ 10C (20.16 kWh, 7.68 kW, 89.4% round trip), and we keep 10%
as backup. For every home and every day we simulate:
- peak shaving: the lowest cap the battery can hold that day, recharging in the quietest hours,
- discharge in the 3 to 8 pm window, valued at $100 per kW-year at the 100 highest system hours plus TOU savings
  on NYSEG SC12 prices,
- adding a Level 2 charger or a heat pump and checking the 3 kVA rule with and without the battery.

The Battery Priority Index (0 to 100) weights kW cut at the system peak (30%), customer peak cut (25%), energy
shifted (15%), electrification (15%), persistent peak days (10%) and solar (5%). Tier 1 is the top 5% of eligible
homes, Tier 2 the next 10%, Tier 3 homes with at least 0.5 kW of flexible load, Tier 4 the rest. Homes above
38.4 kW and part-year homes are left out.

## Caveats

- Hourly data hides short spikes, and the dispatch knows each day's load in advance, so battery results are an
  upper bound.
- TOU prices are 12-month averages and $100 per kW-year is a placeholder for Avangrid's avoided cost.
- The labels are "likely", not confirmed. Heat pump vs resistance heat is our weakest call.
- Hot tub and water heater detection is rough.
- We had no feeder or transformer IDs, so the ranking is per customer.
- Customer numbers go up to 35,725, but only 34,238 meters have data.

## Rebuilding the slides

```bash
CUBE=data/cube.npz python deck/prep.py
cd deck && npm install && cd ..
node deck/build_deck_focal.js
```
