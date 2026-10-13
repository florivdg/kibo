# Updates

Vorher ins [CHANGELOG](../../CHANGELOG.md) schauen: Dort steht unter „Hinweise
zum Update“, was sich für den Betrieb ändert. Dann `KIBO_IMAGE_TAG` in der
`.env` auf die neue Version setzen und:

```sh
cd /opt/kibo
./update.sh
```

Das Skript macht genau das, worauf es bei einem Update ankommt – und in dieser
Reihenfolge:

```sh
./backup.sh                       # 1. sichern (sicherung.md)
docker compose pull               # 2. neue Images holen
docker compose run --rm migrate   # 3. Migration einmalig ausführen
docker compose up -d --wait       # 4. erst danach die App austauschen
```

Schritt 4 wartet, bis die App `healthy` ist (höchstens `WAIT_TIMEOUT`
Sekunden, Vorgabe 180). Wird sie es nicht, endet das Skript mit Fehler und
nennt den Weg zurück: die Version, die vor dem Update lief (aus dem laufenden
Container gelesen, bevor irgendetwas geändert wurde), und die Sicherung von
eben. Das hilft nur mit einem festen Tag in `KIBO_IMAGE_TAG`, nicht mit
`latest` oder `main`.

## Warum nicht einfach `docker compose up -d`?

Compose würde den alten
App-Container **zuerst** stoppen und die Migration erst danach starten.
Schlägt sie fehl, bleibt die Instanz unerreichbar liegen (`app` bleibt im
Zustand _Created_), und das lässt sich nur von Hand wieder geraderücken. Mit
Schritt 3 vorweg bricht ein Update bei einer fehlerhaften Migration ab,
**bevor** die laufende Version angefasst wird:

```
service "migrate" didn't complete successfully: exit 1
```

Die Abhängigkeit `service_completed_successfully` in der `compose.yml` bleibt
trotzdem wichtig: Sie verhindert, dass eine neue App jemals auf ein nicht
migriertes Schema trifft – auch beim Erststart oder nach einem Neustart des
Servers.

App, Migration, optionaler Fixture-Helfer und separater Lastgenerator erhalten
dieselben Image-Tags (`ghcr.io/florivdg/kibo`,
`ghcr.io/florivdg/kibo-migrate`, `ghcr.io/florivdg/kibo-load-fixtures` und
`ghcr.io/florivdg/kibo-load-runner`). Im Stack steuert `KIBO_IMAGE_TAG` die
App, Migration und den Fixture-Helfer; den Runner-Tag wählt man auf dem
separaten Generator. Die CI baut alle vier Images und vergibt die
Tags (`1.2.0`, `latest`, `main`) erst, wenn **alle** Builds erfolgreich waren;
scheitert einer, bleiben die bisherigen Tags stehen. Die Images werden danach
nacheinander getaggt, nicht in einem Schritt: Bricht die CI dazwischen ab,
können Tags vorübergehend verschiedene Stände bezeichnen, bis der Lauf
wiederholt ist. Mit einer festen Version in `KIBO_IMAGE_TAG` fällt das nicht
ins Gewicht – ein Versions-Tag entsteht nur einmal. Der Helfer wird nur bei
expliziten [Lasttest-Befehlen](./lasttests.md) gestartet. Der Runner läuft
ausschließlich auf einem separaten Generator, nicht im Anwendungsstack.

## Rollback

Ein älteres Image kennt das neue Schema nicht. Ein Rückschritt
ist deshalb nur zusammen mit dem Einspielen der Sicherung von **vor** dem
Update sicher: alten `KIBO_IMAGE_TAG` eintragen, Datenbank aus der Sicherung
wiederherstellen ([Sicherung und Wiederherstellung](./sicherung.md#wiederherstellen)),
dann `docker compose up -d`.

Bleibt eine Instanz nach einem abgebrochenen Update doch einmal unten (`app`
startet nicht, weil die Migration fehlschlägt), hilft: Ursache im Log
(`docker compose logs migrate`) beheben oder alten Tag und Sicherung von vor
dem Update einspielen, danach `docker compose up -d`.

## Update auf 1.2.0

- **Ein Link pro Kita.** Statt eines Links pro Brett hat jede Kita einen
  Kita-Link `/k/<kita-link>/`, der alle ihre Bretter zeigt; ein Brett liegt
  unter `/k/<kita-link>/<brett>/`. Eltern legen die Kita einmal auf den
  Home-Bildschirm und schalten Benachrichtigungen Brett für Brett ein
  ([Bretter](../fuer-kitas/bretter.md),
  [Benachrichtigungen](../fuer-kitas/benachrichtigungen.md)). Einen neuen Link
  gibt es nur noch für die ganze Kita. Migration `0009` legt die Tabelle
  `kita_link` an und entfernt die Spalte `board.token`; sie läuft wie jede
  Migration über das Migrations-Image. Jede Kita bekommt ihren Kita-Link beim
  ersten Aufruf. Neue Umgebungsvariablen gibt es nicht.
  - Ein Netz darf jetzt **150 statt 30 neue Abos pro Stunde** anlegen, weil
    ein Handy mehrere Bretter abonniert; die Budgets eines Bretts zählen pro
    Brett und Kita-Link ([Spam-Schutz](./spam-schutz.md)).
  - Die Datenschutzerklärung braucht die geänderten Abschnitte „Zettel auf
    den Brettern“ und „Benachrichtigungen“ aus `deploy/legal/datenschutz.md`
    (was das Gerät speichert, Abos pro Brett über den Kita-Link).
- **Zettel melden.** Eltern können Zettel ohne Konto melden; die Inhaberin
  oder der Inhaber und alle Admins der Kita bekommen dazu eine E-Mail und
  bearbeiten die Meldungen unter „Meldungen“ im Admin-Bereich
  ([Meldungen](../fuer-kitas/meldungen.md)). Migration `0008` legt die
  Tabellen `report_case`, `note_report` und `report_notification` an und läuft
  wie jede Migration über das Migrations-Image. Neue Umgebungsvariablen gibt
  es nicht; für die E-Mails muss `SMTP_*` eingerichtet sein ([SMTP](./smtp.md)),
  ohne bleiben die Meldungen im Admin-Bereich trotzdem sichtbar. Fälle werden
  nach 30 beziehungsweise 90 Tagen gelöscht
  ([Betrieb](./betrieb.md#meldungen-und-ihre-e-mails)). Die
  Datenschutzerklärung braucht dafür den neuen Abschnitt „Zettel melden“ aus
  `deploy/legal/datenschutz.md`.
- Migration `0006` legt die Tabelle `hosted_subscription` an (bleibt ohne
  `HOSTED` leer), Migration `0007` ergänzt sie um zwei Spalten
  (`deletion_notice_at`, `kitas_deleted_at`). Beide laufen wie jede Migration
  über das Migrations-Image. Für die Rollen braucht es keine: Wer eine Kita angelegt hat, ist seit jeher als
  `owner` eingetragen, und andere Mitglieder gab es bisher nicht.
- **Einladungen und Rollen.** Eine Kita kann jetzt mehrere Personen haben: Die
  Inhaberin oder der Inhaber (wer die Kita angelegt hat) lädt unter
  „Kita-Einstellungen“ Admins per E-Mail ein. Dafür muss `SMTP_*` eingerichtet
  sein ([SMTP](./smtp.md)). Mit `SIGNUP_MODE=closed` können sich Eingeladene
  über den Link aus der Mail registrieren; `SIGNUP_EMAIL_DOMAINS` gilt auch für
  sie
  ([Registrierung steuern](./konfiguration.md#registrierung-steuern-und-erstes-konto-anlegen)).
- **Konto löschen.** Löscht die Inhaberin oder der Inhaber das eigene Konto,
  werden ihre beziehungsweise seine Kitas mitgelöscht – auch wenn dort Admins
  mitverwalten; die Kontoseite warnt davor. Bisher blieb eine Kita bestehen,
  solange sie ein weiteres Mitglied hatte; das konnte es ohne Einladungen
  nicht geben. Löscht ein Admin sein Konto, endet nur die Mitgliedschaft.
- Das Limit von drei Kitas pro Konto zählt weiterhin die selbst angelegten
  Kitas; Mitgliedschaften per Einladung zählen nicht mit.
- `deploy/compose.yml` aus dem Repository neu übernehmen: Es reicht die neuen
  Variablen `SIGNUP_MODE`, `SIGNUP_EMAIL_DOMAINS`, `HOSTED`, `DOCS_URL`,
  `SOURCE_URL`, die vier `OPERATOR_*`-Angaben (`OPERATOR_NAME`,
  `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `OPERATOR_LEGAL_INFO`) und die des
  [gehosteten Modus](./konfiguration.md#gehosteter-modus) an die App durch.
  Mit der alten Datei bleibt die Registrierung offen und ohne Domain-Liste,
  auch wenn die Variablen in der `.env` stehen.
- Ohne die Variablen ändert sich nichts, bis auf die neuen Links „Hilfe“
  (nächster Punkt) und „Quelltext“ (letzter Punkt). Ein ungültiger Wert lässt
  die App nicht starten ([Startprüfung](./einrichtung.md#startprüfung)).
- **Hilfe im Admin-Bereich.** Die Seitenleiste hat einen neuen Link „Hilfe“,
  der in einem neuen Fenster die Dokumentation öffnet – ohne weitere Angabe
  die im Repository auf GitHub. Wer seinen Kitas eine eigene Anleitung geben
  will, trägt deren Adresse als `DOCS_URL` ein
  ([Hilfe-Link](./konfiguration.md#hilfe-link)). `HOSTED` bleibt auf einer
  selbst gehosteten Instanz aus.
- **Betreiberangaben und Datenschutz in E-Mails.** Jede Mail endet jetzt mit
  einem Fuß: wer die Instanz betreibt (`OPERATOR_NAME`, `OPERATOR_ADDRESS`,
  `OPERATOR_EMAIL`, dazu `OPERATOR_LEGAL_INFO` für die Pflichtangaben der
  Rechtsform; Zeilen getrennt durch `|`) und vollständige Links zu Impressum
  und Datenschutzerklärung. Einladungen haben zusätzlich einen kurzen
  Datenschutzhinweis
  ([Betreiberangaben in E-Mails](./impressum-und-datenschutz.md#betreiberangaben-in-e-mails)).
  Keine Migration. Die App startet auch ohne die Angaben und warnt im Log
  (`[mail] Betreiberangaben unvollständig …`); fehlt eine der beiden Seiten,
  warnt das Log ebenfalls (`[legal] Für /impressum ist weder …`). Neu geprüft wird auf jeder
  Instanz: `IMPRESSUM_URL` und `DATENSCHUTZ_URL` müssen, wenn gesetzt,
  vollständige Adressen mit `https://` sein. Der Datenschutzhinweis der Einladung
  nennt den Betrieb als Ansprechpartner. Die Datenschutz-Vorlage
  beschreibt den Mailversand jetzt vollständig (Einladungen an Adressen ohne
  Konto, beide Schritte der Adressänderung,
  Versanddienstleister); wer sie
  übernommen hat, gleicht den Abschnitt „E-Mails“ ab. Zum Versanddienst selbst
  siehe [SMTP – Vor dem produktiven Versand](./smtp.md#vor-dem-produktiven-versand).
- **Verwaltungsskript.** `node dist/admin.mjs` kennt neben `create-user` den
  Befehl `remove-note`
  ([Rechtswidrige Inhalte](./rechtswidrige-inhalte.md)) und die Befehle des
  gehosteten Modus.
  `create-user` verhält sich wie bisher.
- **Die Dokumentation ist umgezogen.** Aus `docs/deployment.md` und
  `docs/spam-schutz.md` sind einzelne Seiten unter `docs/selbst-hosten/`
  geworden, dazu kommt eine Anleitung für Kitas unter `docs/fuer-kitas/`; das
  Inhaltsverzeichnis ist [`docs/README.md`](../README.md). Die beiden alten
  Dateien verweisen nur noch dorthin. Auch die Startprüfung nennt jetzt
  `docs/selbst-hosten/einrichtung.md`.

## Update auf 1.1.0

- Migration `0005` legt die Tabelle `push_subscription` und die Spalte
  `board.push_enabled` an und läuft wie jede Migration über das
  Migrations-Image.
- `deploy/compose.yml` aus dem Repository neu übernehmen: Es reicht die neuen
  Variablen `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und `VAPID_SUBJECT` an die
  App durch. Mit der alten Datei bleiben Benachrichtigungen aus, auch wenn die
  Variablen in der `.env` stehen.
- Benachrichtigungen sind optional
  ([Benachrichtigungen](./benachrichtigungen.md)). Wer sie einschaltet,
  ergänzt vorher die Datenschutzerklärung um den Abschnitt
  „Benachrichtigungen“ aus `deploy/legal/datenschutz.md`.

## Update auf 1.0.0

- **Alle melden sich einmal neu an.** Die Sitzungs-Cookies heißen im
  Produktions-Build jetzt `__Secure-…`; die alten Cookies werden nicht mehr
  gelesen.
- Migration `0004` legt einen Index an und läuft wie jede Migration über das
  Migrations-Image.
- Die App startet nur noch mit gültiger Konfiguration
  ([Startprüfung](./einrichtung.md#startprüfung)): Secret mit mindestens 32 Zeichen, `BETTER_AUTH_URL` mit
  `https://`.
- `deploy/compose.yml` und `update.sh`/`backup.sh` aus dem Repository neu
  übernehmen: Log-Rotation, Pflichtangaben, geänderte Traefik-Header
  ([Sicherheits-Header](./sicherheit.md#sicherheits-header)) und das Warten auf
  `healthy`.
- **Startseite und Quelltext-Link.** Am Fuß jeder Seite steht jetzt auf jeder
  Instanz der Link „Quelltext“ mit der laufenden Version; er führt auf das
  Repository von Kibo. Wer eine geänderte Fassung betreibt, trägt die Adresse
  ihres Quelltexts als `SOURCE_URL` ein (AGPL § 13,
  [Quelltext-Link](./konfiguration.md#quelltext-link-agpl)). Sonst bleibt die
  Startseite einer selbst gehosteten Instanz, wie sie war.
