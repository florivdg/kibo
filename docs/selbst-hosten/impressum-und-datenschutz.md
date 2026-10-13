# Impressum und Datenschutz hinterlegen

Beide Seiten sind Pflicht und pro Instanz konfigurierbar. Zwei Wege:

1. **Eigene Website:** `IMPRESSUM_URL` und `DATENSCHUTZ_URL` in der `.env` auf
   die bestehenden Seiten zeigen lassen. Die Fußzeile verlinkt dann direkt
   dorthin.
2. **Markdown im Container:** `deploy/legal/impressum.md` und
   `deploy/legal/datenschutz.md` ausfüllen. Das Verzeichnis `./legal` wird
   schreibgeschützt eingebunden und unter `/impressum` und `/datenschutz`
   ausgeliefert.

Die Impressums-Vorlage folgt § 5 DDG: Name, Rechtsform (bei juristischen
Personen), Anschrift und Vertretung; E-Mail und ein zweiter schneller
Kontaktweg, der kein Telefon sein muss; die **Kontaktstelle nach Art. 11 und
12 DSA** mit E-Mail-Adresse, den Sprachen Deutsch und Englisch und dem
Verweis auf die übrigen Kontaktwege, die jeder
Betrieb braucht – die Meldefunktion auf den Brettern ersetzt sie nicht;
Registereintrag und USt-IdNr. oder Wirtschafts-Identifikationsnummer, falls
vorhanden. Einen Link auf die abgeschaltete OS-Plattform enthält die
Vorlage nicht. Einen Abschnitt „Verantwortlich für den Inhalt“ hat sie bewusst
nicht: Den braucht nur ein journalistisch-redaktionelles Angebot (§ 18 Abs. 2
MStV), und die Zettel schreiben Eltern und andere Besucher. Die Kommentare in
der Datei erklären die Angaben und erscheinen nicht auf der Seite.

Die mitgelieferte Datenschutz-Vorlage ist ein **rechtlich ungeprüfter
Entwurf** und trägt das sichtbar am Anfang. Sie beschreibt, was Kibo
tatsächlich verarbeitet, und ist so aufgebaut, wie die DSGVO es verlangt:

- **Verantwortlich** zuerst: der Betreiber, für alles, was die Erklärung
  beschreibt.
- **Je Verarbeitung** was gespeichert wird, wer es sieht, wie lange und
  genau eine Rechtsgrundlage: Zettel (mit den Hinweisen für Personen, die auf
  einem Zettel genannt werden, Art. 14 DSGVO), was auf dem Gerät liegt
  (`kibo:own-notes`, `kibo:seen`, die Cookies des Admin-Bereichs mit ihren
  Laufzeiten, `kibo:flash`; § 25 TDDDG), Meldungen, Hinweise an den Betrieb
  ([Rechtswidrige Inhalte](./rechtswidrige-inhalte.md), Art. 6 Abs. 1 lit. c
  DSGVO mit Art. 16–18 DSA), Benachrichtigungen samt dem, was die Push-Dienste
  sehen, und der Grundlage der Übermittlung je Anbieter, Spam-Schutz (Netze
  /64, /56 und /48, Formular-Token, HMAC-Prüfwerte als pseudonymisierte
  Daten), Konten mit Passkeys und Sitzungen, Datenexport, Mails, Protokolle
  und Sicherungen (Vorgabe von `backup.sh`: 14 Tage).
- Eine **Übersicht der Speicherdauern**, ob Angaben **Pflicht** sind und
  dass es **keine automatisierten Entscheidungen** gibt (Art. 13 Abs. 2
  lit. e und f DSGVO), die Rechte und – abgesetzt als eigener Kasten – das
  **Widerspruchsrecht nach Art. 21 DSGVO** mit jeder Verarbeitung, die auf
  berechtigten Interessen oder – bei öffentlichen Trägern – einer Aufgabe im
  öffentlichen Interesse beruht.

Teile, die nur für einen Betrieb gelten, stehen in eckigen Klammern mit „Nur
mit …“ oder „Nur wenn …“; der Kommentar am Anfang der Datei sagt, was zu
behalten und was zu streichen ist: „Benachrichtigungen“ und die Stellen, die Benachrichtigungen erwähnen, nur
mit `VAPID_*`-Schlüsseln ([Benachrichtigungen](./benachrichtigungen.md)),
„Hinweis an den Betreiber“ und die Stellen zu Eingangsbestätigungen nur mit
`OPERATOR_EMAIL`.

Derselbe Kommentar warnt: Eine Behörde – etwa eine Gemeinde als Träger –
kann sich für ihre Aufgaben nicht auf berechtigte Interessen stützen
(Art. 6 Abs. 1 Unterabs. 2 DSGVO) und braucht dort eine andere
Rechtsgrundlage; kirchliche Träger wenden KDG oder DSG-EKD an. Platzhalter
in eckigen Klammern ersetzen – Hosting, Mailversand, Sicherungen, die
Zertifizierungen der Push-Dienste, die Aufsichtsbehörde – und den Text
rechtlich prüfen lassen; die Vorlage ist keine Rechtsberatung.

Bilder in den Markdown-Dateien müssen von Kibo selbst kommen: Die
Content-Security-Policy erlaubt nur `img-src 'self' data:`. Ein Logo von der
Website des Trägers wird deshalb nicht angezeigt – als `data:`-URL einbetten
oder weglassen.

Geänderte Dateien werden beim nächsten Start gelesen:

```sh
docker compose restart app
```

## Betreiberangaben in E-Mails

Jede E-Mail, die Kibo verschickt – Bestätigung der Adresse, Passwort-Reset,
beide Schritte einer Adressänderung, Einladungen –, endet unter dem Gruß mit demselben Fuß, in der
HTML- wie in der Textfassung:

```
--
Kita-Verbund Musterstadt gGmbH
Musterstraße 1
12345 Musterstadt
E-Mail: kontakt@kita-verbund.de

Amtsgericht Musterstadt, HRB 12345
Geschäftsführung: Anna Beispiel

Impressum: https://kibo.kita-verbund.de/impressum
Datenschutz: https://kibo.kita-verbund.de/datenschutz
```

| Variable              | Bedeutung                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPERATOR_NAME`       | Name der Betreiberin oder des Betreibers, eine Zeile, höchstens 120 Zeichen, kein Link                                                                       |
| `OPERATOR_ADDRESS`    | Postanschrift, höchstens 5 Zeilen mit je höchstens 100 Zeichen, kein Link                                                                                    |
| `OPERATOR_EMAIL`      | Kontaktadresse; die Einladungsmail nennt sie für unerwünschte Einladungen, und an sie gehen [Hinweise auf rechtswidrige Inhalte](./rechtswidrige-inhalte.md) |
| `OPERATOR_LEGAL_INFO` | Was die Rechtsform in Geschäftsbriefen verlangt – Rechtsform, Sitz, Registergericht und -nummer, Vertretung, USt-IdNr. –; höchstens 8 Zeilen                 |

Eine Umgebungsvariable ist auf den meisten Wegen eine Zeile, deshalb trennt
ein `|` die Zeilen von Anschrift und Pflichtangaben:

```sh
OPERATOR_NAME="Kita-Verbund Musterstadt gGmbH"
OPERATOR_ADDRESS="Musterstraße 1 | 12345 Musterstadt"
OPERATOR_EMAIL=kontakt@kita-verbund.de
OPERATOR_LEGAL_INFO="Amtsgericht Musterstadt, HRB 12345 | Geschäftsführung: Anna Beispiel"
```

Leerzeichen um das `|` und leere Zeilen fallen weg; ein echter Zeilenumbruch,
der doch ankommt, zählt ebenfalls als Trenner. Für alle Zeilen gelten die
Regeln für Text in Kibo: keine Steuer- oder Bidi-Zeichen, in jeder Zeile etwas
Sichtbares. `OPERATOR_NAME` darf deshalb auch kein `|` enthalten. Ein
ungültiger Wert lässt die App nicht starten
([Startprüfung](./einrichtung.md#startprüfung)).

**Fehlende Angaben.** Ohne `OPERATOR_NAME`, `OPERATOR_ADDRESS` und
`OPERATOR_EMAIL` startet die App, schreibt beim Start aber eine Warnung ins
Log:

```
[mail] Betreiberangaben unvollständig, es fehlt: OPERATOR_NAME, OPERATOR_ADDRESS, OPERATOR_EMAIL. Der Fuß der E-Mails nennt nur, was gesetzt ist, und verlinkt Impressum und Datenschutz.
```

Der Fuß zeigt dann nur, was gesetzt ist, und immer die beiden Links. Sind alle
drei gesetzt, steht stattdessen `[mail] Betreiber im Fuß der E-Mails: …` im
Log.

**Die Links** sind immer vollständige Adressen, denn eine E-Mail hat keine
Seite, auf die sich ein relativer Link beziehen könnte: `IMPRESSUM_URL`
beziehungsweise `DATENSCHUTZ_URL`, wenn gesetzt – dann mit `https://`, sonst
startet die App nicht, und so normalisiert, wie die Startprüfung sie liest
(Leerzeichen etwa als `%20`) –, andernfalls die eigenen Seiten der Instanz unter
`BETTER_AUTH_URL` (`…/impressum`, `…/datenschutz`). Diese Seiten sind ohne
Anmeldung erreichbar, sobald für sie eine Adresse oder eine Datei hinterlegt
ist – sonst führt der Link auf eine Seite, die nur sagt, dass sie noch nicht
ausgefüllt ist. Die App warnt deshalb beim Start:

```
[legal] Für /impressum ist weder IMPRESSUM_URL gesetzt noch impressum.md in LEGAL_DIR (./legal) hinterlegt. Die Seite und der Link im Fuß jeder E-Mail zeigen nur einen Hinweis.
```

### Datenschutzhinweis in Einladungen

Eine Einladung geht an eine Adresse, die die Inhaberin oder der Inhaber einer
Kita eingetippt hat – oft an jemanden ohne Konto. Über dem Gruß steht deshalb
ein kurzer Hinweis. Er sagt immer, dass die Inhaberin oder der Inhaber der
genannten Kita die Adresse eingegeben hat, um zur Verwaltung der Kita
einzuladen; dass die Einladung gespeichert bleibt, bis sie angenommen,
abgelehnt oder zurückgezogen wird oder nach sieben Tagen abläuft, und danach
beim nächsten stündlichen Aufräumen gelöscht wird; an wen man sich mit einer
unerwünschten Einladung wendet (`OPERATOR_EMAIL`, fehlt sie, verweist er auf
das Impressum); und er verlinkt für die ausführlichen Informationen nach
Art. 14 DSGVO die Datenschutzerklärung.

Der Link in der Einladung zeigt sie, ohne jemanden anzumelden. Annehmen oder
ablehnen kann nur, wer sich mit der eingeladenen Adresse anmeldet; wer kein
Konto hat, muss nichts tun – die Einladung läuft nach sieben Tagen ab – oder
schreibt an den Betrieb.

**Wenn sich jemand über eine Einladung beschwert**, gibt es dafür keinen
Befehl in `scripts/admin.ts`, sondern drei Wege:

- die Inhaberin oder den Inhaber der Kita bitten, die Einladung unter
  `/admin/kita` zurückzuziehen;
- die offene Einladung selbst in der Datenbank löschen:

  ```sql
  DELETE FROM invitation
  WHERE lower(email) = lower('adresse@example.org') AND status = 'pending';
  ```

- oder abwarten: Nach sieben Tagen läuft sie ab und wird beim nächsten
  stündlichen Aufräumen gelöscht.

Danach ist die Adresse nur noch als Prüfwert im Zähler der Einladungen je
Empfängeradresse gespeichert (siehe [Spam-Schutz](./spam-schutz.md)), wie es
die Datenschutz-Vorlage beschreibt; der Zähler verfällt mit seinem
Zeitfenster.

Als Ansprechpartner nennt der Hinweis den Betreiber: „Ansprechpartner für den
Datenschutz ist … (`OPERATOR_NAME`), der Betreiber dieser Kibo-Instanz.“ Wer
Kibo als Träger für die eigenen Kitas betreibt, ist in der Regel selbst
verantwortlich; wie die Verantwortung tatsächlich verteilt ist, steht in der
Datenschutzerklärung. Den Text des Hinweises kann der Betrieb nicht ändern;
die Datenschutz-Vorlage beschreibt Einladungen im Abschnitt „E-Mails“.

### Vor dem produktiven Versand

- `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` und, soweit die
  Rechtsform es verlangt, `OPERATOR_LEGAL_INFO` setzen und im Log
  kontrollieren, dass keine Warnung `[mail] Betreiberangaben unvollständig`
  mehr erscheint.
- Impressum und Datenschutzerklärung hinterlegen und ohne Anmeldung aufrufen
  – unter genau den Adressen, die der Fuß einer Test-Mail verlinkt.
- In der Datenschutzerklärung den Abschnitt „E-Mails“ der Vorlage ausfüllen:
  Versanddienstleister mit Name und Sitz, Verarbeitungsorte, Grundlage einer
  Übermittlung in Drittländer, Speicherdauer der Versandprotokolle beim
  Anbieter.
- Den Versanddienst selbst prüfen, wie unter
  [SMTP – Vor dem produktiven Versand](./smtp.md#vor-dem-produktiven-versand)
  beschrieben: Auftragsverarbeitungsvertrag, Standorte, Verschlüsselung,
  kein Öffnungs- und Klicktracking, kein Umschreiben von Links.
- Eine Einladung an eine eigene Adresse schicken und Fuß, Links und
  Datenschutzhinweis in HTML- und Textfassung lesen.

Kibo stellt die technischen Voraussetzungen bereit; die Angaben selbst, die
Rechtsgrundlagen und die Verträge muss der Betrieb für sich prüfen (lassen).
