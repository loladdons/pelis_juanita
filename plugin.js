// Premiere (pelisjuanita.org) — port para la app (contrato lol.json / CommonJS) — v0.3.0
//
// Ids: el id de cada título es "<ruta>/<slug>" (p. ej. "serie/the-boys"); el de un episodio es
// "<ruta>/<slug>#<temporada>x<episodio>". getMeta y getStreams los reciben tal cual.

const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const BASE = "https://pelisjuanita.org";
const API = BASE + "/api/rest/v1";
const HEAD = { "User-Agent": UA, Referer: BASE + "/" };
const ROW_LIMIT = 40;
const CACHE_MS = 10 * 60 * 1000;

const ROUTE_TO_API = { pelicula: "movie", serie: "serie", anime: "anime", novela: "novel", wwe: "wwe" };
const LIST_KIND = { peliculas: "movie", series: "serie", anime: "anime", novelas: "novel", wwe: "wwe" };

// ---------------------------------------------------------------------------------------------
// Utilidades

function mkErr(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}
function log() {
  try {
    console.log.apply(console, ["premiere:"].concat(Array.prototype.slice.call(arguments)));
  } catch (_) {}
}
function kfetch(url, opts) {
  opts = opts || {};
  const ms = opts.timeoutMs;
  const o = Object.assign({}, opts);
  delete o.timeoutMs;
  const p = fetch(url, o);
  if (!ms) return p;
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () {
      reject(new Error("timeout " + ms + "ms"));
    }, ms);
    p.then(
      function (v) { clearTimeout(t); resolve(v); },
      function (e) { clearTimeout(t); reject(e); }
    );
  });
}
async function api(path) {
  const r = await kfetch(API + path, { headers: HEAD, timeoutMs: 15000 });
  if (r.status === 404) throw mkErr("not_found", path);
  if (r.status === 429) throw mkErr("rate_limited", path);
  if (!r.ok) throw mkErr("unavailable", "HTTP " + r.status + " " + path);
  return r.json();
}
function getImgUrl(path, size) {
  if (!path) return undefined;
  if (String(path).indexOf("http") === 0) return String(path);
  return "https://image.tmdb.org/t/p/" + (size || "w500") + "/" + String(path).replace(/^\//, "");
}
function dedupe(items) {
  const seen = new Set();
  return items.filter(function (it) {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Items

function parseRoute(url) {
  const m = String(url || "").match(/\/(pelicula|serie|anime|novela|wwe)\/([^\/?#]+)/);
  return m ? { route: m[1], slug: m[2] } : null;
}

function toItems(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    if (!it || !it.title) continue;
    const r = parseRoute(it.url);
    if (!r) continue;
    const poster = getImgUrl(it.poster_path, "w500");
    const item = {
      id: r.route + "/" + r.slug,
      title: it.title,
      type: r.route === "pelicula" || r.route === "wwe" ? "movie" : "series",
      poster: poster,
      backdrop: getImgUrl(it.backdrop_path, "w780") || poster,
    };
    const y = it.year ? parseInt(it.year, 10) : NaN;
    if (!isNaN(y)) item.year = String(y);
    const ov = it.overview || it.description;
    if (ov) item.overview = String(ov);
    out.push(item);
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------------------------
// Home

function refForRowTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.indexOf("serie") >= 0) return "series";
  if (t.indexOf("anime") >= 0) return "anime";
  if (t.indexOf("novela") >= 0) return "novelas";
  if (t.indexOf("wwe") >= 0) return "wwe";
  if (t.indexOf("estreno") >= 0) return "genre-estrenos";
  return "peliculas";
}

async function getHome() {
  const year = new Date().getFullYear();
  const settled = await Promise.all([
    api("/home").catch(function (e) { log("home failed:", e && e.message); return null; }),
    api("/taxonomies/year/" + year + "?page=1&limit=30").catch(function () { return null; }),
  ]);
  const home = settled[0];
  const yearJson = settled[1];
  const rows = [];

  if (home && home.hero && home.hero.items && home.hero.items.length) {
    rows.push({
      id: "hero",
      title: "Destacados",
      type: "hero",
      imageStyle: "backdrop",
      items: toItems(home.hero.items).slice(0, 6),
    });
  }
  if (yearJson && yearJson.items && yearJson.items.length) {
    rows.push({
      id: "year-" + year,
      title: "Estrenos " + year,
      type: "row",
      imageStyle: "poster",
      catalogId: "year-" + year,
      items: toItems(yearJson.items).slice(0, ROW_LIMIT),
    });
  }
  if (home && Array.isArray(home.rows)) {
    for (const row of home.rows) {
      if (!row || !row.items || !row.items.length) continue;
      if (String(row.title || "").toLowerCase().indexOf("popular") >= 0) continue;
      const items = toItems(row.items).slice(0, ROW_LIMIT);
      if (!items.length) continue;
      rows.push({
        id: row.config && row.config.id ? String(row.config.id) : "row-" + rows.length,
        title: row.title,
        type: "row",
        imageStyle: "poster",
        catalogId: refForRowTitle(row.title),
        items: items,
      });
    }
  }
  if (!rows.length) throw mkErr("unavailable", "home: sin filas");
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Catálogos / descubrir / búsqueda

const GENRES = [
  ["terror", "Terror"],
  ["animacion", "Animación"],
  ["fantasia", "Fantasía"],
];

async function getCatalogs() {
  const year = new Date().getFullYear();
  const out = [
    { id: "year-" + year, title: "Estrenos " + year },
    { id: "peliculas", title: "Películas" },
    { id: "series", title: "Series" },
    { id: "anime", title: "Anime" },
    { id: "novelas", title: "Novelas" },
    { id: "wwe", title: "WWE" },
  ];
  GENRES.forEach(function (g) { out.push({ id: "genre-" + g[0], title: g[1] }); });
  return out;
}

function pageOut(json, page) {
  return {
    items: toItems(json.items),
    hasMore: !!(json.pagination && json.pagination.has_next),
    page: page,
  };
}

async function browseRef(ref, page, order) {
  ref = String(ref || "peliculas");
  let path;
  if (LIST_KIND[ref]) path = "/listing?kind=" + LIST_KIND[ref] + "&order=" + (order || "recent") + "&limit=24&page=" + page;
  else if (ref === "populares") path = "/listing?order=popular&limit=24&page=" + page;
  else if (ref === "genre-estrenos") path = "/listing?kind=movie&order=trending_7d&limit=24&page=" + page;
  else if (ref.indexOf("genre-") === 0) path = "/taxonomies/genre/" + ref.slice(6) + "?page=" + page + "&limit=30";
  else if (ref.indexOf("year-") === 0) path = "/taxonomies/year/" + ref.slice(5) + "?page=" + page + "&limit=30";
  else return { items: [], hasMore: false, page: page };
  return pageOut(await api(path), page);
}

async function getCatalog(catalogId, opts) {
  return browseRef(catalogId, Math.max(1, parseInt(opts && opts.page, 10) || 1));
}

async function getDiscoverFilters() {
  return [
    {
      id: "tipo",
      label: "Tipo",
      options: [
        { id: "peliculas", label: "Películas" },
        { id: "series", label: "Series" },
        { id: "anime", label: "Anime" },
        { id: "novelas", label: "Novelas" },
        { id: "wwe", label: "WWE" },
      ],
    },
    {
      id: "orden",
      label: "Orden",
      options: [
        { id: "recent", label: "Recientes" },
        { id: "popular", label: "Populares" },
        { id: "trending_7d", label: "Tendencia semanal" },
      ],
    },
    {
      id: "genero",
      label: "Género (ignora Tipo)",
      options: [{ id: "todos", label: "Todos" }].concat(GENRES.map(function (g) { return { id: g[0], label: g[1] }; })),
    },
  ];
}

async function getDiscover(opts) {
  opts = opts || {};
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const genero = String(opts.genero || "todos");
  if (genero !== "todos") return browseRef("genre-" + genero, page);
  return browseRef(String(opts.tipo || "peliculas"), page, String(opts.orden || "recent"));
}

async function search(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const json = await api("/search?q=" + encodeURIComponent(q));
  return toItems(json.items);
}

// ---------------------------------------------------------------------------------------------
// Detalle y episodios

function splitId(id) {
  const s = String(id);
  const hash = s.indexOf("#");
  const base = hash >= 0 ? s.slice(0, hash) : s;
  const frag = hash >= 0 ? s.slice(hash + 1) : "";
  const parts = base.split("/");
  const fm = frag.match(/^(\d+)x(\d+)$/);
  return {
    base: base,
    route: parts[0],
    slug: parts[1],
    season: fm ? Number(fm[1]) : null,
    episode: fm ? Number(fm[2]) : null,
  };
}

async function fetchSeason(itemId, seasonNum) {
  const eps = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= 60) {
    let j;
    try {
      j = await api("/episodes?item_id=" + itemId + "&season=" + seasonNum + "&limit=100&page=" + page);
    } catch (_) {
      break;
    }
    (j.episodes || []).forEach(function (ep) {
      if (!ep.playable) return;
      eps.push({
        season: seasonNum,
        number: Number(ep.episode),
        title: ep.title || "Episodio " + ep.episode,
        overview: ep.overview || "",
        still: getImgUrl(ep.still_path),
        player_url: ep.player_url || null,
      });
    });
    hasNext = !!(j.pagination && j.pagination.has_next);
    page++;
  }
  return eps;
}

const detailCache = {};
async function loadDetail(route, slug) {
  const key = route + "/" + slug;
  const hit = detailCache[key];
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const apiKind = ROUTE_TO_API[route];
  if (!apiKind || !slug) throw mkErr("not_found", "id inválido: " + key);
  const json = await api("/content/" + apiKind + "/" + slug);
  const item = json.item;
  if (!item) throw mkErr("not_found", "ficha no disponible: " + key);
  const isMovie = apiKind === "movie" || apiKind === "wwe";
  let episodes = [];
  if (!isMovie && item.catalog_item_id != null) {
    let seasons = [];
    try {
      seasons = (await api("/episode-seasons?item_id=" + item.catalog_item_id)).seasons || [];
    } catch (_) {}
    const lists = await Promise.all(
      seasons.map(function (s) { return fetchSeason(item.catalog_item_id, s.season); })
    );
    lists.forEach(function (l) { episodes = episodes.concat(l); });
    episodes.sort(function (a, b) { return a.season - b.season || a.number - b.number; });
  }
  const v = { json: json, item: item, isMovie: isMovie, episodes: episodes };
  detailCache[key] = { t: Date.now(), v: v };
  return v;
}

async function getMeta(id) {
  const p = splitId(id);
  const d = await loadDetail(p.route, p.slug);
  const it = d.item;
  const meta = {
    id: p.base,
    title: it.title,
    type: d.isMovie ? "movie" : "series",
    overview: it.overview || "",
    poster: getImgUrl(it.poster_path, "w500"),
    backdrop: getImgUrl(it.backdrop_path, "w1280"),
    genres: (d.json.genres || []).map(function (g) { return g.title; }).filter(Boolean),
  };
  const y = it.year ? parseInt(it.year, 10) : NaN;
  if (!isNaN(y)) meta.year = String(y);
  if (!d.isMovie) {
    const bySeason = {};
    d.episodes.forEach(function (ep) {
      (bySeason[ep.season] = bySeason[ep.season] || []).push({
        number: ep.number,
        id: p.base + "#" + ep.season + "x" + ep.number,
        title: ep.title,
        overview: ep.overview,
        still: ep.still,
      });
    });
    meta.seasons = Object.keys(bySeason)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (n) { return { number: n, name: "Temporada " + n, episodes: bySeason[n] }; });
  }
  return meta;
}

// ---------------------------------------------------------------------------------------------
// Streams: sigue iframes y botones del reproductor y junta TODOS los servidores que encuentra.

const RESOLVE_BUDGET_MS = 40000;

function hostOf(origin) {
  return String(origin).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/:\d+$/, "");
}

function findStream(code) {
  code = String(code).replace(/\\\//g, "/");
  const m =
    code.match(/(?:file|src|url)["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/i) ||
    code.match(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'\\<>]*)?/i);
  return m ? m[1] || m[0] : null;
}

async function collectStreams(initialUrl) {
  const visited = new Set();
  const found = [];
  const deadline = Date.now() + RESOLVE_BUDGET_MS;
  let seq = 0;

  async function extract(url, referer, depth) {
    if (depth > 3 || Date.now() > deadline) return;
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (visited.has(url)) return;
    visited.add(url);
    const mySeq = seq++;

    const om = url.match(/^(https?:\/\/[^\/]+)/i);
    const origin = om ? om[1] : url;
    try {
      const res = await kfetch(url, { headers: { "User-Agent": UA, Referer: referer }, timeoutMs: 10000 });
      if (!res.ok) return;
      const html = await res.text();

      const subs = [];
      const subRe = /(?:file|src|url)["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:vtt|srt)[^"']*)["']/gi;
      let sm;
      while ((sm = subRe.exec(html)) !== null) subs.push(sm[1]);

      let streamUrl = findStream(html);
      if (!streamUrl) {
        const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
        for (const s of scripts) {
          if (s.indexOf("eval(function(p,a,c,k,e,d)") < 0) continue;
          const pm = s.match(/eval\((function\(p,a,c,k,e,d\)[\s\S]+)\)/);
          if (!pm) continue;
          try {
            const unpacked = new Function("return (" + pm[1] + ");")();
            streamUrl = findStream(String(unpacked));
            if (streamUrl) break;
          } catch (_) {}
        }
      }

      if (streamUrl) {
        streamUrl = streamUrl.replace(/\\\//g, "/").replace(/&amp;/g, "&");
        found.push({
          seq: mySeq,
          name: hostOf(origin),
          url: streamUrl,
          isHls: /\.m3u8/i.test(streamUrl),
          headers: { "User-Agent": UA, Referer: origin + "/", Origin: origin },
          subtitles: subs.map(function (u, i) { return { label: "Subtítulo " + (i + 1), url: u }; }),
        });
        return;
      }

      const next = [];
      const iframeRe = /<iframe[^>]+src=["'](http[^"']+)["']/gi;
      let m;
      while ((m = iframeRe.exec(html)) !== null) next.push(m[1].replace(/&amp;/g, "&"));
      const dataRe = /(?:data-link|data-url|data-server)=["'](http[^"']+)["']/gi;
      while ((m = dataRe.exec(html)) !== null) next.push(m[1].replace(/&amp;/g, "&"));
      await Promise.all(next.map(function (u) { return extract(u, origin + "/", depth + 1); }));
    } catch (e) {
      log("fallo al explorar", url, e && e.message);
    }
  }

  await extract(initialUrl, BASE + "/", 0);
  found.sort(function (a, b) { return a.seq - b.seq; });
  const seen = new Set();
  return found.filter(function (f) {
    if (seen.has(f.url)) return false;
    seen.add(f.url);
    return true;
  });
}

async function getStreams(id, type, season, episode) {
  const p = splitId(id);
  const d = await loadDetail(p.route, p.slug);
  const s = season != null ? Number(season) : p.season;
  const e = episode != null ? Number(episode) : p.episode;

  let playerUrl = null;
  if (d.isMovie) {
    playerUrl = d.item.player_url || null;
  } else {
    const ep =
      d.episodes.find(function (x) { return (s == null || x.season === s) && x.number === e; }) ||
      (e == null ? d.episodes[0] : null);
    if (!ep) throw mkErr("not_found", "episodio no encontrado: " + p.base + " " + s + "x" + e);
    playerUrl = ep.player_url;
  }
  const start = playerUrl || BASE + "/" + p.route + "/" + p.slug;

  const streams = await collectStreams(start);
  if (!streams.length) {
    log("sin video para", p.base, "- los iframes pueden estar protegidos o caídos");
    return [];
  }
  return streams.map(function (st) {
    const out = { url: st.url, name: st.name, provider: "Premiere", headers: st.headers, isHls: st.isHls };
    if (st.subtitles.length) out.subtitles = st.subtitles;
    return out;
  });
}

module.exports = {
  getHome: getHome,
  getCatalogs: getCatalogs,
  getCatalog: getCatalog,
  getDiscoverFilters: getDiscoverFilters,
  getDiscover: getDiscover,
  search: search,
  getMeta: getMeta,
  getStreams: getStreams,
};
