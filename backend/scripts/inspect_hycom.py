from pathlib import Path
import xarray as xr

# backend/scripts/inspect_hycom.py
# Dataset is:
# backend/data/raw/ocean/currents/RSMC_hycom_20260908.nc

ROOT = Path(__file__).resolve().parents[1]

FILE = ROOT / "data" / "raw" / "ocean" / "currents" / "RSMC_hycom_20260908.nc"

print("=" * 70)
print("OCEANLENS - INCOIS HYCOM INSPECTOR")
print("=" * 70)

print(f"\nFile:")
print(FILE)

if not FILE.exists():
    print("\nERROR: File not found.")
    raise SystemExit(1)

size_gb = FILE.stat().st_size / (1024 ** 3)

print(f"\nFile size: {size_gb:.2f} GB")
print("\nOpening NetCDF metadata...")
print("This does NOT load the entire dataset into RAM.\n")

try:
    ds = xr.open_dataset(
        FILE,
        engine="netcdf4",
        decode_times=True,
        chunks={}
    )

    print("=" * 70)
    print("DIMENSIONS")
    print("=" * 70)

    for name, size in ds.sizes.items():
        print(f"{name:25} {size}")

    print("\n" + "=" * 70)
    print("COORDINATES")
    print("=" * 70)

    for name, coord in ds.coords.items():
        print(f"\n{name}")
        print(f"  Dimensions : {coord.dims}")
        print(f"  Shape      : {coord.shape}")
        print(f"  Units      : {coord.attrs.get('units', 'N/A')}")
        print(f"  Long name  : {coord.attrs.get('long_name', 'N/A')}")

        # Safely show small coordinate ranges
        try:
            if coord.size <= 100000:
                values = coord.values

                if values.size > 0:
                    print(f"  First      : {values.flat[0]}")
                    print(f"  Last       : {values.flat[-1]}")
        except Exception:
            pass

    print("\n" + "=" * 70)
    print("VARIABLES")
    print("=" * 70)

    for name, var in ds.data_vars.items():

        print(f"\n{name}")
        print(f"  Dimensions : {var.dims}")
        print(f"  Shape      : {var.shape}")
        print(f"  Data type  : {var.dtype}")
        print(f"  Units      : {var.attrs.get('units', 'N/A')}")
        print(f"  Long name  : {var.attrs.get('long_name', 'N/A')}")
        print(f"  Standard   : {var.attrs.get('standard_name', 'N/A')}")

    print("\n" + "=" * 70)
    print("GLOBAL ATTRIBUTES")
    print("=" * 70)

    for key, value in ds.attrs.items():
        print(f"{key}: {value}")

    print("\n" + "=" * 70)
    print("OCEANLENS VARIABLE DETECTION")
    print("=" * 70)

    variables = {name.lower(): name for name in ds.data_vars}

    groups = {
        "Ocean Current U": [
            "water_u",
            "u",
            "uo",
            "u_velocity",
            "eastward_sea_water_velocity",
        ],
        "Ocean Current V": [
            "water_v",
            "v",
            "vo",
            "v_velocity",
            "northward_sea_water_velocity",
        ],
        "Sea Surface Temperature": [
            "sst",
            "temperature",
            "water_temp",
            "thetao",
            "sea_surface_temperature",
        ],
        "Salinity": [
            "salinity",
            "so",
            "sss",
            "sea_surface_salinity",
        ],
        "Sea Surface Height": [
            "ssh",
            "zos",
            "sea_surface_height",
        ],
        "Mixed Layer Depth": [
            "mld",
            "mixed_layer_depth",
        ],
        "Tropical Cyclone Heat Potential": [
            "tchp",
            "tropical_cyclone_heat_potential",
        ],
    }

    for group, candidates in groups.items():

        found = []

        for candidate in candidates:
            if candidate in variables:
                found.append(variables[candidate])

        if found:
            print(f"FOUND  {group}: {', '.join(found)}")
        else:
            print(f"NOT FOUND  {group}")

    print("\n" + "=" * 70)
    print("INSPECTION COMPLETE")
    print("=" * 70)

    ds.close()

except Exception as e:
    print("\nERROR while opening NetCDF:")
    print(type(e).__name__)
    print(str(e))

    print("\nIf this is a NetCDF/HDF5 library issue, send me the")
    print("complete error output before changing anything.")

    raise