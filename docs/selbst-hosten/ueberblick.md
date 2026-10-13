# Überblick und Architektur

Diese Anleitung beschreibt den Betrieb von Kibo mit Docker Compose hinter
einem Reverse Proxy. Als Beispiel dient Traefik. Alle Beispieldateien liegen
in [`deploy/`](../../deploy).

## Architektur

```
Internet ──▶ Traefik ──▶ Kibo (App) ──▶ PostgreSQL
             :80/:443     :4321            :5432
             Netzwerk „proxy“   Netzwerk „internal“ (ohne Internet)
```

- **Traefik** terminiert TLS und ist der einzige Dienst mit veröffentlichten
  Ports.
- **App** hängt in zwei Netzwerken: `proxy` (nur für Traefik erreichbar) und
  `internal`.
- **PostgreSQL** hängt ausschließlich in `internal` und veröffentlicht keinen
  Port.
- **migrate** ist ein eigener Container, der einmal läuft und die Migrationen
  anwendet. Die App startet erst, wenn er erfolgreich war.
- **load-fixtures** ist ein optionaler Helfer im internen Netzwerk für
  [künstliche Lasttest-Daten](./lasttests.md). Er startet nur auf ausdrücklichen
  Aufruf, hält sein privates Journal in einem eigenen Volume und erzeugt keine
  HTTP-Last.
- **load-runner** ist ein eigenständiges Image für den separaten
  [Lastgenerator](./lasttests.md#vom-eigenständigen-docker-runner-starten). Es
  enthält Bun, k6 und das Testskript, braucht keinen Checkout und gehört nicht
  auf den Anwendungs- oder Datenbankhost.

Ein einziges Image passt für jede Domain: Adresse, Secrets, SMTP-Zugang und
die Rechtstexte kommen zur Laufzeit aus der Umgebung. Das Beispiel betreibt
einen App-Prozess. Die Spam-Limits liegen in PostgreSQL und werden von allen
Prozessen geteilt ([Spam-Schutz](./spam-schutz.md)); daraus folgt noch keine
vollständige Unterstützung mehrerer App-Replikas. Insbesondere die
Push-Bündelung hält ihren Zustand derzeit im einzelnen Prozess.

## Der Weg zur eigenen Instanz

1. [Voraussetzungen](./voraussetzungen.md) prüfen: Server, DNS, Ports, Images.
2. [Traefik](./traefik.md) anbinden – den vorhandenen oder das Beispiel.
3. [Kibo einrichten](./einrichtung.md): Dateien kopieren, `.env` ausfüllen,
   starten.
4. [Konfiguration](./konfiguration.md): alle Umgebungsvariablen, und wer sich
   registrieren darf.
5. [SMTP](./smtp.md) einrichten – ohne Mailversand kann sich niemand registrieren.
6. [Impressum und Datenschutz](./impressum-und-datenschutz.md) hinterlegen.
7. Optional: [Benachrichtigungen](./benachrichtigungen.md) einschalten.

Für den laufenden Betrieb: [Updates](./updates.md),
[Sicherung und Wiederherstellung](./sicherung.md), [Betrieb](./betrieb.md),
[Sicherheit](./sicherheit.md), [Fehlersuche](./fehlersuche.md) und die Regeln
des [Spam-Schutzes](./spam-schutz.md).
