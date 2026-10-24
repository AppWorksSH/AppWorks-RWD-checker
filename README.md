# RWD Checker

Aplikacja na macOS (Apple Silicon) do automatycznego sprawdzania responsywności stron. Podajesz adres — aplikacja sama znajduje podstrony, sprawdza je w wielu rozdzielczościach i przeglądarkach, a potem tworzy raport po polsku ze zrzutami ekranu i zaznaczonymi błędami.

## Instalacja (gotowa aplikacja)

1. Otwórz `release/RWD Checker-1.0.0-arm64.dmg` i przeciągnij aplikację do folderu Aplikacje.
2. Aplikacja nie jest podpisana certyfikatem Apple, więc przy pierwszym uruchomieniu macOS ją zablokuje. Wykonaj raz w Terminalu:
   ```bash
   xattr -cr "/Applications/RWD Checker.app"
   ```
3. W aplikacji wejdź w **Ustawienia → Przeglądarki testowe → Zainstaluj przeglądarki** (jednorazowo ok. 400 MB; Chromium, WebKit/Safari, Firefox).
4. Opcjonalnie dodaj klucz API (Anthropic lub OpenAI) w **Ustawienia → Analiza AI**. Klucz jest szyfrowany w pęku kluczy macOS.

## Co sprawdza

| Obszar | Testy |
| --- | --- |
| Układ | przewijanie poziome (z elementem-winowajcą), treści ucięte przez `overflow: hidden`, elementy wychodzące poza rodzica, nakładające się i ucięte teksty |
| Zakresy szerokości | każda szerokość od 320 do 1920 px co 10/20 px — wykrywa błędy widoczne tylko np. między 700 a 760 px |
| Mobile | meta viewport, blokada powiększania, mały tekst, małe cele dotykowe (WCAG 2.5.8), zoom pól formularzy na iOS, test menu „hamburger” |
| Elementy stałe | paski i banery (w tym cookies) zasłaniające ekran |
| Obrazy | zniekształcone proporcje, zbyt duże pliki względem wyświetlanego rozmiaru |
| Technika | błędy HTTP, błędy JavaScript, brakujące zasoby, przesunięcia układu (CLS), niedziałające linki |
| Dostępność | axe-core (WCAG) z polskimi komunikatami |
| AI (opcjonalnie) | model ogląda zrzuty i wskazuje problemy wizualne, których nie wychwycą reguły, oraz pisze podsumowanie |

Domyślne rozdzielczości: 3 telefony, 3 tablety, 3 desktopy (lista do edycji w Ustawieniach). Przeglądarki: Chrome, Safari (WebKit) i Firefox.

## Korzystanie

- **Nowy skan** — adres + profil:
  - *Szybki* — 3 rozdzielczości, kilka minut;
  - *Standardowy* — 9 rozdzielczości, Chrome + Safari, zakresy co 20 px, dostępność, linki;
  - *Pełny* — wszystkie przeglądarki, zakresy co 10 px, linki zewnętrzne, AI.

  W „Ustawieniach zaawansowanych” są: limit podstron, wykluczenia adresów, ignorowane elementy (np. widżet czatu), Basic Auth dla serwerów testowych i inne opcje.
- **Skany** — postęp, dziennik, przerwanie. Przerwany skan można wznowić z historii.
- **Historia** — raporty, eksport do PDF lub jednego pliku HTML (do wysłania klientowi), porównanie z poprzednim skanem tej samej witryny (nowe i naprawione problemy).
- **Raport** — wynik 0–100, problemy pogrupowane (ten sam błąd na wielu podstronach = jedna karta), filtry, podgląd pełnego zrzutu z zaznaczeniami, zakresy szerokości, dostępność, linki. Przyciski „Ignoruj…” zapamiętują wyjątki dla danej witryny.
- **Harmonogram** — cykliczne skany (codziennie/co tydzień) z powiadomieniem o wyniku. Działają, gdy aplikacja jest uruchomiona (opcja „Uruchamiaj przy logowaniu”).

## Wiersz poleceń (CI)

```bash
node dist/cli.js scan https://example.com --profile standard --pdf --fail-on high
node dist/cli.js browsers          # instalacja przeglądarek
node dist/cli.js --help            # wszystkie opcje
```

Kod wyjścia `1` przy `--fail-on`, gdy są problemy o tej wadze lub wyższej; `3` gdy skan się nie powiódł. AI w CLI: zmienne `ANTHROPIC_API_KEY` lub `OPENAI_API_KEY` + flaga `--ai`.

## Rozwój

Wymagany Node 22 (`nvm use 22`).

```bash
npm install
npm run browsers      # przeglądarki Playwright
npm start             # build + uruchomienie aplikacji
npm run dev           # przebudowa przy zmianach (w drugim terminalu: npm run app)
npm test              # testy jednostkowe
npm run test:e2e      # pełny skan strony testowej z celowymi błędami
npm run fixtures      # strona testowa na http://127.0.0.1:4321
npm run test:app      # test dymny interfejsu (wymaga uruchomionej strony testowej)
npm run typecheck
npm run dist          # pakowanie .dmg/.zip do release/
```

Struktura:

- `src/core` — silnik: crawler, detektory, skan zakresów, AI, grupowanie, raport (HTML/PDF);
- `src/electron` — proces główny, worker skanu (osobny proces), preload, ustawienia;
- `src/renderer` — interfejs (React);
- `src/cli` — wiersz poleceń;
- `test/fixtures/site` — strona testowa z celowymi błędami RWD.

Dane aplikacji: `~/Library/Application Support/RWD Checker/` (`settings.json`, katalog `scans/` z raportami).
