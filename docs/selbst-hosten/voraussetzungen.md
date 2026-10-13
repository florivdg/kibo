# Voraussetzungen

Was vorhanden sein muss, bevor Kibo eingerichtet wird:

- Ein Server mit Docker und Docker Compose v2. Fertige Images kommen aus der
  GitHub Container Registry; wer das Image selbst baut, braucht beim Build
  Netzzugang zu Google Fonts – die Schriften werden dabei heruntergeladen und
  liegen danach im Image, sodass zur Laufzeit kein Browser Google kontaktiert.
- Ein DNS-A-Record (und bei IPv6 ein AAAA-Record) für die gewünschte
  Subdomain, zum Beispiel `kibo.example.org`, der auf den Server zeigt; für
  eine [zweite Domain](./traefik.md#zweite-domain) ebenso.
- Die Ports 80 und 443 erreichbar – aber **nur** für den Reverse Proxy.
- Etwas Plattenplatz für Datenbank und Sicherungen.

## Images

Die CI baut aus jedem Git-Tag `vX.Y.Z` Images mit demselben Tag:
`ghcr.io/florivdg/kibo` (App) und `ghcr.io/florivdg/kibo-migrate`
(Migrationen), dazu `kibo-load-fixtures` und `kibo-load-runner` für die
[Lasttests](./lasttests.md). `latest` zeigt auf die neueste Version, `main` und
`sha-<commit>` sind Entwicklungsstände. Wer Kibo aus einem eigenen Fork
veröffentlicht: Neue Pakete auf GHCR sind zunächst privat. Nach dem ersten
Push alle Pakete unter „Packages“ → „Package settings“ auf **Public**
stellen, sonst braucht jeder Server ein `docker login ghcr.io`.
