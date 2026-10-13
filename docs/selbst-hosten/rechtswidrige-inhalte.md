# Hinweise auf rechtswidrige Inhalte

Wer eine Kibo-Instanz betreibt, speichert Zettel im Auftrag der Eltern, die sie
anpinnen, und ist damit Anbieter eines Hostingdienstes im Sinne des Digital
Services Act (DSA, Verordnung (EU) 2022/2065, Art. 3 Buchst. g). Unabhängig
von der Größe gelten dann unter anderem Art. 16 (Melde- und Abhilfeverfahren),
Art. 17 (Begründung) und Art. 18 (Meldung von Straftaten). Kibo bringt den
Meldeweg mit; prüfen, entscheiden und antworten müssen Sie selbst. Diese Seite
beschreibt, was Kibo dafür tut – eine Rechtsberatung ist sie nicht.

Die Kita ist dabei nicht der Anbieter: Ihre normalen Meldungen
([Meldungen](../fuer-kitas/meldungen.md)) erreichen nur ihr Team. Deshalb hat
das Melden-Formular die Option „Rechtswidriger Inhalt – auch an den Betreiber
melden“.

## Voraussetzung

Die Option erscheint nur, wenn `OPERATOR_EMAIL` gesetzt ist
([Betreiberangaben in E-Mails](./impressum-und-datenschutz.md#betreiberangaben-in-e-mails));
auf der gehosteten Instanz ist das Pflicht. Ohne die Adresse fehlt die Option,
und die Aktion weist sie ab. Wer `OPERATOR_EMAIL` nicht setzt, braucht einen
anderen elektronischen Meldeweg, etwa eine Adresse im Impressum.

## Was ankommt

Wählt jemand die Option, geht die Meldung wie jede andere als Fall an die Kita.
Nach dem Speichern verschickt die App zusätzlich:

- **an `OPERATOR_EMAIL`** die E-Mail „Kibo: Hinweis auf rechtswidrigen Inhalt“
  mit Kita, Brett, der Adresse des Bretts, der Zettel-ID, dem Grund und dem
  Hinweis, dem Zettel so, wie der Server ihn gelesen hat (Titel, Text, Name,
  Kontakt, angepinnt am, läuft ab am), dem Zeitpunkt der Meldung, Name und
  E-Mail-Adresse der meldenden Person (beides freiwillig), ihrer Erklärung,
  dass ihre Angaben richtig und vollständig sind, und dem Befehl, der den
  Zettel abnimmt;
- **an die meldende Person**, falls sie eine Adresse angegeben hat, eine
  Eingangsbestätigung (Art. 16 Abs. 4). Sie hat einen festen Text und
  wiederholt nichts, was jemand eingegeben hat – keinen Namen, keinen Hinweis,
  keinen Zettel, keinen Link –, damit sich das Formular nicht nutzen lässt, um
  Fremden etwas zu schicken. Sie geht nur hinaus, wenn die E-Mail an Sie
  hinausging, und zählt gegen die Budgets pro Adresse
  ([Spam-Schutz](./spam-schutz.md#meldungen)).

Name und E-Mail-Adresse der meldenden Person stehen **nur in dieser E-Mail**;
in der Datenbank speichert Kibo sie nicht – die E-Mail-Adresse geht nur als
Bezug in die HMAC-Zähler der Eingangsbestätigung ein (wie das Netz), nie im
Klartext –, und die Kita sieht sie nicht. Die
E-Mail ist damit Ihr einziger Beleg der Meldung – bewahren Sie sie auf, solange
Sie sie für die Bearbeitung und Nachweise brauchen, und nennen Sie das in der
Datenschutzerklärung.

Nimmt der Mailserver die E-Mail an Sie nicht an, sagt das Formular der
meldenden Person, dass die Nachricht nicht angekommen ist, und nennt
`OPERATOR_EMAIL` zum direkten Schreiben; ein zweiter Versuch ist nicht
möglich, weil nichts davon gespeichert ist. Im Log steht dann
`[mail] Versand an … fehlgeschlagen (Kibo: Hinweis auf rechtswidrigen Inhalt)`,
im Zählerprotokoll `report:operator-failed` (`report:operator-sent` für die
zugestellten).

## Prüfen und entscheiden

Art. 16 Abs. 6 verlangt, Meldungen zeitnah, sorgfältig, frei von Willkür und
objektiv zu bearbeiten. Kibo trifft keine Entscheidung automatisch: Der
Zettel bleibt hängen, bis Sie oder die Kita ihn abnehmen oder er abläuft.
Die Kita hat denselben Fall und kann den Zettel unabhängig von Ihnen abnehmen.

## Zettel abnehmen

Sie haben kein Konto in der Kita. Abgenommen wird über das
Verwaltungsskript im App-Container, mit der Zettel-ID aus der E-Mail:

```sh
docker compose exec app node dist/admin.mjs remove-note --id <zettel-id>
```

- Der Zettel wird sofort gelöscht, egal auf welchem Brett er hängt.
- Ist zu ihm ein Fall der Kita offen, wird er im selben Schritt als „vom
  Betreiber – der Zettel wurde entfernt“ abgeschlossen (`closed_by_operator`,
  ohne Konto in `closed_by`). Hat die Kita ihren Fall schon abgeschlossen und
  den Zettel hängen lassen, wird ihr zuletzt abgeschlossener Fall ebenso als
  vom Betreiber entfernt vermerkt. Die Kita sieht das unter „Meldungen“; die
  Kopie des Zettels im Fall bleibt bis zum Ende der üblichen Aufbewahrung.
- Die Ausgabe nennt Titel, Brett und Kita. Ist der Zettel schon weg –
  abgenommen oder abgelaufen und gelöscht –, endet der Befehl mit 1 und
  „Kein Zettel mit der Kennung … – schon abgenommen oder abgelaufen“.

Entscheiden Sie, dass der Zettel bleiben darf, ist in Kibo nichts zu tun.

## Die Entscheidung mitteilen

- **An die meldende Person** (Art. 16 Abs. 5): Hat sie eine Adresse
  angegeben, schreiben Sie ihr Ihre Entscheidung selbst aus Ihrem Postfach,
  mit dem Hinweis, dass keine automatisierte Entscheidung beteiligt war, und
  den Rechtsbehelfen, die ihr offenstehen.
- **An die Person, die den Zettel angepinnt hat** (Art. 17): Eine Begründung
  ist nur geschuldet, soweit ihre elektronischen Kontaktdaten bekannt sind
  (Art. 17 Abs. 2). Kibo kennt von Eltern, die anpinnen, keine Adresse; steht
  im Kontaktfeld des Zettels eine E-Mail-Adresse, prüfen Sie, ob Sie die
  Begründung dorthin schicken.

## Straftaten gegen Leib und Leben

Begründet ein Zettel den Verdacht einer Straftat, die eine Gefahr für das
Leben oder die Sicherheit von Personen darstellt, verlangt Art. 18, die
Strafverfolgungsbehörden unverzüglich zu informieren – in Deutschland das
[Bundeskriminalamt](https://www.bka.de/DE/DasBKA/OrganisationAufbau/Fachabteilungen/ZentralerInformationsUndFahndungsdienst/Digitale_Eingangsstelle/Guidelines/Verdachtsmeldungen_node.html).
Halten Sie dafür die E-Mail mit der Kopie des Zettels bereit, bevor Sie ihn
abnehmen.

## Missbrauch begrenzen

Für die Option gelten alle Budgets einer Meldung und zusätzlich zwei eigene:
höchstens 5 E-Mails an Sie pro Zettel und 20 pro Brett am Tag. Darüber hinaus
wird die Meldung mit der Option abgewiesen und kann ohne sie an die Kita gehen;
die Absage nennt dann Ihre Adresse, damit ein Hinweis Sie trotzdem erreicht.
Die Eingangsbestätigung zählt gegen die Budgets pro Adresse (`report-receipt`).
Einzelheiten: [Spam-Schutz](./spam-schutz.md#meldungen).
