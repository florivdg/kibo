# Benachrichtigungen

Eltern können sich vom Handy benachrichtigen lassen, sobald auf einem Brett ein
neuer Zettel hängt – ohne App aus dem Store und ohne Konto. Welche Bretter das
sind, wählen sie selbst.

![Die Fundkiste auf dem Handy](../screenshots/board-mobile.webp)

## Die Glocke

Jedes Brett hat eine Glocke: auf der Seite der Kita neben dem Brett und oben
auf dem Brett selbst. Ein Antippen schaltet die Benachrichtigungen für dieses
Brett ein. Beim ersten Mal fragt das Handy, ob Kibo Benachrichtigungen schicken
darf; danach lassen sich weitere Glocken ohne erneute Nachfrage ein- und
ausschalten.

Die Einstellung gilt für dieses eine Brett auf diesem einen Gerät. Noch einmal
antippen schaltet sie wieder ab. Ist die letzte Glocke des Geräts aus, meldet
sich der Browser auch beim Push-Dienst ab: Danach erfährt der Server nichts
mehr von diesem Gerät, bis wieder eine Glocke eingeschaltet wird.

Wird die Kita auf einem Gerät ein halbes Jahr lang nicht geöffnet und kommt in
der Zeit auch keine Benachrichtigung an, schaltet Kibo dessen Glocken von
selbst ab; wer sie wieder möchte, tippt sie erneut an.

## iPhone und iPad

Auf dem iPhone funktionieren Benachrichtigungen ab iOS 18.4, und nur, wenn die
Kita auf dem Home-Bildschirm liegt. Das ist einmal nötig, für alle Bretter:

1. Den Kita-Link in Safari öffnen.
2. „Teilen“ antippen und „Zum Home-Bildschirm“ wählen.
3. Kibo über das neue Symbol auf dem Home-Bildschirm öffnen.
4. Dort die Glocken der gewünschten Bretter antippen und die Benachrichtigungen
   erlauben.

Auch wenn es von einem einzelnen Brett aus angelegt wurde, öffnet das Symbol
die Seite der Kita mit allen Brettern. In Safari selbst zeigt die Seite der
Kita statt der Glocken einen Hinweis auf diese Schritte; auf einem Brett öffnet
ihn der gestrichelte Knopf an der Stelle der Glocke. Auf Android genügt jeder
gängige Browser.

Safari und das Symbol auf dem Home-Bildschirm speichern getrennt voneinander.
Ein Zettel, der in Safari angepinnt wurde, lässt sich nur dort wieder abnehmen,
nicht über das Symbol – und umgekehrt. Auch die Markierung „Neu“ führen beide
für sich.

## Was in der Benachrichtigung steht

Der Name des Bretts und die Überschrift des neuen Zettels – bei mehreren die
Anzahl („3 neue Zettel“). Der Text, der Name und der Kontakt stehen nie darin.
Ein Antippen öffnet das Brett, auf dem iPhone in der App auf dem
Home-Bildschirm.

- Neue Zettel werden zwei Minuten gesammelt und kommen als eine
  Benachrichtigung an.
- Pro Brett gibt es höchstens sechs Benachrichtigungen in der Stunde. Was
  darüber hinausgeht, kommt mit der nächsten Stunde.
- Für den eigenen Zettel gibt es keine Benachrichtigung.

## Die Zahl auf dem Symbol

Liegt die Kita als App auf dem Home-Bildschirm, zeigt ihr Symbol eine Zahl wie
bei einer App aus dem Store: So viele neue Zettel hängen auf den Brettern,
deren Glocke auf diesem Gerät an ist, und wurden dort noch nicht gesehen.

- Wer ein Brett öffnet, nimmt dessen Zettel aus der Zahl. Der eigene Zettel
  zählt nie mit.
- Bretter ohne Glocke zählen nicht; für sie gibt es die Markierung „Neu“ auf
  der Seite der Kita.
- Abgelaufene Zettel fallen heraus. Mehr als 99 zeigt das Symbol nicht.
- Die Zahl kommt mit jeder Benachrichtigung und wird beim Laden einer Seite
  der App aktualisiert. Holt man die App nur aus dem Hintergrund zurück,
  behält sie ihre Zahl, bis eine Seite lädt oder eine Benachrichtigung kommt.

Auf dem iPhone und iPad erscheint sie ab iOS 26 auch, während die App
geschlossen ist; von iOS 18.4 bis vor iOS 26 ändert sie sich nur beim Laden
einer Seite der App. Auf Android zeigen viele Startbildschirme eine Zahl oder
einen Punkt am Symbol der installierten App, je nach Hersteller. Im normalen
Browser-Tab gibt es keine Zahl.

## Benachrichtigungen für ein Brett abschalten

Die Kita entscheidet pro Brett: Auf der Seite des Bretts im Admin-Bereich
steht unter „Benachrichtigungen“ der Schalter „Benachrichtigungen erlauben“.
Dort sehen Sie auch, auf wie vielen Geräten sie gerade aktiviert sind.

- Ausgeschaltet verschwindet die Glocke dieses Bretts, und die bisherigen
  Aktivierungen werden gelöscht. Wer sie später wieder möchte, aktiviert sie
  neu.
- Ein [neuer Kita-Link](./bretter.md#einen-neuen-link-erzeugen) beendet die
  Benachrichtigungen aller Bretter der Kita.

## Nach einem neuen Kita-Link

Hat die Kita einen neuen Link erzeugt, zeigt das alte Symbol auf dem
Home-Bildschirm nur noch den Hinweis „Diesen Link gibt es nicht (mehr).“ Eltern
entfernen das Symbol, legen den neuen Link auf den Home-Bildschirm und schalten
dort die Glocken wieder ein. Auf dem iPhone fragt das Handy dabei noch einmal
nach der Erlaubnis, weil das neue Symbol dort als neue App gilt.

## Wenn die Glocke fehlt

- Die Benachrichtigungen sind für dieses Brett abgeschaltet.
- Auf dem iPhone liegt die Kita noch nicht auf dem Home-Bildschirm.
- Die Benachrichtigungen sind blockiert: In den Einstellungen des Browsers
  oder des Handys wurden sie für Kibo verboten und müssen dort wieder erlaubt
  werden. Die Seite weist dann darauf hin, auf einem Brett hinter dem
  gestrichelten Knopf an der Stelle der Glocke.
- Die Instanz hat die Funktion nicht eingerichtet. Das ist Sache des Betriebs;
  wer Kibo selbst betreibt, findet die Schritte unter
  [Benachrichtigungen (Web-Push)](../selbst-hosten/benachrichtigungen.md).
