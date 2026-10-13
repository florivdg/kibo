<!--
ENTWURF – RECHTLICH UNGEPRÜFT. NICHT UNVERÄNDERT VERWENDEN.

Vorlage für die Datenschutzerklärung einer Kibo-Instanz. Sie beschreibt, was
Kibo technisch tatsächlich verarbeitet. Ob sie für den eigenen Betrieb
vollständig und richtig ist, kann sie nicht beurteilen.

Vor der Verwendung:
1. Den Text von einer Rechtsanwältin, einem Rechtsanwalt oder der
   Datenschutzbeauftragten prüfen und anpassen lassen. Dies ist keine
   Rechtsberatung.
2. Alle Platzhalter in [eckigen Klammern] ersetzen, auch die Angaben zu
   Hosting, E-Mail-Anbieter (docs/selbst-hosten/smtp.md, „Vor dem
   produktiven Versand“), Sicherungen und Aufsichtsbehörde.
3. Bedingte Teile: Eckige Klammern, die mit „Nur mit …“ oder „Nur wenn …“
   beginnen, gelten nur in diesem Fall – dann den Text ohne die Klammer
   behalten, sonst streichen. Betroffen sind:
   - „Benachrichtigungen“ nur mit VAPID_*-Schlüsseln; ohne sie den Abschnitt
     und jede Klammer „Nur mit `VAPID_*`“ streichen: unter „Was auf Ihrem
     Gerät gespeichert wird“ (die Einwilligung), „Schutz vor Spam und
     Missbrauch“, „Konten der Kita“, „Schriften und externe Inhalte“,
     „Hosting und Sicherungen“, in der Speicherdauer, unter „Pflicht zur Bereitstellung“ und „Ihre Rechte“
     (Widerruf einer Einwilligung, wohin man sich wendet).
   - „Hinweis an den Betreiber: rechtswidrige Inhalte“ nur mit
     OPERATOR_EMAIL: Ohne die Adresse bietet das Formular die Option nicht
     an; dann auch jede Klammer „Nur mit `OPERATOR_EMAIL`“ streichen: unter „Zettel melden“, „Schutz vor Spam
     und Missbrauch“ (was gezählt wird), „E-Mails“ (Begrenzung je
     Empfängeradresse, Eingangsbestätigungen) und in der Speicherdauer.
4. Den sichtbaren Hinweiskasten am Anfang erst nach der Prüfung entfernen.

Rechtsgrundlagen:
- Öffentliche Träger (Gemeinde, Landkreis, kommunaler Eigenbetrieb und
  andere Behörden) können sich bei der Erfüllung ihrer Aufgaben nicht auf
  berechtigte Interessen stützen (Art. 6 Abs. 1 Unterabs. 2 DSGVO). Betreibt
  eine solche Stelle Kibo selbst, braucht jede Verarbeitung, für die die
  Vorlage Art. 6 Abs. 1 lit. f DSGVO nennt, eine andere Grundlage – in der
  Regel Art. 6 Abs. 1 lit. e DSGVO mit einer Vorschrift des Landesrechts
  (Landesdatenschutzgesetz, Kita-Gesetz des Landes). Der Kasten
  „Widerspruchsrecht nach Art. 21 DSGVO“ nennt lit. e und f; seine Liste
  gilt dann für die Verarbeitungen nach lit. e.
- Kirchliche Träger wenden statt der DSGVO das KDG (katholisch) oder das
  DSG-EKD (evangelisch) an. Einen kirchlichen Träger, der Kibo selbst
  betreibt, bildet die Vorlage nicht ab.
- Jede Verarbeitung nennt genau eine Rechtsgrundlage. Wer eine ändert,
  passt die Liste unter „Widerspruchsrecht nach Art. 21 DSGVO“ an: Sie muss
  jede Verarbeitung nach lit. e oder f nennen.

Besonders rechtlich zu prüfen:
- „Personen, die auf einem Zettel genannt werden“: ob eine eigene
  Benachrichtigung der Genannten nach Art. 14 Abs. 5 lit. b DSGVO entfallen
  kann, beurteilt der Verantwortliche im Einzelfall; die Vorlage beschreibt
  nur, wie diese Prüfung ausgehen kann.

Die Datei als deploy/legal/datenschutz.md behalten – sie wird
schreibgeschützt in den Container eingebunden und unter /datenschutz
ausgeliefert. Die Überschrift „Datenschutzerklärung“ setzt Kibo selbst, hier
also mit ## beginnen. Kommentare wie dieser erscheinen nicht auf der Seite.
Jeder Absatz steht in einer Zeile: Ein Zeilenumbruch im Absatz wird als
Umbruch ausgegeben (gewollt nur in der Anschrift).
-->

> **Entwurf – rechtlich ungeprüft.** Diese Datenschutzerklärung ist eine Vorlage und keine Rechtsberatung. Sie muss vor der Verwendung rechtlich geprüft und an den eigenen Betrieb angepasst werden. Platzhalter in eckigen Klammern sind noch zu ersetzen.

## Verantwortlich und Rollen

Diese Kibo-Instanz betreibt:

[Name des Betreibers – in der Regel der Träger der Kitas]
[Anschrift]
E-Mail: [E-Mail-Adresse, wie `OPERATOR_EMAIL`]

[Falls benannt:] **Datenschutzbeauftragte Person:** [Name, Kontakt]

Die Kontaktstelle nach Art. 11 und 12 des Digital Services Act (DSA) nennt das [Impressum](/impressum).

Der Betreiber ist für alle Verarbeitungen verantwortlich, die diese Erklärung beschreibt.

Auf Ihr Recht, Verarbeitungen aufgrund berechtigter Interessen oder einer Aufgabe im öffentlichen Interesse zu widersprechen, weisen wir gesondert hin: siehe „Widerspruchsrecht nach Art. 21 DSGVO“ am Ende.

## Was diese Anwendung ist

Kibo ist ein digitales schwarzes Brett. Eine Kita legt Bretter an und teilt sie über einen nicht erratbaren Link, der zu allen Brettern der Kita führt. Wer den Link hat, kann Zettel lesen und anpinnen – ohne Konto und ohne Registrierung. Die Kita-Seite zeigt jedes Brett mit Name, Beschreibung und der Zahl der Zettel, die gerade hängen.

## Zettel auf den Brettern

Beim Anpinnen eines Zettels speichert Kibo: die Kategorie, die Überschrift, den Text, einen Namen oder ein Kürzel und – wenn Sie es ausfüllen – ein Kontaktfeld (zum Beispiel Telefonnummer oder E-Mail-Adresse), dazu den Zeitpunkt, die gewählte Laufzeit und einen Prüfwert (SHA-256-Hash) des Schlüssels, mit dem Sie den Zettel selbst abnehmen können. Alles außer dem Prüfwert sehen alle, die den Link der Kita haben, und das Team der Kita im Verwaltungsbereich. **Tragen Sie nur ein, was öffentlich stehen darf: keine Daten anderer Personen, nichts über Ihre Kinder und keine Angaben zu Gesundheit, Religion oder anderen besonders geschützten Bereichen.**

Sie wählen beim Anpinnen die Laufzeit: 7, 14 oder 30 Tage. Danach wird der Zettel sofort ausgeblendet und innerhalb der folgenden Stunde endgültig aus der Datenbank gelöscht. Ihren eigenen Zettel können Sie vom selben Gerät aus vorzeitig abnehmen (siehe „Was auf Ihrem Gerät gespeichert wird“). Die Kita kann jeden Zettel entfernen, nach einem Hinweis auf rechtswidrige Inhalte auch der Betreiber.

Überschrift, Text und Name braucht es, um einen Zettel anzupinnen; statt Ihres Namens genügt ein Kürzel. Das Kontaktfeld ist freiwillig. Niemand ist verpflichtet, einen Zettel anzupinnen; wer es nicht tut, dem entsteht kein Nachteil.

Zweck und Rechtsgrundlage: das berechtigte Interesse der Kita, Eltern und anderen Besuchern ein Brett für ihre Aushänge zu bieten, und Ihr Interesse, dort etwas auszuhängen (Art. 6 Abs. 1 lit. f DSGVO).

### Personen, die auf einem Zettel genannt werden

Nennt ein Zettel andere Personen – etwa jemanden, der etwas verloren hat, oder eine Ansprechperson –, stammen diese Angaben nicht von den Genannten selbst, sondern von der Person, die den Zettel anpinnt (Art. 14 DSGVO). Kibo weiß nicht, wer genannt ist, und hat keinen Weg, die Genannten zu erreichen. Ob eine genannte Person einzeln informiert wird, beurteilt der Verantwortliche – der Betreiber – im Einzelfall: Kennt er sie und kann er sie erreichen, informiert er sie innerhalb einer angemessenen Frist, spätestens nach einem Monat (Art. 14 Abs. 3 DSGVO), es sei denn, eine Ausnahme nach Art. 14 Abs. 5 DSGVO greift. Kennt er sie nicht oder kann er sie nicht erreichen, ist eine einzelne Benachrichtigung in der Regel unmöglich oder unverhältnismäßig (Art. 14 Abs. 5 lit. b DSGVO). Diese Erklärung ist in jedem Fall für alle abrufbar. Für die Genannten gilt dasselbe wie oben: derselbe Zweck und dieselbe Rechtsgrundlage, sichtbar für alle mit dem Link der Kita, gespeichert bis zum Ablauf des Zettels (höchstens 30 Tage) und, falls er gemeldet wird, als Kopie im Fall der Meldung (siehe „Zettel melden“).

Wer sich auf einem Zettel findet und das nicht möchte, kann die Kita bitten, den Zettel zu entfernen, oder ihn über „Melden“ auf dem Zettel melden. Alle weiteren Rechte stehen unter „Ihre Rechte“ und „Widerspruchsrecht nach Art. 21 DSGVO“.

## Was auf Ihrem Gerät gespeichert wird

Kibo setzt keine Tracking- oder Werbe-Cookies und bindet keine Dienste Dritter ein. Was die Anwendung auf Ihrem Gerät ablegt oder dort ausliest, ist unbedingt erforderlich, damit sie den Dienst erbringen kann, den Sie ausdrücklich nutzen (§ 25 Abs. 2 Nr. 2 TDDDG)[Nur mit `VAPID_*`: – mit einer Ausnahme: Für Benachrichtigungen braucht es Ihre Einwilligung (siehe „Benachrichtigungen“)].

**Auf den Seiten der Kita und ihrer Bretter**, im lokalen Speicher Ihres Browsers (localStorage). `kibo:seen` verlässt Ihr Gerät nie. Den Schlüssel aus `kibo:own-notes` schickt Ihr Browser nur dann an Kibo, wenn Sie Ihren Zettel abnehmen, zusammen mit der Kennung des Zettels; Kibo vergleicht ihn mit dem gespeicherten Prüfwert (SHA-256):

| Eintrag          | Inhalt und Zweck                                                                                                                                         | Wann und wie lange                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kibo:own-notes` | Kennung, Schlüssel zum Abnehmen und Ablaufzeit jedes Zettels, den Sie auf diesem Gerät angepinnt haben – nur damit können Sie ihn selbst wieder abnehmen | erst, wenn Sie auf diesem Gerät einen Zettel anpinnen; ein abgelaufener Zettel fällt beim nächsten Öffnen eines Bretts heraus, der Eintrag verschwindet, sobald keiner mehr übrig ist |
| `kibo:seen`      | für jedes Brett die Kennung und wann Sie es auf diesem Gerät zuletzt geöffnet haben, um Bretter mit neueren Zetteln als „Neu“ zu kennzeichnen            | erst, wenn Sie auf diesem Gerät ein Brett öffnen; Angaben, die älter als 30 Tage sind, fallen beim nächsten Öffnen eines Bretts heraus                                                |

Auf iPhone und iPad führen Browser und App vom Home-Bildschirm je einen eigenen Speicher. Sie können beides jederzeit löschen, indem Sie die Websitedaten in Ihrem Browser löschen beziehungsweise die App entfernen; danach lässt sich ein eigener Zettel nicht mehr selbst abnehmen.

**Im Verwaltungsbereich** (`/admin`), nur für Personen, die eine Kita verwalten. Die Namen der Anmelde-Cookies beginnen mit `__Secure-better-auth.`:

| Name                   | Art                               | Zweck                                                                                                  | Wie lange                                                         |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `…session_token`       | Cookie                            | hält Sie nach der Anmeldung angemeldet                                                                 | bis zur Abmeldung, längstens sieben Tage nach der letzten Nutzung |
| `…two_factor`          | Cookie                            | verbindet Passwort und zweiten Faktor einer Anmeldung                                                  | zehn Minuten                                                      |
| `…trust_device`        | Cookie                            | nur wenn Sie „Diesem Gerät 30 Tage vertrauen“ wählen: erspart auf diesem Gerät den zweiten Faktor      | 30 Tage nach der letzten Anmeldung auf diesem Gerät               |
| `…better-auth-passkey` | Cookie                            | ordnet die Antwort Ihres Geräts der Anmelde- oder Registrierungsanfrage mit einem Passkey zu           | fünf Minuten                                                      |
| `sidebar_state`        | Cookie                            | merkt sich, ob Sie die Seitenleiste ein- oder ausgeklappt haben; gesetzt erst, wenn Sie sie umschalten | sieben Tage                                                       |
| `kibo:flash`           | Sitzungsspeicher (sessionStorage) | eine Bestätigung wie „Gespeichert“, die nach einem Formular auf der nächsten Seite erscheint           | bis sie angezeigt wird, längstens bis Sie den Tab schließen       |

## Zettel melden

Einen Zettel, der nicht auf das Brett gehört, können Sie der Kita melden – ohne Konto, ohne Namen und ohne E-Mail-Adresse[Nur mit `OPERATOR_EMAIL`: ; Namen und E-Mail-Adresse geben Sie nur an, wenn Sie den Hinweis an den Betreiber wählen und das möchten (siehe „Hinweis an den Betreiber: rechtswidrige Inhalte“)]. Sie wählen einen Grund und können einen Hinweis hinzufügen (höchstens 500 Zeichen, freiwillig).

Die Meldungen eines Zettels bilden einen Fall, solange dieser offen ist. Hat die Kita den Fall abgeschlossen und hängt der Zettel noch, eröffnet eine spätere Meldung einen neuen Fall – mit einer neuen Kopie des Zettels, einer eigenen Höchstzahl gespeicherter Meldungen und eigenen Löschfristen. Gespeichert werden:

- **zum Fall** eine Kopie des Zettels, wie er gemeldet wurde (Kategorie, Überschrift, Text, Name, Kontaktfeld, wann er angepinnt wurde und wann er abläuft), damit die Kita ihn auch dann noch prüfen kann, wenn er abgenommen oder abgelaufen ist; die Zahl der Meldungen und wann die erste und die letzte kam; nach dem Abschluss wann und von welchem Konto des Teams der Fall abgeschlossen wurde, ob der Zettel entfernt wurde oder hängen blieb und ob der Betreiber ihn entfernt hat;
- **zu jeder Meldung** der Grund, der Hinweis und der Zeitpunkt – für höchstens 25 Meldungen je Fall, weitere werden nur gezählt. Derselbe Hinweis zum selben Zettel wird binnen 24 Stunden nur einmal gespeichert; dafür hält Kibo einen Prüfwert (HMAC) des Hinweises, solange der Zettel hängt, längstens 24 Stunden.

Wer gemeldet hat, wird nicht gespeichert, auch nicht die IP-Adresse (zur Begrenzung siehe „Schutz vor Spam und Missbrauch“). Meldungen sehen nur die Personen, die die Kita bei Kibo verwalten[Nur mit `OPERATOR_EMAIL`: , beim Hinweis an den Betreiber außerdem der Betreiber]. Bei einem neuen Fall bekommt jede von ihnen eine E-Mail, dass etwas gemeldet wurde, ohne den Inhalt, höchstens eine pro Stunde und Kita; dafür speichert Kibo je Empfängerin oder Empfänger einen Versandauftrag mit der Konto-ID, dem Stand und den Zeitpunkten der Versuche.

Ein abgeschlossener Fall wird 30 Tage nach seinem Abschluss gelöscht, jeder Fall samt der Kopie des Zettels, seinen Meldungen und Versandaufträgen spätestens 90 Tage nach der ersten Meldung; mit dem Brett oder der Kita gehen auch ihre Fälle.

Zweck und Rechtsgrundlage: das berechtigte Interesse der Kita, rechtswidrige oder unangemessene Inhalte auf ihren Brettern zu erkennen und zu entfernen (Art. 6 Abs. 1 lit. f DSGVO).

## Hinweis an den Betreiber: rechtswidrige Inhalte

[Nur wenn `OPERATOR_EMAIL` gesetzt ist; sonst diesen Abschnitt streichen.]

Der Betreiber ist Anbieter eines Hostingdienstes im Sinne des Digital Services Act. Wer einen Zettel für rechtswidrig hält, kann beim Melden zusätzlich „Rechtswidriger Inhalt – auch an den Betreiber melden“ wählen und freiwillig Namen und E-Mail-Adresse angeben. Verantwortlich dafür ist der Betreiber.

Die Meldung geht wie jede andere als Fall an die Kita (siehe „Zettel melden“). Zusätzlich bekommt der Betreiber eine E-Mail an [E-Mail-Adresse, wie `OPERATOR_EMAIL`] mit Kita, Brett, der Adresse des Bretts, der Kennung des Zettels, dem Grund und dem Hinweis, dem Zettel so, wie er gemeldet wurde (Überschrift, Text, Name, Kontaktfeld, wann er angepinnt wurde und wann er abläuft), dem Zeitpunkt der Meldung, Ihrem Namen und Ihrer E-Mail-Adresse, falls angegeben, und Ihrer Erklärung, dass Ihre Angaben richtig und vollständig sind. Name und E-Mail-Adresse stehen nur in dieser E-Mail: Kibo speichert sie nicht in seiner Datenbank, und die Kita erhält sie nicht. Die E-Mail-Adresse geht wie das Netz, aus dem die Meldung kommt, nur als Prüfwert in die Begrenzung ein (siehe „Schutz vor Spam und Missbrauch“).

Haben Sie eine E-Mail-Adresse angegeben, schickt Kibo Ihnen eine Eingangsbestätigung, sobald die Meldung an den Betreiber gegangen ist. Das kann scheitern – etwa wenn an dieselbe Adresse in kurzer Zeit schon zu viele Bestätigungen gingen (siehe „Schutz vor Spam und Missbrauch“) oder der Mailserver sie nicht annimmt –; sie wird dann nicht wiederholt, und das Formular erwähnt keine Bestätigung. Kam schon die Meldung beim Betreiber nicht an, sagt das Formular das. In beiden Fällen können Sie ihm direkt an [E-Mail-Adresse, wie `OPERATOR_EMAIL`] schreiben. Seine Entscheidung teilt er Ihnen an die angegebene Adresse mit. Ohne Adresse kann er Ihnen weder Bestätigung noch Entscheidung schicken; eine Meldung, die bei ihm angekommen ist, bearbeitet er trotzdem. Entfernt der Betreiber den Zettel, vermerkt der Fall der Kita, dass er es war.

Begründet ein Zettel den Verdacht einer Straftat, die eine Gefahr für das Leben oder die Sicherheit von Personen darstellt, muss der Betreiber die Strafverfolgungsbehörden informieren (Art. 18 DSA), in Deutschland das Bundeskriminalamt; dabei können der Zettel und die Angaben der Meldung weitergegeben werden.

Rechtsgrundlage: Erfüllung einer rechtlichen Verpflichtung (Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 16, 17 und 18 DSA). Der Betreiber bewahrt die E-Mail auf, solange er sie für die Bearbeitung und als Nachweis braucht: [Dauer eintragen, zum Beispiel sechs Monate nach der Entscheidung; bei einer Weitergabe nach Art. 18 DSA bis zum Abschluss des Verfahrens].

## Benachrichtigungen

[Nur mit `VAPID_*`-Schlüsseln; sonst diesen Abschnitt streichen.]

Für jedes Brett können Sie über seine Glocke Benachrichtigungen aktivieren. Sie erhalten dann auf diesem Gerät einen Hinweis, wenn auf diesem Brett ein neuer Zettel hängt. Der Hinweis nennt nur den Namen des Bretts und die Überschrift des Zettels (oder die Anzahl neuer Zettel) – nie den Text, den Namen oder das Kontaktfeld.

**Auf Ihrem Gerät.** Beim ersten Aktivieren legt die Anwendung einen Service Worker an, der die Hinweise anzeigt, und Ihr Browser meldet das Gerät bei seinem Push-Dienst an. Er übergibt Kibo eine Zustelladresse (Endpunkt) und zwei Schlüssel, mit denen Kibo die Nachricht verschlüsselt.

**Bei Kibo gespeichert** wird für jedes Brett, für das Sie Benachrichtigungen aktiviert haben: der Endpunkt, die beiden Schlüssel, zu welchem Brett sie gehören, wann Sie die Benachrichtigungen aktiviert haben, bis wann Sie das Brett auf diesem Gerät gesehen haben, wann Sie zuletzt eine Seite der Kita geöffnet haben (höchstens einmal am Tag vermerkt), wann zuletzt eine Nachricht zugestellt wurde und wie oft die Zustellung zuletzt in Folge gescheitert ist. Ihr Name, Ihre IP-Adresse oder eine Geräte- oder Werbekennung werden dafür nicht gespeichert.

**Übermittelt** werden Endpunkt und Schlüssel, solange Ihr Browser für mindestens ein Brett dieser Instanz Benachrichtigungen hat: beim Öffnen jeder Seite einer Kita, um die Glocken richtig anzuzeigen und neue Schlüssel nachzutragen. Auf der Seite eines Bretts schickt der Browser außerdem mit, bis wann Sie dessen Zettel gesehen haben; daraus berechnet Kibo die Zahl auf dem Symbol der App auf Ihrem Home-Bildschirm – wie viele neue Zettel auf den Brettern mit aktivierter Glocke hängen – und schickt sie mit den Hinweisen mit. Pinnen Sie selbst einen Zettel an, schickt der Browser den Endpunkt mit, damit Sie für Ihren eigenen Zettel keinen Hinweis bekommen; diese Angabe hält Kibo nur im Arbeitsspeicher, bis der Hinweis verschickt ist (in der Regel etwa zwei Minuten, höchstens rund eine Stunde), und speichert sie nicht.

**Push-Dienste.** Zugestellt werden die Nachrichten über den Push-Dienst, den Ihr Browser verwendet; welcher das ist, bestimmt Ihr Browser, nicht der Betreiber. Die Nachricht selbst ist Ende-zu-Ende verschlüsselt, auch die Adresse des Bretts darin; ihren Inhalt kann der Push-Dienst nicht lesen. Er sieht die Zustelladresse, die er selbst vergeben hat (den Endpunkt), Zeitpunkt und Größe jeder Nachricht, die IP-Adresse des Servers dieser Kibo-Instanz und die Header: wie lange er die Nachricht aufheben soll (einen Tag), wie dringend sie ist, einen Prüfwert (`Topic`), mit dem er eine noch nicht zugestellte Nachricht desselben Bretts durch die neuere ersetzt – er ist für jedes Gerät und Brett ein anderer und verrät weder das Brett noch, welche Geräte demselben Brett folgen –, und die Signatur mit dem öffentlichen Schlüssel dieser Kibo-Instanz und einer Kontaktadresse des Betreibers. Die Push-Dienste sind vom Betreiber unabhängig und keine Auftragsverarbeiter von ihm; sie verarbeiten diese Angaben in eigener Verantwortung, auch außerhalb der EU:

| Push-Dienst (Browser)                                                                      | Anbieter                        | Sitz     | Grundlage der Übermittlung                                |
| ------------------------------------------------------------------------------------------ | ------------------------------- | -------- | --------------------------------------------------------- |
| Firebase Cloud Messaging (Chrome und andere Chromium-Browser, meist auch Samsung Internet) | [Google LLC, prüfen]            | USA      | [EU-US Data Privacy Framework, Zertifizierung prüfen]     |
| Apple Push Notification Service (Safari, iPhone und iPad)                                  | [Apple Inc., prüfen]            | USA      | [EU-US Data Privacy Framework, Zertifizierung prüfen]     |
| Mozilla Push Service (Firefox)                                                             | [Mozilla Corporation, prüfen]   | USA      | [EU-US Data Privacy Framework, Zertifizierung prüfen]     |
| Windows Push Notification Services (Edge unter Windows)                                    | [Microsoft Corporation, prüfen] | USA      | [EU-US Data Privacy Framework, Zertifizierung prüfen]     |
| Samsung Push Service (Samsung Internet mit Samsungs eigenem Push-Dienst)                   | [Samsung Electronics, prüfen]   | Südkorea | [Angemessenheitsbeschluss für die Republik Korea, prüfen] |

[Die Zertifizierungen unter dataprivacyframework.gov prüfen. Gegen den Angemessenheitsbeschluss zum Data Privacy Framework ist ein Rechtsmittel anhängig (EuGH, C-703/25 P); den Stand vor der Veröffentlichung prüfen.]

**Rechtsgrundlage** ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO; für Service Worker und Push-Anmeldung auf Ihrem Gerät § 25 Abs. 1 TDDDG), die Sie mit dem Antippen der Glocke erteilen. Sie ist freiwillig; ohne sie bekommen Sie keine Hinweise, das Brett funktioniert sonst unverändert. Sie können sie jederzeit widerrufen: über die Glocke des Bretts oder in den Einstellungen Ihres Browsers bzw. Geräts.

**Gelöscht** werden die gespeicherten Angaben eines Bretts, sobald Sie seine Glocke ausschalten; ist es die letzte Glocke Ihres Geräts, meldet Ihr Browser das Gerät auch beim Push-Dienst ab und schickt danach nichts mehr. Ebenso gelöscht wird, sobald die Kita die Benachrichtigungen für das Brett abschaltet, das Brett löscht oder einen neuen Link für die Kita erzeugt, sobald der Push-Dienst meldet, dass es die Zustelladresse nicht mehr gibt, wenn die Zustellung mindestens dreimal in Folge scheitert und 30 Tage lang keine Nachricht angekommen ist, und spätestens 180 Tage, nachdem Sie zuletzt eine Seite der Kita geöffnet haben und zuletzt eine Nachricht zugestellt wurde – maßgeblich ist das spätere von beidem.

## Schutz vor Spam und Missbrauch

Damit Bretter nicht automatisiert zugespammt, Postfächer nicht über Kibo mit E-Mails überschüttet und Konten nicht durch Raten von Passwörtern übernommen werden, begrenzt Kibo, wie oft etwas in einer bestimmten Zeit geschehen darf, und erkennt denselben Text, wenn er mehrfach abgeschickt wird. Verantwortlich ist der Betreiber.

**Was gezählt wird:** Zettel anpinnen, laden, abnehmen und melden; das Abholen des Formular-Tokens (siehe unten); [Nur mit `VAPID_*`: Abgleich, An- und Abmelden von Benachrichtigungen;] [Nur mit `OPERATOR_EMAIL`: Hinweise an den Betreiber und ihre Eingangsbestätigungen;] Anmeldeversuche; E-Mails, die jemand anstoßen kann (siehe „E-Mails“); Einladungen; Datenexporte einer Kita.

**Worauf gezählt wird:** je nach Vorgang auf das Netz, aus dem eine Anfrage kommt – die IPv4-Adresse oder bei IPv6 das /64-Netz, beim Anpinnen und Melden zusätzlich das /56- und das /48-Netz –, auf die E-Mail-Adresse (bei Anmeldeversuchen die des Kontos, bei E-Mails die Empfängeradresse, auch zusammen mit dem Netz), auf die Konto-ID (Einladungen, Datenexporte), auf die Kita (über ihre Kennung oder ihren aktuellen Link), auf das Brett zusammen mit dem Link der Kita und auf den einzelnen Zettel.

**Wie gespeichert wird:** Keiner dieser Bezüge wird im Klartext gespeichert. Aus dem Namen der Begrenzung, dem Bezug und dem Beginn des Zeitfensters bildet Kibo mit einem zufälligen Schlüssel einen Prüfwert (HMAC) und speichert nur ihn, zusammen mit einem Zähler und einem Ablaufzeitpunkt. Ebenso werden vom Text eines Zettels und vom Hinweis einer Meldung keine Inhalte, sondern nur Prüfwerte abgelegt, um eine Wiederholung binnen 24 Stunden zu erkennen.

**Formular-Token.** Das Formular zum Anpinnen holt sich beim Öffnen ein Token: die Kennung des Schlüssels, die Uhrzeit, eine Zufallszahl und eine Signatur (HMAC) über Brett, Uhrzeit und Zufallszahl. Es enthält nichts über Sie und wird nicht gespeichert; angenommen wird es frühestens drei Sekunden und höchstens zwei Stunden nach dem Abholen.

**Anmeldefunktion.** Bei Anmelde- und Kontovorgängen (Anmeldung, Registrierung, Passwort zurücksetzen, Passkeys und Ähnliches) zählt die Anmeldefunktion zusätzlich Anfragen je IP-Adresse (bei IPv6 je /64-Netz) und Vorgang. Dafür speichert sie die IP-Adresse im Klartext zusammen mit dem aufgerufenen Pfad, einem Zähler und dem Zeitpunkt der letzten Anfrage.

| Was                                                     | Wie lange                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Zähler je Prüfwert und Zeitfenster                      | Länge des Fensters (fünf Minuten bis 24 Stunden) und bis gut zwei Stunden danach, längstens rund 26 Stunden |
| Prüfwert eines Zetteltexts oder eines Meldungshinweises | 24 Stunden, oder bis der Zettel entfernt wird                                                               |
| Schlüssel für die Prüfwerte                             | bis 25 Stunden, nachdem er durch einen neuen ersetzt wurde                                                  |
| Zähler der Anmeldefunktion (IP-Adresse und Pfad)        | spätestens rund zwei Stunden nach der letzten Anfrage                                                       |
| Formular-Token                                          | wird nicht gespeichert                                                                                      |

Abgelaufene Einträge löscht Kibo stündlich. Der Schlüssel liegt in derselben Datenbank – sonst würde jeder Neustart die Begrenzung aufheben – und damit auch in ihren Sicherungen. Die Prüfwerte sind deshalb für den Betreiber pseudonymisierte, nicht anonyme Daten: Ohne den Schlüssel lässt sich aus ihnen keine IP-Adresse, kein Text und keine E-Mail-Adresse zurückgewinnen, mit ihm ließe sich eine vermutete Angabe prüfen. Der Schlüssel lässt sich jederzeit austauschen. In das Protokoll des Servers geht nur, wie oft eine Begrenzung gegriffen hat, ohne Adressen oder Texte.

Zweck und Rechtsgrundlage: das berechtigte Interesse an einem funktionsfähigen und vor Missbrauch geschützten Angebot und an der Sicherheit von Netz und Diensten (Art. 6 Abs. 1 lit. f DSGVO, Erwägungsgrund 49 DSGVO).

Die technische Beschreibung der Regeln steht in der Dokumentation von Kibo unter „Spam-Schutz“ (`docs/selbst-hosten/spam-schutz.md`).

## Konten der Kita

Wer eine Kita bei Kibo verwaltet, hat ein Konto: Name, E-Mail-Adresse und Passwort (nur als Hash gespeichert), ob die Adresse bestätigt ist, und zu welchen Kitas das Konto mit welcher Rolle gehört (Inhaberin oder Inhaber, wer die Kita angelegt hat; Admin, wer eingeladen wurde). Verantwortlich für die Konten ist der Betreiber.

- **Zwei-Faktor-Anmeldung** (freiwillig): ein geheimer Schlüssel für die Authenticator-App (verschlüsselt gespeichert) und die Backup-Codes.
- **Passkeys** (freiwillig): je Passkey der öffentliche Schlüssel, seine Kennung, ein Zähler der Anmeldungen, ob er an ein Gerät gebunden ist oder synchronisiert und gesichert wird, die Übertragungswege (etwa USB oder intern), die Modellkennung des Authenticators (AAGUID, sie nennt die Art des Passkey-Speichers, nicht Ihr Gerät), der Name, den Sie ihm geben, und wann er angelegt wurde. Den privaten Schlüssel und Ihren Fingerabdruck, Ihr Gesicht oder Ihre PIN erhält Kibo nie. Einen synchronisierten Passkey hält Ihr Passkey-Anbieter (etwa iCloud-Schlüsselbund oder Google Passwortmanager) auf Ihren Geräten bereit, außerhalb von Kibo. Kibo verlangt, dass Ihr Gerät Sie bei jeder Verwendung prüft, und erfährt nur, dass diese Prüfung stattgefunden hat. Wird das Passwort zurückgesetzt, werden alle Passkeys des Kontos gelöscht.
- **Team:** Die Mitglieder einer Kita sehen untereinander Namen und E-Mail-Adressen. Wer eingeladen wird, steht unter „E-Mails“, Einladungen.

Name, E-Mail-Adresse und Passwort braucht es für ein Konto; ohne Konto lässt sich keine Kita verwalten. Konten, deren E-Mail-Adresse nach sieben Tagen nicht bestätigt ist und die zu keiner Kita gehören, werden automatisch gelöscht. Sie können Ihr Konto jederzeit selbst löschen. Eine Mitgliedschaft samt Rolle bleibt gespeichert, bis das Mitglied austritt oder entfernt wird oder die Kita oder das Konto gelöscht wird. Wird das Konto gelöscht, dem eine Kita gehört, wird auch die Kita samt ihren Brettern, Zetteln und Meldungen[Nur mit `VAPID_*`: sowie den Benachrichtigungs-Abos] gelöscht; die Konten der übrigen Mitglieder bleiben bestehen.

Rechtsgrundlage: Vertrag über die Nutzung von Kibo beziehungsweise vorvertragliche Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO).

**Sitzungen.** Angemeldete Sitzungen werden über die Cookies unter „Was auf Ihrem Gerät gespeichert wird“ geführt. Zu jeder Sitzung speichert Kibo die IP-Adresse (bei IPv6 das /64-Netz) und die Browserkennung (User-Agent), mit der sie begonnen wurde, dazu wann sie begann, zuletzt erneuert wurde und abläuft und welche Kita gerade gewählt ist. IP-Adresse und Browserkennung dienen der Sicherheit des Kontos, etwa um eine fremde Anmeldung erkennen zu können. Bei der Abmeldung wird die Sitzung gelöscht; sonst läuft sie spätestens sieben Tage nach der letzten Nutzung ab und wird binnen einer Stunde gelöscht. Für die Anmeldung speichert Kibo außerdem kurzlebige Einträge, teils mit der Konto-ID: für einen Link zum Zurücksetzen des Passworts (eine Stunde gültig), für eine begonnene Anmeldung mit zweitem Faktor (zehn Minuten), für eine Anfrage mit einem Passkey (fünf Minuten) und, wenn Sie es wählen, für „Diesem Gerät 30 Tage vertrauen“ (30 Tage nach der letzten Anmeldung auf diesem Gerät). Sie werden gelöscht, sobald sie verwendet werden, spätestens eine Stunde nach ihrem Ablauf. Besucherinnen und Besucher der Bretter haben keine Sitzung; für sie wird nichts davon gespeichert.

Rechtsgrundlage: berechtigtes Interesse an der Sicherheit der Konten (Art. 6 Abs. 1 lit. f DSGVO).

## Datenexport der Kita

Inhaberin, Inhaber und Admins einer Kita können ihre Daten jederzeit als Datei herunterladen: den Namen der Kita, ihre Bretter mit Art, Kategorien, Name, Beschreibung und Einstellungen und alle Zettel, die gerade hängen, mit Kategorie, Überschrift, Text, Name, Kontaktfeld und den Zeitpunkten des Anpinnens und des Ablaufs. Die Datei landet auf dem Gerät der Person, die sie herunterlädt; von da an ist die Kita für sie verantwortlich. Kibo vermerkt über den Download nur die Zähler der Begrenzung je Konto und Kita (siehe „Schutz vor Spam und Missbrauch“).

Zweck und Rechtsgrundlage: das berechtigte Interesse der Kita, ihre Daten aufzubewahren oder zu einem anderen Anbieter mitzunehmen (Art. 6 Abs. 1 lit. f DSGVO).

## E-Mails

Kibo verschickt E-Mails nur aus einem konkreten Anlass – keine Newsletter, keine Werbung. Jede E-Mail nennt am Ende den Betreiber und verlinkt Impressum und diese Datenschutzerklärung. E-Mails, die jemand anstoßen kann – Links zum Bestätigen und Zurücksetzen, Einladungen[Nur mit `OPERATOR_EMAIL`: , Eingangsbestätigungen eines Hinweises an den Betreiber] –, zählen gegen eine Begrenzung je Empfängeradresse; die Adresse geht dafür nur als Prüfwert ein (siehe „Schutz vor Spam und Missbrauch“).

**E-Mails an Konten.** An die E-Mail-Adresse eines Kontos schickt Kibo:

- nach der Registrierung einen Link zur Bestätigung der Adresse,
- auf Anforderung einen Link zum Zurücksetzen des Passworts,
- bei einer Änderung der E-Mail-Adresse zwei Nachrichten: zuerst an die bisherige Adresse, mit der neuen Adresse und einem Link, der Änderung zuzustimmen; erst nach dieser Zustimmung an die neue Adresse, mit einem Link, sie zu bestätigen. Bis dahin bleibt die bisherige Adresse die des Kontos.

Die Links zum Bestätigen und Zurücksetzen sind eine Stunde gültig. Verantwortlich ist der Betreiber; Rechtsgrundlage ist der Vertrag über die Nutzung von Kibo beziehungsweise vorvertragliche Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO).

**E-Mails zu Meldungen** gehen an die Inhaberin oder den Inhaber und die Admins einer Kita, siehe „Zettel melden“. [Nur mit `OPERATOR_EMAIL`: **Eingangsbestätigungen** eines Hinweises an den Betreiber gehen an die Adresse, die die meldende Person angegeben hat, siehe „Hinweis an den Betreiber: rechtswidrige Inhalte“.]

**Einladungen – auch an Personen ohne Konto.** Wer eine Kita angelegt hat (Inhaberin oder Inhaber), kann weitere Personen per E-Mail einladen, die Kita mitzuverwalten. Dafür gibt sie oder er die E-Mail-Adresse der eingeladenen Person ein; die Adresse stammt also von der Kita, nicht von der eingeladenen Person selbst (Art. 14 DSGVO). Gespeichert werden die eingeladene Adresse, die Kita, die einladende Person, die Rolle, der Stand (offen, angenommen, abgelehnt, zurückgezogen), der Zeitpunkt und das Ablaufdatum der Einladung. Die Einladung nennt den Namen der Kita und der einladenden Person und enthält einen Link, der die Einladung zeigt, ohne jemanden anzumelden. Annehmen oder ablehnen kann sie nur, wer sich mit der eingeladenen Adresse anmeldet; wer kein Konto hat und keines anlegen möchte, muss nichts tun.

- **Verantwortlich** ist der oben genannte Betreiber. Die Einladungs-E-Mail nennt ihn als Ansprechpartner für den Datenschutz.
- **Zweck und Rechtsgrundlage:** die Einladung zur Mitverwaltung der Kita; berechtigtes Interesse des Trägers, ihr Team für die Verwaltung der Bretter selbst zusammenzustellen (Art. 6 Abs. 1 lit. f DSGVO).
- **Speicherdauer:** Eine Einladung gilt sieben Tage. Sie bleibt gespeichert, bis sie angenommen oder abgelehnt, von der Kita zurückgezogen wird oder abläuft, und wird danach beim nächsten stündlichen Aufräumen gelöscht; mit einer gelöschten Kita gehen auch ihre Einladungen. Wer eine Einladung annimmt, legt dabei ein Konto an oder meldet sich an; dann gilt der Abschnitt „Konten der Kita“. Um massenhafte Einladungen zu verhindern, zählt Kibo Einladungen je Kita, je einladendem Konto und je Empfängeradresse – nur als Prüfwert.
- **Unerwünschte Einladung:** Wer nichts tut, dessen Adresse wird nach Ablauf der Einladung (sieben Tage) beim nächsten stündlichen Aufräumen gelöscht. Widerspruch und alle anderen Rechte können Sie jederzeit beim Betreiber geltend machen: [E-Mail-Adresse, wie `OPERATOR_EMAIL`].

Die Einladungs-E-Mail fasst diese Angaben in einem kurzen Hinweis zusammen und verlinkt auf diese Datenschutzerklärung.

**Versand.** Die E-Mails werden über [Name und Sitz des E-Mail-Anbieters] versendet. Der Anbieter verarbeitet dafür die Empfängeradresse, den Betreff, den Inhalt der Nachricht samt der darin enthaltenen Links und technische Angaben zur Zustellung (Zeitpunkt, Zustellstatus, Antwort des empfangenden Servers). Mit ihm besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. [Verarbeitungsorte angeben; bei Verarbeitung oder möglichem Zugriff außerhalb der EU die Grundlage der Übermittlung, zum Beispiel Angemessenheitsbeschluss oder Standardvertragsklauseln.] [Wie lange der Anbieter Versandprotokolle und Inhalte aufbewahrt.] Zwischen Kibo und dem Anbieter ist die Verbindung stets verschlüsselt (TLS); [ob der Anbieter die Nachricht verschlüsselt an den Server der Empfängerin oder des Empfängers weitergibt]. Kibo bettet weder Zählpixel noch umgeleitete Links in seine E-Mails ein; [Öffnungs- und Klickverfolgung ist auch beim Anbieter abgeschaltet].

## Server-Protokolle

Die Anwendung, die Datenbank und der vorgeschaltete Reverse Proxy protokollieren Betriebs- und Fehlermeldungen, damit der Betreiber Störungen erkennen und beheben kann. Kibos eigene Meldungen enthalten keine IP-Adressen, keine Links der Kitas, keine Zetteltexte und keine Bestätigungs- oder Reset-Links; E-Mail-Adressen erscheinen nur gekürzt (etwa `a***@example.org`). Bei einem unerwarteten Fehler, etwa einer gescheiterten Datenbankabfrage, kann das Fehlerprotokoll aber Teile der betroffenen Anfrage enthalten, zum Beispiel den Link einer Kita, einen Zetteltext oder eine IP-Adresse. Einige Meldungen nennen die Konto-ID – eine zufällige Kennung, nie Name oder Adresse –, etwa wenn eine E-Mail zu Meldungen nicht zugestellt werden konnte. Zuordnen lässt sich eine solche Kennung nur mit der Datenbank.

Der Reverse Proxy schreibt in der mitgelieferten Konfiguration keine Zugriffsprotokolle. [Falls Zugriffsprotokolle mit IP-Adressen geführt werden, hier Inhalt, Zweck und Speicherdauer angeben.]

Die Protokolle werden nach Größe rotiert: höchstens drei Dateien zu je 10 MB je Dienst; ältere Einträge werden überschrieben. Eine feste Frist gibt es dadurch nicht – auf einer ruhigen Instanz können Einträge einige Wochen alt werden. [Falls die Protokolle an ein zentrales System weitergeleitet werden: wohin und wie lange sie dort bleiben.]

Rechtsgrundlage: berechtigtes Interesse an einem sicheren und störungsfreien Betrieb (Art. 6 Abs. 1 lit. f DSGVO).

## Schriften und externe Inhalte

Die verwendeten Schriften werden vom eigenen Server ausgeliefert. Ihr Browser baut beim Besuch keine Verbindung zu Google Fonts oder anderen Diensten Dritter auf. Ein Einwilligungsbanner ist deshalb nicht nötig. [Nur mit `VAPID_*`: Nur wenn Sie auf einem Brett Benachrichtigungen aktivieren, spricht Ihr Browser mit seinem Push-Dienst (siehe „Benachrichtigungen“).]

## Hosting und Sicherungen

Die Anwendung läuft auf [Anbieter, Standort des Servers]. Mit dem Anbieter besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.

Die Datenbank wird [täglich] gesichert, damit sie sich nach einem Fehler wiederherstellen lässt (Art. 32 Abs. 1 lit. c DSGVO). Die Sicherungen liegen [Speicherort] und werden nach [14 Tagen – Vorgabe von `deploy/backup.sh`, `KEEP_DAYS`] gelöscht. Sie enthalten alles, was zum Zeitpunkt der Sicherung in der Datenbank stand, also auch Zettel, Meldungen, [Nur mit `VAPID_*`: Benachrichtigungs-Abos,] Sitzungen und Zähler, die seitdem gelöscht wurden. Verantwortlich ist der Betreiber.

Rechtsgrundlage: berechtigtes Interesse an der Verfügbarkeit und Wiederherstellbarkeit des Dienstes (Art. 6 Abs. 1 lit. f DSGVO).

## Speicherdauer im Überblick

| Daten                                                             | Wie lange                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Zettel                                                            | bis zum Ablauf (7, 14 oder 30 Tage), dann binnen einer Stunde gelöscht; früher, wenn er abgenommen wird     |
| Meldungen samt Kopie des Zettels und Versandaufträgen             | 30 Tage nach dem Abschluss, spätestens 90 Tage nach der ersten Meldung                                      |
| [Nur wenn `OPERATOR_EMAIL` gesetzt ist:] Hinweis an den Betreiber | nur in der E-Mail an den Betreiber: [Dauer wie oben]                                                        |
| [Nur mit `VAPID_*`:] Benachrichtigungs-Abo                        | bis zum Ausschalten der Glocke, spätestens 180 Tage nach dem letzten Besuch und der letzten Zustellung      |
| Zähler und Prüfwerte der Spam-Begrenzung                          | höchstens rund 26 Stunden, Prüfwerte von Texten 24 Stunden                                                  |
| Zähler der Anmeldefunktion (IP-Adresse und Pfad)                  | spätestens rund zwei Stunden nach der letzten Anfrage                                                       |
| Sitzung mit IP-Adresse und Browserkennung                         | bis zur Abmeldung, längstens sieben Tage nach der letzten Nutzung                                           |
| Einträge für Anmeldung und Links                                  | fünf Minuten bis 30 Tage (siehe „Konten der Kita“), spätestens eine Stunde nach Ablauf gelöscht             |
| Konto, Passkeys, Zwei-Faktor-Anmeldung                            | bis das Konto gelöscht wird; unbestätigte Konten ohne Kita nach sieben Tagen                                |
| Mitgliedschaft und Rolle in einer Kita                            | bis das Mitglied austritt oder entfernt wird oder die Kita oder das Konto gelöscht wird                     |
| Einladung                                                         | bis sie beantwortet, zurückgezogen oder nach sieben Tagen abgelaufen ist, dann binnen einer Stunde gelöscht |
| Server-Protokolle                                                 | bis sie durch neuere überschrieben werden (höchstens 3 × 10 MB je Dienst)                                   |
| Sicherungen                                                       | [14 Tage]                                                                                                   |
| Auf Ihrem Gerät                                                   | siehe „Was auf Ihrem Gerät gespeichert wird“                                                                |

## Pflicht zur Bereitstellung und automatisierte Entscheidungen

Gesetzlich vorgeschrieben ist keine der Angaben, die Kibo verarbeitet. Welche für einen Vorgang oder einen Vertrag nötig sind und was geschieht, wenn sie fehlen, steht in den Abschnitten oben: ohne Überschrift, Text und Namen kein Zettel, ohne Konto keine Verwaltung einer Kita[Nur mit `VAPID_*`: , ohne Einwilligung keine Benachrichtigungen]. Die IP-Adresse überträgt Ihr Browser bei jedem Aufruf; ohne sie lässt sich keine Seite ausliefern.

Kibo trifft keine Entscheidungen, die ausschließlich auf einer automatisierten Verarbeitung beruhen und Ihnen gegenüber rechtliche Wirkung entfalten oder Sie in ähnlicher Weise erheblich beeinträchtigen, und bildet keine Profile (Art. 22 DSGVO). Die Spam-Begrenzung weist einzelne Anfragen nur vorübergehend ab; ob ein gemeldeter Zettel entfernt wird, entscheiden Menschen.

## Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21, siehe unten)[Nur mit `VAPID_*`: sowie das Recht, eine Einwilligung jederzeit mit Wirkung für die Zukunft zu widerrufen (Art. 7 Abs. 3 DSGVO)].

Wenden Sie sich dafür an den Verantwortlichen: an den Betreiber, Adresse oben.

Wer Zettel anpinnt oder meldet, hat bei Kibo kein Konto. Damit Ihnen Auskunft zu einem Zettel gegeben oder ein Zettel gelöscht werden kann, braucht es Angaben, an denen er sich erkennen lässt – etwa Brett, Überschrift und ungefähren Zeitpunkt (Art. 11 Abs. 2, Art. 12 Abs. 2 DSGVO). Den eigenen Zettel können Sie vom selben Gerät aus jederzeit selbst abnehmen.

Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel bei der für [den Betreiber] zuständigen: [zuständige Landesdatenschutzbehörde mit Anschrift].

## Widerspruchsrecht nach Art. 21 DSGVO

> **Sie haben das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit gegen die Verarbeitung Sie betreffender personenbezogener Daten Widerspruch einzulegen, die auf Art. 6 Abs. 1 lit. e oder f DSGVO (Aufgabe im öffentlichen Interesse oder berechtigte Interessen) beruht.**
>
> Auf dieser Website betrifft das:
>
> - Zettel auf den Brettern, auch Angaben über Sie auf einem Zettel, den jemand anderes angepinnt hat
> - Meldungen von Zetteln und die E-Mails dazu
> - Einladungen zur Mitverwaltung einer Kita
> - den Datenexport einer Kita
> - IP-Adresse und Browserkennung angemeldeter Sitzungen
> - den Schutz vor Spam und Missbrauch
> - die Server-Protokolle und die Sicherungen der Datenbank
>
> Nach einem Widerspruch verarbeitet der Verantwortliche diese Daten nicht mehr, es sei denn, er kann zwingende schutzwürdige Gründe für die Verarbeitung nachweisen, die Ihre Interessen, Rechte und Freiheiten überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
>
> Ein formloser Widerspruch genügt, am besten per E-Mail: an den Betreiber, Adresse oben. Damit der Widerspruch einen bestimmten Zettel trifft, nennen Sie ihn so, dass er sich erkennen lässt.

Stand: [Datum]
