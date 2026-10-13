# Kibo-Dokumentation

Kibo ist eine digitale Pinnwand für Kita-Eltern: Die Kita legt Bretter an und
teilt sie über einen Link, Eltern tauschen sich dort ohne Konto selbst aus –
gefunden, gesucht, zu verschenken. Diese Dokumentation hat zwei Teile – einen
für alle, die Kibo in ihrer Kita nutzen, und einen für alle, die eine eigene
Instanz betreiben.

## Für Kitas

Kurze Anleitungen für Kita-Leitung und Team.

- [Erste Schritte](./fuer-kitas/erste-schritte.md) – registrieren, anmelden,
  die Kita anlegen
- [Bretter anlegen und teilen](./fuer-kitas/bretter.md) – Brett-Arten,
  Kita-Link, QR-Code, Home-Bildschirm, neuer Link
- [Zettel](./fuer-kitas/zettel.md) – anpinnen, Laufzeit, abnehmen
- [Meldungen](./fuer-kitas/meldungen.md) – Zettel melden, die E-Mail ans Team,
  Fälle abschließen, rechtswidrige Inhalte an den Betreiber
- [Benachrichtigungen](./fuer-kitas/benachrichtigungen.md) – die Glocken, das
  iPhone, abschalten, nach einem neuen Link
- [Team](./fuer-kitas/team.md) – einladen, Rollen, entfernen, verlassen
- [Konto und Sicherheit](./fuer-kitas/konto-und-sicherheit.md) – Passwort,
  E-Mail-Adresse, Bestätigung in zwei Schritten, Konto löschen
- [Daten exportieren](./fuer-kitas/datenexport.md) – alle Bretter und
  aktuellen Zettel als Datei herunterladen
- [Abo](./fuer-kitas/abo.md) – nur auf gehosteten Instanzen: Testphase,
  Rechnung anfordern, was nach dem Ablauf passiert

## Selbst hosten

Kibo ist freie Software und lässt sich mit Docker Compose hinter einem Reverse
Proxy selbst betreiben.

- [Überblick und Architektur](./selbst-hosten/ueberblick.md)
- [Voraussetzungen](./selbst-hosten/voraussetzungen.md) – Server, DNS, Images
- [Traefik](./selbst-hosten/traefik.md) – vorhandenen nutzen oder neu
  aufsetzen
- [Kibo einrichten](./selbst-hosten/einrichtung.md) – `.env`, erster Start,
  Startprüfung
- [Konfiguration](./selbst-hosten/konfiguration.md) – alle
  Umgebungsvariablen, Registrierung steuern
- [Datenexport einer Kita](./selbst-hosten/datenexport.md) – das
  Exportformat Feld für Feld, Versionen
- [SMTP konfigurieren](./selbst-hosten/smtp.md)
- [Impressum und Datenschutz hinterlegen](./selbst-hosten/impressum-und-datenschutz.md)
- [Hinweise auf rechtswidrige Inhalte](./selbst-hosten/rechtswidrige-inhalte.md)
  – Meldungen an den Betreiber (DSA), Zettel abnehmen, Pflichten
- [Updates](./selbst-hosten/updates.md) – Ablauf, Rollback, Hinweise zu den
  Versionen
- [Sicherung und Wiederherstellung](./selbst-hosten/sicherung.md)
- [Betrieb](./selbst-hosten/betrieb.md) – Healthcheck, Logs, Aufräumarbeiten
- [Lasttests](./selbst-hosten/lasttests.md) – k6, künstliche Daten, sichere Profile
- [Sicherheit](./selbst-hosten/sicherheit.md) – Proxy-Netzwerk, Header,
  verlorene Zwei-Faktor-Anmeldung
- [Fehlersuche](./selbst-hosten/fehlersuche.md)
- [Benachrichtigungen (Web-Push)](./selbst-hosten/benachrichtigungen.md) –
  VAPID-Schlüssel, Push-Dienste
- [Spam-Schutz](./selbst-hosten/spam-schutz.md) – Budgets, Grenzwerte,
  Datenhaltung

## Mehr

- Das zweiseitige [Infoblatt (PDF)](./kibo-infoblatt.pdf) zum Weitergeben an
  Kita-Leitung oder Träger
- Quelltext, Entwicklung und Lizenz: [README](../README.md) des Repositorys
- Was sich mit welcher Version geändert hat: [CHANGELOG](../CHANGELOG.md)
