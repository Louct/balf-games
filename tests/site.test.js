import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function helpers(initial = {}, blocked = false) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem(key) {
      if (blocked) throw new Error("Storage disabled");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (blocked) throw new Error("Storage disabled");
      data.set(key, String(value));
    },
    removeItem(key) {
      if (blocked) throw new Error("Storage disabled");
      data.delete(key);
    },
  };
  const context = {
    URL,
    URLSearchParams,
    localStorage: storage,
    sessionStorage: storage,
    location: {
      href: "https://aetheris.test/index.html",
      origin: "https://aetheris.test",
    },
    document: {
      addEventListener() {},
      documentElement: { style: { setProperty() {} }, classList: { add() {} } },
    },
  };
  context.window = context;
  context.parent = context;
  context.addEventListener = () => {};
  context.innerHeight = 1180;
  vm.runInNewContext(
    fs.readFileSync(new URL("../public/js/site.js", import.meta.url), "utf8"),
    context,
  );
  return context.Aetheris;
}

test("shared URL validation rejects missing values and unsafe schemes", () => {
  const site = helpers();
  for (const input of [
    undefined,
    null,
    "",
    "   ",
    123,
    "javascript:alert(1)",
    "data:text/html,bad",
    "https://user:pass@example.com/",
  ])
    assert.equal(site.httpUrl(input), null);
  assert.equal(
    site.httpUrl("/load.html?game=abc"),
    "https://aetheris.test/load.html?game=abc",
  );
});

test("routes retain game/search arguments and reject unknown pages or origins", () => {
  const site = helpers();
  assert.equal(
    site.parseRoute("#load?game=two+words").url,
    "load.html?game=two+words",
  );
  assert.equal(
    site.routeForUrl("https://aetheris.test/search.html?q=hello%20world").route,
    "search?q=hello+world",
  );
  for (const value of ["__proto__", "../settings", "javascript:alert(1)"])
    assert.equal(site.parseRoute(value), null);
  assert.equal(
    site.routeForUrl("https://different.example/load.html?game=abc"),
    null,
  );
});

test("favorites tolerate malformed storage and normalize numeric IDs", () => {
  assert.equal(
    JSON.stringify(
      helpers({ favorites: '[1,"1","a",null,{}]' }).readList("favorites"),
    ),
    '["1","a"]',
  );
  assert.equal(
    JSON.stringify(helpers({ favorites: "broken JSON" }).readList("favorites")),
    "[]",
  );
  const site = helpers({}, true);
  assert.equal(site.storage.setItem("value", "temporary"), false);
  assert.equal(site.storage.getItem("value"), "temporary");
  site.storage.removeItem("value");
  assert.equal(site.storage.getItem("value"), null);
});
