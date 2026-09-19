"""Our polar stereographic formulas must match the CRS embedded in the LOLA DEMs."""

import numpy as np
import pytest
from lunar_core.terrain import polar_stereographic_south
from pyproj import CRS, Transformer

# CRS WKT as published in LDEM_80S_20MPP_ADJ.TIF / LDEM_60S_240MPP_ADJ.TIF (PGDA product 90).
LOLA_WKT = (
    'PROJCS["Moon (2015) - Sphere / Ocentric / South Polar",'
    'GEOGCS["Moon (2015) - Sphere / Ocentric",DATUM["Moon (2015) - Sphere",'
    'SPHEROID["Moon (2015) - Sphere",1737400,0]],PRIMEM["Reference Meridian",0],'
    'UNIT["degree",0.0174532925199433]],PROJECTION["Polar_Stereographic"],'
    'PARAMETER["latitude_of_origin",-90],PARAMETER["central_meridian",0],'
    'PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],'
    'AXIS["Easting",NORTH],AXIS["Northing",NORTH]]'
)


def test_matches_pyproj_with_lola_crs():
    crs = CRS.from_wkt(LOLA_WKT)
    to_map = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
    lats = np.array([-89.9, -89.5, -88.0, -85.0, -80.0, -70.0])
    lons = np.array([0.0, 45.0, 120.0, 222.0, 300.0, 359.0])

    expected_x, expected_y = to_map.transform(lons, lats)
    x, y = polar_stereographic_south(lats, lons)

    assert x == pytest.approx(expected_x, abs=0.01)
    assert y == pytest.approx(expected_y, abs=0.01)
