# Turtle Lab
[![Deploy to GitHub Pages](https://github.com/UserDevtec/turtle-lab/actions/workflows/deploy.yml/badge.svg)](https://github.com/UserDevtec/turtle-lab/actions/workflows/deploy.yml)

RDF Turtle Lab is een webapp om Turtle (.ttl) te laden, RDF‑triples te bekijken en SPARQL‑queries uit te voeren. De app ondersteunt OTL‑queries (Nodes/Edges/Paths) en exporteert resultaten naar Excel met dezelfde structuur als de GUI V5 tool.

Live demo: https://userdevtec.github.io/turtle-lab

## Features
- Upload of sleep een .ttl; parsing gebeurt automatisch.
- Dropdown met queries uit `src/queries`, bewerkbare query‑editor met syntax highlighting.
- Query‑resultaten met filtering en lazy loading.
- OTL‑queries: preview van Paths, Excel export met Paths/Nodes/Edges/Data/ExportInfo/Unieken.
- Excel‑export met kolomvertalingen uit `src/dictionaries/rdf_column_translations.json`.
- Log tab met downloadbare log.

## Gebruik
1) Selecteer of sleep een Turtle bestand in de Input.
2) Kies een query of pas deze aan.
3) Run de query en download Excel indien gewenst.

## Ontwikkelen
```bash
npm install
npm run dev
```

## Opmerkingen
- Sommige queries gebruiken `$var` placeholders; deze werken als normale variabelen in de query‑editor.
- Browser‑notificaties verschijnen na een query (toestemming vereist).
