const DEFAULT_PREVIEW_LIMIT = 500;

const e7ToDeg = (v) => (typeof v === "number" ? v / 1e7 : null);
const round = (v, d = 4) => Math.round(v * (10 ** d)) / (10 ** d);
const coordKey = (lat, lng) => `${round(lat, 4)},${round(lng, 4)}`;

const parseIso = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

const haversineKm = (a, b) => {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

function parseGeoString(input) {
  if (!input) return null;

  let s = input;
  if (typeof input === "object" && input.latLng) s = input.latLng;
  if (typeof s !== "string") return null;

  s = s.trim()
    .replace(/^geo:/i, "")
    .replaceAll("\u00b0", "");

  const parts = s.split(",").map(x => parseFloat(x.trim()));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;

  return { lat: parts[0], lng: parts[1] };
}

function detectType(json) {
  if (Array.isArray(json)) return "device_export_array";
  if (json && Array.isArray(json.semanticSegments)) return "device_export_object";
  if (json && Array.isArray(json.timelineObjects)) return "semantic_takeout";
  if (json && Array.isArray(json.locations)) return "records_takeout";
  return "unknown";
}

function extractDeviceExportVisits(json) {
  const segs = Array.isArray(json) ? json : (json.semanticSegments || []);
  const out = [];

  for (const seg of segs) {
    const start = seg.startTime || null;
    const end = seg.endTime || null;

    const tc = seg.visit?.topCandidate;
    if (tc) {
      const placeId = tc.placeId || tc.placeID || tc.placeID || null;
      const semanticType = tc.semanticType || "Unknown";

      const loc = parseGeoString(tc.placeLocation);
      if (loc) {
        const startMs = start ? Date.parse(start) : null;
        const endMs = end ? Date.parse(end) : null;
        const seconds = (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)
          ? (endMs - startMs) / 1000
          : 0;

        out.push({
          kind: "placeVisit",
          lat: loc.lat,
          lng: loc.lng,
          placeId,
          name: semanticType,
          address: null,
          start,
          end,
          seconds
        });
        continue;
      }
    }
  }

  return out;
}

function extractSemantic(allJson) {
  const out = [];
  for (const json of allJson) {
    for (const obj of (json.timelineObjects || [])) {
      const pv = obj.placeVisit;
      if (!pv) continue;

      const dur = pv.duration || {};
      const loc = pv.location || {};
      const latE7 = (typeof loc.latitudeE7 === "number") ? loc.latitudeE7 : pv.centerLatE7;
      const lngE7 = (typeof loc.longitudeE7 === "number") ? loc.longitudeE7 : pv.centerLngE7;
      const lat = e7ToDeg(latE7);
      const lng = e7ToDeg(lngE7);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const startMs = parseIso(dur.startTimestamp);
      const endMs = parseIso(dur.endTimestamp);
      const seconds = (startMs && endMs && endMs > startMs) ? (endMs - startMs) / 1000 : 0;

      out.push({
        kind: "placeVisit",
        lat, lng,
        placeId: loc.placeId || null,
        name: loc.name || null,
        address: loc.address || null,
        start: dur.startTimestamp || null,
        end: dur.endTimestamp || null,
        seconds,
      });
    }
  }
  return out;
}

function extractRecordsAsStays(allJson) {
  const points = [];
  for (const json of allJson) {
    for (const rec of (json.locations || [])) {
      const lat = e7ToDeg(rec.latitudeE7);
      const lng = e7ToDeg(rec.longitudeE7);
      const ts = rec.timestamp || (rec.timestampMs ? new Date(Number(rec.timestampMs)).toISOString() : null);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !ts) continue;
      points.push({ lat, lng, ts, placeId: rec.placeId || null });
    }
  }
  points.sort((a, b) => a.ts.localeCompare(b.ts));

  const stays = [];
  let cur = null;

  const finalize = () => {
    if (!cur) return;
    const startMs = Date.parse(cur.start);
    const endMs = Date.parse(cur.end);
    const seconds = (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)
      ? (endMs - startMs) / 1000
      : 0;
    if (seconds >= 10 * 60) {
      stays.push({
        kind: "stay",
        lat: cur.sumLat / cur.n,
        lng: cur.sumLng / cur.n,
        placeId: cur.placeId || null,
        name: null,
        address: null,
        start: cur.start,
        end: cur.end,
        seconds
      });
    }
  };

  for (const p of points) {
    if (!cur) {
      cur = { start: p.ts, end: p.ts, n: 1, sumLat: p.lat, sumLng: p.lng, placeId: p.placeId };
      continue;
    }
    const center = { lat: cur.sumLat / cur.n, lng: cur.sumLng / cur.n };
    const distKm = haversineKm(center, p);
    const gapMs = Date.parse(p.ts) - Date.parse(cur.end);

    if (distKm <= 0.2 && gapMs <= 30 * 60 * 1000) {
      cur.end = p.ts;
      cur.n += 1;
      cur.sumLat += p.lat;
      cur.sumLng += p.lng;
      cur.placeId = cur.placeId || p.placeId;
    } else {
      finalize();
      cur = { start: p.ts, end: p.ts, n: 1, sumLat: p.lat, sumLng: p.lng, placeId: p.placeId };
    }
  }
  finalize();
  return stays;
}

function aggregate(items, geoCache) {
  const places = new Map();
  const cities = new Map();
  const countries = new Map();

  const normPlaceName = (it) =>
    it.name || (it.address ? it.address.split("\n")[0] : null) || (it.placeId ? it.placeId : coordKey(it.lat, it.lng));

  for (const it of items) {
    const k = coordKey(it.lat, it.lng);
    const geo = geoCache.get(k) || {};
    const country = geo.country || null;
    const city = geo.city || null;

    const placeKey = it.placeId || k;
    if (!places.has(placeKey)) {
      places.set(placeKey, {
        key: placeKey,
        name: normPlaceName(it),
        lat: it.lat, lng: it.lng,
        visits: 0,
        seconds: 0,
        city, country
      });
    }
    const p = places.get(placeKey);
    p.visits += 1;
    p.seconds += it.seconds || 0;
    p.city = p.city || city;
    p.country = p.country || country;

    if (city) {
      const ck = `${city}${country ? ", " + country : ""}`;
      if (!cities.has(ck)) cities.set(ck, { name: ck, visits: 0, seconds: 0 });
      const c = cities.get(ck);
      c.visits += 1;
      c.seconds += it.seconds || 0;
    }

    if (country) {
      if (!countries.has(country)) countries.set(country, { name: country, visits: 0, seconds: 0 });
      const c = countries.get(country);
      c.visits += 1;
      c.seconds += it.seconds || 0;
    }
  }

  const arrSort = (m) => Array.from(m.values()).sort((a, b) => (b.seconds - a.seconds) || (b.visits - a.visits));
  return {
    countries: arrSort(countries),
    cities: arrSort(cities),
    places: arrSort(places),
  };
}

async function readJsons(source) {
  if (source?.url) {
    self.postMessage({ type: "progress", message: "Fetching file..." });
    const response = await fetch(source.url);
    if (!response.ok) throw new Error("Fetch failed: " + response.status);
    self.postMessage({ type: "progress", message: "Reading file..." });
    const text = await response.text();
    self.postMessage({ type: "progress", message: "Parsing JSON..." });
    return [JSON.parse(text)];
  }

  const files = source?.files || [];
  if (!files.length) return [];

  const jsons = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    self.postMessage({ type: "progress", message: `Reading file ${i + 1}/${files.length}...` });
    const text = await f.text();
    self.postMessage({ type: "progress", message: `Parsing file ${i + 1}/${files.length}...` });
    jsons.push(JSON.parse(text));
  }
  return jsons;
}

self.onmessage = async function (e) {
  const { type, source, options } = e.data || {};
  if (type !== "load") return;

  try {
    const jsons = await readJsons(source);
    if (!jsons.length) throw new Error("No JSON files provided.");

    const dataType = detectType(jsons[0]);
    if (dataType === "unknown") {
      throw new Error("Couldn't detect format. Expected Takeout or on-device export.");
    }

    self.postMessage({ type: "progress", message: "Extracting visits..." });

    let visits = [];
    if (dataType === "semantic_takeout") {
      visits = extractSemantic(jsons);
    } else if (dataType === "records_takeout") {
      visits = extractRecordsAsStays(jsons);
    } else if (dataType === "device_export_array") {
      visits = jsons.flatMap(j => extractDeviceExportVisits(j));
    } else if (dataType === "device_export_object") {
      visits = jsons.flatMap(j => extractDeviceExportVisits(j));
    }

    const visitsCount = visits.length;
    const previewLimit = options?.previewLimit ?? DEFAULT_PREVIEW_LIMIT;
    const visitsPreview = visits.slice(0, previewLimit);
    const includeVisits = !!options?.includeVisits;

    if (includeVisits) {
      self.postMessage({
        type: "done",
        data: { dataType, visitsCount, visits }
      });
      return;
    }

    self.postMessage({ type: "progress", message: "Aggregating..." });
    const geoCache = new Map(Object.entries(options?.geoCache || {}));
    const agg = aggregate(visits, geoCache);
    self.postMessage({
      type: "done",
      data: { dataType, visitsCount, visitsPreview, agg }
    });
  } catch (err) {
    self.postMessage({ type: "error", error: err?.message || String(err) });
  }
};
