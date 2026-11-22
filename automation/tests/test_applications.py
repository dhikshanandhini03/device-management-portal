import pytest
from playwright.sync_api import expect

from pages.application_page import ApplicationPage

pytestmark = [pytest.mark.applications, pytest.mark.regression]


@pytest.fixture
def apps(admin_page) -> ApplicationPage:
    return ApplicationPage(admin_page).open()


@pytest.fixture(scope="module")
def api_apps(admin_api):
    return {a["package_id"]: a for a in admin_api.json("GET", "/applications")}


@pytest.mark.smoke
def test_view_installed_applications(apps, api_apps):
    assert apps.rows.count() == len(api_apps)
    assert set(apps.packages()) == set(api_apps)


def test_search_application_name(apps):
    apps.search("Netflix")
    assert apps.names() == ["Netflix"]


def test_verify_package_identifier(apps, api_apps):
    apps.search("Fibe TV")
    row = apps.row_for("ca.bell.fibetv")
    expect(row.get_by_test_id("cell-app-package")).to_have_text("ca.bell.fibetv")
    assert "ca.bell.fibetv" in api_apps


def test_verify_application_version(apps, api_apps):
    for package_id, app in list(api_apps.items())[:5]:
        expect(apps.row_for(package_id).get_by_test_id("cell-app-latest")).to_have_text(app["latest_version"])


def test_filter_application_category(apps, api_apps):
    apps.filter_category("Streaming")
    expected = {p for p, a in api_apps.items() if a["category"] == "Streaming"}
    assert set(apps.packages()) == expected


def test_filter_application_versions(apps):
    apps.open_application("ca.bell.crave")
    versions = apps.version_counts()
    assert len(versions) >= 2
    version = sorted(versions)[0]
    apps.filter_installations_by_version(version)
    installed = apps.installation_versions()
    assert installed and set(installed) == {version}


def test_view_application_distribution(apps, admin_api, api_apps):
    # Streaming apps are not provisioned on automation-created devices, so counts are stable during parallel runs.
    apps.open_application("com.netflix.ninja")
    detail = admin_api.json("GET", f"/applications/{api_apps['com.netflix.ninja']['id']}")
    assert apps.version_counts() == {v["version"]: v["device_count"] for v in detail["versions"]}
    assert sum(apps.version_counts().values()) == detail["device_count"]
    expect(apps.by_id("chart-app-versions-body").locator("svg.recharts-surface")).to_be_visible()
    assert apps.detail_package() == "com.netflix.ninja"


def test_verify_update_availability(apps, api_apps):
    apps.filter_updates("Updates available")
    shown = set(apps.packages())
    expected = {p for p, a in api_apps.items() if a["update_available_count"] > 0}
    assert shown == expected
    for package_id in list(shown)[:3]:
        expect(apps.row_for(package_id).get_by_test_id("cell-app-updates")).to_have_text(
            str(api_apps[package_id]["update_available_count"]))
