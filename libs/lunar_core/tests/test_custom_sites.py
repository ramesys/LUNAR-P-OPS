import math

import pytest
from lunar_core.sites import custom_site, parse_custom_site_id


def test_custom_site_normalizes_longitude_and_rounds_to_a_stable_id():
    site = custom_site(-88.123456, -45.0)

    assert site.id == "custom:-88.1235:315"
    assert site.latitude_deg == -88.1235
    assert site.longitude_deg == 315.0
    assert site.origin == "custom"
    assert site.name == "Custom 88.12°S 315.00°E"


def test_ids_round_trip():
    site = custom_site(-86.5, 12.25)

    assert parse_custom_site_id(site.id) == site
    assert parse_custom_site_id(custom_site(-89.99999, 359.99999).id).longitude_deg == 0.0


@pytest.mark.parametrize(
    ("latitude", "longitude", "message"),
    [
        (-59.0, 0.0, "south polar region"),
        (10.0, 0.0, "south polar region"),
        (-91.0, 0.0, "south polar region"),
        (-80.0, 400.0, "longitude"),
        (-80.0, math.nan, "longitude"),
    ],
)
def test_custom_site_rejects_out_of_scope_coordinates(
    latitude: float, longitude: float, message: str
):
    with pytest.raises(ValueError, match=message):
        custom_site(latitude, longitude)


@pytest.mark.parametrize(
    "site_id",
    [
        "sample-a",
        "custom:",
        "custom:-88",
        "custom:a:b",
        "custom:-88:1:2",
        "custom:-10:0",
        "custom:-88,1",
    ],
)
def test_malformed_custom_ids_are_rejected(site_id: str):
    with pytest.raises(ValueError):
        parse_custom_site_id(site_id)
