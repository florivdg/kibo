#!/bin/sh
# Sicherung der Kibo-Datenbank als komprimierter pg_dump-Archivstand.
#
# Aufruf aus dem Verzeichnis mit der compose.yml, zum Beispiel per Cron:
#   15 3 * * * cd /opt/kibo && ./backup.sh >> /var/log/kibo-backup.log 2>&1
#
# Umgebung (optional):
#   BACKUP_DIR   Zielverzeichnis (Vorgabe: ./backups)
#   KEEP_DAYS    Aufbewahrung in Tagen (Vorgabe: 14)
#
# Wiederherstellen: siehe docs/selbst-hosten/sicherung.md.

set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/kibo-$stamp.dump"

# Zwei Läufe in derselben Sekunde (Cron und ein Update von Hand) dürfen sich
# nicht gegenseitig überschreiben. Die Rotation findet -1, -2 … genauso.
suffix=1
while [ -e "$target" ] || [ -e "$target.part" ]; do
  target="$BACKUP_DIR/kibo-$stamp-$suffix.dump"
  suffix=$((suffix + 1))
done

# Abbruch (Fehler, Strg-C, Neustart) darf keine halbe Datei hinterlassen
trap 'rm -f "$target.part"' EXIT INT TERM

# Zugangsdaten kommen aus der Umgebung des Containers – die .env muss dafür
# nicht gelesen werden. -Fc: Archivformat, komprimiert, für pg_restore.
$COMPOSE exec -T postgres sh -c \
  'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$target.part"

# Erst prüfen, dann umbenennen: pg_restore muss das Inhaltsverzeichnis des
# Archivs lesen können. Das fängt leere und unlesbare Dateien ab; bricht
# pg_dump mittendrin ab, endet das Skript schon oben (set -e).
if ! $COMPOSE exec -T postgres pg_restore --list <"$target.part" >/dev/null; then
  echo "Sicherung unbrauchbar: pg_restore --list schlägt fehl" >&2
  exit 1
fi

mv "$target.part" "$target"
chmod 600 "$target"
echo "Sicherung geschrieben: $target ($(wc -c <"$target") Bytes)"

# Rotation: ältere Sicherungen entfernen
find "$BACKUP_DIR" -name 'kibo-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete

# Die Sicherung enthält Konto-Daten und alle noch nicht abgelaufenen Zettel.
# Eine Kopie außer Haus gehört dazu – und dieselbe Sorgfalt wie beim Server.
