# Betrieb

Was im laufenden Betrieb zu wissen ist: Status und Logs, der Healthcheck, das
Herunterfahren, die stündlichen Aufräumarbeiten und die Grenzen, die die App
sich selbst setzt.

```sh
docker compose ps            # Status und Healthcheck
docker compose logs -f app   # Logs der App
docker compose top           # Prozesse
```

- **Healthcheck:** `GET /api/health` antwortet mit 200 (`{"status":"ok"}`),
  wenn die Datenbank antwortet, sonst mit 503 (`{"status":"error"}`). Mehr
  verrät die Antwort bewusst nicht – woran es liegt, steht im Log der App
  (`docker compose logs app | grep '\[health\]'`). Der Container-Healthcheck
  fragt den Endpunkt alle 30 Sekunden ab.
- **Herunterfahren:** Auf `SIGTERM` nimmt die App keine neuen Verbindungen mehr
  an, wartet bis zu 15 Sekunden auf die laufenden Anfragen, auf
  Benachrichtigungen, die schon unterwegs sind, und auf E-Mails zu Meldungen, und schließt danach den
  Datenbank-Pool. Noch gesammelte, nicht verschickte Benachrichtigungen
  entfallen ([Benachrichtigungen](./benachrichtigungen.md#was-die-app-tut)).
  Der Container bekommt dafür 30 Sekunden Zeit
  (`stop_grace_period`). Gelingt das Leeren oder das Schließen des Pools nicht,
  endet der Prozess mit Exit-Code 1 und
  `[server] Herunterfahren nicht sauber beendet: …` im Log.
- **Stündliche Aufräumarbeiten:** Abgelaufene Zettel werden sofort
  ausgeblendet und stündlich endgültig gelöscht – auch auf Instanzen, auf denen
  gerade niemand etwas anpinnt. Im selben Takt verschwinden abgelaufene
  Sitzungen und Spam-Zähler, abgelaufene Einträge der Tabelle `verification`
  (Bestätigungs- und Reset-Links, die Anmelde-Challenges der Passkeys und die
  30-Tage-Einträge „Gerät vertrauen“ der Zwei-Faktor-Anmeldung, die Better Auth
  sonst liegen ließe), die Zähler der Anmeldebegrenzung in `rate_limit`
  (`IP|Pfad`), sobald ihre letzte Anfrage länger als das längste Fenster von
  einer Stunde plus 5 Minuten zurückliegt – also spätestens gut zwei Stunden
  danach –, Konten, deren E-Mail-Adresse nach sieben
  Tagen nicht bestätigt ist und die zu keiner Kita gehören, Einladungen, die
  abgelaufen oder beantwortet sind, sowie
  Benachrichtigungs-Abos, die wiederholt scheitern und seit 30 Tagen nichts
  mehr zugestellt bekommen haben oder die seit 180 Tagen weder einen Besuch
  noch eine Zustellung hatten
  ([Benachrichtigungen](./benachrichtigungen.md#was-die-app-tut)), und gemeldete Zettel nach ihrer
  Aufbewahrungsfrist ([Meldungen und ihre E-Mails](#meldungen-und-ihre-e-mails)). Die Zahlen der
  Spam-Regeln gehen als eine `[spam]`-Zeile ins Log (keine IPs, keine Tokens,
  keine Zetteltexte), zum Beispiel
  `[spam] {"note:allowed":37,"note:limited":2}`. Neben `note:allowed`,
  `note:limited`, `note:board-limited`, `note:duplicate`, `note:honeypot`,
  `note:token` ([Formular-Token](./spam-schutz.md#formular-token)) und
  `note:unavailable` gibt es `note:list-limited` (Blättern) und
  `note:remove-limited` (Abnehmen), die `report:*`-Zähler für Meldungen und
  ihre E-Mails ([Spam-Schutz](./spam-schutz.md#meldungen)) samt `report:operator-sent`,
  `report:operator-failed` und `report:operator-limited` für Hinweise an den Betreiber,
  `invite:limited` und `invite:unavailable` für Einladungen, `invoice:limited` und
  `invoice:unavailable` für Rechnungsanfragen, `export:limited` und `export:unavailable`
  für den Datenexport, `mail:allowed`, `mail:limited` und
  `mail:unavailable` sowie `signin:limited` und `signin:unavailable` für die
  Anmeldebegrenzung pro Konto und `analytics:limited` und
  `analytics:unavailable` für die Besucherzählung der Startseite. Die Zahlen zu Benachrichtigungen stehen im
  selben Takt in einer eigenen `[push]`-Zeile: `push:subscribed`,
  `push:request-limited`, `push:subscribe-limited`, `push:board-full`,
  `push:throttled` und `push:unavailable`, außerdem die Zustellungen
  `push:sent`, `push:gone` (Abo vom Push-Dienst beendet) und `push:failed`
  ([Benachrichtigungen](./benachrichtigungen.md)).
  `*:unavailable` heißt: Das Budget war nicht prüfbar, meist weil die
  Datenbank nicht antwortete.
- **Logs:** Jeder Container schreibt über den `json-file`-Treiber höchstens
  drei Dateien zu je 10 MB (`logging` in `deploy/compose.yml`); ältere Zeilen
  verschwinden. Die Grenze ist eine Größe, keine Frist: Auf einer ruhigen
  Instanz können Zeilen Wochen alt werden. Wer Logs länger braucht, leitet sie
  an ein zentrales System weiter – und legt dort eine Frist fest.
- **Was in den Logs steht:** Kibos eigene Zeilen enthalten keine
  IP-Adressen, keine Kita-Links, keine Zetteltexte und keine Bestätigungs-
  oder Reset-Links; E-Mail-Adressen nur gekürzt (`a***@example.org`). Ein
  unerwarteter Fehler, den Astro selbst mit seinem Stacktrace protokolliert –
  etwa eine gescheiterte Datenbankabfrage beim Aufbau einer Seite –, kann
  dagegen Teile der Anfrage enthalten, bei einer Abfrage auch ihre Parameter
  (einen Kita-Link, einen Zetteltext, eine IP-Adresse). Einige Zeilen nennen die **Konto-ID** – die
  zufällige ID aus der Tabelle `user`, nie Name oder Adresse –, damit der
  Betrieb einem Fehler nachgehen kann: Mails zu Meldungen, die nicht
  rausgingen (`[reports] … an Konto <id> …`), und im gehosteten Betrieb
  Erinnerungen, Löschankündigungen und gelöschte Kitas eines Kontos
  (`[hosted] … Konto <id> …`), dazu die ID einer gelöschten Kita ohne
  Inhaber:in. Das ist ein Pseudonym: Wer nur das Log hat, erfährt daraus nicht,
  wer gemeint ist; zuordnen kann es nur, wer auch die Datenbank hat. Ist das
  Konto gelöscht, führt die ID ins Leere. Die IDs bleiben deshalb im Log, so
  lange wie jede andere Zeile.
- **Datenbank-Verbindungen:** Die App öffnet höchstens **10 Verbindungen** pro
  Instanz, wartet höchstens 5 Sekunden auf eine neue Verbindung, und
  PostgreSQL bricht jede Anweisung nach 15 Sekunden ab. `max_connections`
  (Vorgabe 100) muss für alle Instanzen reichen, plus Migration, Sicherung und
  eine Reserve für Wartung.
- **Anfragegröße:** Anfragen sind auf 64 KiB begrenzt. Größere Anfragen an die
  Anmelde-API beantwortet die App gleich mit 413; ein Zettel ist nur wenige
  Kilobyte groß.
- **Mehrere Instanzen:** Die Spam-Limits und die von Better Auth liegen in
  PostgreSQL, ein zweiter Prozess bekommt also kein eigenes Kontingent. Das
  Beispiel bleibt trotzdem bei einer Instanz – für eine Instanz dieser Größe reicht sie, und
  weniger bewegliche Teile heißt weniger Betrieb.

## Meldungen und ihre E-Mails

Eltern können Zettel melden ([Meldungen](../fuer-kitas/meldungen.md)). Was
dafür im Betrieb läuft:

- **Aufbewahrung.** Ein Fall (`report_case`, mit einer Kopie des Zettels, und
  seine Meldungen in `note_report`) wird 30 Tage nach dem Abschluss gelöscht,
  jeder Fall – auch ein offener – spätestens 90 Tage nach der ersten Meldung
  (`REPORT_CLOSED_RETENTION_DAYS`, `REPORT_MAX_RETENTION_DAYS` in
  `src/lib/limits.ts`). Das erledigt der stündliche Lauf; im Log steht dann
  `[reports] N alte Meldungsfälle gelöscht`. Löscht die Kita ein Brett oder
  wird die Kita gelöscht, gehen ihre Fälle mit; das Abnehmen eines einzelnen
  Zettels lässt den Fall stehen.
- **E-Mail-Aufträge.** Mit einem neuen Fall entsteht in derselben Transaktion
  je Inhaberin oder Admin der Kita ein Auftrag in `report_notification`. Die
  App arbeitet sie gleich nach dem Speichern ab und sieht außerdem alle fünf
  Minuten nach, was fällig ist – auch nach einem Neustart. Vor dem Versand
  wird geprüft, ob die Person noch zur Kita gehört; wer ausgeschieden ist,
  bekommt nichts (`skipped`), und ob der Fall noch offen ist. Jede Person bekommt höchstens eine E-Mail pro
  Stunde und Kita, weitere Fälle gehen gesammelt mit der nächsten raus.
- **Ausfall des Mailservers.** Ein Auftrag, den der SMTP-Server nicht annimmt,
  wird nach 5, 15, 60 und 240 Minuten erneut versucht, insgesamt fünfmal;
  danach bleibt er als `failed` stehen (`report:mail-given-up`). Die Meldung
  selbst geht dabei nie verloren und steht unter „Meldungen“ im
  Admin-Bereich. Im Log steht nur
  `[reports] Mail zu Meldungen an Konto <id> nicht verschickt, neuer Versuch folgt`,
  beim letzten Versuch
  `[reports] Mail zu Meldungen an Konto <id> nicht verschickt, aufgegeben`,
  und die gekürzte Adresse aus dem Mailer, nie ein Inhalt.
- **Mehrere Prozesse und Neustarts.** Die Aufträge einer Person in einer Kita
  werden vor dem Versand gemeinsam beansprucht und gelten 15 Minuten als
  vergeben, gerechnet ab dem Moment des Beanspruchens. Eine Advisory-Sperre
  auf Kita und Person sorgt dafür, dass immer nur ein Prozess nachsieht; hält
  ein anderer Prozess gerade Aufträge dieser Person, wartet der neue Auftrag
  und geht nach dessen E-Mail mit der nächsten Stunde raus – so kommen auch
  mit mehreren Prozessen nie zwei E-Mails in einer Stunde. Stirbt ein Prozess
  dazwischen, nimmt ein späterer Lauf die Aufträge wieder auf. Im ungünstigsten Fall – der Mailserver hat die E-Mail
  angenommen, der Prozess stirbt, bevor er das vermerkt – geht sie ein zweites
  Mal raus; eine E-Mail, die nie rausgeht, gibt es nicht.
- Ohne `SMTP_HOST` schreibt der Entwicklungsserver die E-Mails ins Log und
  zählt sie als nicht zugestellt; ein Produktions-Build ohne SMTP versucht es
  wie bei jedem Ausfall weiter und gibt nach fünf Versuchen auf.
- **Meldungen an den Betreiber.** Die E-Mail an `OPERATOR_EMAIL` und die
  Eingangsbestätigung einer Meldung mit der Option „auch an den Betreiber
  melden“ laufen nicht über diese Aufträge: Sie gehen direkt nach dem
  Speichern hinaus, ohne neuen Versuch, weil Name und Adresse der meldenden
  Person nirgends gespeichert werden. Was dann zu tun ist, steht unter
  [Hinweise auf rechtswidrige Inhalte](./rechtswidrige-inhalte.md).
