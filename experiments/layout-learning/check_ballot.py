"""Check the generated ballot in a standalone file preview and in an interactive browser."""
import argparse
import json
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright


def loaded_images(page, expected):
    images = page.locator("img.art")
    assert images.count() == expected
    assert images.evaluate_all(
        "imgs => imgs.every(i => i.src.startsWith('data:image/webp;base64,') && i.complete && i.naturalWidth > 0)"
    )


def verify(work, browser_path=None):
    key = json.loads((work / "blind-key.json").read_text(encoding="utf-8"))
    questions = [r["question"] for r in key["questions"]]
    total = len(questions)
    entry = work / "blind" / "index.html"
    with TemporaryDirectory() as temp, sync_playwright() as driver:
        # A file preview may receive only the HTML, without its sibling media directory.
        url = Path(copyfile(entry, Path(temp) / "ballot.html")).resolve().as_uri()
        options = {"executable_path": str(browser_path)} if browser_path else {}
        browser = driver.chromium.launch(headless=True, **options)
        static = browser.new_context(java_script_enabled=False)
        page = static.new_page()
        page.goto(url, wait_until="load")
        loaded_images(page, 2 * total)
        assert page.locator(".case:visible").count() == total
        assert page.locator("#actions").is_hidden()
        if total:
            for number, q in enumerate(questions, 1):
                case = page.locator(f'.case[data-question="{q}"]')
                assert str(number) in case.get_by_role("heading").inner_text()
                assert case.get_by_role("radio").count() == 4
                case.get_by_role("radio", name="选 B", exact=True).check()
                assert case.get_by_role("radio", name="选 B", exact=True).is_checked()
        static.close()

        interactive = browser.new_context(accept_downloads=True)
        page = interactive.new_page()
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        page.goto(url, wait_until="load")
        loaded_images(page, 2 * total)
        if total:
            votes = {}
            labels = [("选 A", "A"), ("选 B", "B"), ("一样合适", "tie"), ("都不采用", "neither")]
            for i, q in enumerate(questions):
                assert page.locator(".case:visible").get_attribute("data-question") == q
                label, choice = labels[i % len(labels)]
                votes[q] = choice
                page.get_by_role("radio", name=label, exact=True).check()
                if i + 1 < total:
                    page.get_by_role("button", name="下一组").click()
            assert page.get_by_role("button", name="下一组").is_disabled()
            page.reload(wait_until="load")
            assert page.get_by_role("radio", name="选 A", exact=True).is_checked()
            page.get_by_role("button", name="放大方案 A").click()
            assert page.locator("dialog").is_visible()
            assert page.locator("#large").evaluate("i => i.complete && i.naturalWidth > 0")
            page.get_by_role("button", name="关闭").click()
            with page.expect_download() as download:
                page.get_by_role("button", name="导出选择").click()
            ballot = json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
            assert ballot["digest"] == key["digest"] and ballot["choices"] == votes
            assert ballot["version"] == key["version"] and ballot["ballotId"]
        assert not errors
        assert all(r == url or r.startswith(("data:", "blob:")) for r in requests)
        interactive.close()

        if total:
            narrow = browser.new_context(viewport={"width": 390, "height": 844})
            narrow.add_init_script("Object.defineProperty(window, 'localStorage', {get(){throw new Error('unavailable')}});")
            page = narrow.new_page()
            page.goto(url, wait_until="load")
            page.get_by_role("radio", name="选 B", exact=True).check()
            assert page.get_by_role("button", name="导出选择").is_enabled()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            narrow.close()
        browser.close()
    print(f"{total} pairs visible with scripts disabled and no sibling files. Interactive choices and export passed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("--browser", type=Path, help="Path to an installed Chromium-based browser")
    args = parser.parse_args()
    verify(args.work, args.browser)

