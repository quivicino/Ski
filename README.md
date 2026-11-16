# Qui-Ski

Web app per il telefono per chi scia, con lo stesso aspetto e funzionamento di Qui-Trekking.
Per ora è una **simulazione sul comprensorio di Pila** (Valle d'Aosta).

- **Piste** di OpenStreetMap (`piste:type`), colorate come in Italia: verde (campo scuola), blu, rossa, nera;
  i collegamenti sono grigi tratteggiati. Numero della pista sulla linea, lunghezza, battitura.
- **Impianti di risalita** (`aerialway`): funivie, cabinovie, seggiovie, skilift e tappeti, con nome sulla mappa;
  la scheda ha tipo, lunghezza, durata della corsa, portata oraria, posti, cupola, stazioni a valle e a monte
  e le piste che partono dall'arrivo.
- **Stazioni** degli impianti, **confine del comprensorio** (`landuse=winter_sports`).
- **Bar e ristoranti** a meno di 300 m da una pista o da un impianto (rifugi `tourism=alpine_hut` se ci sono).
- Pulsanti in basso: impianto più vicino (alla stazione a valle) e bar o ristorante più vicino.
- Elenco a tutto schermo (piste, impianti, locali) per distanza o per nome; ogni voce apre la sua scheda.

## Simulazione

Se il GPS non c'è, non è permesso o è a più di 15 km da Pila, l'app fa finta che tu sia alla stazione delle
cabinovie di Pila (in alto compare **Simulazione**): così distanze e "più vicino" si possono provare da casa.

## Dati

`dati/pila.json` viene da `osm_ski.py` (sul computer, accanto a `osm_italia.py`), che legge il PBF Italia
di Geofabrik e scrive un file nello stesso formato di una risposta di Overpass:

    py -3.12 -X utf8 osm_ski.py italy-latest.osm.pbf --zona=pila

Dati © OpenStreetMap e chi contribuisce (ODbL). Mappa topografica © OpenTopoMap (CC-BY-SA).

## Pubblicazione

Impostazioni del repository → Pages → Source: **GitHub Actions**. A ogni modifica su `main` il workflow
`.github/workflows/pubblica.yml` pubblica il sito su https://quivicino.github.io/Ski/.

## File

- `index.html`, `style.css`: interfaccia (stili di Qui-Trekking, barra blu)
- `app.js`: mappa, piste, impianti, elenco, schede, posizione (vera o simulata)
- `dati/pila.json`: dati OSM di Pila
