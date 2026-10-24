import type { RuleCategory, Severity } from './types';

export interface RuleMeta {
  title: string;
  category: RuleCategory;
  description: string;
  fix: string;
}

export const RULES: Record<string, RuleMeta> = {
  'horizontal-overflow': {
    title: 'Poziome przewijanie strony',
    category: 'rwd',
    description: 'Element jest szerszy niż ekran i powoduje, że całą stronę da się przewijać w poziomie. Na telefonie użytkownik widzi „pływający” layout i puste pasy.',
    fix: 'Ustaw max-width: 100%, użyj elastycznych jednostek (%, fr, minmax), dodaj flex-wrap lub owiń szeroką treść (tabele, kod) w kontener z overflow-x: auto.',
  },
  'content-cut-off': {
    title: 'Treść ucięta przy krawędzi ekranu',
    category: 'rwd',
    description: 'Element częściowo wystaje poza ekran, ale przewijanie jest zablokowane (overflow-x: hidden na html/body lub element przyklejony). Część treści jest niewidoczna i nieosiągalna.',
    fix: 'Popraw szerokość elementu zamiast ukrywać przepełnienie. overflow-x: hidden na body maskuje błąd, ale go nie usuwa.',
  },
  'sweep-overflow': {
    title: 'Przewijanie poziome w zakresie szerokości',
    category: 'rwd',
    description: 'Podczas zmiany szerokości okna co kilka pikseli strona zaczyna przewijać się poziomo w określonym zakresie. Takie błędy zwykle leżą między punktami przełamania (breakpointami).',
    fix: 'Sprawdź media queries dla podanego zakresu szerokości i element wskazany jako przyczyna. Często pomaga min-width: 0 dla dzieci flex/grid lub zmiana sztywnych szerokości na max-width.',
  },
  'viewport-meta-missing': {
    title: 'Brak meta viewport',
    category: 'rwd',
    description: 'Strona nie ma znacznika <meta name="viewport">. Telefony renderują ją jak desktop (ok. 980 px) i pomniejszają — tekst jest mikroskopijny.',
    fix: 'Dodaj w <head>: <meta name="viewport" content="width=device-width, initial-scale=1">.',
  },
  'viewport-meta-invalid': {
    title: 'Nieprawidłowy meta viewport',
    category: 'rwd',
    description: 'Meta viewport nie używa width=device-width, więc strona nie dopasowuje się do szerokości urządzenia.',
    fix: 'Użyj: <meta name="viewport" content="width=device-width, initial-scale=1">.',
  },
  'viewport-zoom-disabled': {
    title: 'Zablokowane powiększanie strony',
    category: 'a11y',
    description: 'Meta viewport blokuje powiększanie (user-scalable=no lub maximum-scale < 2). Osoby słabowidzące nie mogą przybliżyć treści (WCAG 1.4.4).',
    fix: 'Usuń user-scalable=no oraz maximum-scale z meta viewport.',
  },
  'small-text': {
    title: 'Za mały tekst na urządzeniu mobilnym',
    category: 'rwd',
    description: 'Tekst ma rozmiar poniżej 12 px, co na telefonie jest trudne do przeczytania.',
    fix: 'Na urządzeniach mobilnych stosuj min. 14–16 px dla tekstu głównego i min. 12 px dla tekstów pomocniczych.',
  },
  'input-zoom-ios': {
    title: 'Pole formularza powoduje zoom na iPhonie',
    category: 'rwd',
    description: 'Pole formularza ma czcionkę mniejszą niż 16 px. Safari na iOS automatycznie powiększa stronę po kliknięciu w takie pole, co rozjeżdża widok.',
    fix: 'Ustaw font-size: 16px (lub 1rem) dla input, select i textarea na urządzeniach mobilnych.',
  },
  'tap-target-size': {
    title: 'Za mały element klikalny',
    category: 'rwd',
    description: 'Link lub przycisk jest mniejszy niż 24×24 px i leży zbyt blisko innego elementu klikalnego (WCAG 2.2, kryterium 2.5.8). Łatwo w niego nie trafić palcem.',
    fix: 'Zwiększ obszar klikalny do min. 24×24 px (zalecane 44×44 px), np. przez padding, lub zwiększ odstępy między elementami.',
  },
  'text-clipped': {
    title: 'Ucięty tekst',
    category: 'rwd',
    description: 'Tekst nie mieści się w swoim elemencie i jest ucinany (overflow: hidden) bez wielokropka.',
    fix: 'Pozwól elementowi rosnąć (usuń sztywną wysokość/szerokość), dodaj zawijanie (overflow-wrap: anywhere) lub świadomie użyj text-overflow: ellipsis.',
  },
  'text-overflow': {
    title: 'Tekst wychodzi poza element',
    category: 'rwd',
    description: 'Tekst (np. długie słowo, adres e-mail, URL) wystaje poza ramy swojego elementu.',
    fix: 'Dodaj overflow-wrap: anywhere lub word-break: break-word, ewentualnie hyphens: auto.',
  },
  'outside-parent': {
    title: 'Element wystaje poza kontener',
    category: 'rwd',
    description: 'Element jest szerszy niż jego rodzic i wystaje poza jego krawędź. Często objaw sztywnej szerokości lub braku min-width: 0 w układzie flex/grid.',
    fix: 'Użyj max-width: 100%, box-sizing: border-box, a w flex/grid ustaw min-width: 0 dla elementów potomnych.',
  },
  'text-overlap': {
    title: 'Nachodzący na siebie tekst',
    category: 'rwd',
    description: 'Teksty dwóch elementów nakładają się na siebie, przez co są nieczytelne.',
    fix: 'Sprawdź pozycjonowanie absolutne, ujemne marginesy i sztywne wysokości w tym widoku.',
  },
  'image-distorted': {
    title: 'Zniekształcony obraz',
    category: 'rwd',
    description: 'Obraz wyświetlany jest w innych proporcjach niż oryginał (jest rozciągnięty lub ściśnięty).',
    fix: 'Ustaw height: auto przy zmianie szerokości albo użyj object-fit: cover / contain.',
  },
  'image-oversized': {
    title: 'Za duży plik obrazu',
    category: 'tech',
    description: 'Obraz ma dużo większą rozdzielczość niż potrzebna w tym widoku. Spowalnia ładowanie na telefonach.',
    fix: 'Dodaj srcset i sizes, aby przeglądarka pobierała mniejsze warianty, lub zmniejsz obraz.',
  },
  'fixed-coverage': {
    title: 'Przyklejone elementy zasłaniają ekran',
    category: 'rwd',
    description: 'Elementy z position: fixed/sticky (nagłówek, pasek, widget) zajmują dużą część ekranu podczas przewijania.',
    fix: 'Zmniejsz wysokość przyklejonego nagłówka na mobile, ukrywaj go przy przewijaniu w dół lub nie przyklejaj na małych ekranach.',
  },
  'consent-coverage': {
    title: 'Baner cookies zasłania większość ekranu',
    category: 'rwd',
    description: 'Baner zgody na cookies zajmuje bardzo dużą część ekranu przy pierwszym wejściu.',
    fix: 'Zmniejsz baner na urządzeniach mobilnych (krótszy tekst, przyciski w jednym rzędzie).',
  },
  'mobile-menu-missing': {
    title: 'Brak przycisku menu na mobile',
    category: 'rwd',
    description: 'Nawigacja jest ukryta w tym widoku, a nie znaleziono widocznego przycisku, który by ją otwierał.',
    fix: 'Dodaj widoczny przycisk menu (hamburger) z aria-expanded i aria-controls.',
  },
  'mobile-menu-broken': {
    title: 'Menu mobilne się nie otwiera',
    category: 'rwd',
    description: 'Po kliknięciu przycisku menu nie pojawiły się żadne nowe widoczne linki nawigacji.',
    fix: 'Sprawdź skrypt otwierający menu (błędy JS w konsoli) oraz style aktywnego stanu menu.',
  },
  'mobile-menu-overflow': {
    title: 'Otwarte menu mobilne wychodzi poza ekran',
    category: 'rwd',
    description: 'Po otwarciu menu część jego elementów wystaje poza ekran.',
    fix: 'Ogranicz szerokość panelu menu do 100vw i pozwól na przewijanie w pionie (overflow-y: auto, max-height: 100dvh).',
  },
  'layout-shift': {
    title: 'Przesunięcia układu podczas ładowania (CLS)',
    category: 'tech',
    description: 'Elementy strony przeskakują podczas ładowania. Wskaźnik Cumulative Layout Shift przekracza zalecaną wartość 0,1.',
    fix: 'Nadaj obrazom i osadzeniom wymiary (width/height lub aspect-ratio), rezerwuj miejsce na banery i używaj font-display: optional/swap z dopasowanymi fontami.',
  },
  'http-error': {
    title: 'Podstrona zwraca błąd HTTP',
    category: 'tech',
    description: 'Serwer zwrócił kod błędu dla tej podstrony.',
    fix: 'Sprawdź routing i logi serwera.',
  },
  'load-error': {
    title: 'Nie udało się wczytać podstrony',
    category: 'tech',
    description: 'Podstrona nie wczytała się w wyznaczonym czasie lub przeglądarka zgłosiła błąd.',
    fix: 'Sprawdź wydajność strony i dostępność serwera. Możesz zwiększyć limit czasu w ustawieniach skanu.',
  },
  'page-error': {
    title: 'Błąd JavaScript',
    category: 'tech',
    description: 'Na stronie wystąpił nieobsłużony wyjątek JavaScript. Może psuć interaktywne elementy (menu, slidery, formularze).',
    fix: 'Sprawdź konsolę przeglądarki i popraw wskazany błąd.',
  },
  'console-error': {
    title: 'Błąd w konsoli',
    category: 'tech',
    description: 'Strona zapisała błąd w konsoli przeglądarki.',
    fix: 'Sprawdź komunikat i jego źródło.',
  },
  'failed-resource': {
    title: 'Nie wczytał się zasób',
    category: 'tech',
    description: 'Obraz, styl, skrypt lub font zwrócił błąd lub nie wczytał się.',
    fix: 'Popraw ścieżkę zasobu lub usuń odwołanie.',
  },
  'broken-link': {
    title: 'Niedziałający link',
    category: 'tech',
    description: 'Link prowadzi do adresu, który zwraca błąd.',
    fix: 'Popraw adres linku lub dodaj przekierowanie.',
  },
  'ai-visual': {
    title: 'Problem wizualny (analiza AI)',
    category: 'ai',
    description: 'Problem znaleziony przez model AI na zrzucie ekranu. To ocena wizualna — warto ją zweryfikować ręcznie.',
    fix: 'Zobacz opis problemu i zrzut ekranu.',
  },
};

export function ruleMeta(ruleId: string): RuleMeta {
  if (RULES[ruleId]) return RULES[ruleId];
  if (ruleId.startsWith('axe:')) {
    return {
      title: `Dostępność: ${ruleId.slice(4)}`,
      category: 'a11y',
      description: 'Problem dostępności wykryty przez axe-core.',
      fix: 'Zobacz opis reguły w dokumentacji axe.',
    };
  }
  return { title: ruleId, category: 'rwd', description: '', fix: '' };
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Krytyczny',
  high: 'Wysoki',
  medium: 'Średni',
  low: 'Niski',
  info: 'Informacja',
};

export const CATEGORY_LABELS_RULE: Record<RuleCategory, string> = {
  rwd: 'RWD',
  a11y: 'Dostępność',
  tech: 'Techniczne',
  ai: 'AI',
};

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) <= severityRank(b) ? a : b;
}
