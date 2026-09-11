from pathlib import Path
import json
import numpy as np
import xarray as xr


# ============================================================
# OceanLens - INCOIS HYCOM Bay of Bengal Extractor
# ============================================================

ROOT = Path(__file__).resolve().parents[1]

RAW_FILE = (
    ROOT
    / "data"
    / "raw"
    / "ocean"
    / "currents"
    / "RSMC_hycom_20260908.nc"
)

PROCESSED_DIR = ROOT / "data" / "processed" / "ocean"
OUTPUT_FILE = PROCESSED_DIR / "incois_hycom_bob_surface.nc"
METADATA_FILE = PROCESSED_DIR / "incois_hycom_bob_metadata.json"


# ------------------------------------------------------------
# Bay of Bengal extraction area
# ------------------------------------------------------------
# Deliberately focused on the Bay of Bengal and surrounding
# northern Indian Ocean.
#
# Longitude: 80E - 100E
# Latitude : 5N  - 25N
# ------------------------------------------------------------

MIN_LON = 80.0
MAX_LON = 100.0

MIN_LAT = 5.0
MAX_LAT = 25.0


print("=" * 72)
print("OCEANLENS - INCOIS HYCOM BAY OF BENGAL EXTRACTOR")
print("=" * 72)

print(f"\nSource:")
print(RAW_FILE)

if not RAW_FILE.exists():
    raise FileNotFoundError(
        f"\nHYCOM file not found:\n{RAW_FILE}"
    )

print(f"\nOutput:")
print(OUTPUT_FILE)

PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------
# Open source dataset lazily
# ------------------------------------------------------------

print("\nOpening source dataset...")
print("The original 9.85 GB file will NOT be modified.")

ds = xr.open_dataset(
    RAW_FILE,
    engine="netcdf4",
    chunks={}
)

print("Source opened successfully.")


# ------------------------------------------------------------
# Validate coordinates
# ------------------------------------------------------------

required_coords = ["LAT", "LON", "TIME", "DEPTH"]

for coord in required_coords:
    if coord not in ds.coords:
        raise RuntimeError(
            f"Required coordinate '{coord}' was not found."
        )


# ------------------------------------------------------------
# Print source information
# ------------------------------------------------------------

print("\nSource dimensions:")

for name, size in ds.sizes.items():
    print(f"  {name:10} {size}")


# ------------------------------------------------------------
# Select Bay of Bengal
# ------------------------------------------------------------

print("\nSelecting Bay of Bengal region...")

bob = ds.sel(
    LON=slice(MIN_LON, MAX_LON),
    LAT=slice(MIN_LAT, MAX_LAT),
)

print(
    f"Region: "
    f"{MIN_LAT}°N to {MAX_LAT}°N, "
    f"{MIN_LON}°E to {MAX_LON}°E"
)

print("\nSelected dimensions:")

for name, size in bob.sizes.items():
    print(f"  {name:10} {size}")


# ------------------------------------------------------------
# Select surface layer
# ------------------------------------------------------------

print("\nSelecting surface depth...")

depth_values = bob["DEPTH"].values

print("Available depths:", depth_values)

# Select the shallowest available depth.
surface_depth = float(depth_values[0])

print(f"Using surface depth: {surface_depth} m")

surface = bob.sel(
    DEPTH=surface_depth,
    method="nearest"
)


# ------------------------------------------------------------
# Verify required variables
# ------------------------------------------------------------

required_variables = [
    "UVEL",
    "VVEL",
    "TEMP",
    "SALN",
    "SSH",
    "TCHP",
    "MLD",
]

print("\nChecking required variables...")

missing = [
    variable
    for variable in required_variables
    if variable not in surface.data_vars
]

if missing:
    raise RuntimeError(
        f"Missing required variables: {missing}"
    )

for variable in required_variables:
    print(f"  OK  {variable}")


# ------------------------------------------------------------
# Build OceanLens dataset
# ------------------------------------------------------------

print("\nBuilding OceanLens surface dataset...")

ocean = surface[
    [
        "UVEL",
        "VVEL",
        "TEMP",
        "SALN",
        "SSH",
        "TCHP",
        "MLD",
    ]
].copy()


# ------------------------------------------------------------
# Calculate current speed
# ------------------------------------------------------------

print("Calculating current speed...")

ocean["CURRENT_SPEED"] = np.sqrt(
    ocean["UVEL"] ** 2
    + ocean["VVEL"] ** 2
)

ocean["CURRENT_SPEED"].attrs = {
    "units": "m/s",
    "long_name": "Ocean current speed",
}


# ------------------------------------------------------------
# Calculate current direction
# ------------------------------------------------------------
#
# Bearing toward which the current is moving:
# 0°   = North
# 90°  = East
# 180° = South
# 270° = West
#
# atan2(U, V) gives a bearing measured clockwise from North.
# ------------------------------------------------------------

print("Calculating current direction...")

direction = (
    np.degrees(
        np.arctan2(
            ocean["UVEL"],
            ocean["VVEL"],
        )
    )
    + 360.0
) % 360.0

ocean["CURRENT_DIRECTION"] = direction

ocean["CURRENT_DIRECTION"].attrs = {
    "units": "degrees",
    "long_name": "Ocean current direction toward which current flows",
    "convention": "0=N, 90=E, 180=S, 270=W",
}


# ------------------------------------------------------------
# Add dataset-level metadata
# ------------------------------------------------------------

ocean.attrs = {
    "title": "OceanLens Bay of Bengal Ocean Conditions",
    "source": "INCOIS RSMC HYCOM",
    "source_file": "RSMC_hycom_20260908.nc",
    "data_status": "REAL",
    "provider": "Indian National Centre for Ocean Information Services (INCOIS)",
    "region": "Bay of Bengal",
    "latitude_range": f"{MIN_LAT} to {MAX_LAT} degrees north",
    "longitude_range": f"{MIN_LON} to {MAX_LON} degrees east",
    "depth_selected_m": surface_depth,
    "processing": "OceanLens regional surface extraction",
    "original_data_preserved": "true",
}


# ------------------------------------------------------------
# Encoding
# ------------------------------------------------------------

encoding = {}

for variable in ocean.data_vars:

    encoding[variable] = {
        "zlib": True,
        "complevel": 4,
        "dtype": "float32",
    }


# ------------------------------------------------------------
# Write processed NetCDF
# ------------------------------------------------------------

print("\nWriting processed dataset...")
print("This may take a while because the source data is large.")

ocean.to_netcdf(
    OUTPUT_FILE,
    engine="netcdf4",
    encoding=encoding,
)

print("\nProcessed NetCDF created.")


# ------------------------------------------------------------
# Create metadata JSON
# ------------------------------------------------------------

metadata = {
    "dataset": "OceanLens Bay of Bengal Ocean Conditions",
    "status": "REAL",
    "provider": "INCOIS",
    "source_product": "RSMC HYCOM",
    "source_file": "RSMC_hycom_20260908.nc",
    "source_date": "2026-09-08",
    "region": {
        "min_lat": MIN_LAT,
        "max_lat": MAX_LAT,
        "min_lon": MIN_LON,
        "max_lon": MAX_LON,
    },
    "surface_depth_m": surface_depth,
    "time_start": str(ocean["TIME"].values[0]),
    "time_end": str(ocean["TIME"].values[-1]),
    "time_steps": int(ocean.sizes["TIME"]),
    "variables": {
        "UVEL": {
            "meaning": "Eastward ocean current",
            "units": "m/s",
        },
        "VVEL": {
            "meaning": "Northward ocean current",
            "units": "m/s",
        },
        "CURRENT_SPEED": {
            "meaning": "Ocean current speed",
            "units": "m/s",
        },
        "CURRENT_DIRECTION": {
            "meaning": "Current direction",
            "units": "degrees",
        },
        "TEMP": {
            "meaning": "Ocean temperature at surface layer",
            "units": "as provided by source",
        },
        "SALN": {
            "meaning": "Ocean salinity at surface layer",
            "units": "as provided by source",
        },
        "SSH": {
            "meaning": "Sea surface height",
            "units": "m",
        },
        "TCHP": {
            "meaning": "Tropical Cyclone Heat Potential",
            "units": "KJ/cm2",
        },
        "MLD": {
            "meaning": "Mixed Layer Depth",
            "units": "as provided by source",
        },
    },
    "original_file": str(RAW_FILE),
    "processed_file": str(OUTPUT_FILE),
}


with open(
    METADATA_FILE,
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        metadata,
        f,
        indent=2,
    )


# ------------------------------------------------------------
# Final report
# ------------------------------------------------------------

print("\n" + "=" * 72)
print("EXTRACTION COMPLETE")
print("=" * 72)

print(f"\nProcessed dataset:")
print(OUTPUT_FILE)

print(f"\nMetadata:")
print(METADATA_FILE)

print("\nVariables:")

for variable in ocean.data_vars:
    print(f"  - {variable}")

print("\nTime:")
print(f"  {ocean['TIME'].values[0]}")
print(f"  →")
print(f"  {ocean['TIME'].values[-1]}")

print("\nRegion:")
print(
    f"  {MIN_LAT}°N → {MAX_LAT}°N"
)
print(
    f"  {MIN_LON}°E → {MAX_LON}°E"
)

print("\nData status: REAL")
print("Provider: INCOIS")
print("\nOriginal 9.85 GB source file was NOT modified.")

print("\n" + "=" * 72)