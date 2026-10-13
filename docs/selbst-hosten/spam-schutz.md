# Spam-Schutz

Ein Brett ist öffentlich: Wer den Link der Kita hat, darf schreiben. Kein Konto, kein
CAPTCHA. Damit das auch dann trägt, wenn der Link in falsche Hände gerät,
begrenzt Kibo, wie viel von einer Stelle aus in welcher Zeit geschrieben werden
darf, verlangt für jeden Zettel ein Formular-Token des Bretts, erkennt
wiederholte Inhalte und liefert Bretter seitenweise aus.

Die Seite des Betriebs – Reverse Proxy, Netzwerke, Ports – steht unter
[Traefik](./traefik.md) und [Sicherheit](./sicherheit.md). Die Vertrauensgrenze
ist hier noch einmal zusammengefasst, damit diese Seite für sich steht.

## Vertrauensgrenze

Alle Budgets hängen daran, dass die Absenderadresse nicht frei wählbar ist.
Zwei Voraussetzungen:

1. **Der App-Port ist nicht öffentlich erreichbar.** Kibo läuft ausschließlich
   hinter dem Reverse Proxy. Wer die App direkt erreichen kann, setzt seine
   eigenen `X-Forwarded-*`-Header und umgeht damit jede Zählung.
2. **Der Proxy überschreibt eingehende `X-Forwarded-For`.** Traefik tut das,
   solange `forwardedHeaders.trustedIPs` nicht gesetzt ist: Es verwirft, was der
   Client geschickt hat, und schreibt einen einzigen eigenen Wert.

Hängt noch etwas davor, das an die Kette anhängt (CDN, zweiter Proxy), muss das
über die Umgebungsvariable **`TRUSTED_PROXIES`** bekannt gemacht werden –
kommaseparierte IPs oder CIDR-Bereiche:

```
TRUSTED_PROXIES=10.0.0.0/8,2001:db8::/32
```

Dieselbe Einstellung speist auch Better Auth (`advanced.ipAddress.
trustedProxies`), damit Beitrags- und Auth-Limits dieselbe Adresse sehen.

## Wer wird gezählt

Grundlage ist das Netz, aus dem die Anfrage kommt – nicht die Person.

- **Mit `TRUSTED_PROXIES`**: Die Kette wird von rechts abgebaut, jeder bekannte
  Proxy übersprungen; die erste Adresse, für die niemand bürgt, ist der Client.
- **Ohne `TRUSTED_PROXIES`** (Standard): Es wird nur ein `X-Forwarded-For` mit
  genau einem Eintrag akzeptiert – exakt das, was Traefik als einziger Proxy
  erzeugt.
- **Lässt sich die Kette so nicht auflösen**, landet die Anfrage im
  gemeinsamen Sammeltopf `unbekannt`, und das Log meldet es einmal pro Prozess
  (`[spam] X-Forwarded-For ließ sich nicht auflösen …`). Die Adresse, die
  Astro dann als `clientAddress` meldet, ist _nicht_ die der Verbindung,
  sondern der linke Eintrag der Kette – und den schreibt der Client selbst.
  Mit jeder neu erfundenen Kette bekäme er ein frisches Budget. Der Sammeltopf
  ist der kleinere Schaden: Wer hineinfällt, teilt sich ein Budget, statt sich
  beliebig viele zu nehmen. Im dokumentierten Aufbau kommt er nicht vor; taucht
  die Warnung auf, hängt etwas vor Kibo, das an die Kette anhängt, und gehört
  in `TRUSTED_PROXIES`.
- **Ohne `X-Forwarded-For`** (nur bei direktem Zugriff, etwa lokal) zählt die
  Adresse der Verbindung.
- `TRUSTED_PROXIES` wird beim Start geprüft: Ein Eintrag, der weder IP noch
  CIDR-Bereich ist, lässt `scripts/server.mjs` mit einer Fehlermeldung
  abbrechen (unter `astro dev` wird er ignoriert und ins Log geschrieben).
- IPv4-Adressen zählen einzeln. IPv6-Adressen werden auf das **/64** gekürzt:
  Jedes Gerät darin kann sich beliebig neue Adressen geben (Privacy
  Extensions), ein engeres Präfix ließe sich also kostenlos umgehen. Better
  Auth kürzt intern genauso.
- **Weitere IPv6-Netze.** Ein Hausanschluss bekommt aber meist ein /56 – 256
  /64-Netze –, ein günstiger Server ein /48 mit 65.536. Wer dort jede Anfrage
  aus einem neuen /64 schickt, hätte ebenso viele Budgets. Fürs Anpinnen und
  Melden zählt deshalb zusätzlich das **/56** und das **/48** der Adresse,
  mit höheren Grenzen (siehe die Tabellen unten), damit eine Familie mit
  mehreren Geräten oder ein Haus mit vielen Anschlüssen nicht aneinander
  stößt. Mobilfunkanbieter und manche Provider vergeben allerdings /64-Netze
  fremder Kunden aus demselben /56 oder /48, sodass sich auch Unbekannte diese
  Budgets teilen können. Jedes weitere Netz zählt nur, was die Budgets des
  engeren Netzes passiert: Das /56 zählt nach dem /64, das /48 nach dem /56.
  Ein bereits abgewiesenes /64 oder /56 verbraucht nichts vom Kontingent
  seiner Nachbarn. IPv4 bekommt keine solche Stufe – hinter
  Carrier-Grade-NAT wären in einem /24 ganze Stadtteile –, und der
  Sammeltopf `unbekannt` ist ohnehin nur ein Budget.
- Gleichwertige Schreibweisen derselben Adresse landen im selben Budget:
  Groß-/Kleinschreibung, verkürzte Nullgruppen, eckige Klammern, Portangabe,
  Zone-ID und IPv4-in-IPv6 (`::ffff:203.0.113.7` zählt wie `203.0.113.7`).

Code: `src/lib/spam/client-ip.ts`.

## Budgets für Zettel

Ein Versuch, einen Zettel anzupinnen, läuft in dieser Reihenfolge durch:

1. **Honeypot** und **[Formular-Token](#formular-token)** – ein ausgefülltes,
   unsichtbares Feld oder ein fehlendes, zu frisches, abgelaufenes oder
   fremdes Token wird wie jede ungültige Eingabe abgewiesen. Das kostet kein
   Budget.
2. **Netz-Budgets** – was diese eine Herkunft darf, erst das /64 (oder die
   IPv4-Adresse), dann /56, dann /48. Geprüft, bevor das Brett überhaupt
   nachgeschlagen wird: Wer mit erfundenen Links anklopft, zahlt für jeden
   Versuch, ohne dass die Datenbank nach dem Brett suchen muss.
3. **Netz-und-Brett-Budget** – was diese Herkunft auf diesem einen Brett darf.
4. **Brett- und Kita-Budgets**, Zettel speichern und **Duplikatprüfung** – in
   einer Transaktion: hängt genau dieser Text schon, wird alles zurückgenommen.

Die Reihenfolge ist wesentlich, und die beiden Arten von Budget verhalten sich
dabei bewusst **unterschiedlich**:

- **Netz-Budgets zählen jeden Versuch**, auch einen abgewiesenen. Sie begrenzen
  nicht, wie viel jemand anpinnen darf, sondern wie oft er es versuchen darf –
  sonst könnte ein Skript beliebig oft anklopfen, solange es nur abgewiesen
  wird, und die Prüfung liefe ins Leere. Ein abgewiesener Versuch schiebt das
  Fenster allerdings nicht nach hinten (siehe „Fenster“ weiter unten): Wer
  wartet, ist nach Ablauf wieder dran.
- **Brett- und Kita-Budgets zählen nur, was gespeichert wird.** Sie gehören
  allen; würde jeder Versuch mitzählen, könnte eine einzige laute IP mit 300 abgewiesenen
  Anfragen das Brett für einen Tag dichtmachen, ohne je einen Zettel
  anzupinnen. Technisch fällt das mit ab, weil Zähler, Zettel und
  Duplikatmerkmal in einer Transaktion stehen: Wird der Zettel nicht gespeichert
  – Duplikat, Fehler –, ist der Zähler mit zurückgenommen.

Weil die Netz-Budgets gestaffelt sind, **wächst die genannte Wartezeit, wenn
jemand weiter versucht**: Die ersten Abweisungen nennen die Restlaufzeit des
Fünf-Minuten-Fensters, nach zwölf Versuchen in der Stunde die des
Stundenfensters, danach die des Tages. Für Eltern, die einmal zu viel auf den
Knopf gedrückt haben, bleibt es bei den fünf Minuten; ein Skript, das weiter
hämmert, sperrt sich selbst immer länger aus.

| Budget                  | Bezug               | Zeitraum   | Grenze | gleitend |
| ----------------------- | ------------------- | ---------- | ------ | -------- |
| `note:burst`            | Netz                | 5 Minuten  | 5      | ja       |
| `note:client-hour`      | Netz                | 1 Stunde   | 12     | ja       |
| `note:client-day`       | Netz                | 24 Stunden | 30     | nein     |
| `note:client56-hour`    | IPv6-/56            | 1 Stunde   | 36     | ja       |
| `note:client56-day`     | IPv6-/56            | 24 Stunden | 90     | nein     |
| `note:client48-day`     | IPv6-/48            | 24 Stunden | 300    | nein     |
| `note:client-board-day` | Netz + Brett + Link | 24 Stunden | 15     | nein     |
| `note:board-hour`       | Brett + Link        | 1 Stunde   | 60     | nein     |
| `note:board-day`        | Brett + Link        | 24 Stunden | 300    | nein     |
| `note:kita-hour`        | Kita-Link           | 1 Stunde   | 120    | nein     |
| `note:kita-day`         | Kita-Link           | 24 Stunden | 600    | nein     |
| `note:list` (Blättern)  | Netz                | 15 Minuten | 120    | nein     |
| `note:remove`           | Netz                | 15 Minuten | 30     | nein     |

„Netz“ ist das /64 einer IPv6-Adresse oder die IPv4-Adresse. `note:list`
zählt auch das Abholen eines Formular-Tokens.

Begründung:

- **Realistische Nutzung.** Eltern pinnen ein paar Zettel im Jahr, an einem
  aktiven Abend vielleicht drei hintereinander. Fünf in fünf Minuten decken das
  ab.
- **Geteilte Netze.** Hinter einer Kita-IP oder einem Mobilfunk-/64 sitzen viele
  Eltern. Deshalb sind die Netz-Budgets bewusst nicht scharf: zwölf Zettel pro
  Stunde und dreißig pro Tag reichen auch für einen Elternabend, an dem mehrere
  gleichzeitig schreiben. Gegenüber der alten Regel (10 pro 15 Minuten,
  rechnerisch ~960 pro Tag) ist das Tagesvolumen auf ein Dreißigstel gesenkt.
- **Weitere IPv6-Netze.** Das /56 darf das Dreifache eines /64 (36 pro Stunde,
  90 am Tag), das /48 das Zehnfache am Tag (300). Mehrere Geräte einer
  Familie oder ein Elternabend mit IPv6 im Kita-WLAN kommen damit nicht in die
  Nähe; wer dagegen durch die /64-Netze seines Anschlusses rotiert, hat statt
  256 Tagesbudgets nur noch drei. Weil Mobilfunkanbieter und manche Provider
  die /64-Netze einander fremder Kunden aus demselben /56 oder /48 vergeben,
  teilen sich dort auch Unbekannte diese Budgets; deshalb liegen die Grenzen
  so hoch. Auf einer viel genutzten Instanz kann ein großes Mobilfunknetz
  trotzdem in seltenen Fällen an die Grenze des /48 stoßen.
- **Kein gezieltes Aussperren.** Die Brett-Budgets sind die einzige Regel, mit
  der jemand andere aussperren könnte. Sie liegen deshalb hoch: 300 Zettel an
  einem Tag bedeuten 300 erfolgreiche Beiträge aus mindestens zwanzig Netzen.
  Das fällt in der Zettelliste sofort auf und ist über „Zettel entfernen“ und
  „Neuen Link erzeugen“ zu beantworten. Ein Brett, auf dem mehr als 60 Zettel pro
  Stunde landen, wird nicht von Eltern benutzt.
- **Pro Kita.** Die Brett-Budgets addieren sich: Eine Kita mit acht Brettern
  nähme sonst 2.400 Zettel am Tag. Alle Bretter einer Kita zusammen nehmen
  deshalb höchstens 120 Zettel pro Stunde und 600 am Tag – das Doppelte eines
  einzelnen Bretts, damit ein voller Tag auf einem Brett die anderen nicht
  gleich mitsperrt.
- **Gezählt wird pro Brett und Kita-Link.** Der Bezug ist das Brett zusammen
  mit dem aktuellen Link seiner Kita, beim Kita-Budget der Link selbst. „Neuen Link erzeugen“ beendet einen
  Angriff also vollständig: Unter dem neuen Link starten alle Bretter der Kita
  mit frischem Budget und bleiben nicht für den Rest des Tages dicht, nur weil
  über den alten Link geflutet wurde. Wer den neuen Link nicht hat, kann
  darauf ohnehin nichts anpinnen.
- **Löschen** kostet ein eigenes kleines Budget (`note:remove`, 30 in 15
  Minuten): Eltern nehmen ein paar Zettel im Jahr ab, ein Skript mit geratenen
  Löschschlüsseln soll die Datenbank nicht beliebig oft fragen dürfen.

**Fenster.** Gezählt wird in festen Zeitfenstern, weil ein festes Fenster genau
eine Zeile ist, die sich atomar hochzählen lässt; ein abgewiesener Versuch kann
das Fenster deshalb nie weiter nach hinten schieben. Feste Fenster allein hätten
aber eine Lücke: Wer kurz vor Fensterende ein volles Budget ausgibt und direkt
danach noch eines, hätte in wenigen Sekunden das Doppelte. Die kurzen Budgets
(`note:burst`, `note:client-hour`) zählen deshalb beim Auswerten das vorherige
Fenster anteilig mit – je weiter das aktuelle Fenster fortgeschritten ist, desto
weniger. Das ist eine Näherung an ein gleitendes Fenster und kostet einen
zusätzlichen Lesezugriff; die langen Budgets haben das Problem nicht in
relevantem Ausmaß und bleiben feste Fenster.

Wer wartet, ist nach Ablauf des Fensters wieder dran – auch wer in der
Zwischenzeit erfolglos weiterversucht hat.

Werte: `src/lib/spam/budgets.ts`.

## Formular-Token

Ein Skript kann `notes.create` direkt aufrufen, ohne je ein Brett zu laden –
der Honeypot im Formular erreicht es dann nie. Jeder Zettel braucht deshalb
ein **Formular-Token** seines Bretts:

- **Abholen.** Das Formular „Zettel anpinnen“ holt sich beim Öffnen eines
  über `notes.formToken` (nicht schon beim Laden der Seite). Das Brett muss
  hinter dem Kita-Link existieren und darf nicht pausiert sein, und jeder
  Abruf zählt wie Blättern gegen `note:list`.
- **Inhalt.** Die ID des Schlüssels, Ausstellungszeit, eine Zufallszahl und
  eine HMAC-Signatur über Brett-ID, Zeit und Zufallszahl mit dem aktuellen
  Schlüssel aus `spam_key` (siehe „Datenhaltung“). Gespeichert wird pro Token
  nichts. Geprüft wird nur mit dem Schlüssel, den das Token nennt: Ein Token,
  das mit einem bekannten Schlüssel gefälscht ist, kostet keine
  Datenbankabfrage. Ein Schlüssel, der rotiert wurde, prüft weiter, solange er
  auch zählt (25 Stunden nach seiner Ablösung) – weit länger, als ein Token
  lebt. Nennt ein Token einen Schlüssel, den der Prozess nicht kennt – etwa
  einen, den ein anderer Prozess gerade erst angelegt hat –, liest er die
  Schlüssel nach, höchstens alle fünf Sekunden. Diese Nachprüfung hat eine
  eigene Bremse: Ein gewöhnlicher Abruf des Schlüssel-Caches verzögert sie
  nicht, damit ein bereits gültiges Token eines neuen Schlüssels auch kurz
  nach dem Abruf geprüft werden kann.
- **Angenommen** wird ein Token frühestens **3 Sekunden** und höchstens
  **2 Stunden** nach dem Ausstellen und nur für das Brett, für das es
  ausgestellt wurde (`NOTE_FORM_TOKEN_MIN_AGE_MS`,
  `NOTE_FORM_TOKEN_MAX_AGE_MS` in `src/lib/limits.ts`). Alles andere – kein
  Token, zu früh, zu alt, ein anderes Brett, verändert – bekommt **400** wie
  jede ungültige Eingabe, ohne dass die Antwort das Feld nennt, und zählt im
  Log als `note:token`. Geprüft wird vor allen Budgets: Ein Aufruf ohne
  gültiges Token kostet weder das eigene Netz noch das Brett etwas.
- **Eltern merken nichts davon.** Wer schneller als in drei Sekunden absendet,
  wartet den Rest im Formular ab („Wird angepinnt …“). Ein Token, das bald
  abläuft, ersetzt das Formular vor dem Absenden durch ein neues. Wird ein
  Zettel trotzdem abgewiesen, bleibt der Text stehen.
- **Die Grenze.** Das Token hält nur Skripte auf, die die Seite gar nicht
  erst ansehen. Ein Skript, das sich ein Token holt und drei Sekunden wartet,
  kommt durch, und ein Token gilt zwei Stunden lang für beliebig viele
  Zettel. Ab da greifen die Budgets oben; das Token ersetzt keines davon.

Code: `src/lib/spam/form-token.ts`, im Browser
`src/lib/board/form-token-client.ts`.

## Benachrichtigungen (Web-Push)

Wer die Glocke eines Bretts aktiviert, meldet für dieses Brett einen
Push-Endpunkt seines Browsers an; bei neuen Zetteln schickt der Server dorthin eine
Benachrichtigung. Zwei Dinge sind dabei zu schützen: der Server selbst, der an
eine Adresse posten soll, die ein Besucher angibt, und die Handys der Eltern,
die bei einer Zettelflut nicht im Minutentakt klingeln sollen. Code:
`src/lib/push/`, Budgets in `src/lib/spam/budgets.ts`.

| Budget                       | Bezug | Zeitraum   | Grenze | gleitend |
| ---------------------------- | ----- | ---------- | ------ | -------- |
| `push:request`               | Netz  | 15 Minuten | 120    | nein     |
| `push:subscribe-client-hour` | Netz  | 1 Stunde   | 150    | ja       |
| `push:board-hour`            | Brett | 1 Stunde   | 6      | nein     |

Dazu kommt eine feste Obergrenze von **1.000 Abos pro Brett**.

- **Nur bekannte Push-Dienste.** Angenommen werden ausschließlich
  `https://`-Adressen ohne Zugangsdaten und ohne eigenen Port auf
  `fcm.googleapis.com`, `updates.push.services.mozilla.com` sowie Subdomains
  von `push.apple.com`, `notify.windows.com` und `push.samsungosp.com`
  (Samsung Internet mit Samsungs eigenem Push-Dienst) – genauer Hostvergleich bzw.
  Endung mit Punkt davor, nie ein Teilstring. IP-Adressen,
  `fcm.googleapis.com.evil.tld` oder `evilpush.apple.com` fallen durch. Die
  Prüfung läuft beim Anmelden und noch einmal direkt vor jedem Versand;
  gesendet wird mit `redirect: 'manual'` und 10 Sekunden Zeitlimit, eine
  Weiterleitung führt also nirgendwohin. Die Schlüssel des Browsers müssen die
  richtige Länge haben (65 bzw. 16 Byte) und auf der Kurve liegen.
- **`push:request`** zählt jeden Aufruf von `push.sync`, `push.subscribe`
  und `push.unsubscribe`. Ein Browser mit Abo gleicht es bei jedem
  Seitenaufruf der Kita ab, auf einem Brett noch einmal, wenn dort neue
  Zettel erscheinen (für die Zahl auf dem App-Symbol), deshalb ist das Budget
  so groß wie das fürs Blättern. Ein Link, der gar nicht wie ein Kita-Link aussieht, bekommt ohne
  Datenbankzugriff 404 und kostet nichts.
- **Abgleich beim Laden legt nichts an.** Eine Seite der Kita ruft beim Laden
  einmal `push.sync` mit dem Endpunkt des Browsers auf: Die Antwort nennt
  jedes Brett der Kita, das diesen Endpunkt noch hat – ihre Glocken stehen auf
  an –, und wo sich die Schlüssel des Browsers geändert haben, werden sie
  aufgefrischt. Was nicht mehr
  dabei ist (neuer Kita-Link, abgeschaltet, vom Push-Dienst beendet), bleibt
  aus, ohne neues Abo, ohne `push:subscribe-client-hour` und ohne die
  Obergrenze zu berühren. Ein neues Abo gibt es nur über die Glocke, immer für
  ein Brett.
- **`push:subscribe-client-hour`** zählt nur **neue** Abos eines Netzes, je
  Brett eines. Das erneute Anmelden eines Abos, das das Brett schon hat,
  kostet hier nichts. 150 pro Stunde reichen für einen Elternabend im
  Kita-WLAN, an dem einige Dutzend Handys je mehrere Bretter einschalten; ein
  Skript, das sich Endpunkte ausdenkt, ist schnell draußen.
- **1.000 Abos pro Brett** liegen weit über jeder Kita-Gruppe und begrenzen,
  wie viele Anfragen ein einzelner Zettel auslösen kann. Link prüfen, Zählen
  und Eintragen laufen in einer Transaktion unter einer Sperre der
  Brett-Zeile und der Zeile des Kita-Links: Parallele Anfragen kommen nicht
  gemeinsam über die Grenze, und ein Abo über den alten Link kann nicht nach
  einem neuen Kita-Link oder dem Abschalten doch noch hineinrutschen – es
  wartet auf die Sperre und findet dann kein Brett mehr (404).
- **`push:board-hour`**: höchstens 6 Benachrichtigungen pro Brett und Stunde,
  gezählt pro Versand an alle Abonnenten. Neue Zettel werden ohnehin zwei
  Minuten gesammelt und gehen gebündelt raus („3 neue Zettel“). Ist das Budget
  aufgebraucht, bleiben die Zettel liegen und gehen mit dem nächsten Fenster
  raus, zusammen mit allem, was bis dahin dazukommt. Gezählt wird pro Brett,
  nicht pro Link: Ein neuer Kita-Link löscht ohnehin alle Abos.
- **Inhalt.** Die Benachrichtigung nennt nur Brettnamen und Titel bzw. Anzahl
  der Zettel, nie Text, Namen oder Kontakt; sie ist Ende-zu-Ende verschlüsselt
  (RFC 8291), die Push-Dienste sehen nur Metadaten; der `Topic`-Header trägt
  einen HMAC aus Brett-ID und Endpunkt, nicht die ID selbst, und verrät nicht,
  welche Endpunkte demselben Brett folgen
  ([Was die Push-Dienste sehen](./benachrichtigungen.md#was-die-push-dienste-sehen)).
  Wer den Zettel selbst angepinnt hat, wird dafür nicht benachrichtigt.
- **Aufräumen.** Meldet ein Push-Dienst 404 oder 410, ist das Abo sofort weg.
  Scheitert die Zustellung mindestens dreimal in Folge und kam seit 30 Tagen
  nichts an, löscht der stündliche Lauf das Abo, ebenso eines ohne Besuch
  (`push.sync` vermerkt ihn höchstens einmal am Tag) und ohne erfolgreiche
  Zustellung seit 180 Tagen. Schaltet ein Browser seine letzte Glocke aus,
  meldet er sich auch beim Push-Dienst ab, ebenso beim nächsten Abgleich,
  wenn der Server seine letzten Abos gelöscht hat. Das Abschalten der
  Benachrichtigungen im Admin-Bereich und das Löschen des Bretts entfernen
  alle Abos des Bretts, ein neuer Kita-Link die Abos aller Bretter der Kita
  in der Transaktion, in der der neue Link entsteht. Danach verwirft die App eine
  noch gesammelte Benachrichtigung und hält einen laufenden Versand an: Was
  schon unterwegs ist, läuft zu Ende, alles andere geht nicht mehr raus.
- **Störungen.** Lässt sich `push:board-hour` nicht prüfen, entfällt diese
  Benachrichtigung; der Zettel selbst ist davon nie betroffen, weil der
  Versand erst nach dem Speichern und außerhalb der Anfrage läuft.

## Wiederholte Inhalte

Zusätzlich wird pro Brett festgehalten, welcher Text dort gerade hängt. Als
derselbe Text gilt, was sich nur in Groß-/Kleinschreibung, Leerzeichen,
Satzzeichen, Akzenten oder Unicode-Schreibweise unterscheidet (`Überschrift` +
`Text`, je für sich normalisiert: NFKD, unsichtbare Zeichen wie Null-Breite-
Leerzeichen, weiche Trennstriche, kombinierende Zeichen und Steuerzeichen
entfernt). Überschrift und Text bleiben durch ein Trennzeichen
auseinandergehalten, das in keinem der beiden übrig bleiben kann: Ein Wort,
das von der Überschrift in den Text wandert, ergibt einen anderen Zettel.
Bleibt nach dem Normalisieren von beidem nichts übrig (nur Satzzeichen), gibt
es nichts zu vergleichen, und der Zettel gilt nie als Duplikat. Innerhalb von **24 Stunden** wird eine Wiederholung abgewiesen,
danach ist derselbe Zettel wieder erlaubt – eine Erinnerung nächste Woche soll
funktionieren.

Der Anspruch auf einen Text wird mit einer einzigen `INSERT … ON CONFLICT`-
Anweisung erhoben. Von mehreren gleichzeitig eintreffenden Duplikaten kommt
deshalb genau eines durch, auch über mehrere Prozesse hinweg.

Der Anspruch ist an den Zettel gebunden, der daraus entsteht:

- Wird der Zettel **nicht** gespeichert (Brett- oder Kita-Budget erschöpft, Datenbankfehler),
  wird der Anspruch sofort wieder freigegeben. Ein gescheiterter Versuch sperrt
  den Text also nicht einen Tag lang.
- Wird der Zettel gespeichert, hängt der Fingerabdruck per Fremdschlüssel an ihm.
  **Entfernt jemand den Zettel** – die Verfasserin selbst, die Kita im
  Admin-Bereich, oder der Ablauf –, verschwindet der Fingerabdruck mit ihm, und
  derselbe Text darf sofort wieder gepinnt werden.

## Meldungen

Eltern melden einen Zettel ohne Konto (`notes.report`,
[Meldungen](../fuer-kitas/meldungen.md)). Der Ablauf gleicht dem Anpinnen:

1. **Honeypot** – ein ausgefülltes, unsichtbares Feld wird wie jede ungültige
   Eingabe abgewiesen (`report:honeypot`).
2. **Netz-Budgets** – erst das /64 (oder die IPv4-Adresse), dann /56, dann /48,
   geprüft, bevor das Brett nachgeschlagen wird; erfundene Links kosten so
   viel wie echte Meldungen.
3. **Netz-und-Brett-** und **Netz-und-Zettel-Budget**, sobald Kita-Link und
   Brett zusammengehören (ein alter Link oder ein Brett einer anderen Kita:
   404).
4. In einer Transaktion: der Zettel muss **auf diesem Brett hängen und darf
   nicht abgelaufen sein** (sonst 404 – auch für die Kennung eines Zettels von
   einem anderen Brett), dann
   das **Brett-Budget**, mit der Option „auch an den Betreiber melden“ die
   **Betreiber-Budgets**, der Fall und die E-Mail-Aufträge. Scheitert etwas,
   ist alles zurückgenommen, auch die Zähler.

| Budget                      | Bezug               | Zeitraum   | Grenze | gleitend |
| --------------------------- | ------------------- | ---------- | ------ | -------- |
| `report:client-hour`        | Netz                | 1 Stunde   | 10     | ja       |
| `report:client-day`         | Netz                | 24 Stunden | 30     | nein     |
| `report:client56-hour`      | IPv6-/56            | 1 Stunde   | 30     | ja       |
| `report:client56-day`       | IPv6-/56            | 24 Stunden | 90     | nein     |
| `report:client48-day`       | IPv6-/48            | 24 Stunden | 300    | nein     |
| `report:client-board-day`   | Netz + Brett + Link | 24 Stunden | 15     | nein     |
| `report:client-note-day`    | Netz + Zettel       | 24 Stunden | 3      | nein     |
| `report:board-hour`         | Brett + Link        | 1 Stunde   | 30     | nein     |
| `report:board-day`          | Brett + Link        | 24 Stunden | 100    | nein     |
| `report:operator-note-day`  | Zettel              | 24 Stunden | 5      | nein     |
| `report:operator-board-day` | Brett + Link        | 24 Stunden | 20     | nein     |

- **Dasselbe Netz, derselbe Zettel:** Drei Meldungen am Tag lassen auch
  mehrere Eltern im Kita-WLAN melden; die vierte bekommt „Dieser Zettel wurde
  von hier aus gerade schon gemeldet. Die Verantwortlichen sind informiert.“
- **Ein Fall pro Zettel.** Alle Meldungen eines offenen Falls zählen auf ihn
  (ein eindeutiger Index auf offene Fälle je Zettel); parallele Meldungen
  erzeugen weder einen zweiten Fall noch zweite E-Mail-Aufträge. Gespeichert
  werden je Fall höchstens 25 Meldungen mit Grund und Hinweis
  (`REPORTS_PER_CASE_MAX` in `src/lib/limits.ts`), weitere nur gezählt.
- **Gleiche Hinweise** – gleich nach derselben Normalisierung wie beim
  Zetteltext – werden je Zettel binnen 24 Stunden nur einmal gespeichert;
  die Meldung zählt trotzdem (`report:duplicate`). Der Fingerabdruck liegt wie
  der eines Zetteltexts in `spam_fingerprint`.
- **Die Antwort sagt nichts.** Neuer Fall oder weitere Meldung, mit oder ohne
  E-Mail: Die Aktion antwortet gleich und liefert nichts zurück – außer mit
  der Option „auch an den Betreiber melden“, wo sie sagt, ob die E-Mail an den
  Betreiber hinausging. Ein Brett einer pausierten Kita nimmt keine Meldungen
  an (402), wie es keine Zettel annimmt.
- **Nichts über die meldende Person.** Kein Name, keine Adresse, keine
  IP-Adresse: Das Netz geht nur als Bezug in die HMAC-Zähler ein. Name und
  Adresse, die jemand mit der Betreiber-Option angibt, stehen nur in der
  E-Mail an den Betreiber; die Adresse geht außerdem, wie das Netz, nur als
  Bezug in die HMAC-Zähler der Eingangsbestätigung ein, nie im Klartext. In die Logs kommt weder ein Zetteltext noch ein
  Hinweis noch eine Fallkennung.
- **Meldungen an den Betreiber** ([Hinweise auf rechtswidrige
  Inhalte](./rechtswidrige-inhalte.md)) schreiben bei jeder Meldung mit der
  Option eine E-Mail an `OPERATOR_EMAIL`, also nicht nur beim ersten Mal wie
  beim Team: Jede Meldung ist ein eigener Hinweis, den der Betreiber
  beantworten muss. Damit sich das Postfach trotzdem nicht fluten lässt,
  zählen die Betreiber-Budgets je Zettel (5 am Tag – nach der ersten E-Mail
  kennt der Betreiber den Zettel) und je Brett (20 am Tag), zusätzlich zu den
  Budgets oben. Darüber wird die Meldung mit der Option ganz abgewiesen
  („… Du kannst den Zettel ohne diese Option der Kita melden oder dem
  Betreiber direkt an … schreiben.“ mit `OPERATOR_EMAIL`,
  `report:operator-limited`); ohne die Option geht sie wie gewohnt durch. Die
  Eingangsbestätigung an die meldende Person zählt als Mail der Art
  `report-receipt` gegen die Budgets pro Adresse (siehe „Anmeldung und
  Auth-Mails“) und unterbleibt darüber still; die Meldung selbst geht durch.

**E-Mails an das Team.** Nur ein neuer Fall löst E-Mails aus, an jedes
Mitglied mit der Rolle Inhaber oder Admin einzeln. Jede Person bekommt pro
Kita höchstens **eine E-Mail in der Stunde** (`REPORT_MAIL_INTERVAL_MS`),
gerechnet ab der letzten zugestellten; Fälle, die dazwischen eintreffen,
warten und gehen gesammelt mit der nächsten raus („2 Zettel gemeldet“). Ein
gescheiterter Versand verbraucht diese Stunde nicht, und auch mehrere
Prozesse halten sie ein: Solange einer die E-Mail einer Person verschickt,
lässt jeder andere deren Aufträge liegen. Wie die Aufträge
abgearbeitet werden, steht unter
[Betrieb](./betrieb.md#meldungen-und-ihre-e-mails).

Werte: `src/lib/spam/budgets.ts` (`REPORT_*`), Tests:
`tests/note-reports.test.ts`, `tests/report-outbox.test.ts`,
`tests/operator-reports.test.ts`.

## Anmeldung und Auth-Mails

- Better Auth ist ausdrücklich konfiguriert (`src/lib/auth-options.ts`) und legt
  seine Zähler in derselben PostgreSQL ab (`rateLimit.storage: 'database'`), also
  gemeinsam für alle Prozesse und über Neustarts hinweg. Anders als die
  Kibo-eigenen Zähler stehen dort die Schlüssel im Klartext als `IP|Pfad`
  (IPv6 auf /64 gekürzt). Better Auth selbst löscht alte Zeilen nur, wenn eine
  neue Anfrage ein Fenster beginnt; deshalb löscht der stündliche Lauf jede
  Zeile, deren letzte Anfrage länger als das längste Fenster (1 Stunde) plus
  5 Minuten zurückliegt (`purgeStaleRateLimits` in
  `src/lib/expired-sessions.ts`) – spätestens gut zwei Stunden nach der
  letzten Anfrage.
  - `/sign-up/email`, `/send-verification-email`, `/request-password-reset`,
    `/change-email`: 5 pro Stunde und Netz (der Reset-Pfad heißt in Better Auth
    `/request-password-reset`; eine Regel unter einem nicht existierenden Pfad
    würde stillschweigend nie greifen – `tests/auth-rules.test.ts` prüft jeden
    konfigurierten Pfad gegen die tatsächlich vorhandenen Routen)
  - `/reset-password`: 10 pro Stunde, `/verify-email`: 20 pro Stunde
  - `/organization/invite-member`: 10 pro Stunde und Netz (verschickt eine
    Mail); `/organization/accept-invitation` und
    `/organization/reject-invitation`: 20 pro Stunde, wie `/verify-email` –
    ein Link aus dem Postfach. Die Budgets pro Kita, pro Konto und pro
    Empfänger stehen unter „Einladungen“.
  - Raten eines Passworts oder Codes, 10 pro 10 Minuten: `/sign-in/email`,
    `/two-factor/verify-totp`, `/two-factor/verify-backup-code`,
    `/passkey/verify-authentication` (die Anmeldung mit Passkey; zehn
    gescheiterte Versuche in zehn Minuten sind ohnehin kein Versehen mehr) und
    alle Routen, die das aktuelle Passwort prüfen – `/change-password`,
    `/delete-user`, `/verify-password`, `/two-factor/enable`,
    `/two-factor/disable`, `/two-factor/get-totp-uri`,
    `/two-factor/generate-backup-codes`, `/passkey/verify-registration`. Eine
    gestohlene Sitzung rät damit nicht schneller als die Anmeldeseite;
    `tests/auth-rules.test.ts` prüft, dass jede dieser Routen dieselbe Regel
    hat.
  - `/passkey/generate-register-options` und
    `/passkey/generate-authenticate-options`: 20 pro Minute und Netz. Jeder
    Aufruf legt eine Challenge in der Tabelle `verification` ab (fünf Minuten
    gültig; abgelaufene löscht der [stündliche Lauf](./betrieb.md)). Schon das
    Öffnen der Anmeldeseite in einem Browser mit Passkey-Vorschlägen ist ein
    solcher Aufruf, und eine offene Anmeldeseite fragt alle vier Minuten neu,
    damit die Challenge ihres Vorschlags nicht abläuft. Gezählt werden auch
    diese GET-Anfragen.
  - sonst 60 pro Minute
- **Anmeldung pro Konto.** Zusätzlich zählt `/sign-in/email` pro
  E-Mail-Adresse (getrimmt, klein geschrieben): **20 Versuche pro Stunde**,
  gleitend (`auth:sign-in-account`, Hook in `src/lib/auth.ts`). Ohne dieses
  Budget könnte ein Angreifer aus vielen Netzen zugleich ein Passwort raten,
  jedes Netz unter seiner eigenen Grenze. Gezählt wird jeder Versuch,
  erfolgreiche eingeschlossen – eine Leitung meldet sich ein paar Mal am Tag
  an, und ein Zähler, der Erfolge zurücknimmt, bräuchte einen zweiten
  Schreibzugriff nach der Antwort. Ist das Budget erschöpft, antwortet die
  Anmeldung mit **429** (`code: TOO_MANY_REQUESTS`, `X-Retry-After` in
  Sekunden), gleich ob das Passwort stimmt. Der Preis: Wer ein Konto gezielt
  mit Fehlversuchen flutet, sperrt dessen Anmeldung, solange er das tut –
  höchstens eine Stunde über das Ende des Angriffs hinaus. Das Passwort
  zurücksetzen funktioniert dabei weiter. Ist das Budget nicht prüfbar
  (Datenbank weg), wird die Anmeldung ebenfalls abgewiesen; sie bräuchte
  dieselbe Datenbank. Die Anmeldung mit Passkey zählt hier nicht mit: Bei ihr
  gibt es nichts zu raten.
- Mails haben Budgets **pro Zieladresse und Art** – Bestätigung der Adresse
  (`verification`), Passwort zurücksetzen (`reset`), Adresswechsel
  (`email-change`, beide Schritte), Einladung zu einer Kita (`invitation`)
  und die Eingangsbestätigung
  einer Meldung an den Betreiber (`report-receipt`) zählen getrennt, damit eine
  Flut der einen Art die andere nicht
  blockiert:

  | Budget                             | Bezug          | Zeitraum   | Grenze |
  | ---------------------------------- | -------------- | ---------- | ------ |
  | `mail:<art>:recipient-hour`        | Adresse        | 1 Stunde   | 5      |
  | `mail:<art>:recipient-day`         | Adresse        | 24 Stunden | 10     |
  | `mail:<art>:recipient-client-hour` | Adresse + Netz | 1 Stunde   | 3      |
  | `mail:<art>:recipient-client-day`  | Adresse + Netz | 24 Stunden | 5      |

  Das Budget pro Adresse verhindert, dass ein Postfach aus vielen Netzen
  zugeschüttet wird. Das Budget pro Adresse _und Netz_ ist ein Anteil davon:
  Ein einzelnes Netz kann einer Adresse nicht das ganze Kontingent wegnehmen.
  Es wird zuerst geprüft, und nur was dort durchkommt, zählt gegen die
  Adresse – abgewiesene Versuche eines Netzes kosten die Adresse nichts.
  Die Werte sind bewusst großzügig: Der Mailer meldet eine vom SMTP-Server
  abgelehnte Zustellung nur ins Log, eine nie angekommene Mail hat ihr Budget
  also trotzdem verbraucht. Fünf pro Stunde müssen deshalb „nochmal senden“
  _und_ gelegentliche Fehlversuche abdecken.

- Wird ein Budget überschritten, unterbleibt der Versand still (außer bei
  Einladungen, die ausdrücklich abgewiesen werden – siehe „Einladungen“).
  Die
  Antwort der API ändert sich nicht – „Passwort vergessen“ antwortet weiterhin
  für bekannte und unbekannte Adressen gleich und verrät nicht, ob ein Konto
  existiert. Im Log steht es trotzdem: eine Zeile
  `[mail] Versand an l***@example.org unterdrückt (reset) …` und der Zähler
  `mail:limited` (bzw. `mail:unavailable`, wenn das Budget nicht prüfbar war).
- Budgetprüfung und Versand werden **nicht abgewartet**. Better Auth ruft den
  Versand nur auf, wenn das Konto existiert; würde die Anfrage darauf warten,
  wäre sie für vorhandene Konten messbar langsamer und die gleiche Antwort
  dennoch verräterisch. Der Node-Adapter läuft nach der Antwort weiter, der
  Versand wird also trotzdem fertig.
- Weil die Fenster weiterwandern, ist eine legitime Wiederherstellung nie
  dauerhaft blockiert: spätestens eine Stunde später geht wieder eine Mail raus.

## Einladungen

Die Inhaberin oder der Inhaber einer Kita lädt weitere Admins per E-Mail ein.
Das ist die einzige Stelle, an der ein angemeldetes Konto Kibo eine Mail an
eine **fremde, frei gewählte Adresse** schicken lässt – bei offener
Registrierung kann sich dieses Konto jede und jeder anlegen. Drei Bezüge werden
deshalb gezählt: die Kita, das einladende Konto und die eingeladene Adresse.

| Budget                                  | Bezug          | Zeitraum   | Grenze |
| --------------------------------------- | -------------- | ---------- | ------ |
| `invite:kita-hour`                      | Kita           | 1 Stunde   | 10     |
| `invite:kita-day`                       | Kita           | 24 Stunden | 30     |
| `invite:account-day`                    | Konto          | 24 Stunden | 50     |
| `mail:invitation:recipient-hour`        | Adresse        | 1 Stunde   | 5      |
| `mail:invitation:recipient-day`         | Adresse        | 24 Stunden | 10     |
| `mail:invitation:recipient-client-hour` | Adresse + Netz | 1 Stunde   | 3      |
| `mail:invitation:recipient-client-day`  | Adresse + Netz | 24 Stunden | 5      |

Dazu kommen feste Obergrenzen: höchstens **10 offene Einladungen** und
**10 Mitglieder** pro Kita (`INVITATION_LIMIT`, `MEMBERSHIP_LIMIT` in
`src/lib/limits.ts`) und höchstens drei eigene Kitas pro Konto.

- **Alle drei Bezüge** prüft ein Hook vor `/organization/invite-member`
  (`checkInvitationRequest` in `src/lib/auth.ts`), bevor Better Auth die
  Einladung anlegt – erst Kita und Konto, dann die eingeladene Adresse. Eine
  Kita nimmt in ihrem Leben eine Handvoll Admins auf; zehn Einladungen in der
  Stunde decken auch den Tag ab, an dem ein ganzes Leitungsteam dazukommt. Das
  Budget pro Konto (über alle Kitas, denen es gehört) liegt unter dem, was
  drei Kitas zusammen dürften: 50 statt 90 am Tag.
- **Die eingeladene Adresse** hat dieselben Budgets wie bei den anderen
  Auth-Mails, als eigene Art `invitation`, und wie dort zählt zuerst der
  Anteil des anfragenden Netzes, dann die Adresse insgesamt. Sie gelten über
  alle Kitas hinweg: Auch viele Konten zusammen schütten ein fremdes Postfach
  nicht zu. Anders als bei den anderen Auth-Mails wird hier aber **vor** dem
  Anlegen gefragt und nicht erst beim Versand – der Versand selbst
  (`sendInvitationEmail`) prüft nichts mehr, das Budget wird pro Aufruf genau
  einmal verbraucht.
- **Die Abweisung ist ausdrücklich**, für alle drei Bezüge gleich: **429** mit
  `code: TOO_MANY_INVITATIONS` und `X-Retry-After`, im Formular „Gerade
  können keine weiteren Einladungen verschickt werden …“. Wer hier
  fragt, ist angemeldet und Inhaberin oder Inhaber der Kita; es gibt nichts zu
  verbergen. Eine Einladung, deren Mail still unterbliebe, gibt es nicht: Wird
  abgewiesen, entsteht auch keine Einladung.
- **Gezählt wird nur, wer einladen darf.** Ohne Sitzung und für alle, denen
  die Kita nicht gehört, tritt der Hook zurück und überlässt die Antwort
  (401, 403) Better Auth. Ein Admin, der die Route hämmert, verbraucht also
  nichts vom Budget der Kita – und erfährt auch nicht, was die Domain-Liste
  sagt.
- **Erneut einladen ersetzt den Link.** Dieselbe Adresse noch einmal
  einzuladen zieht die frühere Einladung zurück und verschickt eine neue
  (`cancelPendingInvitationsOnReInvite`); jede zählt gegen alle Budgets.
  Nie aber zieht eine Einladung den früheren Link zurück, deren Mail am
  Budget scheitert: Ist eines erschöpft, antwortet der Hook, bevor Better Auth
  irgendetwas anfasst, und der zuletzt verschickte Link bleibt gültig.
- **Nur die Rolle Admin.** Der Hook lehnt jede andere Rolle im Aufruf ab
  (`INVALID_INVITATION_ROLE`), was auch immer der Client schickt.
- **Domain-Liste.** `SIGNUP_EMAIL_DOMAINS` gilt schon beim Einladen: Eine
  Adresse außerhalb der Liste bekommt keine Mail, die Inhaberin liest den
  Grund (`EMAIL_DOMAIN_NOT_ALLOWED`).
- **Kein Link im Namen.** Die Mail nennt die Kita und die einladende Person.
  Über einen dieser Namen ließe sich sonst ein beliebiger Link in eine Mail
  von Kibo an Fremde setzen. Namen von Personen dürfen deshalb keine Links
  enthalten (`src/lib/account-rules.ts`), und ein Kita-Name, der sich wie ein
  Link liest (`://`, `www.`, `http:`), wird schon beim Anlegen und Umbenennen
  abgewiesen (`ORGANIZATION_NAME_LOOKS_LIKE_LINK`,
  `src/lib/organization-rules.ts`). Der Hook prüft den gespeicherten Namen
  beim Einladen noch einmal – als Rückfallebene für Kitas, die vor dieser
  Regel benannt wurden: Sie laden erst ein, wenn sie umbenannt sind.
- **Der Link verschenkt nichts.** Er führt auf `/admin/invitation?id=…` und
  gilt sieben Tage. Die Seite zeigt ohne Anmeldung nur den Namen der Kita, nie
  die eingeladene Adresse; annehmen kann nur das angemeldete Konto mit genau
  dieser, bestätigten Adresse – nach Passwort und gegebenenfalls TOTP. Die
  Kennung ist 32 Zeichen lang und zufällig, also so wenig zu erraten wie ein
  Reset-Link.
- **Geschlossene Registrierung.** Mit `SIGNUP_MODE=closed` lässt die
  Registrierung genau die eingeladene Adresse durch, wenn der Aufruf die
  Kennung ihrer offenen Einladung mitbringt. Nachgeschlagen wird nur über
  diese Kennung, nie über die Adresse: keine Kennung, eine unbekannte, eine
  abgelaufene und eine für jemand anderen bekommen dieselbe Antwort
  (`SIGNUP_CLOSED`). Von außen lässt sich so nicht abfragen, welche Adressen
  eingeladen sind.
- **Ist das Budget nicht prüfbar** (Datenbank weg), wird die Einladung
  abgewiesen; sie bräuchte dieselbe Datenbank.

Werte: `src/lib/spam/budgets.ts` (`INVITATION_BUDGETS`, `MAIL_BUDGETS`),
Tests: `tests/note-guard.test.ts`, `tests/invitations.test.ts`.

## Datenexport

Inhaberin, Inhaber und Admins laden die Daten ihrer Kita als JSON-Datei
herunter ([Datenexport einer Kita](./datenexport.md)). Jeder Download liest
alle Bretter und aktuellen Zettel der Kita; gezählt werden erst das Konto,
dann die Kita:

| Budget                | Bezug | Zeitraum   | Grenze |
| --------------------- | ----- | ---------- | ------ |
| `export:account-hour` | Konto | 1 Stunde   | 10     |
| `export:account-day`  | Konto | 24 Stunden | 15     |
| `export:kita-day`     | Kita  | 24 Stunden | 30     |

- Ein paar Downloads hintereinander sind ein zweiter Versuch; mehr als zehn
  in der Stunde schafft nur ein Skript. Das Budget der Kita teilen sich alle ihre
  Mitglieder.
- Das Budget der Kita zählt nur, was durch die Budgets des Kontos gekommen
  ist: Ein Konto, das abgewiesen wird, verbraucht nichts von dem, was die
  anderen Mitglieder teilen, und eines allein kommt nicht an die Grenze der
  Kita heran.
- Gezählt wird erst nach der Prüfung der Mitgliedschaft: Wer nicht zur Kita
  gehört, bekommt 404 und verbraucht nichts.
- Eine Anfrage, deren `Sec-Fetch-Site` sagt, dass sie von einer anderen
  Seite kommt (alles außer `same-origin`), bekommt 403, bevor irgendetwas
  gezählt wird; fehlt der Kopf (ältere Browser), geht sie weiter.
- Die Antwort ist offen: **429** mit `Retry-After` und „Bitte versuchen Sie
  es in … noch einmal.“, als Hinweis auf der Seite.
- Im Log zählen `export:limited` und `export:unavailable`.
- **Ist das Budget nicht prüfbar** (Datenbank weg), gibt es keinen Download
  (503); er bräuchte dieselbe Datenbank.

Werte: `src/lib/spam/budgets.ts` (`KITA_EXPORT_ACCOUNT_BUDGETS`,
`KITA_EXPORT_KITA_BUDGETS`), Tests: `tests/kita-export.test.ts`.

## Datenhaltung

Drei Tabellen, alle kurzlebig (`src/db/schema/spam.ts`):

| Tabelle            | Inhalt                                                    | Aufbewahrung       |
| ------------------ | --------------------------------------------------------- | ------------------ |
| `spam_key`         | Zufallsschlüssel (32 Byte) für HMACs und Formular-Token   | 25 h nach Ablösung |
| `spam_counter`     | HMAC des Budgets + Bezug + Fensterbeginn, Zähler, Ablauf  | Fenster + gut 1 h  |
| `spam_fingerprint` | HMAC aus Brett und normalisiertem Text, Zettel-ID, Ablauf | 24 Stunden         |

Gemeldete Zettel liegen nicht hier, sondern in `report_case`, `note_report`
und `report_notification` (`src/db/schema/report.ts`): der Fall mit einer
Kopie des Zettels, die einzelnen Meldungen mit Grund und Hinweis, die
E-Mail-Aufträge. Wer gemeldet hat, steht in keiner davon. Ein erledigter Fall
wird 30 Tage nach dem Abschluss gelöscht, jeder Fall spätestens 90 Tage nach
der ersten Meldung (`REPORT_*_RETENTION_DAYS` in `src/lib/limits.ts`).

Was in diesen drei Tabellen **nicht** gespeichert wird: rohe IP-Adressen,
Kita-Links, Zetteltexte, E-Mail-Adressen, Bestätigungs- oder Reset-Links.
Alles davon geht nur als Eingabe in einen HMAC ein.

Außerhalb davon hält Better Auth zwei Dinge mit IP-Bezug: die Schlüssel in
`rate_limit` (`IP|Pfad`, bis gut zwei Stunden nach der letzten Anfrage,
siehe oben) und in `session` die IP-Adresse und den User-Agent der Anmeldung,
solange die Sitzung läuft. Der stündliche Lauf in `src/lib/server/runtime.ts`
löscht beides (`src/lib/expired-sessions.ts`), dazu abgelaufene Einträge in
`verification` – Bestätigungs- und Reset-Links, Passkey-Challenges und die
30-Tage-Einträge „Gerät vertrauen“ der Zwei-Faktor-Anmeldung samt Konto-ID.

- **Schlüssel.** Der Schlüssel liegt in der Datenbank, nicht im Prozess und
  nicht abgeleitet aus `BETTER_AUTH_SECRET`. Ein Neustart und auch ein Wechsel
  des Auth-Secrets setzen damit kein laufendes Budget zurück.
- **Rotation.** Eine Rotation fügt eine neue Zeile in `spam_key` ein. Geschrieben
  wird ab dann mit dem neuen Schlüssel; die Zähler der alten Schlüssel werden
  beim Prüfen weiter mitgezählt, solange ihre Fenster laufen. Es entsteht also
  kein zusätzliches Kontingent. Maßgeblich ist, wann ein Schlüssel **abgelöst**
  wurde, nicht wann er entstanden ist: Ein Schlüssel, der monatelang in
  Gebrauch war, hat im Moment der Rotation noch einen vollen Tag lebender
  Zähler und bleibt deshalb bis 25 Stunden nach seiner Ablösung gültig.
  ```sql
  INSERT INTO spam_key (id, secret)
  VALUES (gen_random_uuid()::text, encode(gen_random_bytes(32), 'base64'));
  ```
- **Aufräumen.** Ein stündlicher Timer im Server (`src/lib/server/runtime.ts`,
  derselbe, der abgelaufene Zettel endgültig löscht) räumt abgelaufene
  Fingerabdrücke weg und ausgediente Schlüssel 25 Stunden nach ihrer Ablösung.
  Weil er am Server hängt und nicht an einer Anfrage, räumt auch eine Instanz
  auf, auf der gerade niemand schreibt; `scripts/server.mjs` lädt ihn direkt
  nach dem Start, damit er mit dem Server anläuft und nicht erst mit dem
  ersten Besuch. Zähler bleiben etwas über ihr Fenster
  hinaus liegen (gut eine Stunde), weil die gleitenden Budgets in das
  abgelaufene Fenster zurückschauen. Derselbe Timer löscht Konten, deren
  Adresse nach sieben Tagen noch nicht bestätigt ist und die zu keiner Kita
  gehören (`src/lib/unverified-accounts.ts`), und Einladungen, die abgelaufen
  oder beantwortet sind – angenommen, abgelehnt, zurückgezogen
  (`src/lib/organization-members.ts`). Better Auth ließe sie für immer liegen,
  jede ist die E-Mail-Adresse einer Person.
- **Backups.** Die drei Tabellen laufen in Backups mit. Sie enthalten nur
  HMAC-Werte und Zahlen, sind aber wie alles andere nach spätestens einem Tag
  inhaltlich wertlos.

## Verhalten bei Störungen

- **Datenbank nicht erreichbar:** Ein Zettel wird abgewiesen („Wir können gerade
  nicht prüfen …“). Das kostet nichts, denn der Zettel bräuchte dieselbe
  Datenbank, um gespeichert zu werden.
- **Auth-Mails:** Lässt sich das Budget nicht prüfen, wird keine Mail verschickt.
  Eine Mail, die niemand zuordnen kann, ist schlechter als eine, die ausbleibt;
  der Vorgang ist über einen erneuten Versuch wiederholbar.

## Rückmeldung an Besucher

- Der Text steht auf Deutsch über dem Formular (`role="alert"`) und nennt die
  Wartezeit: „Bitte versuch es in 5 Minuten nochmal — dein Text bleibt so lange
  stehen.“
- Der Formularinhalt bleibt erhalten; das Dialogfeld wird nicht geschlossen und
  nicht geleert.
- Der Absende-Knopf ist während des Absendens deaktiviert, und ein zweites
  Absenden per Enter wird ignoriert. Kommt trotzdem derselbe Zettel zweimal an,
  fängt ihn die Duplikaterkennung.

## Begrenzte Abfragen

Auch das Blättern hat ein Budget (`note:list`, 120 Anfragen je 15 Minuten und
Netz) – das entspricht 4.800 Zetteln und wird beim normalen Lesen nie erreicht.

Bretter werden seitenweise geladen: **40 Zettel pro Anfrage**, neueste zuerst,
sowohl öffentlich als auch im Admin-Bereich. Ältere Zettel sind über „Ältere
Zettel anzeigen“ bzw. „Ältere Zettel laden“ erreichbar. Paginiert wird per
Keyset über `(createdAt, id)`: die Sortierung bleibt über Seitengrenzen hinweg
stabil, auch wenn zwischendurch Zettel ablaufen, und es entstehen weder Lücken
noch Dubletten. Ein Cursor, dessen Zeitstempel sich nicht lesen lässt, wird als
fehlerhafte Eingabe abgewiesen und erreicht die Datenbank gar nicht.

Barrierefreiheit: Die Knöpfe sind normale Schaltflächen im Textfluss, also per
Tastatur erreichbar. Nach dem Laden meldet ein `role="status"` höflich, wie
viele Zettel dazugekommen sind; verschwindet der Knopf mit der letzten Seite,
wandert der Fokus auf diese Meldung statt ins Nichts. Die Kategoriefilter
arbeiten weiterhin auf dem, was geladen ist, und der leere Zustand sagt es
entsprechend.

## Zähler und Logs

`src/lib/spam/metrics.ts` zählt pro Prozess, wie oft etwas erlaubt, begrenzt,
als Duplikat erkannt, im Honeypot hängen geblieben oder nicht prüfbar war. Der
stündliche Timer des Servers schreibt daraus eine Zeile – und noch einmal beim
Herunterfahren, bevor der Datenbank-Pool schließt, damit die letzte Stunde
nicht verloren geht:

```
[spam] {"note:allowed":37,"note:limited":2,"note:duplicate":1}
```

Mehr steht dort nicht: keine IP, kein Token, kein Text, keine Adresse, kein
Push-Endpunkt. `note:token` zählt abgewiesene Formular-Token,
`note:board-limited` ein erschöpftes Brett- oder Kita-Budget. Neben den
`note:*`-Zählern gibt es die für Meldungen
(`report:allowed`, `report:limited`, `report:board-limited`,
`report:duplicate`, `report:honeypot`, `report:unavailable`) und ihre E-Mails
(`report:mail-sent`, `report:mail-failed`, `report:mail-throttled`,
`report:mail-given-up`) und Hinweise an den Betreiber (`report:operator-sent`,
`report:operator-failed`, `report:operator-limited`), `invite:limited`,
`invite:unavailable`, `invoice:limited`, `invoice:unavailable`, `export:limited`,
`export:unavailable`, `mail:allowed`, `mail:limited`, `mail:unavailable`,
`signin:limited`, `signin:unavailable`, `analytics:limited` und
`analytics:unavailable`.
Die Zähler für Benachrichtigungen stehen daneben in einer eigenen
`[push]`-Zeile, damit viele Zustellungen die übrigen Zahlen nicht verdecken:
`push:subscribed`, `push:request-limited`, `push:subscribe-limited`,
`push:board-full`, `push:throttled` und `push:unavailable` sowie die
Zustellungen `push:sent`, `push:gone` und `push:failed`.

Fehler werden überall nur mit ihrer Meldung geloggt, nie als ganzes Objekt:
Ein Datenbankfehler trägt die Parameter der Abfrage (Adressen, Zetteltext),
ein Fehler des Pools dessen Konfiguration samt Passwort. Lehnt der SMTP-Server
eine Zustellung ab, stehen Fehlercode und Antwortcode im Log; Adressen in
seinem Antworttext werden wie die Empfängeradresse gekürzt (`l***@kita.example`).

## Vorgehen bei Spam

1. **Zettel entfernen.** Im Admin-Bereich des Bretts, Zeile für Zeile. Gelöschte
   Zettel sind sofort weg.
2. **Neuen Link erzeugen.** „Neuen Link erzeugen“ in der Karte „Kita-Link“
   macht den alten Link der Kita und alle Links zu ihren Brettern ungültig. Das
   ist das wirksamste Mittel, wenn der Link öffentlich geworden ist – danach
   den neuen Link erneut an die Eltern geben. Ihre Benachrichtigungen schalten
   sie über den neuen Link wieder ein.
3. **Grenzen prüfen.** `[spam]`-Zeilen im Log zeigen, ob die Budgets greifen. Ist
   das Verhältnis von `note:limited` zu `note:allowed` dauerhaft hoch, sind die
   Werte in `src/lib/spam/budgets.ts` anzupassen.
4. **Notfalls Brett löschen und neu anlegen.**

### Bewertet, aber nicht umgesetzt

- **Temporäre Schreibpause pro Brett.** Wäre ein Schalter „Brett vorübergehend
  nur lesen“. Nützlich in einem laufenden Angriff, aber das Brett-Tagesbudget
  wirkt bereits als automatische Bremse, und ein erneuerter Link löst dasselbe
  Problem dauerhaft. Lohnt sich erst, wenn ein Fall auftritt, in dem der Link
  nicht gewechselt werden kann.
- **Einmal-Token.** Ein Formular-Token gilt zwei Stunden für beliebig viele
  Zettel. Es nach dem ersten Zettel zu verbrauchen, bräuchte einen
  Datenbankeintrag pro Zettel und hielte ein Skript doch nur um einen Abruf
  und drei Sekunden pro Zettel auf – die Budgets begrenzen es schon vorher.
- **Gebündeltes Löschen.** Bei einem Schwall wäre „alle Zettel dieses Tages
  entfernen“ oder eine Auswahl über Kästchen praktisch. Sinnvolle Ergänzung,
  aber kein Schutz – erst nötig, wenn die Budgets nennenswert viele Zettel
  durchlassen.
- **Risikobasierte Bot-Challenge.** Erst prüfen, wenn nach alldem noch
  Missbrauch übrig bleibt. Ein externer CAPTCHA-Dienst kommt nicht in Frage:
  Er wäre eine Hürde für genau die Eltern, die Kibo einfach halten soll, ein
  Datenabfluss an Dritte und ein Single Point of Failure. Falls doch nötig,
  dann selbst gehostet, nur bei auffälligem Verhalten, mit einer bedienbaren
  Alternative für Screenreader und mit der Festlegung, dass ein Ausfall der
  Challenge das Anpinnen erlaubt und nicht blockiert.

## Tests

`bun test` (braucht die lokale PostgreSQL aus `bun run db:up` und
`bun run db:migrate`):

- `tests/client-ip.test.ts` – Normalisierung, /64-Zusammenfassung, /56 und
  /48 (keine für IPv4 und den Sammeltopf),
  gleichwertige Schreibweisen, Ports, gefälschte Header (auch mit einer
  `clientAddress`, wie Astro sie daraus bildet), `TRUSTED_PROXIES`
- `tests/spam-store.test.ts` – Grenzen, Ablauf, gleitende Fenster an der
  Fenstergrenze, parallele Anfragen, zweiter Prozess, Neustart,
  Schlüsselrotation (auch eines lange zuvor erzeugten Schlüssels), Signaturen
  über eine Rotation hinweg (nachgelesen nur für eine unbekannte
  Schlüssel-ID), Duplikate, Aufräumen
- `tests/note-guard.test.ts` – die echten Budgets, deutsche Texte, dass ein
  abgewiesener Client kein Brett-Kontingent verbraucht, /56 und /48 über
  viele /64-Netze (und dass abgewiesene /64- und /56-Netze nichts vom
  Kontingent des jeweils weiteren Netzes verbrauchen),
  das Kita-Budget über mehrere Bretter, frisches Budget nach einem neuen
  Kita-Link, Freigabe eines Anspruchs, Anmeldebudget pro Konto,
  Einladungsbudgets pro Kita und Konto, Mailbudgets pro Adresse, Art und Netz
- `tests/form-token.test.ts` – Formular-Token: fehlend, zu früh, zu alt,
  fremdes Brett, verändert, unbekannter Schlüssel, nach einer
  Schlüsselrotation; das Formular wartet
  die drei Sekunden ab und ersetzt alte Token
- `tests/text-rules.test.ts` – Steuer- und unsichtbare Zeichen in Eingaben,
  Kita-Name und -Slug, Kontoname, Normalisierung für die Duplikaterkennung
- `tests/auth-rules.test.ts` – jede Better-Auth-Regel zeigt auf eine Route, die
  es tatsächlich gibt; jede Route, die ein Passwort prüft, ist begrenzt; jede
  Organisations-Route ist bewusst freigegeben oder abgeschaltet
- `tests/accounts.test.ts` – Löschen unbestätigter Konten, Kitas der
  Inhaberin beim Löschen eines Kontos, Aufräumen erledigter Einladungen,
  Text-Version der Mails
- `tests/invitations.test.ts` – Rollen (Inhaberin und Admin) über die echten
  Routen, Einladen samt Rolle, Domain-Liste, Budget und Obergrenze, Annehmen
  und Ablehnen, geschlossene Registrierung mit Einladung, Konto löschen
- `tests/organization-roles.test.ts` – was Inhaberin und Admin dürfen
- `tests/note-page.test.ts` – Paginierung, Sortierung, Ablauf
- `tests/note-reports.test.ts` – Melden: Zettel und Brett gehören zusammen,
  abgelaufene Zettel, erneuerte Kita-Links, Bretter anderer Kitas, pausierte
  Kitas, parallele Meldungen,
  gleiche Hinweise, die Budgets je Netz und Zettel; Abschließen nur für das
  Team der Kita, Aufbewahrung
- `tests/report-outbox.test.ts` – E-Mails an das Team: Empfänger zum
  Versandzeitpunkt, kein Inhalt in der Mail, eine pro Stunde mit gesammelten
  Fällen, Wiederholung nach Fehlern, parallele Läufe, verwaiste Aufträge
- `tests/push-crypto.test.ts` – Allow-List der Push-Dienste samt
  Doppelgängern, Schlüsselprüfung, Verschlüsselung nach dem Beispiel aus
  RFC 8291, VAPID-Signatur
- `tests/push-subscriptions.test.ts` – Anmelden als Upsert, Abgleich ohne
  neues Abo (`push.sync`), Netz-Budget nur für neue Abos, Obergrenze pro
  Brett, Anmelden im Wettlauf mit neuem Kita-Link oder Abschalten, Löschen
  bei neuem Kita-Link, Abschalten und Brett-Löschung, Aufräumen scheiternder
  und seit 180 Tagen ungenutzter Abos, Besuchsvermerk höchstens einmal am Tag
  und nur auf den Brettern der Kita mit Glocke, erneutes Antippen als Besuch,
  Antwort auf die letzte Glocke und beim Abgleich (`remaining`)
- `tests/push-dispatcher.test.ts` – Bündeln, Drossel, abgenommene und eigene
  Zettel, Zahl fürs App-Symbol pro Empfänger, Antworten der Push-Dienste,
  Allow-List vor dem Versand, Abbruch bei neuem Kita-Link, `Topic` als HMAC
  pro Brett und Abo
- `tests/push-unseen.test.ts` – Zahl auf dem App-Symbol: was zählt (nur
  Bretter mit Glocke, nur nach `seen_at`, nichts Abgelaufenes, keine andere
  Kita, höchstens 99), `push.sync` mit Zahl und mit dem Brett einer
  Brettseite (nur über den Kita-Link, ohne Neues kein Schreiben),
  `push.unsubscribe` mit Zahl, der eigene Zettel
