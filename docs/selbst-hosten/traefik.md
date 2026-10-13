# Traefik: vorhandenen nutzen oder neu aufsetzen

Kibo läuft hinter einem Reverse Proxy, der TLS terminiert, die Anfragen an
die App weiterreicht und die Antworten komprimiert. Die Beispiele verwenden
Traefik.

## Vorhandenen Traefik nutzen (der Normalfall)

Läuft auf dem Server bereits ein Traefik, wird Kibo einfach ein weiterer
Container an dessen Docker-Netzwerk. Nötig sind drei Angaben aus der
bestehenden Installation, die in `deploy/.env` eingetragen werden:

| Variable             | Bedeutung                                         | Vorgabe       |
| -------------------- | ------------------------------------------------- | ------------- |
| `KIBO_PROXY_NETWORK` | Name des Docker-Netzwerks, in dem Traefik lauscht | `proxy`       |
| `KIBO_ENTRYPOINT`    | Name des HTTPS-Entrypoints                        | `websecure`   |
| `KIBO_CERTRESOLVER`  | Name des Zertifikatsauflösers (ACME)              | `letsencrypt` |

Die Namen stehen in der Traefik-Konfiguration (`entryPoints:` und
`certificatesResolvers:`) beziehungsweise in dessen Compose-Datei. Das
Netzwerk findet man mit `docker network ls`. Existiert es noch nicht:

```sh
docker network create proxy
```

Laufen auf dem Server noch andere Anwendungen hinter demselben Traefik, ist
ein **eigenes Netz nur für Traefik und Kibo** die bessere Wahl – sonst erreicht
jeder Nachbarcontainer die App direkt und kann ihr eine beliebige Besucher-IP
vorgaukeln ([Sicherheit](./sicherheit.md#proxy-netzwerk) erklärt das mit den
nötigen Befehlen):

```sh
docker network create kibo-proxy
docker network connect kibo-proxy <name-des-traefik-containers>
# in der .env: KIBO_PROXY_NETWORK=kibo-proxy
```

Weitere Voraussetzungen an den vorhandenen Traefik:

- Docker-Provider aktiv; bei `exposedByDefault: false` genügen die Labels aus
  `deploy/compose.yml` (sie setzen `traefik.enable=true`).
- **Keine** `forwardedHeaders.trustedIPs` für den Entrypoint, es sei denn,
  davor steht ein eigener Loadbalancer oder ein CDN. Ohne diese Einstellung
  verwirft Traefik die `X-Forwarded-*`-Header der Clients und setzt sie selbst
  – genau darauf beruht die Erkennung der Besucher-IP
  ([Sicherheit](./sicherheit.md#weitergeleitete-header)).
- Läuft eine zweite Kibo-Instanz auf demselben Host, in `deploy/compose.yml`
  Router, Service und Middlewares umbenennen (`kibo` → zum Beispiel `kibo2`)
  und `COMPOSE_PROJECT_NAME` setzen.

## Zweite Domain

Läuft Kibo unter `www.example.org`, soll meist auch `example.org` (oder eine
alte Adresse) dorthin führen. Das übernimmt `deploy/compose.redirect.yml`: ein
zweiter Router mit eigenem Zertifikat, der jede Anfrage dauerhaft auf
`KIBO_DOMAIN` umleitet, Pfad und Query bleiben erhalten. Die App sieht diese
Anfragen nicht. Eingeschaltet wird er in `deploy/.env`:

```sh
KIBO_DOMAIN=www.example.org
KIBO_REDIRECT_DOMAIN=example.org
COMPOSE_FILE=compose.yml:compose.redirect.yml
```

`COMPOSE_FILE` liest `docker compose` selbst aus der `.env`, so nehmen auch
`update.sh` und `backup.sh` die Datei mit. Beide Namen brauchen einen
DNS-Eintrag auf den Server, sonst gibt es für die zweite Domain kein
Zertifikat. `BETTER_AUTH_URL` bleibt die Adresse von `KIBO_DOMAIN`.

## Komprimierung

Die App liefert alles unkomprimiert aus. In `deploy/compose.yml` komprimiert
deshalb die Middleware `kibo-compress` am Router Seiten, Actions, CSS,
JavaScript, SVG und das Manifest; Rasterbilder, Schriften und das Video sind
schon komprimiert. Wer einen anderen Proxy nutzt, schaltet die Komprimierung
dort ein (Caddy `encode`, nginx `gzip` mit passenden `gzip_types`).

## Keinen Traefik? Beispiel starten

```sh
docker network create proxy
cd deploy/traefik
# Pflicht: eigene E-Mail-Adresse für Let's Encrypt in traefik.yml eintragen
docker compose up -d
```

Das Beispiel richtet `web` (Weiterleitung auf HTTPS) und `websecure` ein, holt
Zertifikate per HTTP-Challenge und legt sie in einem Volume ab. Zugriffs-Logs
sind bewusst abgeschaltet.
