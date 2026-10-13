# Changelog

Alle nennenswerten Änderungen an Kibo stehen in dieser Datei. Das Format folgt
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen folgen
[Semantic Versioning](https://semver.org/lang/de/). Jede Version erscheint als
Git-Tag `vX.Y.Z` und als Images `ghcr.io/florivdg/kibo:X.Y.Z` und
`ghcr.io/florivdg/kibo-migrate:X.Y.Z`.

Bis 1.2.1 entstand Kibo in einem privaten Repository; die Einträge bis dahin
verweisen deshalb auf keine Commits.

## 1.2.2 – 2026-10-13

### Geändert

- **Öffentliches Repository:** Kibo liegt jetzt öffentlich unter
  [github.com/florivdg/kibo](https://github.com/florivdg/kibo), und die Images
  auf GHCR sind öffentlich – zum Herunterladen braucht es kein
  `docker login` mehr.
- **Dokumentation:** Der gehostete Modus (`HOSTED=true`) ist der Betrieb des
  Projekts selbst und wird nicht mehr als Anleitung zum Nachbauen
  beschrieben; die Seite „Gehosteter Betrieb“ und die Vorlagen für AGB und
  AV-Vertrag sind entfernt. Die Vorlagen für Impressum und
  Datenschutzerklärung enthalten nur noch die Fassung für den eigenen
  Betrieb.
- **Changelog und README** durchgehend auf Deutsch; das README nennt Passkeys,
  Meldungen und den Datenexport.
- Abhängigkeiten aktualisiert, u. a. Astro 7.3.8, @astrojs/node 11.1.7,
  Vue 3.5.44, drizzle-orm 0.45.4 und nodemailer 10.1.0; `@types/k6` passt
  jetzt zur k6-Version 2.3.0 des Lasttest-Images.

### Sicherheit

- devalue 5.9.3 behebt die Befunde, die `bun audit` meldete. devalue nutzen
  nur die Lasttests; im App-Image steckt diese Fassung nicht.

### Hinweise zum Update

- Keine Migration und keine neuen Variablen. Wer sich für die Images bei
  GHCR angemeldet hat, kann `docker logout ghcr.io` ausführen.

## 1.2.1 – 2026-10-13

### Geändert

- **Startseite:** neues Foto im Abschnitt über den Autor; seine Links und der
  Link zum Repository öffnen sich in einem neuen Tab.

### Behoben

- Die `favicon.ico` zeigt das Kibo-Logo statt des Astro-Logos.

### Hinweise zum Update

- Keine Migration und keine neuen Variablen.

## 1.2.0 – 2026-10-13

### Hinzugefügt

- **Ein Link pro Kita:** Jede Kita hat einen Kita-Link `/k/…/`, der alle ihre
  Bretter zeigt, und kommt einmal als App auf den Home-Bildschirm; das
  App-Icon zählt ungesehene Zettel.
- **Einladungen und Rollen:** Die Inhaberin oder der Inhaber einer Kita lädt
  weitere Admins per E-Mail ein.
- **Registrierung steuern:** `SIGNUP_MODE` schließt die Registrierung,
  `SIGNUP_EMAIL_DOMAINS` beschränkt sie auf bestimmte Domains.
- **Passkeys:** Anmeldung mit Passkey, mit Vorschlag im E-Mail-Feld der
  Anmeldeseite.
- **Zettel melden:** Eltern melden Zettel ohne Konto, die Kita bearbeitet die
  Meldungen unter `/admin/reports`. Rechtswidrige Inhalte lassen sich
  zusätzlich an den Betreiber melden (DSA Art. 16); er nimmt Zettel mit
  `remove-note` ab.
- **Datenexport:** Jede Kita lädt ihre Bretter und aktuellen Zettel als
  JSON-Datei herunter, für einen Anbieterwechsel oder die Rückgabe der Daten.
- **Betreiberangaben und Datenschutzhinweise** im Fuß jeder E-Mail
  (`OPERATOR_*`).
- **Hilfe im Admin-Bereich:** Der Link „Hilfe“ führt zur Dokumentation oder
  zu `DOCS_URL`; die Dokumentation ist auf einzelne Seiten unter
  `docs/fuer-kitas/` und `docs/selbst-hosten/` aufgeteilt.
- **Quelltext-Link:** Am Fuß jeder Seite stehen der Link zum Quelltext und die
  laufende Version (AGPL § 13, `SOURCE_URL`).
- **Spam-Schutz:** Budgets auch je IPv6-/56- und /48-Netz, ein Budget je Kita
  für neue Zettel und ein Formular-Token beim Anpinnen.
- **Lasttests:** eine begrenzte, nur lesende k6-Suite mit eigenen Images.
- **Gehosteter Modus** (`HOSTED=true`, der Betrieb des Projekts selbst): Abo
  mit Testphase, Pausierung und Löschung, versionierte AGB und AV-Vertrag,
  die Startseite des Dienstes und eine Besucherzählung der Startseite auf dem
  Server.

### Geändert

- **Bretter:** eine kompakte App-Leiste statt des hohen Kopfbereichs.
- **Startseite:** Kibo als Pinnwand für Kita-Eltern.
- **Datenschutz:** Benachrichtigungen ohne Brett-ID im `Topic`, ein Gerät
  meldet sich selbst ab, wenn es keinem Brett mehr folgt; Browser-Speicher
  wird erst beschrieben, wenn es etwas zu behalten gibt; ungenutzte
  Benachrichtigungs-Abos, abgelaufene Anmelde-Daten und Zähler werden
  regelmäßig gelöscht.
- **Vorlagen:** Impressum (Rechtsform, Wirtschafts-ID, DSA-Kontaktstelle) und
  Datenschutzerklärung passen zum Code.
- **Betrieb:** Antworten werden am Proxy komprimiert, das Video-Vorschaubild
  ist WebP; eine zweite Domain lässt sich weiterleiten
  (`deploy/compose.redirect.yml`).
- Abhängigkeiten aktualisiert; die CI läuft auf Ubuntu 26.04.

### Behoben

- Barrierefreiheit auf den Brettern und im Admin-Bereich; der Fokus bleibt
  erhalten, wenn ein Zettel abgenommen wird.
- Befunde von `bun audit` in esbuild, http-cache-semantics und source-map-js.

### Hinweise zum Update

- Migrationen laufen wie gewohnt über das Migrations-Image. Neue Variablen,
  der Kita-Link statt der Brett-Links und alles Weitere:
  [Update auf 1.2.0](docs/selbst-hosten/updates.md#update-auf-120).

## 1.1.1 – 2026-09-29

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

## 1.1.0 – 2026-09-29

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

## 1.0.1 – 2026-09-29

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

## 1.0.0 – 2026-09-29

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
