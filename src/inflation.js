// CPI-U annual averages from the BLS, 1850-2024. Source: U.S. Bureau of
// Labor Statistics, with pre-1913 figures from the historical CPI series
// reconstructed by Robert J. Shiller (Yale) using NBER macrohistory data.
// Base for adjustment is 2024 (most recent complete year).
//
// Used to scale `data/impacts.json` damage figures (nominal millions USD
// at year-of-storm) into 2024 USD for fair cross-era comparison.
//
// Methodology: real_2024 = nominal * (CPI_2024 / CPI_year)
// Edge case: storms before 1850 fall back to nominal (no CPI data).

const CPI = {
  1850: 7.86, 1851: 7.86, 1852: 7.86, 1853: 7.86, 1854: 8.43,
  1855: 8.62, 1856: 8.62, 1857: 8.81, 1858: 8.05, 1859: 8.05,
  1860: 8.05, 1861: 8.62, 1862: 9.96, 1863: 12.45, 1864: 15.71,
  1865: 16.28, 1866: 15.71, 1867: 14.56, 1868: 13.79, 1869: 13.41,
  1870: 12.83, 1871: 11.87, 1872: 11.87, 1873: 11.68, 1874: 11.11,
  1875: 10.73, 1876: 10.54, 1877: 10.34, 1878: 9.77, 1879: 9.77,
  1880: 10.15, 1881: 10.15, 1882: 10.15, 1883: 10.0, 1884: 9.81,
  1885: 9.62, 1886: 9.43, 1887: 9.62, 1888: 9.62, 1889: 9.24,
  1890: 9.05, 1891: 9.05, 1892: 9.05, 1893: 8.86, 1894: 8.48,
  1895: 8.29, 1896: 8.29, 1897: 8.10, 1898: 8.10, 1899: 8.29,
  1900: 8.48, 1901: 8.48, 1902: 8.67, 1903: 8.86, 1904: 8.86,
  1905: 8.86, 1906: 9.05, 1907: 9.43, 1908: 9.24, 1909: 9.24,
  1910: 9.62, 1911: 9.62, 1912: 9.81, 1913: 9.9, 1914: 10.0,
  1915: 10.1, 1916: 10.9, 1917: 12.8, 1918: 15.1, 1919: 17.3,
  1920: 20.0, 1921: 17.9, 1922: 16.8, 1923: 17.1, 1924: 17.1,
  1925: 17.5, 1926: 17.7, 1927: 17.4, 1928: 17.1, 1929: 17.1,
  1930: 16.7, 1931: 15.2, 1932: 13.7, 1933: 13.0, 1934: 13.4,
  1935: 13.7, 1936: 13.9, 1937: 14.4, 1938: 14.1, 1939: 13.9,
  1940: 14.0, 1941: 14.7, 1942: 16.3, 1943: 17.3, 1944: 17.6,
  1945: 18.0, 1946: 19.5, 1947: 22.3, 1948: 24.1, 1949: 23.8,
  1950: 24.1, 1951: 26.0, 1952: 26.5, 1953: 26.7, 1954: 26.9,
  1955: 26.8, 1956: 27.2, 1957: 28.1, 1958: 28.9, 1959: 29.1,
  1960: 29.6, 1961: 29.9, 1962: 30.2, 1963: 30.6, 1964: 31.0,
  1965: 31.5, 1966: 32.4, 1967: 33.4, 1968: 34.8, 1969: 36.7,
  1970: 38.8, 1971: 40.5, 1972: 41.8, 1973: 44.4, 1974: 49.3,
  1975: 53.8, 1976: 56.9, 1977: 60.6, 1978: 65.2, 1979: 72.6,
  1980: 82.4, 1981: 90.9, 1982: 96.5, 1983: 99.6, 1984: 103.9,
  1985: 107.6, 1986: 109.6, 1987: 113.6, 1988: 118.3, 1989: 124.0,
  1990: 130.7, 1991: 136.2, 1992: 140.3, 1993: 144.5, 1994: 148.2,
  1995: 152.4, 1996: 156.9, 1997: 160.5, 1998: 163.0, 1999: 166.6,
  2000: 172.2, 2001: 177.1, 2002: 179.9, 2003: 184.0, 2004: 188.9,
  2005: 195.3, 2006: 201.6, 2007: 207.342, 2008: 215.303, 2009: 214.537,
  2010: 218.056, 2011: 224.939, 2012: 229.594, 2013: 232.957, 2014: 236.736,
  2015: 237.017, 2016: 240.007, 2017: 245.120, 2018: 251.107, 2019: 255.657,
  2020: 258.811, 2021: 270.970, 2022: 292.655, 2023: 304.702, 2024: 313.689,
};

const BASE_YEAR = 2024;
const BASE_CPI = CPI[BASE_YEAR];

export const NCEI_BILLIONS_DATASET_ID = 'ncei-billions';
export const BILLIONS_DATASET_STATUS = Object.freeze({
  id: NCEI_BILLIONS_DATASET_ID,
  status: 'closed',
  end_date: '2024-12-31',
  retirement_citation: Object.freeze({
    title: 'Billion Dollar Weather and Climate Disasters',
    date: '2025-05-08',
    url: 'https://www.nesdis.noaa.gov/about/documents-reports/notice-of-changes/2025-notice-of-changes/billion-dollar-weather-and-climate-disasters',
  }),
});

export function isClosedSeries(status) {
  return status?.status === 'closed';
}

export function seriesEndYear(status) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(status?.end_date || '');
  return match ? Number(match[1]) : null;
}

// Returns { real, factor } or null when out of range.
export function inflateUSD(amountUSD, fromYear, toYear = BASE_YEAR) {
  if (amountUSD == null) return null;
  if (Number(fromYear) > BASE_YEAR) {
    return { real: amountUSD, factor: 1, baseYear: fromYear, currentDollars: true };
  }
  const fromCPI = CPI[fromYear];
  const toCPI = CPI[toYear] || BASE_CPI;
  if (!fromCPI) return null;
  const factor = toCPI / fromCPI;
  return { real: amountUSD * factor, factor, baseYear: toYear };
}

// Format the BLS year label range for a UI hint.
export function inflationBaseYear() { return BASE_YEAR; }

// Convenience: pretty-format a millions-USD value with M / B / T suffixes.
export function formatMillionsUSD(m) {
  if (m == null) return '—';
  if (m >= 1_000_000) return `$${(m / 1_000_000).toFixed(2)}T`;
  if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  if (m >= 1) return `$${m.toFixed(1)}M`;
  return `$${(m * 1000).toFixed(0)}K`;
}
