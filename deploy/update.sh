#!/bin/sh
# Update auf eine neue Kibo-Version, in der Reihenfolge, die den Betrieb
# schützt:
#
#   1. Sicherung anlegen
#   2. neue Images holen
#   3. Migration einmalig ausführen – schlägt sie fehl, bricht das Update hier
#      ab und die laufende Version bleibt unangetastet
#   4. erst dann App und Rest neu starten und warten, bis die App gesund ist –
#      sonst endet das Skript mit Fehler und nennt den Weg zurück
#
# Ohne Schritt 3 würde `docker compose up -d` zuerst den alten App-Container
# stoppen und die Migration erst danach starten: eine fehlerhafte Migration
# ließe die Instanz dann unerreichbar zurück.
#
# Aufruf aus dem Verzeichnis mit der compose.yml:
#   ./update.sh
#
# Umgebung (optional):
#   COMPOSE       Compose-Kommando (Vorgabe: docker compose)
#   SKIP_BACKUP   auf 1 setzen, um die Sicherung zu überspringen
#   WAIT_TIMEOUT  Sekunden, die die App bis „healthy“ bekommt (Vorgabe: 180)

set -eu

COMPOSE="${COMPOSE:-docker compose}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-180}"

# Die Version, die gerade läuft – die .env nennt schon die neue. Leer beim
# ersten Start.
previous=""
container="$($COMPOSE ps -q app 2>/dev/null || true)"
if [ -n "$container" ]; then
  image="$(docker inspect --format '{{.Config.Image}}' "$container")"
  previous="${image##*:}"
  echo "==> Laufende Version: $previous"
fi

rollback_hint() {
  echo >&2
  echo "Zurück zur vorigen Version (docs/selbst-hosten/updates.md, „Rollback“):" >&2
  if [ -n "$previous" ]; then
    echo "  1. in der .env KIBO_IMAGE_TAG=$previous eintragen" >&2
  else
    echo "  1. in der .env den vorigen KIBO_IMAGE_TAG eintragen" >&2
  fi
  echo "  2. die Sicherung von vor dem Update einspielen" >&2
  echo "     (neueste Datei in ${BACKUP_DIR:-./backups})" >&2
  echo "  3. $COMPOSE up -d" >&2
  echo "Ursache: $COMPOSE logs app" >&2
}

if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  echo "==> Sicherung"
  ./backup.sh
fi

echo "==> Images holen"
$COMPOSE pull

echo "==> Migration"
# --rm: der Container verschwindet nach dem Lauf. Bricht er ab, endet dieses
# Skript, und die alte Version läuft weiter.
if ! $COMPOSE run --rm migrate; then
  echo "Migration fehlgeschlagen, die laufende Version ist unverändert." >&2
  echo "Die Ursache steht in der Ausgabe darüber." >&2
  exit 1
fi

echo "==> Neu starten"
# --wait: kehrt erst zurück, wenn die App „healthy“ ist, und scheitert, wenn
# sie es nicht wird
if ! $COMPOSE up -d --wait --wait-timeout "$WAIT_TIMEOUT"; then
  echo "Die neue Version ist nicht gesund geworden." >&2
  rollback_hint
  $COMPOSE ps >&2
  exit 1
fi

echo "==> Status"
$COMPOSE ps
