# Lasttests mit k6

Die Lasttests prüfen die öffentlichen Kita- und Brettseiten und das Nachladen
älterer Zettel. Sie ändern weder Spam-Budgets noch Produktverhalten. Sie messen
HTTP-Antworten des SSR-Servers, keine Browserausführung, Bilder oder Web-Push.
Nur künstliche Daten verwenden; echte Kita-Links gehören weder in Tickets noch
in Logs oder Artefakte. Die ersten Staging-Messungen stehen unten; eine Produktions-Baseline wurde
noch nicht ermittelt. Die unten genannten Grenzwerte sind Startwerte, keine
zugesicherte Kapazität.

## Vorbereitung und Freigabe

Der eigenständige Lastgenerator `ghcr.io/florivdg/kibo-load-runner` enthält
Bun 1.4.2, k6 **2.3.0**, den Wrapper und das gebündelte Testskript. Damit
braucht der separate Generator nur Docker, keinen Checkout und keine lokale
Bun-/k6-Installation. Die beiden Helfer haben unterschiedliche Aufgaben:
`load-fixtures` legt Daten im Stack an, `load-runner` erzeugt HTTP-Last von
außerhalb. Der Runner gehört nicht in den Anwendungsstack.

Wer aus dem Repository arbeitet, muss Bun 1.4.2 und k6 **2.3.0** verwenden. `bun install --frozen-lockfile` installiert
auch den Devalue-Decoder. Der Wrapper baut das k6-Skript mit Bun. Eine andere
k6-Version wird vor dem ersten HTTP-Aufruf abgelehnt.

Staging und Produktion laufen ausschließlich durch den öffentlichen
HTTPS-Reverse-Proxy, auf einem **separaten Lastgenerator**. Nicht auf dem
Anwendungs- oder Datenbankhost laufen lassen. Zieladresse, DNS, Zertifikat,
Deploy-Commit und Image-Digest vorab prüfen. Lokal ist HTTP auf localhost oder
127.0.0.1 erlaubt. URLs dürfen keine Pfade, Zugangsdaten oder Query enthalten.

Künstliche Daten werden separat angelegt, nicht vom Lastgenerator oder CI.
Im bestehenden Compose-Stack reicht der optionale Dienst `load-fixtures`:
Er verwendet dessen `DATABASE_URL`, `BETTER_AUTH_URL` und `HOSTED`. Auf dem
Server sind weder ein Checkout noch Bun, ein manuelles Bundle, eine weitere
Env-Datei oder eigene Deployment-Aktionen nötig. Die Befehle im Verzeichnis
mit der bestehenden `compose.yml` und `.env` ausführen, etwa über die
Servershell des Deployment-Werkzeugs. Der Dienst ist im Profil `load` und
startet bei einem gewöhnlichen `docker compose up -d` nicht. Auch ohne
Argumente zeigt sein Image nur Hilfe und schreibt nichts.

```sh
docker compose pull load-fixtures
docker compose run --rm load-fixtures provision /fixtures/staging.json
```

Das Image `ghcr.io/florivdg/kibo-load-fixtures` trägt denselben
`KIBO_IMAGE_TAG` wie App und Migration. Der gewählte Tag muss bereits ein
Helper-Image enthalten; die CI veröffentlicht es zusammen mit den anderen
Images. Der Helfer hängt nur im internen Datenbanknetz, öffnet keine Ports und
führt keine HTTP-Last aus. Das private Journal liegt dauerhaft im benannten
Volume `load_fixtures`, auch wenn der Container mit `--rm` entfernt wird.
Sein Docker-Logtreiber ist ausgeschaltet, damit auch die gezielte Ausgabe
eines Journals nicht in Containerlogs gespeichert wird.

Die Vorgabe ist `KIBO_LOAD_ENVIRONMENT=staging`. Für Produktion zunächst ein
Betriebsfenster vereinbaren und Zielhost/Datenbank prüfen, dann **bewusst**
`KIBO_LOAD_ENVIRONMENT=production` in der bestehenden `.env` setzen und
`/fixtures/production.json` statt `/fixtures/staging.json` verwenden. Diese
Einstellung wirkt nur auf den ausdrücklich gestarteten Helfer, nicht auf die
App. Das manuelle Provision/Cleanup ist die Freigabe für synthetische Daten;
die bisherigen Umgebungs- und Identitätsprüfungen bleiben wirksam.

Das Journal privat auf den separaten Lastgenerator übertragen. Es enthält die
Kita-Tokens: nicht in die Zwischenablage einer öffentlichen Konsole, in Logs,
Tickets oder Artefakte kopieren. Folgendes leitet es direkt in eine private
Datei im Home-Verzeichnis auf dem ausführenden Rechner um; diese Datei
anschließend sicher auf den Lastgenerator übertragen oder als
GitHub-Environment-Secret hinterlegen:

```sh
umask 077
docker compose run --rm -T --no-deps --entrypoint cat load-fixtures /fixtures/staging.json > "$HOME/staging.json"
chmod 600 "$HOME/staging.json"
```

Falls Docker nur mit `sudo` zugänglich ist, `sudo` vor `docker compose` setzen.
Die Umleitung `>` läuft weiterhin als angemeldeter Benutzer; deshalb in dessen
Home-Verzeichnis schreiben, nicht in ein schreibgeschütztes Stack-Verzeichnis.

Wer lokal aus dem Repository entwickelt, kann weiterhin direkt provisionieren:
`LOAD_ENVIRONMENT=local`, `LOAD_ORIGIN=http://localhost:4321`,
`LOAD_DATABASE_URL`, `LOAD_HOSTED=false` und
`LOAD_FIXTURE_AUTHORIZATION=provision-synthetic-local` setzen, dann
`bun run load:fixtures provision .load-private/fixtures.json` ausführen.

Bei HOSTED erhält nur der künstliche Eigentümer ein
kostenfreies Abo, damit Laufzeitaufgaben die Daten nicht entfernen. Es entstehen
drei Kitas mit je einem Brett: leer (0), typisch (12) und groß (240 aktuelle
Zettel, 40 pro Seite). Alle Texte sind künstlich, Kontaktfelder leer, Push aus,
keine anmeldbaren Konten oder Sessions. Die Zettel laufen nach 24 Stunden ab;
danach neu provisionieren. Dieselben Daten können innerhalb dieses Tages für
Vergleichsläufe wiederverwendet werden.

Der private Wiederherstellungsnachweis enthält die konkreten IDs und Kita-Tokens.
Er wird vor dem Transaktionscommit mit Dateimodus 600 geschrieben. Nicht
veröffentlichen. Bei Unterbrechung kann er bereits existieren, obwohl die
Transaktion zurückgerollt wurde. Cleanup funktioniert auch dann.

## Profile und harte Grenzen

| Profil       | Umgebung           | Seitentraffic                            | Dauer | Max. Seiten-VUs               |
| ------------ | ------------------ | ---------------------------------------- | ----- | ----------------------------- |
| `smoke`      | lokal oder Staging | 2 Nutzer, je 2 Sekunden Pause            | 120 s | 2                             |
| `baseline`   | nur Staging        | konstante 5, 10, 25 Ankünfte/s, je 100 s | 300 s | 50 je Stufe, ohne Überlappung |
| `production` | nur Produktion     | konstant 1 Ankunft/s                     | 300 s | 4                             |

Eine Seiteniteration sendet genau einen GET: 30 % Kitaübersicht, 70 % Brett,
gleichmäßig verteilt auf die drei Datenmengen. Ankunftsraten sind angebotene
Last; `dropped_iterations` zeigt, wenn der Generator das Ziel nicht erreicht.
Zusätzlich prüft ein VU alle 10 Sekunden `/api/health`. Smoke und Baseline
senden über **einen** weiteren VU alle 10 Sekunden einen POST an
`/_actions/notes.list` mit dem Cursor nach den ersten 40 Zetteln des großen
Bretts. Das sind höchstens 30 Nachladeaufrufe in fünf Minuten, unabhängig von
den Seiten-VUs. Produktion sendet keine Actions und bleibt bei GETs.

Alle VUs teilen die Netzwerkidentität des Generators. Kibo erlaubt 120
Leseaufrufe pro Netzwerk in 15 Minuten. Keine IP-Header fälschen, keine
Netzwerkrotation, keine Budgetausnahmen. Zwischen Läufen mindestens 15 Minuten
warten; anderen Traffic des Generators berücksichtigen. 429 beim Nachladen
wird als erwartete Ablehnung separat gezählt, nicht als erfolgreiche Latenz.
Ein solcher Lauf belegt keine erfolgreiche Nachladeleistung.

## Vom eigenständigen Docker-Runner starten

Alle folgenden Schritte auf dem **separaten Lastgenerator** ausführen. Ein
Image-Tag wie `main` ist erst nach einem erfolgreichen Build dieser Version
verfügbar; für wiederholbare Vergleiche das Runner-Image mit `sha-<Commit>` oder
Digest festlegen. Das gewählte Image muss den Runner enthalten. Bei privaten
GHCR-Paketen zuerst mit einem berechtigten Konto `docker login ghcr.io`
ausführen; alternativ muss das Paket öffentlich lesbar sein.

```sh
mkdir -p .load-private/run
chmod 700 .load-private .load-private/run
# Das sicher übertragene Journal hierhin kopieren:
cp "$HOME/staging.json" .load-private/staging.json
chmod 600 .load-private/staging.json
```

Die private Datei `.load-private/load.env` anlegen. Zieladresse, Zielcommit,
Zielimage und Infrastruktur auf die tatsächliche Installation setzen;
Platzhalter ersetzen. Die URL bleibt eine Laufzeitvariable. Die Datei enthält
keine Datenbankzugangsdaten, SMTP-Zugangsdaten oder Sitzungscookies:

```dotenv
LOAD_ENVIRONMENT=staging
LOAD_PROFILE=smoke
LOAD_ORIGIN=https://staging.example.org
LOAD_MANIFEST=/input/fixtures.json
LOAD_RUN_AUTHORIZATION=run-readonly-staging
LOAD_COMMIT=<40-stellige Commit-ID des Zieldeployments>
LOAD_IMAGE=ghcr.io/florivdg/kibo@sha256:<Digest des Zieldeployments>
LOAD_INFRASTRUCTURE=4logical-2physical-4GiB-Postgres18-Traefik-separate-generator
```

```sh
chmod 600 .load-private/load.env
LOAD_RUNNER_IMAGE=ghcr.io/florivdg/kibo-load-runner:main
docker pull "$LOAD_RUNNER_IMAGE"
docker run --rm --init \
  --user "$(id -u):$(id -g)" \
  --security-opt no-new-privileges:true --cap-drop=ALL \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --log-driver=none \
  --env-file "$PWD/.load-private/load.env" \
  --mount "type=bind,src=$PWD/.load-private/staging.json,dst=/input/fixtures.json,readonly" \
  --mount "type=bind,src=$PWD/.load-private/run,dst=/work" \
  "$LOAD_RUNNER_IMAGE" run
```

Der Container läuft mit der UID/GID des ausführenden Benutzers. Das Journal
ist nur lesbar eingehängt; Bundle und Ergebnisse entstehen im beschreibbaren
Arbeitsverzeichnis. **Das gesamte Arbeitsverzeichnis `/work` einhängen**,
nicht nur `/work/load-results`: Vor jedem Lauf entfernt der Wrapper alte
Ergebnisse, einschließlich dieses Unterverzeichnisses. Der Standardbenutzer
des Images ist ebenfalls unprivilegiert. Ohne Argumente oder mit `--help`
zeigt das Image nur Hilfe und startet keine Last; `run` startet das gewählte
Profil. Containerlogs sind abgeschaltet; die bereinigten Ergebnisse sind
auf dem Generator unter `.load-private/run/load-results/summary.json` und
`provenance.json` verfügbar. Ein Exit-Code ungleich null bedeutet einen
abgelehnten Lauf, Abbruch oder ein verfehltes Testziel; Ergebnisse mitprüfen.

Nach einem Smoke-Test mindestens 15 Minuten Pause nach dessen Ende einhalten,
dann für die Staging-Baseline `LOAD_PROFILE=baseline` in der Env-Datei setzen
und denselben Docker-Befehl erneut ausführen. Vorher Ergebnisse sichern, wenn
sie für Vergleiche gebraucht werden. Für Produktion gelten ausschließlich
`LOAD_ENVIRONMENT=production`, `LOAD_PROFILE=production`,
`LOAD_RUN_AUTHORIZATION=run-readonly-production` und ein passend provisioniertes
Produktionsjournal. Das Ziel muss zur Herkunft des Journals passen.

### Aus dem Repository starten

Bei dieser Alternative Bun/k6 wie oben installieren und das übertragene
Journal unter `.load-private/fixtures.json` ablegen. Die gleichen Einstellungen
vollständig als Umgebungsvariablen setzen:

```sh
export LOAD_ENVIRONMENT=staging
export LOAD_ORIGIN=https://staging.example.org
export LOAD_PROFILE=baseline
export LOAD_MANIFEST=.load-private/fixtures.json
export LOAD_RUN_AUTHORIZATION=run-readonly-staging
export LOAD_COMMIT='<40-stellige Commit-ID des Zieldeployments>'
export LOAD_IMAGE='ghcr.io/florivdg/kibo@sha256:<Digest>'
export LOAD_INFRASTRUCTURE='2CPU 4GB RAM Postgres18 Proxy separate-generator'
bun run load:run
```

Ungültige Umgebung, Profil, Ziel, abgelaufene Fixtures oder fehlende Freigabe
werden vor der Last abgelehnt. Keine zusätzlichen k6-Flags oder Umgebungs-
Overrides: Der Wrapper gibt k6 eine eigene Umgebung und verwirft dessen rohe
Ausgaben, weil Transportfehler vollständige URLs enthalten können.

## Prüfen und stoppen

Seiten müssen Status 200 und HTML enthalten. Die Kitaübersicht muss den
passenden Zettelstand zeigen; Brettseiten alle erwarteten ersten 0/12/40
Zettel beziehungsweise den Leerzustand. Namen allein reichen nicht aus,
pausierte Bretter und andere Hinweisantworten werden als Fehler gezählt.
Das Nachladen verwendet Astros normalen JSON-Request und den gebündelten
Devalue-Decoder für `application/json+devalue`; erwartet werden 40 ältere,
streng absteigend sortierte Zettel und `hasMore: true`.

Die vorläufigen Leistungsziele sind Seiten p95 < 500 ms, p99 < 1.000 ms,
Nachladen p95 < 300 ms und unerwartete Fehler < 0,5 %. Überschreitungen
machen den abgeschlossenen Lauf rot.

Automatisch wird bei unerwarteten Fehlern ab 1 % nach 20 Sekunden, bei
Erfolgs-Latenz p95 ab 2 Sekunden nach 30 Sekunden oder bei einem fehlgeschlagenen
Healthcheck abgebrochen. Jeder Request hat 5 Sekunden Timeout, Redirects sind
aus. Der Wrapper beendet k6 spätestens nach sechs Minuten. Fehlende Generatorleistung macht den Lauf ebenfalls rot. Parallel CPU,
RAM, DB-Verbindungen, DB-Latenz und Proxy-5xx beobachten. Bei auffälligen Werten
oder Beschwerden sofort **Ctrl-C**; im GitHub-Workflow „Cancel workflow“.
Die Tests fahren keine Laststeigerung außerhalb der festgelegten Profile.

## Artefakte und Baseline

Nur `load-results/summary.json` und `provenance.json` weitergeben. Die Summary
enthält ausschließlich freigegebene numerische Aggregate: erfolgreiche Seiten-
und Nachlade-Latenzen einschließlich p95/p99, unerwartete Fehler, erwartete 429,
Healthfehler, HTTP-Anzahl, Iterationen und verworfene Iterationen. URL- und
Error-Systemtags fehlen. Response-Inhalte, Tokens, Session-Cookies, Gruppen,
Setup-Daten und rohe k6-Ausgaben werden nicht gespeichert. Das private
Manifest und Bundle bleiben in `.load-private/`, beide Verzeichnisse sind
Git-ignoriert. Keine anderen Outputs, HTTP-Debugging oder Konsolenlogs ergänzen.

Für jede Ankunftsstufe stehen zusätzlich freigegebene Stufennamen, angeforderte
Rate, konfigurierte und tatsächlich gemessene Dauer, Seitenanzahl, erreichte
Rate, erfolgreiche Latenzen, Fehler und verworfene Iterationen in der Summary.
Die erreichte Rate teilt die Seitenanzahl durch die Dauer dieser Stufe; sie
verwendet nicht die Gesamtdauer aller Stufen.

Die Provenienz hält Zieldeploy-Commit, Image, Infrastruktur, Profil, Umgebung,
Startzeit, k6-Version und Fixture-Größen fest. Bei Vergleichen zusätzlich
Deploymentkonfiguration, Generatorstandort, Reverse-Proxy, Datenbankversion,
Cachezustand und konkurrierende Nutzung dokumentieren, ohne Links oder Secrets.
Für weitere Baselines diese Tabelle nach einem freigegebenen Lauf ausfüllen:

| Angabe                                          | Wert                |
| ----------------------------------------------- | ------------------- |
| Zeitpunkt, Commit, Image                        | noch nicht gemessen |
| CPU/RAM/DB/Proxy/Generator                      | noch nicht erfasst  |
| Profil und angebotene/erreichte Rate            | noch nicht gemessen |
| Seiten p95/p99, Nachladen p95/p99               | noch nicht gemessen |
| 429, unerwartete Fehler, verworfene Iterationen | noch nicht gemessen |
| Betriebsmesswerte und Abbruchgrund              | noch nicht gemessen |

### Erste Staging-Messungen vom 7. Oktober 2026

Mit synthetischen Fixtures wurden Smoke und Baseline erfolgreich ausgeführt.
Die Baseline erreichte 5,00 / 9,98 / 24,98 Seitenaufrufe pro Sekunde über je
100 Sekunden; Seiten-p95 war 174 / 179 / 170 ms. Nachladen-p95 war 61 ms;
unerwartete Fehler, Healthfehler und verworfene Iterationen waren null.

Zusätzlich wurden separat freigegebene, ausschließlich lesende
Kapazitätsversuche durchgeführt. Diese sind **keine zusätzlichen eingebauten
Profile** und keine Freigabe, die festen Profile selbstständig zu erhöhen:

| Angebotene Last | Dauer              | Erreichte Rate | Seiten p95 | Verworfene Iterationen |
| --------------- | ------------------ | -------------- | ---------- | ---------------------- |
| 100/s           | 100 s              | 99,91/s        | 166 ms     | 0                      |
| 200/s           | 300 s              | 199,95/s       | 154 ms     | 0                      |
| 300/s           | 600 s              | 299,81/s       | 162 ms     | 78                     |
| 400/s           | 20 s, dann Abbruch | 348,09/s       | 1.607 ms   | 529                    |

Der 300er-Lauf lief zehn Minuten vollständig, verfehlte aber das strenge Ziel
von null verworfenen Iterationen. Der 400er-Lauf brach am zusätzlich
vereinbarten Stufenlimit p95 < 1.500 ms ab. Beide hatten keine unerwarteten
HTTP- oder Healthfehler. 348,09/s aus der kurzen abgebrochenen Stufe ist keine
nachgewiesene Dauerkapazität.

Der gemeinsam genutzte Host hatte 4 logische CPUs, 2 physische Kerne und
3,75 GiB RAM; ein Node-App-Prozess, PostgreSQL und Traefik wurden beobachtet.
Ein Wiederholungslauf mit SSH-Beobachtung zeigte bei 400/s den Node-Hauptthread
bei ungefähr 96 % eines Kerns, während die Host-CPU im Mittel etwa 61 %
erreichte. App- und Datenbankcontainer hatten keine CPU-Quote oder feste
Speichergrenze, keine CPU-Drosselung und keine OOM-Ereignisse. Mindestens
1,5 GiB RAM blieb verfügbar. Das spricht für CPU-Sättigung im App-Prozess.
Der separate Generator hatte 10 logische CPUs und 32 GiB RAM.

Der Testcode basierte auf `ca842f7cc2a40e17695923ed2783f6e09d6f8932`.
**Commit und Image-Digest des Zieldeployments wurden nicht verifiziert.**
Generatorstandort und Cachezustand wurden nicht vollständig erfasst. Diese
Messungen sind deshalb eine Orientierung für diese Installation, keine
versionsgebundene Kapazitätszusage. Für belastbare Vergleiche die vollständige
Provenienz vor dem nächsten Lauf erfassen. Keine privaten Zieladressen oder
Fixture-Tokens veröffentlichen.

Der manuell gestartete Workflow `Read-only load test` läuft pro Umgebung nur
einmal gleichzeitig und lädt ausschließlich die beiden bereinigten Dateien
hoch (14 Tage Aufbewahrung). In den GitHub-Environments `staging` und
`production` jeweils `LOAD_ORIGIN`, `LOAD_MANIFEST_JSON` (Inhalt des privaten
Manifests), `LOAD_RUN_AUTHORIZATION` als Secrets und `LOAD_COMMIT`, `LOAD_IMAGE`,
`LOAD_INFRASTRUCTURE` als Variablen setzen. Produktions-Environment mit
Freigaberegeln schützen. Die Variablen beschreiben das **Zieldeployment**, nicht
nur den ausgecheckten Testcode. Der Runner liegt außerhalb des Zielhosts.

## Aufräumen

Im bestehenden Stack mit derselben geprüften Datenbank und
`KIBO_LOAD_ENVIRONMENT` wie bei der Provisionierung:

```sh
docker compose run --rm load-fixtures cleanup /fixtures/staging.json
```

Nach erfolgreichem Cleanup kann das Journal entfernt werden, damit derselbe
Dateiname später für einen neuen Datensatz verfügbar ist:

```sh
docker compose run --rm -T --no-deps --entrypoint rm load-fixtures /fixtures/staging.json
```

Für lokale Repository-Tests bleibt
`bun run load:fixtures cleanup .load-private/fixtures.json` mit den bisherigen
`LOAD_*`-Einstellungen verfügbar.

Cleanup löscht nur die drei dokumentierten Kita-IDs, deren Name, Slug, Marker
und alleinige Eigentümermitgliedschaft exakt passen. Andere Daten und
Spam-Zähler bleiben erhalten. Der künstliche Eigentümer wird nur bei passender
Identität und ohne weitere Mitgliedschaften gelöscht. Alles geschieht in einer
Transaktion; jede Abweichung stoppt die Löschung. Wiederholter Cleanup ist
unschädlich. Private Journale erst nach bestätigtem Cleanup entfernen. Bei
fehlendem Journal nicht anhand eines Namenspräfixes großflächig löschen;
dokumentierte IDs und Marker manuell prüfen.

Weitere Betriebsprüfungen: [Betrieb](./betrieb.md),
[Spam-Schutz](./spam-schutz.md), [Sicherheit](./sicherheit.md).
