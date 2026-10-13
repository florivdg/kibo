# Benachrichtigungen (Web-Push)

Eltern können für jedes Brett ihrer Kita die Glocke antippen und bekommen dann
eine Benachrichtigung, sobald dort ein neuer Zettel hängt – Brettname und Titel
des Zettels, nie der Text, der Name oder der Kontakt. Das läuft über Web Push
mit VAPID: kein Drittanbieter-Konto, keine App. Auf Android klappt es in jedem
gängigen Browser, auf dem iPhone (ab iOS 18.4) erst, wenn die Kita über
„Teilen → Zum Home-Bildschirm“ als eigene App angelegt ist – eine App pro Kita,
in der die Glocken aller Bretter stehen.

Die Funktion ist **optional**. Ohne die drei Variablen unten ist sie aus: Die
Bretter zeigen keine Glocke, und der Admin-Bereich sagt nichts darüber.

## Schlüssel erzeugen

Einmal, auf einem beliebigen Rechner mit Bun oder Node:

```sh
bunx @pushforge/builder vapid     # oder: npx @pushforge/builder vapid
```

Das Werkzeug gibt einen öffentlichen Schlüssel (87 Zeichen) und eine
JSON-Zeile (JWK) aus. In die `.env`:

```sh
VAPID_PUBLIC_KEY=BH8QTeGdjgOfY0c32hsUmO77…
# Die JSON-Zeile unverändert, in einfachen Anführungszeichen
VAPID_PRIVATE_KEY='{"alg":"ES256","key_ops":["sign"],"ext":true,"kty":"EC",…}'
# Wie die Push-Dienste den Betrieb erreichen: mailto: oder https:
VAPID_SUBJECT=mailto:betrieb@example.org
```

Danach `docker compose up -d`. Im Log steht `[push] Benachrichtigungen
eingerichtet`. Die App startet nicht, wenn nur ein Teil der drei gesetzt ist,
ein Schlüssel nicht das erwartete Format hat oder öffentlicher und privater
Schlüssel nicht zusammengehören. Der private Schlüssel gehört wie
`BETTER_AUTH_SECRET` nur in die `.env`.

## Schlüssel stabil halten

Jedes Abo ist im Browser an den öffentlichen
Schlüssel gebunden. Ein neues Schlüsselpaar macht **alle** Abos wertlos: Die
Push-Dienste weisen jede Nachricht ab, und alle Eltern müssen die Glocken neu
aktivieren (die Seiten bieten das von selbst wieder an). Aus dem privaten
Schlüssel leitet die App außerdem den Schlüssel für den `Topic`-Header ab
(siehe unten); auch der wechselt dann, was ohne gültige Abos aber nichts mehr
ausmacht. Nötig ist ein
Wechsel nur, wenn der private Schlüssel bekannt geworden ist. Die alten Abos
danach gleich löschen, statt sie 30 Tage scheitern zu lassen:

```sh
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM push_subscription;"'
```

## Was die App tut

- Ein Browser – auf dem iPhone die App auf dem Home-Bildschirm – hat **ein**
  Push-Abo, das er für alle Bretter der Kita benutzt. Gespeichert wird es pro
  Brett: Wer drei Glocken einschaltet, steht dreimal in `push_subscription`,
  mit demselben Endpunkt. Beim Laden einer Seite gleicht der Browser einmal ab,
  für welche Bretter der Kita er angemeldet ist (`push.sync`), und frischt
  dabei die Schlüssel auf; neu angemeldet wird nur über eine Glocke
  ([Spam-Schutz](./spam-schutz.md#benachrichtigungen-web-push)). Derselbe
  Abgleich vermerkt höchstens einmal am Tag den Besuch (`last_visit_at`).
- **Die letzte Glocke aus.** `push.unsubscribe` und `push.sync` antworten
  auch, ob der Endpunkt noch irgendein Brett der Instanz abonniert hat
  (`remaining`) – in irgendeiner Kita, denn im Browser bedienen ein Service
  Worker und ein Endpunkt alle. Hat er keins mehr, beendet die Seite das
  Push-Abo des Browsers (`PushSubscription.unsubscribe()`): nach der letzten
  Glocke, die jemand selbst ausschaltet, und ebenso beim nächsten Besuch,
  wenn der Server die Abos inzwischen gelöscht hat – neuer Kita-Link,
  Benachrichtigungen des Bretts abgeschaltet, Brett gelöscht, abgeräumt.
  Antwortet `push.unsubscribe` mit 404 (das Brett oder seine
  Benachrichtigungen gibt es nicht mehr), fragt die Seite gleich einmal
  `push.sync`; ist auch der Kita-Link nicht mehr gültig, bleibt das Abo, bis
  eine Seite mit gültigem Link es abgleicht. Fehler und unklare Antworten
  beenden nie etwas. Danach schickt keine Seite mehr Endpunkt und Schlüssel,
  und die Zahl auf dem App-Symbol ist weg. Alles, was das gemeinsame Abo im
  Browser und auf dem Server ändert (Glocke an, Glocke aus, ein Abgleich, der
  es beenden kann), läuft über alle Tabs hinweg nacheinander, unter einem
  Web Lock (`navigator.locks`, wo es ihn gibt). Der Service Worker bleibt
  registriert; ohne Abo tut er nichts, hält keine Daten, und die nächste
  Glocke nimmt ihn wieder.
- Neue Zettel eines Bretts werden **zwei Minuten** gesammelt und gehen als
  eine Benachrichtigung raus („3 neue Zettel“). Ein Zettel, der vorher wieder
  abgenommen wurde, taucht nicht auf; wer den Zettel selbst angepinnt hat,
  bekommt keine Benachrichtigung dafür.
- **Die Zahl auf dem App-Symbol.** Jedes Abo merkt sich, bis wann sein Brett
  auf diesem Gerät gesehen wurde (`seen_at`, beim Anmelden der Zeitpunkt des
  Abos). Die Seite eines Bretts schickt beim `push.sync` ihr Brett mit und
  den Zeitpunkt, bis zu dem sie es lückenlos zeigt (die Serverzeit beim
  Ausliefern der Seite oder den neuesten Zettel, den sie seitdem vom Server
  geladen hat, höchstens die aktuelle Serverzeit). Ist
  die Glocke dieses Bretts an und hängt dort ein Zettel, der nach `seen_at`
  und bis zu diesem Zeitpunkt angepinnt wurde, rückt `seen_at` dorthin vor,
  bevor gezählt wird. Es rückt nur vor, nie zurück – auch nicht durch eine
  verspätete ältere Anfrage –, Zettel, die die Seite noch nicht geladen hat,
  zählen weiter, und ein Aufruf ohne Neues schreibt nichts. Dasselbe tut die
  Seite noch einmal, sobald sie neue Zettel vom Server geladen hat: gleich
  nach dem Anpinnen (mit dem eigenen Zettel kommen die, die andere
  inzwischen angepinnt haben; erst dann zählt der eigene als gesehen) und
  nach dem Tipp auf eine Benachrichtigung. Kamen mehr neue Zettel, als auf
  eine Seite passen, bleibt der Zeitpunkt stehen, bis „Ältere Zettel
  anzeigen“ die Lücke geschlossen hat.
  Kommen die Antworten in anderer Reihenfolge an, als die Anfragen losgingen,
  zählt nur die der zuletzt gestellten. Gezählt
  werden die Zettel auf den Brettern
  der Kita, für die der Endpunkt angemeldet ist, die nach `seen_at`
  angepinnt wurden und noch hängen, höchstens 99. `push.sync` antwortet mit
  der Zahl, `push.unsubscribe` mit der Zahl ohne das abgeschaltete Brett, und
  die Seite setzt sie mit der Badging API (`navigator.setAppBadge`, bei 0
  `clearAppBadge`); ohne Abo oder Erlaubnis – auf der Seite der Kita auch,
  wenn die Instanz keine Benachrichtigungen hat – löscht sie sie. Beim
  Versand rechnet die App sie für alle Empfänger in einer Abfrage aus und
  schickt sie als `app_badge` mit (siehe unten). Die Seiten einer pausierten
  Kita fragen nicht; dort bleibt die Zahl, wie sie war.
- **Bekannte Grenze der Zahl:** In Chromium-basierten Browsern (Chrome,
  Edge, Samsung Internet …) bedienen ein Service Worker (Bereich `/k/`) und
  ein Endpunkt alle Kitas der Instanz, gezählt wird aber pro Kita. Liegen in
  einem Browser auf dem Desktop oder unter Android die Apps zweier Kitas
  derselben Instanz, zeigt das Symbol die Zahl der Kita, von der die letzte
  Benachrichtigung kam. iPhone und iPad betrifft das nicht: Dort hat jede App
  auf dem Home-Bildschirm ihren eigenen Endpunkt.
- Pro Brett gehen höchstens **6 Benachrichtigungen pro Stunde** raus; was
  darüber hinaus kommt, wartet auf die nächste Stunde. Ein Brett nimmt
  höchstens 1.000 Abos an (Regeln und Gründe im
  [Spam-Schutz](./spam-schutz.md#benachrichtigungen-web-push)).
- Die gesammelten Benachrichtigungen liegen nur im Speicher der App: Ein
  Neustart in diesen zwei Minuten verwirft sie. Für einen Hinweis „schau mal
  aufs Brett“ ist das in Ordnung.
- Die Kita kann Benachrichtigungen pro Brett abschalten; das löscht die
  vorhandenen Abos des Bretts. Ein neuer Kita-Link löscht die Abos aller
  Bretter der Kita – wer nur den alten Link hat, hört nichts mehr von der
  Kita. In beiden Fällen und beim Löschen des Bretts verwirft die App auch
  eine noch gesammelte Benachrichtigung, und ein Versand, der gerade läuft,
  schickt nichts mehr los. Beim nächsten Besuch legt ein Browser ein so
  beendetes Abo nicht von selbst wieder an; dazu muss die Glocke erneut
  angetippt werden.
- Die App schickt nur an die Push-Dienste der Browser: `fcm.googleapis.com`
  (Chrome, Edge, meist auch Samsung Internet), `*.push.apple.com` (Safari),
  `updates.push.services.mozilla.com` (Firefox), `*.notify.windows.com`
  (Windows) und `*.push.samsungosp.com` (Samsung Internet, wenn es Samsungs
  eigenen Push-Dienst nutzt). Andere Adressen nimmt sie gar nicht erst an.
  Wer ausgehenden Verkehr des Servers filtert, gibt HTTPS zu diesen Hosts
  frei.
- Antwortet ein Push-Dienst, dass es ein Abo nicht mehr gibt, wird es
  gelöscht. Scheitert die Zustellung wiederholt und kam 30 Tage lang nichts
  an, räumt der stündliche Lauf das Abo ab, ebenso jedes Abo, das **180 Tage**
  weder einen Besuch (`last_visit_at`) noch eine erfolgreiche Zustellung
  (`last_success_at`, sonst seit dem Anlegen) hatte
  (`PUSH_SUBSCRIPTION_IDLE_DAYS` in `src/lib/limits.ts`) – ein stilles Brett,
  eine pausierte Kita, ein Handy in der Schublade. Das Log nennt nur den Push-Dienst
  und den Status (`[push] fcm.googleapis.com lehnt die Nachricht ab (403)`),
  nie die Adresse eines Abos.

## Service Worker und Proxy

Die Benachrichtigungen zeigt der Service Worker
`/sw.js` an, registriert für den Bereich `/k/`. Er kommt als statische Datei
aus `public/`, also an der App-Middleware vorbei, und Browser prüfen ihn
regelmäßig auf Updates. Der Proxy – und ein CDN davor erst recht – darf ihn
deshalb **nicht lange cachen**, sonst kommt ein Update nie an. Traefik cacht
von sich aus nichts; wer ein CDN oder einen cachenden Proxy davor hat, nimmt
`/sw.js` davon aus oder liefert es mit `Cache-Control: no-cache` aus.

Jede Kita hat außerdem ein eigenes Web-App-Manifest unter
`/k/<kita-link>/manifest.webmanifest`, das jede Seite der Kita einbindet. Es
kommt von der App selbst und trägt dieselben Header wie die Seiten der Kita.
`id`, `start_url` und `scope` sind alle `/k/<kita-link>/`, mit dem
Schrägstrich am Ende: Wird die App von einem Brett aus angelegt, startet sie
trotzdem auf der Seite der Kita, und ihre Bretter liegen im Bereich der App.
Nach einem neuen Kita-Link gehört das alte Symbol zu einer Adresse, die es
nicht mehr gibt; Eltern legen den neuen Link neu an.

## Was die Push-Dienste sehen

Der Inhalt jeder Nachricht ist Ende-zu-Ende verschlüsselt (RFC 8291). Lesbar
bleiben für den Push-Dienst Endpunkt, Zeitpunkt, Größe und die Header:
`Content-Encoding` (`aes128gcm`), `Content-Type` (`application/octet-stream`),
`TTL` (ein Tag), `Urgency`, `Topic` und `Authorization`.

`Authorization` ist der VAPID-Header (RFC 8292): ein signiertes JWT mit `aud`
(der Ursprung des Push-Dienstes), `exp` (zwölf Stunden nach dem Signieren) und
`sub` (`VAPID_SUBJECT`), dazu als `k` der öffentliche Schlüssel der Instanz.
Der ist für jedes Abo derselbe: Ein Push-Dienst kann also erkennen, welche
Endpunkte zur selben Instanz gehören, und über `sub`, wer sie betreibt.

Mit `Topic` ersetzt der Dienst eine
noch nicht zugestellte Nachricht desselben Bretts durch die neuere – das gilt
ohnehin nur innerhalb eines Abos (RFC 8030, Abschnitt 5.4). Er trägt nicht die
Brett-ID, sondern einen HMAC-SHA256 aus Brett-ID und Endpunkt, base64url, auf
32 Zeichen gekürzt. Der Schlüssel dazu wird mit HKDF-SHA256 und der festen
Kennung `kibo push topic v1` aus dem privaten VAPID-Schlüssel abgeleitet: ein
Geheimnis, das nur der Server kennt und das genau so lange stabil ist wie die
Abos. So bekommt jedes Abo eines Bretts immer denselben Topic, jedes andere
Abo aber einen anderen: Niemand kann ihn einem Brett oder einem Kita-Link
zuordnen, und ein Push-Dienst kann am Topic nicht erkennen, welche Endpunkte
demselben Brett folgen.

## iPhone: Declarative Web Push

Die Nachricht ist JSON im Format
„Declarative Web Push“ (`"web_push": 8030`, `notification` mit `title`,
`navigate` …). Safari ab iOS 18.4 erkennt sie **allein an diesem Feld** im
entschlüsselten Inhalt und zeigt die Benachrichtigung selbst an, ohne den
Service Worker. Ein besonderer `Content-Type` ist nicht nötig: Die App schickt
wie jede Web-Push-Bibliothek `application/octet-stream`. Das in älteren
WebKit-Entwürfen genannte `application/notification+json` ist überholt – WebKit
hat es vor der Auslieferung verworfen (Commit `986e05d99d`, Dezember 2024), und
beim Gerät kommt ein Content-Type gar nicht erst an. Streng ist Safari bei den
Feldtypen: `navigate` muss eine absolute URL sein, `web_push` eine Zahl; ein
falscher Typ macht die Nachricht zu einem gewöhnlichen Push. `navigate` zeigt
auf das Brett innerhalb der Kita (`/k/<kita-link>/<brett>/`), liegt also im
Bereich der App und öffnet das Brett dort statt in Safari. Ohne
`"mutable": true` läuft auf iOS der `push`-Handler des Service Workers nicht –
gewollt, Chrome und Firefox nutzen ihn weiterhin.

Die Zahl für das App-Symbol steht als `"app_badge": "3"` **neben**
`notification`, als Ziffernfolge in einem String; WebKit liest sie dort
(`NotificationJSONParser`, nimmt auch eine Zahl) und setzt sie ohne den
Service Worker aufs Symbol. Das Beispiel im WebKit-Blog zeigt `app_badge` noch
innerhalb von `notification`: Dort lasen sie die ersten Versionen (iOS 18.4),
bis WebKit sie im Mai 2025 im Zuge der Standardisierung nach oben verlegt hat
(WebKit-Bug 293457). Von iOS 18.4 bis vor iOS 26 ändert sich die Zahl deshalb
nur beim Laden einer Seite der App: Die deklarative Benachrichtigung umgeht dort
den Service Worker, und das `app_badge` auf oberster Ebene wird noch nicht
gelesen. Eine App, die aus dem Speicher zurückkommt, behält ihre Zahl, bis eine
Seite lädt oder eine Benachrichtigung kommt. Auf Android und dem Desktop setzt der Service Worker sie beim
Anzeigen der Benachrichtigung mit `navigator.setAppBadge`, wo der Browser das
kann. Quellen:
[WebKit-Blog](https://webkit.org/blog/16535/meet-declarative-web-push/),
[Push API](https://w3c.github.io/push-api/),
[WWDC25, Session 235](https://developer.apple.com/videos/play/wwdc2025/235/).
