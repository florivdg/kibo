# Datenexport einer Kita

Jede Kita kann ihre Daten jederzeit als eine JSON-Datei herunterladen – zum
Aufbewahren, für den Wechsel zu einer anderen Kibo-Instanz (auch einer
selbst betriebenen) oder als Rückgabe der Daten am Ende einer
Auftragsverarbeitung. Diese Seite beschreibt das Format Feld für Feld; sie ist
das öffentliche Verzeichnis der Exportformate von Kibo (EU-Datenverordnung,
Art. 26). Wie eine Kita die Datei herunterlädt, steht unter
[Daten exportieren](../fuer-kitas/datenexport.md).

## Wer exportieren kann

- **Inhaberin, Inhaber und Admins** einer Kita, angemeldet im Admin-Bereich:
  „Kita-Einstellungen“ → „Daten exportieren“. Der Download kommt von
  `/admin/kita/export` (`src/pages/admin/kita/export.ts`) und enthält immer
  die gerade **aktive** Kita. Wer dort nicht Mitglied ist, bekommt 404 und
  keine Daten.
- **Auch eine pausierte Kita** im [gehosteten Modus](./konfiguration.md#gehosteter-modus)
  exportiert ihre Daten, bis sie gelöscht ist – gerade dann braucht sie sie.
- Gezählt wird ein kleines Budget (zehn Downloads pro Konto und Stunde, 15
  pro Konto und Tag, 30 pro Kita und Tag,
  [Spam-Schutz](./spam-schutz.md#datenexport)); darüber antwortet die App mit
  429 und der Wartezeit. Eine Anfrage von einer anderen Seite (`Sec-Fetch-Site`
  nicht `same-origin`) bekommt 403 und zählt nicht.

Die Antwort ist `application/json; charset=utf-8` mit
`Content-Disposition: attachment; filename="kibo-<kita-name>-<JJJJ-MM-TT>.json"`
(Name in Kleinbuchstaben ohne Umlaute, Tag in Berliner Zeit) und wie jede
Seite unter `/admin` `Cache-Control: private, no-store`.

## Was enthalten ist – und was nicht

Enthalten sind der Name der Kita, alle Bretter mit Art, Kategorien und
Einstellungen und alle **aktuellen** Zettel, also die, deren Laufzeit zum
Zeitpunkt des Exports noch nicht abgelaufen ist. Alles wird in einem Zug
gelesen: Datei und Datenbank zeigen denselben Augenblick.

Nicht enthalten sind:

- **abgelaufene Zettel** – die App löscht sie ohnehin stündlich,
- der **Kita-Link** (er ist ein Schlüssel zu den Brettern; die neue Instanz
  erzeugt einen eigenen),
- die **Schlüssel zum Abnehmen** eines Zettels (gespeichert sind nur ihre
  Hashes; sie gehören zum Browser der Eltern),
- **Benachrichtigungs-Abos** (sie gehören zum Browser und zur Domain der
  Instanz),
- **Meldungen** samt Kopien gemeldeter Zettel,
- **Mitglieder, Einladungen** und Konten,
- der **Datenschutz-Kontakt** der Kita,
- auf der gehosteten Instanz das **Abo** und die Rechnungsdaten.

## Aufbau

Ein Beispiel mit einem Brett und einem Zettel:

```json
{
  "format": "kibo-kita-export",
  "version": 1,
  "exportedAt": "2026-10-05T08:30:00.000Z",
  "kita": {
    "name": "Kita Sonnenschein"
  },
  "boards": [
    {
      "id": "0b3c5d4e-7a51-4c8e-9f0e-2d6f1a3b9c77",
      "type": "fundkiste",
      "typeLabel": "Fundkiste",
      "categories": [
        { "id": "gesucht", "label": "Gesucht" },
        { "id": "gefunden", "label": "Gefunden" }
      ],
      "name": "Fundkiste",
      "description": "Verlorenes und Gefundenes aus allen Gruppen",
      "pushEnabled": true,
      "createdAt": "2026-09-01T07:12:44.120Z",
      "updatedAt": "2026-09-01T07:12:44.120Z",
      "notes": [
        {
          "id": "6f2a9e1c-3d4b-4e5f-8a7b-1c2d3e4f5a6b",
          "categoryId": "gefunden",
          "title": "Blaue Mütze mit Fuchs",
          "body": "Lag am Montag im Garten neben der Rutsche.",
          "author": "Anna (Igelgruppe)",
          "contact": null,
          "createdAt": "2026-10-04T15:02:10.512Z",
          "expiresAt": "2026-10-18T15:02:10.512Z"
        }
      ]
    }
  ]
}
```

Alle Zeitpunkte sind Zeichenketten nach ISO 8601 in UTC
(`JJJJ-MM-TTThh:mm:ss.sssZ`). Alle Texte sind so, wie sie gespeichert sind:
UTF-8, ohne HTML, Zeilenumbrüche als `\n`.

## Felder

### Dokument

| Feld         | Typ          | Bedeutung                                                   |
| ------------ | ------------ | ----------------------------------------------------------- |
| `format`     | Zeichenkette | immer `"kibo-kita-export"` – kennzeichnet die Datei         |
| `version`    | Zahl         | Version des Formats, hier `1` ([Versionen](#versionen))     |
| `exportedAt` | Zeitpunkt    | wann exportiert wurde; „aktuell“ bezieht sich auf diesen    |
| `kita`       | Objekt       | die Kita ([Kita](#kita))                                    |
| `boards`     | Liste        | alle Bretter der Kita, das älteste zuerst ([Brett](#brett)) |

### Kita

| Feld   | Typ          | Bedeutung                                                         |
| ------ | ------------ | ----------------------------------------------------------------- |
| `name` | Zeichenkette | Name der Kita, wie er auf den Brettern und im Admin-Bereich steht |

### Brett

| Feld          | Typ           | Bedeutung                                                                                        |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `id`          | Zeichenkette  | Kennung des Bretts (UUID); Teil seiner Adresse `/k/<Kita-Link>/<id>/`                            |
| `type`        | Zeichenkette  | Art des Bretts: `"fundkiste"`, `"biete-suche"` oder `"pinnwand"`                                 |
| `typeLabel`   | Zeichenkette  | Name der Art, wie der Admin-Bereich ihn zeigt („Fundkiste“, „Biete & Suche“, „Pinnwand“)         |
| `categories`  | Liste         | die festen Kategorien dieser Art, je `{ "id", "label" }`, in der Reihenfolge des Formulars       |
| `name`        | Zeichenkette  | Name des Bretts                                                                                  |
| `description` | Zeichenkette  | Beschreibung auf der Kita-Seite; leer, wenn keine eingetragen ist                                |
| `pushEnabled` | Wahrheitswert | ob Eltern Benachrichtigungen für neue Zettel einschalten dürfen                                  |
| `createdAt`   | Zeitpunkt     | wann das Brett angelegt wurde                                                                    |
| `updatedAt`   | Zeitpunkt     | wann es zuletzt geändert wurde                                                                   |
| `notes`       | Liste         | die aktuellen Zettel des Bretts, der neueste zuerst ([Zettel](#zettel)); leer, wenn keiner hängt |

Die Kategorien der drei Arten:

| `type`        | Kategorien (`id` – `label`)                             |
| ------------- | ------------------------------------------------------- |
| `fundkiste`   | `gesucht` – Gesucht, `gefunden` – Gefunden              |
| `biete-suche` | `biete` – Biete, `suche` – Suche                        |
| `pinnwand`    | `hinweis` – Hinweis, `frage` – Frage, `termin` – Termin |

### Zettel

| Feld         | Typ                      | Bedeutung                                                                       |
| ------------ | ------------------------ | ------------------------------------------------------------------------------- |
| `id`         | Zeichenkette             | Kennung des Zettels (UUID)                                                      |
| `categoryId` | Zeichenkette             | Kategorie, eine der `categories` des Bretts                                     |
| `title`      | Zeichenkette             | Überschrift                                                                     |
| `body`       | Zeichenkette             | Text                                                                            |
| `author`     | Zeichenkette             | der Name, den die Person beim Anpinnen angegeben hat                            |
| `contact`    | Zeichenkette oder `null` | Kontaktangabe, wenn eine angegeben wurde, sonst `null`                          |
| `createdAt`  | Zeitpunkt                | wann der Zettel angepinnt wurde                                                 |
| `expiresAt`  | Zeitpunkt                | wann er abläuft (7, 14 oder 30 Tage nach dem Anpinnen); immer nach `exportedAt` |

## Versionen

`format` und `version` stehen am Anfang jeder Datei. Ein Programm, das die
Datei liest, prüft beide und lehnt ab, was es nicht kennt.

- **Version 1** ist das Format auf dieser Seite.
- Jede Änderung am Format – ein neues Feld, ein entferntes, eine geänderte
  Bedeutung – bekommt eine neue Versionsnummer und wird hier beschrieben;
  die bisherigen Versionen bleiben auf dieser Seite stehen.

Ein Import in eine andere Instanz ist in Kibo noch nicht eingebaut. Die
Datei enthält alles, was eine neue Instanz braucht, um dieselben Bretter mit
denselben Zetteln anzulegen; den Kita-Link und die Benachrichtigungen bringt
jede Instanz selbst mit.

Code: `src/lib/board/kita-export.ts`, Tests: `tests/kita-export.test.ts`.
