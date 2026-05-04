# HurricaneMap Jupyter Notebooks

Analysis templates and starter code for exploring HurricaneMap's NOAA HURDAT2 dataset.

## Notebooks

### `analysis-starter.ipynb` — Data Analysis Getting Started

A comprehensive introduction to analyzing U.S. hurricane landfalls with Python + pandas + matplotlib.

**Features:**
- Load HURDAT2 landfall data from JSON files
- Filter by year range, Saffir-Simpson category, or state
- Compute climatology: trends, averages, extremes
- Visualize geographic and temporal distributions
- Generate time-series analysis (10-year rolling averages)
- Export results to CSV

**Run online (no installation):**  
[![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/SysAdminDoc/HurricaneMap/blob/main/notebooks/analysis-starter.ipynb)

**Run locally:**
```bash
cd HurricaneMap
pip install pandas numpy matplotlib jupyter
jupyter notebook notebooks/analysis-starter.ipynb
```

**What you'll learn:**
- How to structure landfall data for analysis
- Pandas filtering and groupby workflows
- Creating publication-ready charts
- Exporting data for further research

## Data Files

The notebooks expect HurricaneMap's data files in the `data/` directory:
- `data/landfalls.json` — 760 landfall events (flat list)
- `data/storms.json` — Full track + metadata for every storm
- `data/impacts.json` — Deaths and damage figures (partial coverage)

**For Google Colab:** The notebook includes code to download these files automatically.

## Data Attribution

All notebooks must include proper attribution for NOAA HURDAT2:

> Historical hurricane landfall data sourced from NOAA's National Hurricane Center HURDAT2 database (https://www.nhc.noaa.gov/data/).

See the main [LICENSE.md](../LICENSE.md) for full citation formats.

## Example Analyses

**Quick starts to get you going:**

```python
# Recent major hurricanes in Florida
df_florida_majors = df[(df['year'] >= 1980) & (df['category'] >= 3) & (df['state'] == 'Florida')]

# Category distribution
df['category'].value_counts().sort_index()

# Average landfall wind speed by decade
df.groupby(df['year'] // 10 * 10)['wind'].mean()

# Busiest months for landfalls
df['month'].value_counts().sort_index()
```

## Contributing

Want to add a new notebook? Please:
1. Use this structure as a template
2. Include clear markdown explanations for each cell
3. Add proper data attribution
4. Test in both local and Google Colab environments
5. Ensure all data files load correctly

## Resources

- **NOAA HURDAT2 documentation:** https://www.nhc.noaa.gov/data/hurdat/
- **Pandas guide:** https://pandas.pydata.org/docs/
- **Matplotlib tutorial:** https://matplotlib.org/stable/tutorials/
- **Google Colab:** https://colab.research.google.com/

---

**Last Updated:** May 2026
