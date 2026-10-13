# Sicherung und Wiederherstellung

`deploy/backup.sh` legt einen komprimierten `pg_dump -Fc` unter `./backups` ab
und löscht Sicherungen, die älter als `KEEP_DAYS` (Vorgabe: 14 Tage) sind.
Jede Sicherung wird vor dem Ablegen mit `pg_restore --list` gelesen; eine
leere oder unlesbare Datei bricht das Skript mit Fehler ab, statt als
Sicherung liegen zu bleiben:

```sh
chmod +x backup.sh
./backup.sh
```

Per Cron, zum Beispiel täglich um 3:15 Uhr:

```
15 3 * * * cd /opt/kibo && ./backup.sh >> /var/log/kibo-backup.log 2>&1
```

## Was in den Sicherungen steht

Die Sicherungen enthalten Konto-Daten und alle noch nicht abgelaufenen Zettel
und gehören deshalb verschlüsselt außer Haus kopiert (zum Beispiel per
`restic` oder `rclone` auf einen anderen Speicher). Abgelaufene Zettel werden
spätestens stündlich endgültig gelöscht, können in älteren Sicherungen aber
noch enthalten sein – das gehört in die Datenschutzerklärung.

Mitgesichert werden auch die Tabellen des Spam-Schutzes (`spam_key`,
`spam_counter`, `spam_fingerprint`). Sie enthalten keine IP-Adressen, keine
Kita-Links und keine Zetteltexte, sondern nur HMAC-Prüfwerte und
Zahlen, und sind nach gut einem Tag inhaltlich wertlos – aber `spam_key` liegt
mit darin, deshalb gilt für die Sicherungen dieselbe Sorgfalt wie für alles
andere.

**IP-Adressen im Klartext** stehen an zwei Stellen und damit auch in jeder
Sicherung:

- `rate_limit` – die Zähler von Better Auth für Anmelde- und Kontovorgänge.
  Der Schlüssel ist `IP|Pfad` (IPv6 auf das /64 gekürzt). Zeilen, deren
  letzte Anfrage länger als das längste Zeitfenster (eine Stunde) plus fünf
  Minuten zurückliegt, löscht der stündliche Lauf – spätestens gut zwei
  Stunden nach der letzten Anfrage.
- `session` – `ip_address` und `user_agent` jeder Sitzung eines Kita-Kontos,
  solange die Sitzung läuft (bis zur Abmeldung, längstens sieben Tage nach der
  letzten Nutzung). Abgelaufene Sitzungen löscht der stündliche Timer.

Nach dem Einspielen einer Sicherung laufen die Budgets mit den
wiederhergestellten Zählern weiter; wer das nicht will, leert
`spam_counter`, `spam_fingerprint` und `rate_limit` (die Regeln bauen sich
binnen eines Tages neu auf).

## Was nicht in der Datenbank steht

`backup.sh` sichert nur die Datenbank. Genauso wichtig sind zwei Dinge auf
dem Server, die verschlüsselt mitgesichert gehören:

- **`.env`**, vor allem `BETTER_AUTH_SECRET`: Mit ihm sind die
  Zwei-Faktor-Schlüssel und Backup-Codes verschlüsselt – ohne ihn lässt sich
  keine Zwei-Faktor-Anmeldung mehr prüfen. Dazu die `VAPID_*`-Schlüssel (neue
  machen alle Benachrichtigungs-Abos wertlos) und `POSTGRES_PASSWORD`.
- **`legal/`** mit Impressum und Datenschutzerklärung, falls sie dort als
  Datei liegen.

## Wiederherstellen

Wiederherstellen in eine leere Datenbank:

```sh
docker compose stop app
docker compose exec -T postgres sh -c \
  'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"'
docker compose exec -T postgres sh -c \
  'createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --single-transaction' \
  < backups/kibo-20260101T031500Z.dump
docker compose up -d
```

Benutzername und Datenbankname kommen dabei aus der Umgebung des Containers,
sind also automatisch dieselben wie in der `.env`.

Anschließend prüfen: Anmeldung im Admin-Bereich, ein Brett öffnen, einen
Zettel anpinnen. Eine Wiederherstellung, die nie geprobt wurde, ist keine Sicherung.
