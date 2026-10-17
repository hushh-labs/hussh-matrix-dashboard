"""Read the public TailAdmin demo's page catalogue without executing vendor scripts."""
import concurrent.futures
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

BASE = "https://demo.tailadmin.com/"


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()
        self.headings = []
        self.title = ""
        self.tables = 0
        self.charts = 0
        self.styles = set()
        self.capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            href = attrs.get("href", "")
            parsed = urlparse(urljoin(BASE, href))
            if parsed.netloc == "demo.tailadmin.com" and parsed.path.endswith(".html"):
                self.links.add(parsed.path.lstrip("/"))
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.styles.add(urljoin(BASE, attrs.get("href", "")))
        if tag in ("h1", "h2", "h3", "h4", "title"):
            self.capture = tag
        if tag == "table":
            self.tables += 1
        if "chart" in attrs.get("id", "").lower():
            self.charts += 1

    def handle_endtag(self, tag):
        if self.capture == tag:
            self.capture = None

    def handle_data(self, data):
        value = " ".join(data.split())
        if not value or not self.capture:
            return
        if self.capture == "title":
            self.title += value
        elif value not in self.headings:
            self.headings.append(value)


def read(path):
    try:
        with urlopen(Request(urljoin(BASE, path), headers={"User-Agent": "MetricsDesignAudit/1.0"}), timeout=25) as response:
            html = response.read().decode("utf-8", errors="replace")
            page = Page()
            page.feed(html)
            return {"path": path, "status": response.status, "title": page.title,
                    "headings": page.headings, "tables": page.tables, "chartContainers": page.charts,
                    "stylesheets": sorted(page.styles)}, page.links
    except Exception as error:
        return {"path": path, "error": str(error)}, set()


if __name__ == "__main__":
    first, links = read("analytics.html")
    results = [first]
    seen = {"analytics.html"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        while links - seen:
            pending = sorted(links - seen)
            seen.update(pending)
            for result, discovered in pool.map(read, pending):
                results.append(result)
                links.update(discovered)
    output = Path(".codex/artifacts/tailadmin-reference-audit.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"source": BASE, "pages": sorted(results, key=lambda p: p["path"])}, indent=2), encoding="utf-8")
    print(json.dumps({"pages": len(results), "successful": sum(p.get("status") == 200 for p in results),
                      "failed": [p for p in results if "error" in p], "report": str(output)}))
