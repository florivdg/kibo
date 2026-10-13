# Konfiguration

Alles, was eine Instanz ausmacht, kommt zur Laufzeit aus der Umgebung – mit
Docker Compose aus der Datei `.env` neben der `compose.yml`
([Kibo einrichten](./einrichtung.md)). Das Image selbst ist für jede Domain
dasselbe.

## Umgebungsvariablen

| Variable               | Pflicht | Vorgabe                         | Bedeutung                                                                                                                                                 |
| :--------------------- | :------ | :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | ja      | –                               | Verbindung zur PostgreSQL-Datenbank                                                                                                                       |
| `BETTER_AUTH_URL`      | ja      | –                               | Öffentliche Adresse mit `https://` (außer `localhost`); Grundlage für Cookies, Auth-Links, Links zu den Brettern und Passkeys                             |
| `BETTER_AUTH_SECRET`   | ja      | –                               | Schlüssel für Sitzungen und Tokens, mindestens 32 Zeichen (`openssl rand -base64 32`), stabil halten                                                      |
| `TRUSTED_PROXIES`      | nein    | –                               | IPs/CIDRs der vorgeschalteten Proxys ([Spam-Schutz](./spam-schutz.md#vertrauensgrenze))                                                                   |
| `SIGNUP_MODE`          | nein    | `open`                          | `open`: jede und jeder kann sich registrieren; `closed`: nur per Skript (`node dist/admin.mjs create-user`) oder Einladung.                               |
| `SIGNUP_EMAIL_DOMAINS` | nein⁴   | –                               | Erlaubte E-Mail-Domains für Konten, kommasepariert, z. B. `kita-verbund.de, *.kita-verbund.de`; leer = alle                                               |
| `HOSTED`               | nein    | `false`                         | Modus der gehosteten Instanz des Projekts; auf einer eigenen Instanz `false` lassen ([Gehosteter Modus](#gehosteter-modus))                               |
| `DOCS_URL`             | nein    | Dokumentation auf GitHub        | Adresse, auf die „Hilfe“ im Admin-Bereich zeigt ([Hilfe-Link](#hilfe-link))                                                                               |
| `SOURCE_URL`           | nein    | Repository auf GitHub           | Adresse, auf die „Quelltext“ am Fuß jeder Seite zeigt ([Quelltext-Link](#quelltext-link-agpl))                                                            |
| `SMTP_HOST`            | nein¹   | –                               | Postausgangsserver; fehlt er, versendet der Produktions-Build nichts ([SMTP](./smtp.md))                                                                  |
| `SMTP_PORT`            | nein    | `587`                           | 587 für STARTTLS, 465 für implizites TLS                                                                                                                  |
| `SMTP_USER`            | nein    | –                               | Benutzername; leer für Server ohne Anmeldung                                                                                                              |
| `SMTP_PASSWORD`        | nein    | –                               | Passwort zum Benutzernamen                                                                                                                                |
| `SMTP_FROM`            | nein    | `Kibo <kibo@localhost>`         | Absenderadresse                                                                                                                                           |
| `SMTP_SECURE`          | nein    | Port 465                        | `true`/`false` überschreibt die Portregel für implizites TLS                                                                                              |
| `SMTP_ALLOW_INSECURE`  | nein    | `false`                         | Erlaubt unverschlüsselten Versand – nur für lokales Mailpit                                                                                               |
| `IMPRESSUM_URL`        | nein²   | –                               | Externe Adresse des Impressums mit `https://`; sonst `impressum.md` aus `LEGAL_DIR`                                                                       |
| `DATENSCHUTZ_URL`      | nein²   | –                               | Externe Adresse der Datenschutzerklärung mit `https://`; sonst `datenschutz.md` aus `LEGAL_DIR`                                                           |
| `OPERATOR_NAME`        | nein⁵   | –                               | Name der Betreiberin oder des Betreibers, im Fuß jeder E-Mail ([Betreiberangaben in E-Mails](./impressum-und-datenschutz.md#betreiberangaben-in-e-mails)) |
| `OPERATOR_ADDRESS`     | nein⁵   | –                               | Postanschrift, Zeilen getrennt durch `\|`, z. B. `Musterstraße 1 \| 12345 Musterstadt`                                                                    |
| `OPERATOR_EMAIL`       | nein⁵   | –                               | Kontaktadresse, auch für unerwünschte Einladungen und [Hinweise auf rechtswidrige Inhalte](./rechtswidrige-inhalte.md)                                    |
| `OPERATOR_LEGAL_INFO`  | nein    | –                               | Was die Rechtsform in Geschäftsbriefen verlangt (Registergericht und -nummer, Vertretung, USt-IdNr. …), Zeilen getrennt durch `\|`                        |
| `LEGAL_DIR`            | nein    | `./legal` (Image: `/app/legal`) | Verzeichnis mit den Markdown-Dateien für Impressum und Datenschutz                                                                                        |
| `VAPID_PUBLIC_KEY`     | nein³   | –                               | Öffentlicher Schlüssel für Benachrichtigungen (base64url, 87 Zeichen)                                                                                     |
| `VAPID_PRIVATE_KEY`    | nein³   | –                               | Privater Schlüssel als JWK-JSON-Zeile (`bunx @pushforge/builder vapid`), stabil halten                                                                    |
| `VAPID_SUBJECT`        | nein³   | –                               | Kontakt für die Push-Dienste, `mailto:…` oder `https://…`                                                                                                 |
| `HOST` / `PORT`        | nein    | `0.0.0.0` / `4321`              | Adresse und Port des Node-Servers (im Image gesetzt)                                                                                                      |

¹ Ohne SMTP funktionieren Registrierung, Passwort-Reset und Einladungen nicht. Der Entwicklungsserver schreibt die Mails stattdessen ins Log, ein Produktions-Build nicht.
² Rechtlich erforderlich: entweder die URL setzen oder die Markdown-Datei hinterlegen ([Impressum und Datenschutz](./impressum-und-datenschutz.md)). Jede Mail verlinkt beide Seiten. Fehlen sie, warnt das Log beim Start (`[legal] Für /impressum ist weder IMPRESSUM_URL gesetzt …`).
³ Alle drei oder keine: Ohne sie sind Benachrichtigungen aus, mit nur einem Teil startet der Produktionsserver nicht ([Benachrichtigungen](./benachrichtigungen.md)).
⁴ Die Liste gilt für die Registrierung, für Einladungen, für geänderte E-Mail-Adressen und für Konten aus dem Verwaltungsskript; wie ein Eintrag aussieht, steht unter [Registrierung steuern](#registrierung-steuern-und-erstes-konto-anlegen).
⁵ Der Fuß der E-Mails nennt nur, was gesetzt ist, und das Log warnt beim Start. Ein ungültiger Wert (Link in Name oder Anschrift, mehr als eine Zeile im Namen, mehr als 5 Zeilen Anschrift, Steuer- oder Bidi-Zeichen) lässt die App in jedem Fall nicht starten.

Alle Variablen werden zur **Laufzeit** gelesen; für `bun run build` beziehungsweise den Image-Build wird keine davon gebraucht. Der Produktionsserver (`scripts/server.mjs`) prüft die Pflichtangaben beim Start und startet nicht, wenn eine fehlt, das Secret zu kurz, die Adresse kein HTTPS, `TRUSTED_PROXIES`, `SIGNUP_MODE`, `SIGNUP_EMAIL_DOMAINS`, `HOSTED`, `DOCS_URL`, `SOURCE_URL`, eine der `OPERATOR_*`-Angaben, `IMPRESSUM_URL` oder `DATENSCHUTZ_URL` ungültig oder die VAPID-Konfiguration unvollständig ist ([Startprüfung](./einrichtung.md#startprüfung)).

Dazu kommen die Angaben, die nur die mitgelieferte `compose.yml` liest:
`KIBO_DOMAIN`, `KIBO_IMAGE_TAG` und die drei `POSTGRES_*`
([Kibo einrichten](./einrichtung.md)) sowie `KIBO_PROXY_NETWORK`,
`KIBO_ENTRYPOINT` und `KIBO_CERTRESOLVER` ([Traefik](./traefik.md)),
`KIBO_REDIRECT_DOMAIN` und `COMPOSE_FILE` ([Zweite Domain](./traefik.md#zweite-domain))
sowie `KIBO_LOAD_ENVIRONMENT` ([Lasttests](./lasttests.md)).

## Registrierung steuern und erstes Konto anlegen

Zwei Variablen legen fest, wer auf der Instanz ein Konto bekommt. Beide sind
optional; ohne sie kann sich wie bisher jede und jeder registrieren.

| Variable               | Bedeutung                                                                                                                   | Vorgabe |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `SIGNUP_MODE`          | `open`: Registrierung unter `/admin/signup` für alle. `closed`: Konten legt der Betrieb an, dazu kommen Eingeladene (s. u.) | `open`  |
| `SIGNUP_EMAIL_DOMAINS` | Erlaubte E-Mail-Domains, kommasepariert; leer = keine Einschränkung                                                         | leer    |

**Geschlossene Registrierung.** Mit `SIGNUP_MODE=closed` lehnt die App jede
Registrierung ab, `/admin/signup` leitet zur Anmeldung weiter, und der Knopf
„Kita registrieren“ auf der Startseite sowie der Link „Registrieren“ auf der
Anmeldeseite verschwinden. Anmeldung, „Passwort vergessen“ und die Links aus
bereits verschickten Bestätigungsmails funktionieren unverändert.

Eine Ausnahme gibt es: **Einladungen.** Die Inhaberin oder der Inhaber einer
Kita lädt unter „Kita-Einstellungen“ weitere Admins per E-Mail ein. Wer
eingeladen ist, kann sich auch auf einer geschlossenen Instanz registrieren –
über den Link aus der Einladungsmail, mit genau der eingeladenen Adresse und
solange die Einladung gilt (sieben Tage). Die Registrierungsseite ist nur mit
diesem Link erreichbar; ohne ihn bleibt alles wie oben. Wer auf einer
geschlossenen Instanz niemanden von außen hereinlassen will, begrenzt die
Adressen mit der Domain-Liste: Sie gilt schon beim Einladen.

**Domain-Liste.** Zum Beispiel für einen Träger, dessen Kitas Adressen unter
einer gemeinsamen Domain haben:

```sh
SIGNUP_EMAIL_DOMAINS=kita-verbund.de, *.kita-verbund.de
```

- Ein Eintrag ist eine Domain oder `*.` vor einer Domain. `*.kita-verbund.de`
  erfasst alle Subdomains (`nord.kita-verbund.de`, auch tiefer), aber **nicht**
  `kita-verbund.de` selbst – wer beides will, nennt beides.
- Verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung;
  Umlaut-Domains gelten in jeder Schreibweise (`müller.de` ist
  `xn--mller-kva.de`).
- Die Liste gilt für neue Konten **und** für die neue Adresse bei „E-Mail-Adresse
  ändern“, unabhängig von `SIGNUP_MODE`. Bestehende Konten mit einer anderen
  Domain bleiben unberührt und können sich weiter anmelden.
- Sie gilt auch für Einladungen zu einer Kita, und zwar schon beim Einladen:
  Eine Adresse außerhalb der Liste bekommt keine Mail, und wer einlädt, liest
  „Auf dieser Instanz sind nur E-Mail-Adressen bestimmter Domains zugelassen;
  diese Adresse gehört nicht dazu.“ Das betrifft auch Adressen, die schon ein
  Konto haben.
- Wer eine andere Adresse eingibt, liest im Formular: „E-Mail-Adressen dieser
  Domain sind auf dieser Instanz nicht zugelassen. Bitte verwenden Sie eine
  Adresse Ihrer Einrichtung.“ Die Antwort hängt allein von der Domain ab, nie
  davon, ob es zu der Adresse schon ein Konto gibt.

Beim Start steht die Einstellung im Log, zum Beispiel
`[auth] Registrierung geschlossen, E-Mail-Domains: kita-verbund.de, *.kita-verbund.de`.

**Konto per Skript anlegen.** Für eine geschlossene Registrierung – oder für
das erste Konto, bevor SMTP eingerichtet ist – bringt das App-Image ein
Verwaltungsskript mit. Es spricht direkt mit der Datenbank und legt ein Konto
an, dessen Adresse schon als bestätigt gilt und das sich sofort anmelden kann:

```sh
docker compose exec app node dist/admin.mjs create-user \
  --email leitung@kita-verbund.de --name "Anna Beispiel"
```

Das Skript fragt das Passwort zweimal verdeckt ab. Ohne Terminal (`-T`) liest
es das Passwort von der Standardeingabe, etwa aus einer Datei oder aus einem
Passwortmanager:

```sh
docker compose exec -T app node dist/admin.mjs create-user \
  --email leitung@kita-verbund.de --name "Anna Beispiel" < passwort.txt
```

Ein Argument für das Passwort gibt es bewusst nicht: Argumente stehen in der
Prozessliste und in der Shell-History. `--password` lehnt das Skript ab, und
es gibt das Passwort nirgends aus; gespeichert wird wie bei der Registrierung
nur der Hash von Better Auth.

Es gelten dieselben Regeln wie bei der Registrierung: ein Passwort mit 12 bis
128 Zeichen, ein Name mit höchstens 80 Zeichen ohne Links – und die
Domain-Liste. Soll ein einzelnes Konto bewusst außerhalb der Liste liegen, die
Variable für diesen einen Aufruf leeren:

```sh
docker compose exec -e SIGNUP_EMAIL_DOMAINS= app node dist/admin.mjs create-user …
```

Nach der ersten Anmeldung legt die Person unter `/admin/organizations/new`
ihre Kita an. Hat jemand anderes das Passwort gesetzt, sollte sie es in den
Kontoeinstellungen gleich ändern. Ohne Befehl aufgerufen zeigt das Skript,
was es kann; es endet mit 0 bei Erfolg, mit 1 bei einem Fehler (der Grund
steht als `[admin]`-Zeile da) und mit 2 bei einem falschen Aufruf. `remove-note`
nimmt einen Zettel nach einem Hinweis auf rechtswidrige Inhalte ab
([Rechtswidrige Inhalte](./rechtswidrige-inhalte.md)); die übrigen Befehle
gehören zum gehosteten Modus.

## Gehosteter Modus

`HOSTED=true` ist der Modus, in dem das Projekt Kibo selbst als gehosteten
Dienst betreibt (Abo, Vertragsunterlagen, Dokumentation unter `/docs`). Er ist
nicht für den Selbstbetrieb gedacht und hier nicht weiter beschrieben. Auf
einer eigenen Instanz bleibt `HOSTED` aus: Es gibt dann kein Abo und keine
Fristen, und `/docs`, `/agb`, `/avv` und `/admin/abo` antworten mit 404 wie
jede andere unbekannte Adresse. `HOSTED` kennt nur `true` und `false`, genau
so geschrieben; ein anderer Wert lässt die App nicht starten
([Startprüfung](./einrichtung.md#startprüfung)).

## Hilfe-Link

| Variable   | Bedeutung                                       | Vorgabe                  |
| ---------- | ----------------------------------------------- | ------------------------ |
| `DOCS_URL` | Adresse, auf die „Hilfe“ im Admin-Bereich zeigt | Dokumentation auf GitHub |

Der Link „Hilfe“ in der Seitenleiste des Admin-Bereichs führt auf `DOCS_URL` –
ohne Angabe auf die Dokumentation im Repository
(`https://github.com/florivdg/kibo/tree/main/docs`). Wer für seine Kitas eine
eigene Anleitung pflegt, trägt deren Adresse ein, mit `http://` oder
`https://`. Der Link öffnet ein neues Fenster. Ein `DOCS_URL`, das keine
Adresse ist, lässt die App nicht starten. Beim Start steht die Einstellung im
Log, zum Beispiel
`[server] Modus: selbst gehostet – Dokumentation: https://github.com/florivdg/kibo/tree/main/docs`.

## Quelltext-Link (AGPL)

| Variable     | Bedeutung                                             | Vorgabe                            |
| ------------ | ----------------------------------------------------- | ---------------------------------- |
| `SOURCE_URL` | Adresse, auf die „Quelltext“ am Fuß jeder Seite zeigt | `https://github.com/florivdg/kibo` |

Kibo steht unter der GNU Affero General Public License (`AGPL-3.0-only`).
Deshalb zeigt jede Instanz auf ihren Quelltext: Am Fuß jeder Seite – auf den
Brettern, der Startseite, den Anmeldeseiten, im Admin-Bereich und in der
Dokumentation – steht neben Impressum und Datenschutz der Link „Quelltext“,
dahinter die Version, die läuft (zum Beispiel `v1.2.1`).

Wer Kibo unverändert aus den veröffentlichten Images betreibt, muss nichts
tun: Der Link führt auf das Repository. Wer eine **geänderte Fassung** als
Dienst im Netz betreibt, muss deren Nutzerinnen und Nutzern nach § 13 der
AGPL den Quelltext genau dieser Fassung anbieten – und trägt dafür die Adresse
ein, unter der er liegt:

```sh
SOURCE_URL=https://git.kita-verbund.de/it/kibo
```

Die Adresse braucht `http://` oder `https://`; alles andere lässt die App
nicht starten ([Startprüfung](./einrichtung.md#startprüfung)). Die Version
hinter dem Link kommt aus dem Build (`package.json`) und lässt sich nicht
konfigurieren; wer eine eigene Fassung baut, sieht dort die Version, von der
sie abstammt. Die Variable ändert nur das Ziel im Fuß der Seiten – der Abschnitt
„Open Source“ auf der Startseite der gehosteten Instanz verweist immer auf das
Repository des Projekts.
