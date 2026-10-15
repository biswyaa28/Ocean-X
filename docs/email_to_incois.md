DRAFT: review before sending.

Dear INCOIS Team,

Regarding dataset osf/currents2 RSMC_hycom_<date>.nc on incois.gov.in/thredds:
- Via OPeNDAP (dodsC), DEPTH = 0, 10, 50, 100, 250, 500 and DEPTH_bnds = [-5,5],[5,30],[30,75],[75,175],[175,375],[375,625].
- Via the NetCDF Subset Service (ncss), DEPTH is returned as 0, 17.5, 52.5, 125, 275, 500 (the midpoints of the bounds), and the bounds variable is named DEPTH_bounds instead of DEPTH_bnds.

Could you please clarify:
1. Are 0, 10, 50, 100, 250 and 500 m the model's actual vertical level depths? If so, are they layer centres, layer interfaces or something else?
2. Is the NCSS replacement of DEPTH by bound midpoints expected, and which values should users treat as authoritative?
3. Is there a document we can cite for this configuration?

Thank you for your assistance.

Doom's Coders, SIH26067 (OCEAN-X)
