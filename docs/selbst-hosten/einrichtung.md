# Kibo einrichten

Der Reverse Proxy steht ([Traefik](./traefik.md)) – jetzt kommt Kibo selbst:
Beispieldateien kopieren, `.env` ausfüllen, starten.

## Dateien kopieren und `.env` ausfüllen

```sh
# Beispieldateien auf den Server kopieren, zum Beispiel nach /opt/kibo
mkdir -p /opt/kibo && cd /opt/kibo
# deploy/compose.yml, deploy/.env.example, deploy/backup.sh,
# deploy/update.sh und deploy/legal/ aus dem Repository hierher kopieren,
# für eine zweite Domain auch deploy/compose.redirect.yml
# chmod +x backup.sh update.sh
cp .env.example .env
```

In der `.env` mindestens setzen:

```sh
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -hex 24      # → POSTGRES_PASSWORD (auch in DATABASE_URL eintragen)
```

Das Datenbank-Passwort hexadezimal, weil es in der `DATABASE_URL` steht:
`/`, `+` und `=` aus base64 würden die Adresse zerbrechen. Das Secret steht in
keiner URL, dort passt base64.

- `KIBO_DOMAIN=kibo.example.org` – ohne Protokoll, genau so wie im DNS.
- `BETTER_AUTH_URL=https://kibo.example.org` – mit Protokoll. Daraus entstehen
  Cookies, Bestätigungs- und Reset-Links sowie die Links und QR-Codes der
  Kitas und ihrer Bretter. Auch Passkeys sind an diesen Hostnamen gebunden –
  eine spätere Änderung macht alle hinterlegten Passkeys unbrauchbar
  ([Sicherheit](./sicherheit.md#sitzungen-und-kitas)).
- `DATABASE_URL=postgresql://kibo:…@postgres:5432/kibo` – Host ist der
  Servicename `postgres`, nicht `localhost`.
- `KIBO_IMAGE_TAG` – steht in der Vorlage auf einer festen Version (`1.2.2`).
  Für ein Update die neue Version eintragen ([Updates](./updates.md)).

Alle weiteren Variablen stehen unter [Konfiguration](./konfiguration.md).

Die Datei `.env` enthält Zugangsdaten. `chmod 600 .env` und keinesfalls in ein
Git-Repository legen.

## Starten

```sh
docker compose up -d
docker compose logs -f app
```

Der erste Start legt die Datenbank an, wendet die Migrationen an und startet
die App. Sobald `docker compose ps` für `app` `healthy` zeigt, ist
`https://kibo.example.org/admin/signup` erreichbar: dort das erste Konto und
die erste Kita anlegen. Mit geschlossener Registrierung entsteht das erste
Konto stattdessen per Skript
([Registrierung steuern und erstes Konto anlegen](./konfiguration.md#registrierung-steuern-und-erstes-konto-anlegen)).

## Startprüfung

Fehlt eine Pflichtangabe, bricht schon `docker compose` mit dem Namen der
Variable ab (`DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`KIBO_DOMAIN` und die drei `POSTGRES_*`). Die App selbst prüft beim Start noch
einmal und startet **nicht**, wenn

- `DATABASE_URL`, `BETTER_AUTH_URL` oder `BETTER_AUTH_SECRET` fehlt oder leer
  ist,
- `BETTER_AUTH_SECRET` kürzer als 32 Zeichen ist,
- `BETTER_AUTH_URL` keine gültige Adresse ist oder nicht mit `https://`
  beginnt (ausgenommen `localhost`, `127.0.0.1` und `[::1]` zum Testen),
- `TRUSTED_PROXIES` einen Eintrag enthält, der weder IP noch CIDR-Bereich ist,
- `SIGNUP_MODE` etwas anderes als `open` oder `closed` ist – ein Tippfehler
  soll keine Registrierung offen lassen, die geschlossen sein sollte,
- `SIGNUP_EMAIL_DOMAINS` einen Eintrag enthält, der keine Domain ist (erlaubt
  sind `domain` und `*.domain`),
- `HOSTED` etwas anderes als `true` oder `false` ist oder eine der übrigen
  Angaben des [gehosteten Modus](./konfiguration.md#gehosteter-modus)
  (`HOSTED_*`, `PLAUSIBLE_*`, `AGB_URL`, `AVV_URL`) ungültig ist – auch ohne
  `HOSTED`,
- `DOCS_URL` oder `SOURCE_URL` keine Adresse mit `http://` oder `https://`
  ist,
- eine der Betreiberangaben `OPERATOR_NAME`, `OPERATOR_ADDRESS`,
  `OPERATOR_EMAIL` oder `OPERATOR_LEGAL_INFO` ungültig ist oder
  `IMPRESSUM_URL` oder `DATENSCHUTZ_URL` keine Adresse mit `https://` ist
  ([Betreiberangaben in E-Mails](./impressum-und-datenschutz.md#betreiberangaben-in-e-mails)),
- von den drei `VAPID_*`-Variablen nur ein Teil gesetzt ist oder die Schlüssel
  nicht passen ([Benachrichtigungen](./benachrichtigungen.md)).

Jeder Grund steht als eigene `[server]`-Zeile im Log, gefolgt von
`[server] Kibo startet nicht. Siehe docs/selbst-hosten/einrichtung.md.` Läuft
alles, lädt die App direkt nach dem Start ihre Hintergrundaufgaben (geordnetes
Herunterfahren, stündliche Aufräumarbeiten) statt erst mit dem ersten Besuch
und meldet, wer sich registrieren kann (`[auth] Registrierung …`), um welche
Art von Instanz es sich handelt und wo ihre Dokumentation liegt
(`[server] Modus: …`, [Hilfe-Link](./konfiguration.md#hilfe-link)),
die SMTP-Einstellung (`[mail] SMTP …`, [SMTP](./smtp.md)), die
Betreiberangaben im Fuß der E-Mails (`[mail] Betreiber im Fuß der E-Mails: …`
oder die Warnung `[mail] Betreiberangaben unvollständig …`) sowie, ob
Benachrichtigungen eingerichtet sind (`[push] …`,
[Benachrichtigungen](./benachrichtigungen.md)). Das erste Aufräumen läuft
sofort mit; erreicht die App die Datenbank nicht, steht gleich danach ein
`… fehlgeschlagen` im Log ([Betrieb](./betrieb.md)). Lassen sich die
Hintergrundaufgaben nicht laden, endet die App mit
`[server] Kibo startet nicht: …`.
