# Konto und Sicherheit

Alles rund um Ihr eigenes Konto steht im Admin-Bereich unter „Konto“ – zu
erreichen über Ihren Namen unten in der Seitenleiste.

## Passwort ändern

Unter „Passwort ändern“ geben Sie das aktuelle und das neue Passwort ein. Ein
Passwort hat mindestens 12 Zeichen. Nach der Änderung sind Sie auf allen
anderen Geräten abgemeldet.

## Passwort vergessen

Auf der Anmeldeseite „Passwort vergessen“ wählen und die E-Mail-Adresse
eingeben. Kibo schickt einen Link, über den Sie ein neues Passwort vergeben.
Die Antwort ist immer dieselbe, ob es zu der Adresse ein Konto gibt oder
nicht – kommt keine E-Mail an, prüfen Sie die Schreibweise und den
Spam-Ordner.

Mit dem neuen Passwort werden alle [Passkeys](#passkeys) des Kontos entfernt.
Richten Sie sie danach neu ein.

## E-Mail-Adresse ändern

Die Änderung bestätigen Sie in zwei Schritten, damit niemand Ihr Konto auf
eine fremde Adresse umziehen kann:

1. Unter „E-Mail-Adresse ändern“ die neue Adresse eintragen und
   „Bestätigungslink senden“ wählen.
2. Kibo schickt eine E-Mail an Ihre **bisherige** Adresse. Stimmen Sie der
   Änderung dort zu.
3. Danach geht ein zweiter Link an die **neue** Adresse. Öffnen Sie ihn in dem
   Browser, in dem Sie angemeldet sind. Erst dann gilt die neue Adresse.

Lässt die Instanz nur E-Mail-Adressen bestimmter Domains zu, gilt das auch für
die neue Adresse.

## Bestätigung in zwei Schritten

Mit der Bestätigung in zwei Schritten (Zwei-Faktor-Anmeldung) fragt Kibo bei
jeder Anmeldung mit Passwort zusätzlich einen Code aus einer Authenticator-App
ab. Ein gestohlenes Passwort allein reicht dann nicht mehr.

Einrichten:

1. Unter „Bestätigung in zwei Schritten“ das Passwort bestätigen und
   „Einrichten“ wählen.
2. Den QR-Code mit der Authenticator-App scannen.
3. Die Backup-Codes kopieren oder herunterladen und sicher aufbewahren.
4. Den Code aus der App eingeben.

**Backup-Codes** sind der Ersatz, wenn das Handy mit der App nicht zur Hand
ist: Jeder Code ersetzt einmal den Code aus der App. Bewahren Sie sie getrennt
vom Handy auf.

Sind App und Backup-Codes verloren, kann nur der Betrieb der Instanz die
Bestätigung zurücksetzen – und wird sich vorher vergewissern, dass die Anfrage
wirklich von Ihnen kommt. Wer Kibo selbst betreibt, findet den Weg unter
[Zwei-Faktor-Anmeldung verloren](../selbst-hosten/sicherheit.md#zwei-faktor-anmeldung-verloren).

Deaktivieren lässt sich die Bestätigung an derselben Stelle, wieder mit dem
Passwort. Die bisherigen Backup-Codes werden damit ungültig.

## Passkeys

Ein Passkey ist ein Schlüssel, den Ihr Gerät oder Ihr Passwort-Manager für
Kibo speichert. Sie melden sich damit ohne Passwort und ohne Code aus der
Authenticator-App an und bestätigen nur mit Fingerabdruck, Gesicht oder der
PIN des Geräts. Ein Passkey gilt nur für diese Kibo-Adresse; auf einer
nachgemachten Seite lässt er sich nicht verwenden.

Hinzufügen:

1. Unter „Passkeys“ auf Wunsch eine Bezeichnung eintragen, etwa „Laptop im
   Büro“ (höchstens 60 Zeichen).
2. Das aktuelle Passwort eingeben und „Passkey hinzufügen“ wählen.
3. Die Abfrage des Geräts mit Fingerabdruck, Gesicht oder PIN bestätigen.

Ein Konto kann höchstens 10 Passkeys haben. Die Liste zeigt jeden mit
Bezeichnung und dem Tag, an dem er hinzugefügt wurde.

Anmelden: Auf der Anmeldeseite schlägt der Browser den Passkey im Feld
„E-Mail-Adresse“ vor, sobald Sie hineinklicken. Oder Sie wählen „Mit Passkey
anmelden“. Der Passkey ersetzt Passwort **und** Code; deshalb verlangt Kibo
dabei immer die Bestätigung mit Fingerabdruck, Gesicht oder PIN – ein Passkey,
der nur angetippt wird, reicht nicht. Solange Ihre E-Mail-Adresse nicht bestätigt ist,
ist keine Anmeldung mit Passkey möglich.

Entfernen: In der Liste „Entfernen“ wählen und bestätigen. Der Passkey ist
damit in Kibo ungültig; aus dem Gerät oder Passwort-Manager löschen Sie ihn
dort selbst.

Ändern Sie das Passwort, bleiben Ihre Passkeys erhalten. Setzen Sie es über
[Passwort vergessen](#passwort-vergessen) zurück, werden alle entfernt – damit
niemand, der Ihr Passwort kannte, über einen Passkey im Konto bleibt.

## Konto löschen

Unter „Gefahrenzone“ löschen Sie Ihr Konto. Kibo fragt dazu immer nach dem
Passwort; die Löschung gilt sofort und lässt sich nicht rückgängig machen.

- **Kitas, die Ihnen gehören, werden mitgelöscht** – mit allen Brettern und
  Zetteln und auch dann, wenn dort noch andere Personen mitverwalten. Die
  Kontoseite nennt diese Kitas vorher.
- **Kitas, in denen Sie Admin sind,** bleiben bestehen. Nur Ihre
  Mitgliedschaft endet.

## Abmelden

„Abmelden“ steht im Menü hinter Ihrem Namen unten in der Seitenleiste. Auf
einem Gerät, das Sie mit anderen teilen, melden Sie sich nach der Arbeit ab.
