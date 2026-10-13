# SMTP konfigurieren

Ohne SMTP versendet Kibo **nichts** – und ohne bestätigte E-Mail-Adresse kann
sich niemand anmelden. Auch Einladungen zu einer Kita kommen dann nicht an:
Sie werden angelegt, aber die Mail mit dem Link bleibt aus. Beim Start schreibt
die App deshalb eine deutliche Fehlermeldung ins Log, wenn `SMTP_HOST` fehlt;
mit `HOSTED=true` startet sie ohne `SMTP_HOST` gar nicht.

| Variable              | Bedeutung                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| `SMTP_HOST`           | Postausgangsserver                                                      |
| `SMTP_PORT`           | 587 (STARTTLS) oder 465 (implizites TLS)                                |
| `SMTP_USER`           | Benutzername; leer lassen für Server ohne Anmeldung                     |
| `SMTP_PASSWORD`       | Passwort                                                                |
| `SMTP_FROM`           | Absender, zum Beispiel `Kibo <kibo@example.org>`                        |
| `SMTP_SECURE`         | `true`/`false` überschreibt die Portregel; leer = implizites TLS ab 465 |
| `SMTP_ALLOW_INSECURE` | nur lokal für Mailpit; erlaubt unverschlüsselten Versand                |

## Verschlüsselung und Zustellbarkeit

Verschlüsselung ist ausdrücklich geregelt: Port 465 (oder `SMTP_SECURE=true`)
spricht von der ersten Verbindung an TLS, jeder andere Port **verlangt**
STARTTLS und ein gültiges Zertifikat (`secure: false` allein würde das nicht
erzwingen). Nur `SMTP_ALLOW_INSECURE=true` erlaubt Klartext – für die lokale
Entwicklung mit Mailpit, nicht für den Server.

Zustellbarkeit: Die Domain in `SMTP_FROM` sollte zum Postausgangsserver passen
und per SPF, DKIM und möglichst DMARC abgesichert sein, sonst landen
Bestätigungsmails im Spam. Ein Postfach beim eigenen Hoster oder ein
Versanddienst sind deutlich zuverlässiger als ein selbst betriebener Mailserver
auf demselben VPS.

## Versandfehler erkennen

Fehlgeschlagene Mails stehen als `[mail] Versand an
l***@example.org fehlgeschlagen (…)` im Log. Bewusst nicht im Log stehen:
Mailinhalte, Bestätigungs- und Reset-Links. Ein fehlgeschlagener Versand lässt
die Registrierung nicht scheitern – Betroffene fordern die Mail einfach erneut
an: „E-Mail erneut senden“ auf `/admin/verify-email` beziehungsweise
„Passwort vergessen“ auf `/admin/login`.

Kontrolle nach der Einrichtung:

```sh
docker compose logs app | grep '\[mail\]'
```

## Vor dem produktiven Versand

Kibo verschickt Bestätigungs-, Reset- und Einladungslinks – Schlüssel, mit
denen sich ein Konto übernehmen oder eine Einladung annehmen lässt – und
Einladungen an Menschen, die Kibo nicht kennen. Bevor die erste echte Mail
hinausgeht, gehört deshalb auch der Versanddienst auf den Prüfstand:

- **Auftragsverarbeitung.** Mit dem Anbieter des Postausgangsservers einen
  Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO schließen, sofern es
  nicht der eigene Mailserver ist.
- **Verarbeitungsorte und Drittlandzugriffe.** Wo stehen die Server, wo die
  Protokolle, und kann eine Muttergesellschaft außerhalb der EU darauf
  zugreifen? Die Antwort gehört mit der Grundlage einer Übermittlung in die
  Datenschutzerklärung (Abschnitt „E-Mails“ der Vorlage).
- **Aufbewahrung.** Wie lange speichert der Anbieter Versandprotokolle,
  Empfängeradressen und – bei manchen Diensten – den Inhalt der Mails? Die
  Frist so kurz wie möglich einstellen und in der Datenschutzerklärung nennen.
- **Verschlüsselung.** Zwischen Kibo und dem Postausgangsserver erzwingt
  Kibo TLS (oben). Ob der Anbieter die Mail auch auf dem Weg zum Postfach der
  Empfängerin verschlüsselt weitergibt (TLS, möglichst MTA-STS oder DANE),
  steht in seiner Dokumentation.
- **Kein Tracking, kein Umschreiben von Links.** Öffnungs- und Klicktracking
  abschalten; viele Versanddienste schalten es ab Werk ein. Klicktracking
  schreibt jeden Link auf eine Adresse des Anbieters um: Dann liefen die
  Bestätigungs- und Reset-Links über fremde Server, und der Fuß verlinkte
  Impressum und Datenschutz nicht mehr direkt. Kibo selbst baut weder
  Zählpixel noch Weiterleitungen in seine Mails ein.

Was im Fuß jeder Mail steht und welche Angaben dafür nötig sind, steht unter
[Betreiberangaben in E-Mails](./impressum-und-datenschutz.md#betreiberangaben-in-e-mails).
Danach eine Test-Mail an eine eigene Adresse schicken – am einfachsten eine
Einladung an eine zweite eigene Adresse – und in der HTML- und der Textfassung
prüfen, dass die Links unverändert auf die eigene Domain zeigen.
