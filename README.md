# Qui-Ski

Web app per il telefono per chi scia, con lo stesso aspetto e funzionamento di Qui-Trekking:
piste, impianti, bar e ristoranti dei **comprensori sciistici di tutta Italia**, da OpenStreetMap.

- Da lontano (zoom basso) la mappa mostra i **comprensori** (`landuse=winter_sports`) come pallini blu, più grandi
  per quelli con più km di piste; toccandone uno lo si inquadra. La ricerca in alto trova un comprensorio per nome.
- Da vicino: **piste** colorate come in Italia (verde, blu, rossa, nera; fondo viola tratteggiato; collegamenti
  grigi tratteggiati) con numero, **impianti di risalita** con nome, **stazioni**, **confine del comprensorio**
  e **bar, ristoranti e rifugi** a meno di 300 m da piste o impianti.
- Schede a tutto schermo per piste, impianti e locali; elenco della zona visibile per distanza o per nome,
  ed elenco di tutti i comprensori.
- Pulsanti in basso: impianto più vicino (alla stazione a valle) e bar o ristorante più vicino.

## Simulazione

Se il GPS non c'è, non è permesso o non è in Italia, l'app fa finta che tu sia alla stazione delle cabinovie
di Pila (in alto compare **Simulazione**): così distanze e "più vicino" si possono provare da casa.

## Dati

1. Sul computer, accanto a `osm_italia.py`, `osm_ski.py` legge il PBF Italia di Geofabrik e scrive `ski.json.gz`:

       py -3.12 -X utf8 osm_ski.py italy-latest.osm.pbf

2. `strumenti/tessere.py` lo divide in tessere da 0,2° e scrive l'indice dei comprensori:

       py -3.12 -X utf8 strumenti/tessere.py ..\PBF\OSM-Italia\ski.json.gz dati

   - `dati/indice.json`: data dei dati, elenco delle tessere e dei comprensori (nome, centro, riquadro, km di piste, impianti)
   - `dati/t/<i>_<j>.json`: gli elementi che iniziano nella tessera

L'app scarica solo le tessere della zona che si guarda.

Dati © OpenStreetMap e chi contribuisce (ODbL). Mappa topografica © OpenTopoMap (CC-BY-SA).
Il PBF Italia non contiene la parte svizzera o francese dei comprensori di confine (per esempio Zermatt).

## Pubblicazione

Impostazioni del repository → Pages → Source: **GitHub Actions**. A ogni modifica su `main` il workflow
`.github/workflows/pubblica.yml` pubblica il sito su https://quivicino.github.io/Ski/.
