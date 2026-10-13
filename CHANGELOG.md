# Changelog

Alle nennenswerten Änderungen an Kibo stehen in dieser Datei. Das Format folgt
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen folgen
[Semantic Versioning](https://semver.org/lang/de/). Jede Version erscheint als
Git-Tag `vX.Y.Z` und als Images `ghcr.io/florivdg/kibo:X.Y.Z` und
`ghcr.io/florivdg/kibo-migrate:X.Y.Z`.

## v1.2.1

[compare changes](https://github.com/florivdg/kibo/compare/v1.2.0...v1.2.1)

### 🚀 Enhancements

- **marketing:** New author photo; the author's links and the repository link open in a new tab ([f6bcf33](https://github.com/florivdg/kibo/commit/f6bcf33), [0afff33](https://github.com/florivdg/kibo/commit/0afff33))

### 🩹 Fixes

- **icons:** favicon.ico with the Kibo logo mark instead of Astro's ([62a5a20](https://github.com/florivdg/kibo/commit/62a5a20))

### Hinweise zum Update

- Keine Migration und keine neuen Variablen.

### ❤️ Contributors

- Florian van der Galiën <hallo@flori.dev>

## v1.2.0

[compare changes](https://github.com/florivdg/kibo/compare/v1.1.1...v1.2.0)

### 🚀 Enhancements

- **auth:** Control who may sign up (SIGNUP_MODE, SIGNUP_EMAIL_DOMAINS) ([1610ec4](https://github.com/florivdg/kibo/commit/1610ec4))
- **auth:** Invitations and roles, several admins per Kita ([77276c1](https://github.com/florivdg/kibo/commit/77276c1))
- **docs:** Documentation under /docs, served from the docs folder ([c5abb05](https://github.com/florivdg/kibo/commit/c5abb05))
- **hosted:** Subscriptions, computed state and pausing ([d5d8273](https://github.com/florivdg/kibo/commit/d5d8273))
- **hosted:** Terms, subscription page, reminders and deletion ([3073033](https://github.com/florivdg/kibo/commit/3073033))
- **home:** The start page of the hosted service, with author section and narrated 30 s film ([abd6340](https://github.com/florivdg/kibo/commit/abd6340), [77a913b](https://github.com/florivdg/kibo/commit/77a913b), [006af05](https://github.com/florivdg/kibo/commit/006af05))
- **analytics:** Count start-page views server-side with Plausible, no script in the browser ([e910809](https://github.com/florivdg/kibo/commit/e910809))
- **home:** Position Kibo as the pinboard for Kita parents ([7938252](https://github.com/florivdg/kibo/commit/7938252))
- **home:** Optional Plausible page views on the hosted start page ([d7329b1](https://github.com/florivdg/kibo/commit/d7329b1))
- **mail:** Operator details and privacy notes in system mails ([4c652de](https://github.com/florivdg/kibo/commit/4c652de))
- **reports:** Parents report notes, Kitas handle them under /admin/reports ([16c579e](https://github.com/florivdg/kibo/commit/16c579e))
- **kita-link:** One link and one home-screen app per Kita ([77af631](https://github.com/florivdg/kibo/commit/77af631))
- **push:** App icon badge for unseen notes in the Kita app ([db64718](https://github.com/florivdg/kibo/commit/db64718))
- **spam:** IPv6 /56 and /48 budgets, Kita note budget, form token ([249c1bf](https://github.com/florivdg/kibo/commit/249c1bf))
- **board:** Compact app bar instead of the tall board header ([d507bef](https://github.com/florivdg/kibo/commit/d507bef))
- **auth:** Sign in with passkeys, with autofill on the login page ([4b4b142](https://github.com/florivdg/kibo/commit/4b4b142))
- **analytics:** Count start-page views server-side, drop the Plausible script ([e910809](https://github.com/florivdg/kibo/commit/e910809))
- **export:** Kita data export for switching and the return of data ([b63f8dd](https://github.com/florivdg/kibo/commit/b63f8dd))
- **kita:** Name the Kita as responsible on its boards; Leitweg-ID on invoices ([fe5de20](https://github.com/florivdg/kibo/commit/fe5de20))
- **hosted:** Versioned AGB and AVV with a confirmation mail ([0ebb436](https://github.com/florivdg/kibo/commit/0ebb436))
- **reports:** Let anyone report illegal content to the operator (DSA Art. 16) ([2fd53d9](https://github.com/florivdg/kibo/commit/2fd53d9))
- **privacy:** Push topic per subscriber, browser unsubscribe, storage and retention ([8b198ca](https://github.com/florivdg/kibo/commit/8b198ca))
- **legal:** AGB template with Data Act switching and DSA rules; deletion hold for operators ([8a0f779](https://github.com/florivdg/kibo/commit/8a0f779))
- **load:** Add bounded k6 read-only performance suite ([#77](https://github.com/florivdg/kibo/pull/77))
- **hosted:** Say before payment that leaving early refunds nothing ([e6e1528](https://github.com/florivdg/kibo/commit/e6e1528))
- **marketing:** Show the narrated 30 s film on the hosted start page ([006af05](https://github.com/florivdg/kibo/commit/006af05))

### 🔥 Performance

- Compress responses at the proxy, WebP video poster ([c0ea711](https://github.com/florivdg/kibo/commit/c0ea711))

### 🩹 Fixes

- **a11y:** Accessibility fixes for the board pages and the admin area, focus kept when a note is removed ([bb7e71c](https://github.com/florivdg/kibo/commit/bb7e71c), [ca6e6ba](https://github.com/florivdg/kibo/commit/ca6e6ba))

### 📖 Documentation

- **legal:** Impressum template with legal form, Wirtschafts-ID and DSA contact point ([812cdde](https://github.com/florivdg/kibo/commit/812cdde))
- **legal:** AVV template following the Art. 28 SCC, with church and municipal annex ([677e97f](https://github.com/florivdg/kibo/commit/677e97f))
- **legal:** Privacy notice template matching the code, with roles and Art. 21 section ([80331b0](https://github.com/florivdg/kibo/commit/80331b0))
- **deploy:** Redirect a second domain, check the operator docs for launch ([ab925d6](https://github.com/florivdg/kibo/commit/ab925d6))

### 🏡 Chore

- Upgrade dependencies and fix transitive esbuild audit finding ([0d5023e](https://github.com/florivdg/kibo/commit/0d5023e))
- Update http-cache-semantics to clear its audit finding ([a8e0118](https://github.com/florivdg/kibo/commit/a8e0118))
- Update source-map-js to version 1.2.2 ([e576d16](https://github.com/florivdg/kibo/commit/e576d16))

### 🤖 CI

- Run on Ubuntu 26.04 ([83dee68](https://github.com/florivdg/kibo/commit/83dee68))

### Hinweise zum Update

- Migrationen laufen wie gewohnt über das Migrations-Image. Neue Variablen,
  der Kita-Link statt der Brett-Links und alles Weitere:
  [Update auf 1.2.0](docs/selbst-hosten/updates.md#update-auf-120).

### ❤️ Contributors

- Florian van der Galiën <hallo@flori.dev>

## [1.1.1] – 2026-09-29

[Alle Änderungen](https://github.com/florivdg/kibo/compare/v1.1.0...v1.1.1)

### Geändert

- **Startseite:** Ein vierter Zettel stellt die Benachrichtigungen vor
  („Neue Zettel aufs Handy“); die Zettel stehen auf dem Tablet 2×2 und auf
  dem Desktop zu viert nebeneinander.
- **Launch-Video, jetzt 20 Sekunden:** Eine neue Szene zeigt die
  Benachrichtigungen – der Glocken-Knopf auf dem Brett, eine schwingende
  Glocke und zwei Benachrichtigungen auf dem Sperrbildschirm eines Handys.
  Bildunterschrift, strukturierte Daten und Download-Link nennen die neue
  Länge.
- **Infoblatt (PDF):** weiterhin zwei Seiten, jetzt mit den
  Benachrichtigungen; Spam-Schutz und sichere Kita-Konten stehen gemeinsam
  auf einem Zettel.

### Behoben

- Im Launch-Video hat der dritte Zettel bei „Biete & Suche“ jetzt auch das
  Geräusch beim Anpinnen.

### Hinweise zum Update

- Keine Migration und keine neuen Variablen; nur Startseite, Video und
  Infoblatt ändern sich.

## [1.1.0] – 2026-09-29

[Alle Änderungen](https://github.com/florivdg/kibo/compare/v1.0.1...v1.1.0)

### Hinzugefügt

- **Benachrichtigungen für neue Zettel (Web Push)** (#15): Eltern tippen auf
  einem Brett die Glocke an und erfahren auf dem Handy, sobald dort ein neuer
  Zettel hängt – mit Brettname und Titel, nie mit Text, Name oder Kontakt.
  Auf Android klappt das im Browser, auf dem iPhone (ab iOS 18.4), sobald das
  Brett über „Zum Home-Bildschirm“ als eigene App angelegt ist; die Glocke
  erklärt das dort selbst. Neue Zettel werden zwei Minuten gesammelt, pro
  Brett gehen höchstens 6 Benachrichtigungen pro Stunde raus. Ohne
  Drittanbieter-Konto: Verschlüsselung (RFC 8291) und VAPID (RFC 8292) sind
  eingebaut, zugestellt wird über die Push-Dienste der Browser.
- **Jedes Brett als eigene Web-App:** eigenes Manifest mit Brettname, App-Icons
  und Apple-Touch-Icon.
- **Admin-Bereich:** Die Brett-Liste zeigt, auf wie vielen Geräten
  Benachrichtigungen aktiv sind; pro Brett lassen sie sich abschalten, was die
  vorhandenen Abos löscht. Ein neuer Brett-Link beendet die Abos ebenfalls.

### Geändert

- Die Datenschutz-Vorlage (`deploy/legal/datenschutz.md`) hat einen Abschnitt
  „Benachrichtigungen“ und nennt die Push-Dienste (Google, Apple, Mozilla,
  Microsoft, Samsung) als Empfänger.
- Das README zeigt Screenshots und verlinkt das Infoblatt.

### Behoben

- Häkchen- und Auswahlfelder im Admin-Bereich zeigen ihren gewählten Zustand
  wieder an.

### Hinweise zum Update

- Migration `0005` (Tabelle `push_subscription`, Spalte `board.push_enabled`)
  läuft wie gewohnt über das Migrations-Image.
- Benachrichtigungen sind **optional** und ohne Konfiguration aus. Zum
  Einschalten Schlüssel erzeugen und `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  und `VAPID_SUBJECT` setzen – alle drei oder keine, sonst startet die App
  nicht. Details, auch zu `/sw.js` hinter einem cachenden Proxy, in
  [docs/deployment.md](docs/deployment.md), Abschnitt 12.
- `deploy/compose.yml` neu übernehmen: Nur die neue Datei reicht die
  VAPID-Variablen an die App durch.
- Die eigene Datenschutzerklärung um den Abschnitt „Benachrichtigungen“
  ergänzen, bevor die Funktion eingeschaltet wird.

## [1.0.1] – 2026-09-29

### Hinzugefügt

- **Launch-Video auf der Startseite:** 15 Sekunden zu Fundkiste, Biete &
  Suche und Pinnwand. Es startet erst auf Klick, weil die Permissions-Policy
  Autoplay verbietet und das Video Ton hat.
- **Vorschau beim Teilen:** Open-Graph- und Twitter-Card-Tags mit eigenem
  Vorschaubild (`/og-image.jpg`), kanonische Adresse der Startseite und
  strukturierte Daten (JSON-LD) für App und Video. Bretter, Admin-Bereich und
  Fehlerseiten bekommen keine Vorschau-Tags.

### Geändert

- Die Startseite spricht Kitas mit „ihr“ an, passend zum Video.
- Neuer Seitentitel und neue Beschreibung der Startseite für Suchmaschinen.

### Hinweise zum Update

- Keine Migration. Die vollständigen Adressen in den Vorschau-Tags kommen aus
  `BETTER_AUTH_URL`; die Variable muss wie bisher die öffentliche Adresse der
  Instanz sein.

## [1.0.0] – 2026-09-29

Die erste stabile Version. Kibo ist ein digitales schwarzes Brett für Kitas:
Die Kita-Leitung legt Bretter an und teilt sie über einen nicht erratbaren
Link, Eltern und andere Besucher pinnen dort ohne Konto Zettel an, die nach 7,
14 oder 30 Tagen verschwinden. Betrieben wird Kibo als Docker-Image hinter
einem Reverse Proxy, eine Instanz pro Träger oder Kita.

### Hinzugefügt

- **Bretter und Zettel:** drei Brett-Arten (Fundkiste, Biete & Suche,
  Pinnwand) mit festen Kategorien, Link und QR-Code zum Teilen, „Link
  erneuern“, Zettel mit Laufzeit, Abnehmen vom eigenen Gerät, seitenweises
  Laden.
- **Admin-Bereich:** Kita-Konten mit E-Mail-Bestätigung, Passwort-Reset,
  Zwei-Faktor-Anmeldung per TOTP und Backup-Codes, Kontoeinstellungen
  (Passwort, E-Mail-Adresse, Konto löschen) und die neue Seite
  **Kita-Einstellungen** (`/admin/kita`) zum Umbenennen der Kita.
- **Spam-Schutz** mit Budgets je Netz, Link und E-Mail-Adresse,
  Duplikaterkennung und Honeypot, gezählt in PostgreSQL
  ([docs/spam-schutz.md](docs/spam-schutz.md)).
- **Betrieb:** Images für App und Migration auf GHCR, Beispiel für Docker
  Compose hinter Traefik, Sicherungs- und Update-Skript, Vorlagen für
  Impressum und Datenschutzerklärung
  ([docs/deployment.md](docs/deployment.md)).
- Backup-Codes lassen sich bei der Einrichtung der Zwei-Faktor-Anmeldung
  kopieren und als Textdatei herunterladen; die Anmeldung wird erst
  eingeschaltet, wenn bestätigt ist, dass sie gespeichert sind.
- Eigene Fehlerseiten für 404 und 500.
- Anmeldung pro Konto begrenzt: höchstens 20 Versuche pro Stunde und
  E-Mail-Adresse, zusätzlich zu den Grenzen je Netz.
- Eigene Budgets für das Blättern und das Abnehmen von Zetteln; neue Zähler
  in der `[spam]`-Logzeile (`mail:unavailable`, `signin:limited`,
  `signin:unavailable`, `note:list-limited`, `note:remove-limited`).
- Unbestätigte Konten ohne Kita werden nach sieben Tagen gelöscht, abgelaufene
  Sitzungen (mit IP-Adresse und Browserkennung) stündlich.
- Startprüfung im Server: fehlt `DATABASE_URL`, `BETTER_AUTH_URL` oder
  `BETTER_AUTH_SECRET`, ist das Secret kürzer als 32 Zeichen, die Adresse kein
  HTTPS oder `TRUSTED_PROXIES` ungültig, startet Kibo nicht und nennt den
  Grund im Log.
- `LICENSE` (AGPL-3.0), `SECURITY.md` und dieses Changelog.

### Geändert

- Abhängigkeiten auf den aktuellen Stand gebracht, u. a. Astro 7.3.5,
  Better Auth 1.7.6, Vue 3.5.43, drizzle-orm 0.45.3 und nodemailer 10.0.12.
- In der Oberfläche heißen Boards jetzt durchgehend **Bretter**.
- Brett-Budgets zählen pro Link statt pro Brett: „Link erneuern“ beendet
  einen Angriff samt seiner Zählung.
- Kitas: höchstens drei pro Konto; Name und Kürzel werden serverseitig
  geprüft; nicht genutzte Organisations-Routen von Better Auth antworten mit 404.
- Eingaben (Zettel, Namen, Kita-Namen) werden auf sichtbaren Text geprüft;
  Steuer- und Bidi-Zeichen werden abgewiesen.
- Datenbank-Pool mit festen Grenzen: 10 Verbindungen, 5 s Verbindungs- und
  15 s Statement-Timeout.
- Anfragen sind auf 64 KiB begrenzt.
- Alle Schriften, auch Inter im Admin-Bereich, werden selbst ausgeliefert.
- Tage auf den Zetteln („noch 3 Tage“) rechnen in deutscher Zeit, unabhängig
  von der Zeitzone des Servers.
- Ein angefangener Zettel bleibt beim Schließen des Dialogs erhalten; nach dem
  Anpinnen springt die Seite zum neuen Zettel und kündigt ihn für
  Screenreader an.
- Docker: `latest` zeigt nur noch auf die neueste Version (Git-Tag `v*.*.*`),
  nicht mehr auf jeden Stand von `main`. App- und Migrations-Image werden erst
  getaggt, wenn beide Builds erfolgreich waren. `deploy/.env.example` nagelt
  `KIBO_IMAGE_TAG` auf `1.0.0` fest.
- `deploy/compose.yml`: Log-Rotation, `init`, `no-new-privileges` und
  Pflichtangaben, die beim Start ohne Wert abbrechen. Die Traefik-Middleware
  setzt nur noch HSTS und `nosniff`, damit sie die Header der App nicht
  überschreibt. `update.sh` wartet, bis die App gesund ist, und nennt bei
  einem Fehler den Weg zurück; `backup.sh` prüft jede Sicherung mit
  `pg_restore --list`.
- Die lokale Entwicklungsdatenbank lauscht nur noch auf `127.0.0.1`.

### Sicherheit

- Die App setzt ihre Sicherheits-Header selbst: Content-Security-Policy,
  `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`, `Referrer-Policy` (`no-referrer` auf Brettern
  und dem Reset-Link), `X-Robots-Tag` für Bretter und Admin-Bereich sowie
  `Cache-Control: no-store` für Admin-Seiten und Actions.
- Sitzungs-Cookies tragen im Produktions-Build das Präfix `__Secure-`.
  **Nach dem Update melden sich alle einmal neu an.**
- Kontonamen dürfen keine Links enthalten, damit niemand über die
  Bestätigungsmail an eine fremde Adresse einen Link verschicken kann.
- Beim Löschen eines Kontos werden nur die eigenen verwaisten Kitas
  mitgelöscht, nie eine gerade entstehende fremde.
- Workflows laufen mit minimalen Rechten: `contents: read`, `packages: write`
  nur für die Jobs, die Images schreiben; ungenutzte `id-token`- und
  `attestations`-Rechte sind entfernt.

### Behoben

- Ein nicht lesbares Impressum oder eine nicht lesbare Datenschutzerklärung
  wird nicht mehr bis zum Neustart zwischengespeichert, sondern beim nächsten
  Aufruf erneut gelesen und einmal im Log gemeldet.
- Der Honeypot wird nicht mehr vom Autofill des Browsers ausgefüllt.
- Die Tests hinterlassen keine Test-Kita mehr in der Datenbank.
- Der Kita-Wechsler meldet Fehler, statt still stehen zu bleiben.
- QR-Codes haben die Ruhezone, die Scanner erwarten, und eine feste Größe
  beim Herunterladen.
- Kontrast und Barrierefreiheit im öffentlichen Bereich und im Admin-Bereich
  (Beschriftungen, Statusmeldungen, Fokus).

### Hinweise zum Update

- Migration `0004` (neuer Index) läuft wie gewohnt über das Migrations-Image.
- Neue Pflichtprüfungen beim Start und neue Header: vor dem Update
  [docs/deployment.md](docs/deployment.md) lesen, insbesondere Abschnitt 10.

[1.1.1]: https://github.com/florivdg/kibo/releases/tag/v1.1.1
[1.1.0]: https://github.com/florivdg/kibo/releases/tag/v1.1.0
[1.0.1]: https://github.com/florivdg/kibo/releases/tag/v1.0.1
[1.0.0]: https://github.com/florivdg/kibo/releases/tag/v1.0.0
