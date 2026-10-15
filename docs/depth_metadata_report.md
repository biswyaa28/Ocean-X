# INCOIS RSMC HYCOM Depth Metadata Report

**Project**: OCEAN-X (SIH26067)  
**Date of Retrieval**: 2026-10-10  
**Target Dataset**: INCOIS RSMC HYCOM Ocean State Forecast Currents Product

---

## 1. Repository Search: Dataset URLs and Depth Variable Names

### 1.1 Dataset URLs Discovered in Repository

A systematic search across configuration files, documentation, and data loading scripts identified the following dataset URLs:

| # | URL | Appearance / File Reference | Description in Codebase |
|---|-----|-----------------------------|-------------------------|
| 1 | `https://incois.gov.in/thredds/catalog/osf/currents2/catalog.xml` | `scripts/archive_hycom_runs.py:38`<br>`data/manifest.json:86`<br>`data/manifest.json:227` | THREDDS primary catalog for the RSMC HYCOM currents product (`CATALOG_URL` / `source_url`). |
| 2 | `https://incois.gov.in/thredds/ncss/grid/osf/currents2` | `scripts/archive_hycom_runs.py:39`<br>`data/manifest.json:228` | NetCDF Subset Service (NCSS) grid base endpoint (`NCSS_BASE` / `download_url`). |
| 3 | `https://incois.gov.in/thredds/fileServer/osf/currents2/RSMC_hycom_20261008.nc` | `data/manifest.json:63`<br>`data/manifest.json:68` | Full raw NetCDF-3 file download via THREDDS HTTPServer (`source_url` / `download_url`). |
| 4 | `https://incois.gov.in/thredds/fileServer/osf/currents2/RSMC_hycom_20260908.nc` | `backend/scripts/download_incois.ps1:23` | Earlier raw forecast run download script (`$url`). Noted in `manifest.json:86` as retired upstream by INCOIS's rolling retention policy. |
| 5 | `https://<host>/thredds/dodsC/osf/currents2/RSMC_hycom_<date>.nc.ascii?DEPTH` | `backend/scripts/test_depth_label_hypothesis.py:105`<br>`data/README.md:227-228,250` | OPeNDAP DAP2 endpoint template and documentation citations for inspecting `DEPTH` and `DEPTH_bnds`. |
| 6 | `https://incois.gov.in/oceanservices/osf_gc_rsmc.jsp` | `data/README.md:263` | INCOIS RSMC General Circulation product documentation page. |
| 7 | `https://www.incois.gov.in/site/services/osf.jsp` | `docs/Dataset_Specification.md:18` | INCOIS Ocean State Forecast service overview page. |
| 8 | `https://www.incois.gov.in/oceanservices/osfforecast.jsp` | `docs/Dataset_Specification.md:21` | INCOIS Ocean State Forecast interactive viewer portal. |

### 1.2 Variable Names Used for Depth in the Repository

Across configuration, docs, tests, and loader implementations:
- **`DEPTH`**: Coordinate variable and dimension name in raw NetCDF files, OPeNDAP datasets, and processed subsets (`backend/scripts/diagnose_bias_125m.py:143`, `backend/app/services/model_depth_axis.py:38`, `data/manifest.json:72`, `data/README.md:226`).
- **`DEPTH_bnds`**: Boundary coordinate variable name in upstream raw NetCDF files and OPeNDAP endpoints (`data/README.md:228`, `data/README.md:251`).
- **`DEPTH_bounds`**: Boundary coordinate variable name as emitted when saving NetCDF-4 subsets via NetCDF-Java CDM / NCSS (`backend/app/services/model_depth_axis.py:42`, `backend/app/core/config.py:143`).
- **`depth_m`**: Observation depth derived from pressure via TEOS-10 / GSW in Argo matchup routines (`backend/app/services/argo_levels.py`, `backend/scripts/test_depth_label_hypothesis.py:128`, `data/README.md:215`).
- **`depthLevelsM` / `modelDepthM`**: API schema representation and matchup record fields for vertical levels (`data/manifest.json:254`, `backend/scripts/diagnose_bias_125m.py:734`).
- **`OCEANX_MODEL_DEPTH_AXIS`**: Environment configuration variable controlling depth axis resolution (`"file"` vs `"bounds_nodes"`, `backend/app/core/config.py:152`).

---

## 2. Upstream Retrieval: Endpoints and Responses

All retrievals below were executed directly against `incois.gov.in` on 2026-10-10.

### 2.1 THREDDS Catalog: `catalog.xml`

**URL**: `https://incois.gov.in/thredds/catalog/osf/currents2/catalog.xml`  
**HTTP Status**: `200 OK`

#### Verbatim Services Declared:
```xml
<service name="all" serviceType="compound" base="">
  <service name="odap" serviceType="OpenDAP" base="/thredds/dodsC/" />
  <service name="d4dap" serviceType="DAP4" base="/thredds/dap4/" />
  <service name="http" serviceType="HTTPServer" base="/thredds/fileServer/" />
  <service name="wcs" serviceType="WCS" base="/thredds/wcs/" />
  <service name="wms" serviceType="WMS" base="/thredds/wms/" />
  <service name="ncssGrid" serviceType="NetcdfSubset" base="/thredds/ncss/grid/" />
  <service name="ncssPoint" serviceType="NetcdfSubset" base="/thredds/ncss/point/" />
  <service name="cdmremote" serviceType="CdmRemote" base="/thredds/cdmremote/" />
</service>
```

#### Verbatim Catalog Entry for `RSMC_hycom_20261008.nc`:
```xml
<dataset name="RSMC_hycom_20261008.nc" ID="OSF9/RSMC_hycom_20261008.nc" urlPath="osf/currents2/RSMC_hycom_20261008.nc">
  <dataSize units="Gbytes">10.58</dataSize>
  <date type="modified">2026-10-08T00:16:54.946Z</date>
</dataset>
```

---

### 2.2 OPeNDAP Dataset Attribute Structure (`.das`)

**URL**: `https://incois.gov.in/thredds/dodsC/osf/currents2/RSMC_hycom_20261008.nc.das`  
**HTTP Status**: `200 OK`

#### Verbatim Attribute Definitions for `DEPTH` and `DEPTH_bnds`:
```
    DEPTH {
        String positive "down";
        String point_spacing "uneven";
        String axis "Z";
        String standard_name "depth";
        String bounds "DEPTH_bnds";
    }
    DEPTH_bnds {
    }
```

#### Verbatim Global Attributes (`NC_GLOBAL` and `DODS_EXTRA`):
```
    NC_GLOBAL {
        String history "PyFerret V7.63 (optimized)  8-Oct-26";
        String Conventions "CF-1.6";
    }
    DODS_EXTRA {
        String Unlimited_Dimension "TIME";
    }
```

---

### 2.3 OPeNDAP Dataset Descriptor Structure (`.dds`)

**URL**: `https://incois.gov.in/thredds/dodsC/osf/currents2/RSMC_hycom_20261008.nc.dds`  
**HTTP Status**: `200 OK`

#### Verbatim Declarations for Depth Dimensions and Variables:
```
Dataset {
    ...
    Float32 DEPTH[DEPTH = 6];
    Float32 DEPTH_bnds[DEPTH = 6][bnds = 2];
    Grid {
     ARRAY:
        Float32 TEMP[TIME = 28][DEPTH = 6][LAT = 1384][LON = 1665];
     MAPS:
        Float64 TIME[TIME = 28];
        Float32 DEPTH[DEPTH = 6];
        Float32 LAT[LAT = 1384];
        Float32 LON[LON = 1665];
    } TEMP;
    ...
} osf/currents2/RSMC_hycom_20261008.nc;
```

---

### 2.4 OPeNDAP ASCII Variable Query (`.ascii?DEPTH,DEPTH_bnds`)

**URL**: `https://incois.gov.in/thredds/dodsC/osf/currents2/RSMC_hycom_20261008.nc.ascii?DEPTH,DEPTH_bnds`  
**HTTP Status**: `200 OK`

#### Verbatim Returned Body:
```
Dataset {
    Float32 DEPTH[DEPTH = 6];
    Float32 DEPTH_bnds[DEPTH = 6][bnds = 2];
} osf/currents2/RSMC_hycom_20261008.nc;
---------------------------------------------
DEPTH[6]
0.0, 10.0, 50.0, 100.0, 250.0, 500.0

DEPTH_bnds[6][2]
[0], -5.0, 5.0
[1], 5.0, 30.0
[2], 30.0, 75.0
[3], 75.0, 175.0
[4], 175.0, 375.0
[5], 375.0, 625.0
```

*(Note: The identical values and attributes were verified on subsequent active runs `RSMC_hycom_20261009.nc` and `RSMC_hycom_20261010.nc`.)*

---

### 2.5 NCSS Endpoint: `dataset.xml`

**URL**: `https://incois.gov.in/thredds/ncss/grid/osf/currents2/RSMC_hycom_20261008.nc/dataset.xml`  
**HTTP Status**: `200 OK`

#### Verbatim `DEPTH` Axis Element:
```xml
  <axis name="DEPTH" shape="[6]" type="float" axisType="GeoZ">
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="positive" value="down" />
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="point_spacing" value="uneven" />
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="axis" value="Z" />
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="standard_name" value="depth" />
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="bounds" value="DEPTH_bnds" />
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="_CoordinateAxisType" value="GeoZ" />
    <attribute xmlns="http://www.unidata.ucar.edu/namespaces/netcdf/ncml-2.2" name="_CoordinateZisPositive" value="down" />
    <values spacing="contiguousInterval" npts="6" start="0.0" end="500.0" resolution="83.33333333333333">0.0 17.5 52.5 125.0 275.0 500.0</values>
  </axis>
```

---

### 2.6 HTTPServer / Raw NetCDF File Endpoints

#### 1. `RSMC_hycom_20261008.nc` (Active Run)
**URL**: `https://incois.gov.in/thredds/fileServer/osf/currents2/RSMC_hycom_20261008.nc`  
**HTTP Status**: `200 OK`  
**Content-Length**: `10581647292` bytes (~10.58 GB)  
**Accept-Ranges**: `bytes`  
**Format**: `NETCDF3_CLASSIC`  

Direct in-memory header inspection via HTTP range retrieval confirmed the verbatim NetCDF-3 attributes:
- `DEPTH` variable attributes:
  - `positive`: `"down"`
  - `point_spacing`: `"uneven"`
  - `axis`: `"Z"`
  - `standard_name`: `"depth"`
  - `bounds`: `"DEPTH_bnds"`
- `DEPTH_bnds` variable attributes: None (empty attribute list `[]`)
- Global attributes:
  - `history`: `"PyFerret V7.63 (optimized)  8-Oct-26"`
  - `Conventions`: `"CF-1.6"`

#### 2. `RSMC_hycom_20260908.nc` (Retired Run)
**URL**: `https://incois.gov.in/thredds/fileServer/osf/currents2/RSMC_hycom_20260908.nc`  
**HTTP Status**: `200 OK` (HTTP response header returned 200, but payload is HTML error page)  
**Body**: `<title>Page Not Found</title>`  
**Observation**: Confirming `data/manifest.json:86`, INCOIS deletes older forecast runs when newer cycles are posted.

---

### 2.7 INCOIS Product Specification Webpage

**URL**: `https://incois.gov.in/oceanservices/osf_gc_rsmc.jsp`  
**HTTP Status**: `200 OK`

#### Verbatim Documented Table Content:
- **Title**: `"Ocean State Forecast (General Circulation)"`
- **Model Description**: `"Forecast of ocean state variables such as surface currents, temperature and salinity are generated by a global HYCOM model. The atmospheric forcing (winds, radiation etc.) is taken from the NOAA's Global Forecast System."`
- **Horizontal resolution and Vertical levels**: `"0.25x0.25 and 6 levels"`
- **Variables (units)**: `"Ocean Currents (m/s), Temperature (C), Salinity (PSU), Mixed Layer Depth (MLD; m), Tropical Cyclone Heat Potential (TCHP; J/m2) and Sea Surface Height (SSH; m)"`
- **Domain**: `"Spatial Extent: 20 E - 140 E, 80 S - 30 N"`
- **Data provider**: `"INCOIS (Indian National Centre for Ocean Information Services)"`

---

## 3. DEPTH and DEPTH_bounds Values

### 3.1 DEPTH Values List

#### Source A: Upstream Raw NetCDF / OPeNDAP (`.ascii?DEPTH` / dodsC / fileServer)
The full list of `DEPTH` values is:
```
[0.0, 10.0, 50.0, 100.0, 250.0, 500.0]
```
- Total count: 6
- Data type: `Float32`

#### Source B: Upstream NCSS Endpoint (`dataset.xml` `<values>`)
The full list of `DEPTH` values computed by NCSS is:
```
[0.0, 17.5, 52.5, 125.0, 275.0, 500.0]
```
- Total count: 6
- Data type: `float`

---

### 3.2 DEPTH_bounds Values and Shape

#### Upstream Raw NetCDF / OPeNDAP (`DEPTH_bnds`)
- **Variable Name**: `DEPTH_bnds`
- **Shape**: `(6, 2)` (dimensions `[DEPTH = 6][bnds = 2]`)
- **Data type**: `Float32`
- **Full Values List**:
```
[
  [-5.0, 5.0],
  [5.0, 30.0],
  [30.0, 75.0],
  [75.0, 175.0],
  [175.0, 375.0],
  [375.0, 625.0]
]
```

---

## 4. Not Found

The following attributes were specifically searched for across the file, OPeNDAP, NCSS, and catalog metadata, but could **not** be retrieved:

1. **`units` attribute on variable `DEPTH`**:
   - In the raw NetCDF-3 file (`RSMC_hycom_20261008.nc`) and the OPeNDAP DAS/DDS structure, the `units` attribute does not exist on `DEPTH`.
   - In NCSS-generated subset NetCDFs, a `units` attribute exists but its value is empty string (`""`).
2. **`long_name` attribute on variable `DEPTH`**:
   - Does not exist in the raw NetCDF file, OPeNDAP DAS, or NCSS `dataset.xml`.
3. **Attributes on variable `DEPTH_bnds`**:
   - The bounds variable contains zero attributes (`DEPTH_bnds` has an empty attribute list in the NetCDF header and OPeNDAP DAS).
4. **Global attributes mentioning vertical levels, model configuration, or layer definitions**:
   - The NetCDF file's global attributes only contain `history = "PyFerret V7.63 (optimized)  8-Oct-26"` and `Conventions = "CF-1.6"`.
   - No global attributes describe the vertical coordinate formulation, vertical grid stretching, or whether levels represent layer centres or layer edges.
5. **Numerical depth levels in web documentation**:
   - The INCOIS RSMC web documentation (`osf_gc_rsmc.jsp`) mentions `"0.25x0.25 and 6 levels"`, but does not enumerate the 6 numerical level depths or document their vertical positioning.
6. **Active dataset at retired URL `RSMC_hycom_20260908.nc`**:
   - The September 2026 file referenced in `backend/scripts/download_incois.ps1` returns a `"Page Not Found"` response upstream.

---

## 5. Interpretation

The retrieved producer metadata does **not** state whether `DEPTH` represents a layer centre or a layer edge:
- The `standard_name` is declared as `"depth"`, `axis` is declared as `"Z"`, and `positive` is declared as `"down"`.
- No metadata attribute (such as `cell_methods`, `formula_terms`, or long-form description) designates the values as layer centres, layer interfaces, or cell edges.
- Vertical level positioning with respect to layer boundaries is **unspecified** in the producer's dataset and documentation.

---

## 6. NCSS rewrites DEPTH

1. **Upstream Raw Dataset (`fileServer` / `dodsC` OPeNDAP)**:
   - Raw `DEPTH` coordinate values: `[0.0, 10.0, 50.0, 100.0, 250.0, 500.0]`.
   - Raw `DEPTH_bnds` variable: `[[-5.0, 5.0], [5.0, 30.0], [30.0, 75.0], [75.0, 175.0], [175.0, 375.0], [375.0, 625.0]]`.
   - The bounds rows are mathematically identical to midpoints between adjacent raw `DEPTH` levels with mirrored half-gap end boundaries ($0 \pm 5$ m and $500 \pm 125$ m; 12/12 elements match).

2. **THREDDS NCSS Subset Generation (`ncss` endpoint)**:
   - The THREDDS NetCDF Subset Service (NCSS) automatically substitutes coordinate `DEPTH` with the cell midpoints: `[0.0, 17.5, 52.5, 125.0, 275.0, 500.0]`.
   - NCSS renames the boundary coordinate variable from `DEPTH_bnds` to `DEPTH_bounds`.
   - All archived local subsets in `backend/data/raw/ocean/currents/*_bob_subset.nc` were acquired via NCSS, and therefore store these rewritten midpoint values.

3. **Pipeline Configuration (`OCEANX_MODEL_DEPTH_AXIS`)**:
   - `native` (default): Reconstructs the producer's raw file levels `[0.0, 10.0, 50.0, 100.0, 250.0, 500.0]` from `DEPTH_bounds` (`rule="native_from_bounds"`) when stored `DEPTH` matches the midpoints, and falls back to stored `DEPTH` (`rule="native_file"`) if bounds are absent or already raw.
   - `ncss_file` (legacy): Preserves the stored file `DEPTH` coordinate as served by NCSS.
   - `file` (deprecated alias for `ncss_file`) and `bounds_nodes` (deprecated alias for `native`).

4. **Remaining Open Question**:
   - Whether the 6 native depth levels represent layer centres, layer interfaces, or computational grid nodes in INCOIS's HYCOM numerical scheme remains unconfirmed with INCOIS. The native axis matches the producer's raw file, but is not claimed to be physically proven correct.
