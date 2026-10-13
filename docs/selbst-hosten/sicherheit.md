# Sicherheit

Was die Anwendung selbst absichert und was das Deployment dazu beitragen muss
– allem voran, dass die App nur über den Reverse Proxy erreichbar ist.

## Nur der Proxy ist erreichbar

Weder App noch Datenbank veröffentlichen einen Port. Erreichbar ist von außen
nur Traefik. Das ist keine Kosmetik: Astro vertraut den Headern
`X-Forwarded-Host` und `X-Forwarded-For`, und diese Vertrauensgrenze zieht
nicht die Anwendung, sondern das Deployment. Wer den App-Port direkt
erreicht, kann sich eine beliebige Besucher-IP ausdenken.

Die Anwendung kann diese Grenze nicht selbst ziehen: Astro legt die Liste der
vertrauten Hostnamen (`security.allowedDomains`) beim Build fest, ein Image
für alle Kitas kennt die Domain zu diesem Zeitpunkt aber nicht. Kibo lässt
deshalb jeden Hostnamen über HTTPS zu. Ein fest eingetragener Hostname würde
praktisch nichts ändern – wer den App-Port erreicht, kennt die Domain und
könnte sie ebenso als `X-Forwarded-Host` mitschicken. Öffentliche Links
stammen ohnehin nie aus dem Request, sondern aus `BETTER_AUTH_URL`.

## Proxy-Netzwerk

**Das Proxy-Netzwerk ist Teil dieser Grenze.** Ein Docker-Netzwerk ist flach:
Jeder Container im selben Netz erreicht `app:4321` direkt, an Traefik vorbei,
und kann dabei `X-Forwarded-For` und `X-Forwarded-Host` frei setzen. Wer auf
demselben VPS noch andere Anwendungen betreibt, teilt sich mit ihnen sonst
genau dieses Netz – eine übernommene Fremdanwendung könnte damit das
Spam-Limit umgehen. Empfohlen ist deshalb ein eigenes Netz nur für Traefik
und Kibo:

```sh
docker network create kibo-proxy
docker network connect kibo-proxy <name-des-traefik-containers>
```

Dauerhaft gehört das Netz in die Compose-Datei des Traefik (zusätzlicher
Eintrag unter `networks:`, extern), damit es einen Neustart überlebt. In der
`.env` dann `KIBO_PROXY_NETWORK=kibo-proxy` setzen – das Label
`traefik.docker.network` in `deploy/compose.yml` übernimmt denselben Wert und
muss deshalb nicht angepasst werden. Traefik hängt danach in beiden Netzen,
Kibo nur noch im eigenen.

Ist das nicht möglich, bleibt das gemeinsame `proxy`-Netz zulässig – dann
aber im Bewusstsein, dass die Besucher-IP nur so vertrauenswürdig ist wie die
übrigen Container darin.

## Docker-Socket

Traefik liest über `/var/run/docker.sock`, welche Container es gibt. `:ro` macht nur die Datei schreibgeschützt, nicht die
Docker-API dahinter: Wer Traefik übernimmt, hat über den Socket praktisch
Root-Rechte auf dem Host. Mehr Abstand schafft ein
[docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy), der
nur lesende Container-Abfragen durchlässt; Traefik spricht ihn dann über
`providers.docker.endpoint: tcp://socket-proxy:2375` an.

## Weitergeleitete Header

Der vorgeschaltete Traefik darf keine `forwardedHeaders.trustedIPs` haben –
sonst übernimmt er gefälschte `X-Forwarded-*`-Header der Clients. Er schreibt
dann einen einzigen eigenen Wert, und genau einen solchen akzeptiert Kibo
ohne weitere Konfiguration.

Lässt sich `X-Forwarded-For` nicht auflösen (mehrere Einträge, aber kein
passender `TRUSTED_PROXIES`), landen alle betroffenen Anfragen in einem
gemeinsamen Budget, und das Log meldet einmal pro Prozess
`[spam] X-Forwarded-For ließ sich nicht auflösen …`. Dann hängt etwas vor
Kibo, das an die Kette anhängt: dessen Adressen in `TRUSTED_PROXIES`
eintragen.

Steht ein CDN oder ein weiterer Loadbalancer davor, hängt dieser seinen Wert
an die Kette an. Dann **dessen** IP-Bereiche im Traefik als `trustedIPs` und
in Kibo als `TRUSTED_PROXIES` eintragen. Was Kibo damit macht und was ohne
die Angabe passiert, steht in
[`spam-schutz.md`](./spam-schutz.md#vertrauensgrenze) – dort stehen auch die
Regeln, Grenzwerte und Speicherdauern, die auf dieser Vertrauensgrenze
aufbauen.

## Secret und Image

`BETTER_AUTH_SECRET` stabil halten. Ein Wechsel meldet alle Nutzerinnen und
Nutzer ab, macht offene Bestätigungs- und Reset-Links ungültig und alle
eingerichteten Zwei-Faktor-Anmeldungen samt Backup-Codes unbrauchbar (sie sind
mit dem Secret verschlüsselt); nötig ist
er nur, wenn der Wert bekannt geworden ist. Dann anschließend alle zur
Neuanmeldung auffordern.

Das Image enthält keine Zugangsdaten: Es wird ohne `.env` und ohne
Build-Argumente gebaut, alle Geheimnisse kommen erst zur Laufzeit aus der
Umgebung. Die App läuft im Container nicht als `root`, mit einem minimalen
Init-Prozess (`init: true`) und ohne die Möglichkeit, Rechte zu erlangen
(`no-new-privileges`).

## Der Kita-Link

Jede Kita hat einen Link, `/k/<kita-link>/`; ihre Bretter liegen darunter unter
`/k/<kita-link>/<brett>/`. Das Geheimnis ist allein der Kita-Link (128 Bit
Zufall, 22 Zeichen base64url); die Kennung eines Bretts ist keines, und wer den
Link zu einem Brett hat, kommt auch zu allen anderen Brettern der Kita. Jede
Anfrage prüft, dass das Brett zur Kita des Links gehört; ein Brett einer
anderen Kita antwortet wie ein unbekanntes mit 404. Ein Link, der nicht die
Form eines Kita-Links hat, erreicht die Datenbank gar nicht.

Bei Missbrauch erzeugt jedes Mitglied der Kita im Admin-Bereich unter
„Bretter“ einen neuen Link. Damit werden alle bisherigen Links der Kita
ungültig, samt QR-Codes, Apps auf dem Home-Bildschirm und
Benachrichtigungs-Abos; Bretter und Zettel bleiben. Die Budgets eines Bretts
zählen pro Kita-Link: Mit dem neuen Link beginnen sie von vorn.

## Sicherheits-Header

**Sicherheits-Header setzt die App selbst:** Content-Security-Policy,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` und
`Referrer-Policy` (`no-referrer` auf `/k/…` und `/admin/reset-password`,
sonst `strict-origin-when-cross-origin`). Die Seiten der Kitas samt Manifest
und der Admin-Bereich tragen `X-Robots-Tag: noindex, nofollow`, Admin-Seiten
und Actions (`/_actions/…`) `Cache-Control: private, no-store` und die Seiten
der Kitas `Cache-Control: private, no-cache`; die Dateien unter `/_astro/…`
tragen einen Hash im Namen und
`Cache-Control: public, max-age=31536000, immutable`. Die Dokumentation unter
`/docs` – es gibt sie nur mit `HOSTED=true` – trägt bewusst kein `X-Robots-Tag`:
Sie soll gefunden werden.

**Vom Proxy kommen müssen** HSTS (nur er weiß, dass die Seite über HTTPS
ausgeliefert wird) und `nosniff` für die statischen Dateien unter
`/_astro/…`, die an der App-Middleware vorbeigehen. Das erledigt die
Middleware `kibo-security` in `deploy/compose.yml`. Sie setzt bewusst
**keine** Referrer-Policy und kein `frameDeny`: Traefik überschreibt damit
die Header der App, und das `no-referrer` auf den Brettern ginge verloren.
Wer einen anderen Proxy nutzt, setzt dort ebenso nur HSTS und `nosniff`.

## Sitzungen und Kitas

**Sitzungen:** Im Produktions-Build tragen die Sitzungs-Cookies das Präfix
`__Secure-` und das Attribut `Secure`. Eine Anmeldung mit Passwort ist pro
Konto auf 20 Versuche pro Stunde begrenzt, zusätzlich zu den Grenzen pro Netz
([Spam-Schutz](./spam-schutz.md#anmeldung-und-auth-mails)).

**Passkeys:** Konten können Passkeys hinterlegen (höchstens 10). Eine
Anmeldung mit Passkey ersetzt Passwort **und** zweiten Faktor; deshalb
verlangt der Server bei Einrichtung und Anmeldung die Bestätigung durch das
Gerät (Fingerabdruck, Gesicht oder Geräte-PIN) und weist Passkeys ohne sie ab,
ebenso die Anmeldung eines Kontos, dessen E-Mail-Adresse nicht bestätigt ist.
Hinzufügen verlangt eine Sitzung und das aktuelle Passwort, das der Server
selbst prüft; eine übernommene Sitzung allein kann keinen Passkey hinzufügen.
Wer das Passwort über den Reset-Link neu setzt, verliert alle Passkeys des
Kontos – der Reset nimmt ein Konto vollständig zurück.

Passkey-Einrichtung, Passkey-Anmeldung und Passwort-Reset nehmen dieselbe
Kontosperre in PostgreSQL. Der Reset setzt Passwort, Passkey-Löschung und
Sitzungswiderruf in einer Transaktion um; eine bereits laufende Einrichtung
oder Anmeldung kann danach weder einen Passkey noch eine Sitzung hinterlassen.
Eine Änderung des Passworts in den Kontoeinstellungen lässt sie bestehen.
Passkeys sind an den
Hostnamen aus `BETTER_AUTH_URL` gebunden (Relying-Party-ID und Origin kommen
von dort, nicht aus dem Request): **Wer die Domain der Instanz wechselt, macht
alle Passkeys unbrauchbar.** Die Konten melden sich dann mit Passwort an und
richten sie neu ein. Die Routen zum Umbenennen und Auflisten von Passkeys
über die API antworten mit 404.

**Kitas:** Ein Konto kann höchstens drei Kitas anlegen (Kitas, zu denen es
eingeladen wurde, zählen nicht); Name und Kürzel prüft der Server. Eine Kita
hat eine Inhaberin oder einen Inhaber und höchstens neun eingeladene Admins.
Einladen, Einladungen zurückziehen, Mitglieder entfernen und die Kita
umbenennen darf nur, wem sie gehört; Bretter und Zettel verwalten alle. Der
Link einer Einladung meldet niemanden an, und Einladungen sind pro Kita,
pro Konto und pro Empfänger begrenzt
([Spam-Schutz](./spam-schutz.md#einladungen)).
Organisations-Routen von Better Auth, die Kibo nicht nutzt (Rollen ändern,
Kita löschen, Mitglieder und Einladungen über die API auflisten …),
antworten mit 404.

## Zwei-Faktor-Anmeldung verloren

Bei der Einrichtung der Zwei-Faktor-Anmeldung bekommt jedes Konto
Backup-Codes zum Kopieren oder Herunterladen; ein Code ersetzt einmal den Code
aus der App. Sind App **und** Backup-Codes verloren, kann nur der Betrieb
helfen. Vorher sicherstellen, dass die Anfrage wirklich von der Inhaberin des
Kontos kommt (zum Beispiel persönlich oder über die bekannte Telefonnummer der
Kita) – dieser Weg umgeht den zweiten Faktor.

```sh
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
DELETE FROM two_factor
  WHERE user_id = (SELECT id FROM "user" WHERE email = 'leitung@kita.example');
UPDATE "user" SET two_factor_enabled = false
  WHERE email = 'leitung@kita.example';
COMMIT;
SQL
```

Die Adresse genau so eintragen, wie sie im Konto steht (klein geschrieben).
Danach meldet sich die Person nur mit dem Passwort an und richtet die
Zwei-Faktor-Anmeldung in den Kontoeinstellungen neu ein.
