#!/usr/bin/env python3
"""
Qui-Ski: divide ski.json.gz (scritto da osm_ski.py per tutta Italia) in tessere per l'app.

  py -3.12 -X utf8 strumenti/tessere.py ..\\PBF\\OSM-Italia\\ski.json.gz dati

Scrive:
  dati/indice.json         data dei dati OSM, lato delle tessere, elenco delle tessere e dei comprensori
                           (nome, centro, riquadro, km di piste e numero di impianti)
  dati/t/<i>_<j>.json      gli elementi la cui geometria inizia nella tessera (i = floor(lat/LATO), j = floor(lon/LATO))

Formato compatto di un elemento: {"k": tipo, "id": ..., "tags": {...}, e "g" (una linea [[lat,lon],...]),
"tr" (più linee, per le relazioni) oppure "p" ([lat,lon], per i punti)}.
Tipi: P pista, I impianto, S stazione, L bar/ristorante/rifugio, Z comprensorio.
"""
import gzip
import json
import math
import os
import shutil
import sys

LATO = 0.2                       # lato delle tessere in gradi
CIFRE = 5                        # decimali delle coordinate (circa 1 m)
PISTE = {"downhill", "connection", "nordic"}
IMPIANTI_NO = {"pylon", "goods", "zip_line", "station"}
LOCALI = {"restaurant", "bar", "cafe", "fast_food", "pub"}
TIENI = {"name", "ref", "piste:type", "piste:difficulty", "piste:grooming", "piste:name", "piste:ref", "lit",
         "aerialway", "aerialway:capacity", "aerialway:duration", "aerialway:occupancy", "aerialway:bubble",
         "aerialway:heating", "aerialway:bicycle", "bicycle", "note", "amenity", "tourism", "cuisine",
         "opening_hours", "phone", "contact:phone", "website", "contact:website", "ele", "landuse", "operator",
         "oneway", "area"}


def pulisci(t):
    t = {k: v for k, v in t.items() if k in TIENI}
    if "piste:name" in t and "name" not in t:
        t["name"] = t.pop("piste:name")
    if "piste:ref" in t and "ref" not in t:
        t["ref"] = t.pop("piste:ref")
    if "contact:phone" in t and "phone" not in t:
        t["phone"] = t.pop("contact:phone")
    if "contact:website" in t and "website" not in t:
        t["website"] = t.pop("contact:website")
    if t.get("aerialway") is None:
        t.pop("note", None)
    return t


def linea(geom):
    return [[round(p["lat"], CIFRE), round(p["lon"], CIFRE)] for p in geom]


def tipo(t):
    if t.get("piste:type") in PISTE:
        return "P"
    a = t.get("aerialway")
    if a == "station":
        return "S"
    if a and a not in IMPIANTI_NO:
        return "I"
    if t.get("landuse") == "winter_sports":
        return "Z"
    if t.get("amenity") in LOCALI or t.get("tourism") == "alpine_hut":
        return "L"
    return None


def lunghezza(g):
    m = 0.0
    for (a, b), (c, d) in zip(g, g[1:]):
        dy = (c - a) * 111320
        dx = (d - b) * 111320 * math.cos(math.radians(a))
        m += math.hypot(dx, dy)
    return m


def main():
    sorgente = sys.argv[1]
    uscita = sys.argv[2] if len(sys.argv) > 2 else "dati"
    with gzip.open(sorgente, "rt", encoding="utf-8") as f:
        dati = json.load(f)
    el = dati["elements"]
    base = dati.get("osm3s", {}).get("timestamp_osm_base", "")

    # vie delle piste con i propri tag: servono per non disegnare due volte le relazioni
    vie_piste = {e["id"] for e in el if e["type"] == "way" and tipo(e.get("tags", {})) == "P"}

    uscite = []
    for e in el:
        t = e.get("tags", {})
        k = tipo(t)
        if not k:
            continue
        o = {"k": k, "id": ("w" if e["type"] == "way" else "n" if e["type"] == "node" else "r") + str(e["id"]),
             "tags": pulisci(t)}
        if e["type"] == "relation":
            membri = [m for m in e.get("members", []) if m.get("geometry")]
            if k == "P":
                # se quasi tutte le vie della relazione sono già piste per conto loro, la relazione non serve
                proprie = sum(1 for m in membri if m["ref"] in vie_piste)
                if membri and proprie >= len(membri) / 2:
                    continue
                o["tr"] = [linea(m["geometry"]) for m in membri if len(m["geometry"]) >= 2]
            elif k == "Z":
                esterni = [m for m in membri if m.get("role") in ("outer", "")] or membri
                o["tr"] = [linea(m["geometry"]) for m in esterni if len(m["geometry"]) >= 2]
            else:
                continue
            if not o["tr"]:
                continue
        elif e["type"] == "way" and "geometry" in e:
            o["g"] = linea(e["geometry"])
            if k in ("S", "L"):
                g = o.pop("g")
                o["p"] = [round(sum(p[0] for p in g) / len(g), CIFRE), round(sum(p[1] for p in g) / len(g), CIFRE)]
        elif e["type"] == "way" and "center" in e:
            o["p"] = [round(e["center"]["lat"], CIFRE), round(e["center"]["lon"], CIFRE)]
        elif e["type"] == "node":
            o["p"] = [round(e["lat"], CIFRE), round(e["lon"], CIFRE)]
        else:
            continue
        uscite.append(o)

    def punti(o):
        if "g" in o:
            return o["g"]
        if "tr" in o:
            return [p for g in o["tr"] for p in g]
        return [o["p"]]

    # comprensori: nome, centro, riquadro; km di piste e impianti dentro il riquadro
    comprensori = []
    for o in uscite:
        if o["k"] != "Z":
            continue
        pp = punti(o)
        s, n = min(p[0] for p in pp), max(p[0] for p in pp)
        w, e = min(p[1] for p in pp), max(p[1] for p in pp)
        comprensori.append({"id": o["id"], "nome": o["tags"].get("name", ""), "c": [round((s + n) / 2, 4), round((w + e) / 2, 4)],
                            "b": [round(s, 4), round(w, 4), round(n, 4), round(e, 4)], "km": 0.0, "imp": 0})
    griglia = {}
    for c in comprensori:
        s, w, n, e = c["b"]
        for i in range(math.floor(s / LATO), math.floor(n / LATO) + 1):
            for j in range(math.floor(w / LATO), math.floor(e / LATO) + 1):
                griglia.setdefault((i, j), []).append(c)
    for o in uscite:
        if o["k"] not in ("P", "I"):
            continue
        pp = punti(o)
        a = pp[len(pp) // 2]
        for c in griglia.get((math.floor(a[0] / LATO), math.floor(a[1] / LATO)), ()):
            s, w, n, e = c["b"]
            if s <= a[0] <= n and w <= a[1] <= e:
                if o["k"] == "P" and o["tags"].get("piste:type") == "downhill":
                    c["km"] += sum(lunghezza(g) for g in ([o["g"]] if "g" in o else o["tr"])) / 1000
                elif o["k"] == "I":
                    c["imp"] += 1
    for c in comprensori:
        c["km"] = round(c["km"], 1)
    # senza nome e senza piste: non servono nell'elenco
    comprensori = [c for c in comprensori if c["nome"] or c["km"] >= 1]
    comprensori.sort(key=lambda c: (-c["km"], c["nome"]))

    # tessere
    tessere = {}
    for o in uscite:
        p = punti(o)[0]
        tessere.setdefault(f"{math.floor(p[0] / LATO)}_{math.floor(p[1] / LATO)}", []).append(o)
    cartella = os.path.join(uscita, "t")
    if os.path.isdir(cartella):
        shutil.rmtree(cartella)
    os.makedirs(cartella)
    totale = 0
    for nome, lista in tessere.items():
        percorso = os.path.join(cartella, nome + ".json")
        with open(percorso, "w", encoding="utf-8") as f:
            json.dump(lista, f, ensure_ascii=False, separators=(",", ":"))
        totale += os.path.getsize(percorso)
    indice = {"osm": base, "lato": LATO, "tessere": sorted(tessere), "comprensori": comprensori}
    with open(os.path.join(uscita, "indice.json"), "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, separators=(",", ":"))

    conta = {}
    for o in uscite:
        conta[o["k"]] = conta.get(o["k"], 0) + 1
    print(f"{len(uscite)} elementi ({', '.join(f'{n} {k}' for k, n in sorted(conta.items()))}), "
          f"{len(tessere)} tessere, {totale / 1048576:.1f} MB; {len(comprensori)} comprensori nell'indice")


if __name__ == "__main__":
    main()
