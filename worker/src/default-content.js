export const DEFAULT_CONTENT = {
  company: {
    name: "Sredzka Korona",
    tagline: "Restauracja, hotel i przyjecia w oprawie premium",
    phone: "+48 600 700 800",
    email: "kontakt@sredzkakorona.pl",
    address: "ul. Wrocławska 11, 55-300 Środa Śląska",
    mapEmbed:
      "https://www.google.com/maps?q=%C5%9Aredzka%20Korona%2C%20Wroc%C5%82awska%2011%2C%2055-300%20%C5%9Aroda%20%C5%9Al%C4%85ska&output=embed",
    heroLabel: "Miejsce na spotkania, nocleg i celebracje",
    heroTitle: "Nowoczesna goscinnosc w luksusowym wydaniu",
    heroText:
      "Tworzymy przestrzen, w ktorej doswiadczenie restauracyjne, wypoczynek hotelowy i organizacja przyjec sa prowadzone z ta sama dbaloscia o detal.",
    openingHours: [
      "Poniedzialek - Czwartek: 12:00 - 22:00",
      "Piatek - Sobota: 12:00 - 24:00",
      "Niedziela: 12:00 - 21:00",
    ],
  },
  home: {
    aboutTitle: "O wlascicielu i zespole",
    aboutText:
      "Wlasciciel prowadzi obiekt z mysla o gosciach, ktorzy oczekuja klasy, spokoju i sprawnej obslugi. Zespol laczy doswiadczenie restauracyjne, hotelowe i eventowe, dzieki czemu kazdy etap wizyty jest dopracowany.",
    owner:
      "Wlasciciel odpowiada za standard obiektu, rozwoj oferty oraz kontakt z klientami biznesowymi i prywatnymi.",
    staff: [
      "Szef kuchni przygotowuje sezonowe menu i koordynuje obsluge wydarzen.",
      "Recepcja hotelowa nadzoruje pobyty, meldunki i komfort gosci.",
      "Opiekun przyjec prowadzi klienta od pierwszego zapytania do realizacji wydarzenia.",
    ],
    highlights: [
      {
        title: "Restauracja",
        text: "Karta laczaca klasyke kuchni polskiej z nowoczesnym podaniem i starannie dobranym winem.",
      },
      {
        title: "Hotel",
        text: "Komfortowe pokoje dla gosci indywidualnych, rodzin i uczestnikow wydarzen.",
      },
      {
        title: "Przyjecia",
        text: "Sale na wesela, komunie, jubileusze, spotkania firmowe i kameralne kolacje.",
      },
    ],
    testimonials: [
      {
        author: "Alicja i Michal",
        text: "Przyjecie rodzinne bylo dopiete od pierwszej rozmowy po final wieczoru. Obsluga reagowala zanim zdazylismy o cos poprosic.",
      },
      {
        author: "Firma Deltapro",
        text: "Sala biznesowa, noclegi i kolacja dla gosci zostaly przygotowane profesjonalnie i bez chaosu organizacyjnego.",
      },
    ],
    /** true = podstrona niedostepna z glownej i przez bezposredni URL (przekierowanie na strone glowna) */
    sectionBlocks: {
      hotel: false,
      restaurant: false,
      events: false,
    },
  },
  restaurant: {
    heroTitle: "Autorska kuchnia i atmosfera wieczoru premium",
    heroText:
      "Restauracja Sredzka Korona laczy elegancje sali, staranna obsluge i kuchnie, ktora dobrze sprawdza sie zarowno podczas codziennych kolacji, jak i okazji specjalnych.",
    menuSections: [
      {
        title: "Przystawki",
        items: [
          "Tatar wolowy z piklami i majonezem truflowym",
          "Krewetki z maslem czosnkowym i pieczywem rzemieslniczym",
          "Carpaccio z buraka z kozim serem i orzechami",
        ],
      },
      {
        title: "Dania glowne",
        items: [
          "Policzki wolowe z puree ziemniaczanym i demi-glace",
          "Sandacz na risotto cytrynowym z warzywami sezonowymi",
          "Makaron tagliatelle z borowikami i parmezanem",
        ],
      },
      {
        title: "Desery",
        items: [
          "Fondant czekoladowy z lodami waniliowymi",
          "Sernik baskijski z owocami sezonowymi",
          "Beza z kremem mascarpone i malinami",
        ],
      },
    ],
    extras: [
      "Degustacyjne kolacje okolicznosciowe",
      "Karta win i alkoholi premium",
      "Menu dla grup i przyjec zamknietych",
    ],
  },
  hotel: {
    heroTitle: "Pokoje przygotowane na komfortowy pobyt",
    heroText:
      "Hotel zostal zaprojektowany z mysla o gosciach szukajacych spokojnego noclegu po kolacji, wydarzeniu lub spotkaniu biznesowym.",
    rooms: [
      {
        name: "Pokoj Standard",
        size: "18 m2",
        guests: "1-2 osoby",
        features: ["Lozko queen size", "Prywatna lazienka", "Sniadanie"],
      },
      {
        name: "Pokoj Deluxe",
        size: "26 m2",
        guests: "2 osoby",
        features: ["Strefa wypoczynku", "Ekspres do kawy", "Widok na patio"],
      },
      {
        name: "Apartament",
        size: "38 m2",
        guests: "2-4 osoby",
        features: ["Salon", "Dwie strefy noclegowe", "Priorytetowy check-in"],
      },
    ],
    amenities: [
      "Parking dla gosci",
      "Wi-Fi w calym obiekcie",
      "Mozliwosc pobytu po wydarzeniu lub weselu",
    ],
    roomGalleries: {
      "1-osobowe": [],
      "2-osobowe": [],
      "3-osobowe": [],
      "4-osobowe": [],
    },
  },
  events: {
    heroTitle: "Sale na przyjecia, spotkania i uroczystosci",
    heroText:
      "Prowadzimy wydarzenia rodzinne i firmowe od kameralnych spotkan po duze przyjecia z pelna oprawa gastronomiczna.",
    halls: [
      {
        key: "krolewska",
        name: "Sala Krolewska",
        capacity: "do 160 osob",
        description: "Najwieksza sala na wesela, gale i duze wydarzenia.",
      },
      {
        key: "zlota",
        name: "Sala Zlota",
        capacity: "do 90 osob",
        description: "Elegancka przestrzen na komunie, chrzciny i jubileusze.",
      },
      {
        key: "kominkowa",
        name: "Sala Kominkowa",
        capacity: "do 40 osob",
        description: "Kameralne przyjecia i kolacje rodzinne.",
      },
      {
        key: "biznesowa",
        name: "Sala Biznesowa",
        capacity: "do 28 osob",
        description: "Szkolenia, warsztaty i spotkania zarzadowe.",
      },
      {
        key: "ogrodowa",
        name: "Strefa Ogrodowa",
        capacity: "do 120 osob",
        description: "Eventy letnie i przyjecia z otwarciem na zewnatrz.",
      },
    ],
    hallGalleries: {
      "1": [],
      "2": [],
      "3": [],
      "4": [],
      "5": [],
    },
    packages: [
      "Kompleksowa obsluga wesel i przyjec rodzinnych",
      "Konferencje i lunche biznesowe",
      "Bufety, candy bary i dekoracje na zamowienie",
    ],
    menu: [
      {
        section: "Przystawki",
        items: [
          {
            name: "Tatar wolowy z piklami",
            description: "",
            ingredients: [],
          },
          {
            name: "Krewetki z maslem czosnkowym",
            description: "",
            ingredients: [],
          },
        ],
      },
      {
        section: "Dania glowne",
        items: [
          {
            name: "Policzki wolowe z puree",
            description: "",
            ingredients: [],
          },
          {
            name: "Sandacz na risotto cytrynowym",
            description: "",
            ingredients: [],
          },
        ],
      },
    ],
    ofertaModalBodyHtml: `<p>Organizujemy różnorodne przyjęcia okolicznościowe, dostosowane do Twoich potrzeb i oczekiwań. Oferujemy kompleksową obsługę następujących wydarzeń:</p>
<ul>
  <li><strong>Chrzty</strong> - uroczyste przyjęcia chrzcielne w eleganckiej oprawie</li>
  <li><strong>Komunie</strong> - wyjątkowe przyjęcia komunijne dla dzieci i rodzin</li>
  <li><strong>Śluby</strong> - niezapomniane wesela z pełną obsługą</li>
  <li><strong>Urodziny</strong> - urodzinowe przyjęcia dla każdego wieku</li>
  <li><strong>Imieniny</strong> - kameralne spotkania z okazji imienin</li>
  <li><strong>Andrzejki</strong> - wieczory andrzejkowe z tradycyjnymi wróżbami</li>
  <li><strong>Nowy Rok</strong> - sylwestrowe bale i przyjęcia noworoczne</li>
  <li><strong>Jubileusze</strong> - uroczyste obchody rocznic</li>
  <li><strong>Wydarzenia firmowe</strong> - spotkania biznesowe, konferencje i integracje</li>
  <li><strong>Inne okazje</strong> - jesteśmy otwarci na każde wyjątkowe wydarzenie</li>
</ul>
<p>Każde przyjęcie przygotowujemy indywidualnie, dbając o każdy szczegół, aby Twój dzień był wyjątkowy i niezapomniany.</p>
<p style="margin-top: 1.5rem;"><strong>Koszt organizacji przyjęcia</strong></p>
<p>Koszt organizacji przyjęcia zależy od składu menu (dania wybierane z karty), liczby gości i dodatkowych usług.</p>
<p><strong>Wycenę ustalamy indywidualnie</strong>.</p>
<p>W typowej ofercie podstawowej zapewniamy m.in.:</p>
<ul>
  <li>Wynajem sali</li>
  <li>Podstawowe menu (do wyboru z naszej karty)</li>
  <li>Obsługę kelnerską</li>
  <li>Podstawowe nakrycie stołów</li>
</ul>
<p>Dodatkowo oferujemy:</p>
<ul>
  <li>Rozszerzone menu premium</li>
  <li>Dekoracje sali</li>
  <li>Obsługę barmańską</li>
  <li>Dodatkowe atrakcje (DJ, zespół muzyczny, fotograf)</li>
  <li>Noclegi dla gości</li>
</ul>
<p>Zapraszamy do kontaktu w celu omówienia szczegółów i przygotowania indywidualnej wyceny dla Twojego wydarzenia.</p>`,
  },
  /** Rezerwacje online: false = komunikat „wstrzymane” zamiast formularza */
  booking: {
    restaurant: true,
    hotel: true,
    events: true,
    restaurantPauseFrom: "",
    restaurantPauseTo: "",
    hotelPauseFrom: "",
    hotelPauseTo: "",
    eventsPauseFrom: "",
    eventsPauseTo: "",
  },
  services: [
    {
      title: "Florystyka Krolewska",
      description: "Kompozycje kwiatowe i dekoracje sal dopasowane do charakteru wydarzenia.",
      contact: "florystyka@example.com",
      link: "https://example.com",
    },
    {
      title: "Atelier Swiatla",
      description: "Oprawa swietlna, napis LOVE, podswietlenie stolow i sceny.",
      contact: "+48 500 111 222",
      link: "https://example.com",
    },
    {
      title: "Kadry Chwili",
      description: "Fotografia i reportaz z przyjec, wesel oraz wydarzen firmowych.",
      contact: "kadry@example.com",
      link: "https://example.com",
    },
  ],
  gallery: {
    intro:
      "Kazdy album ma zdjecie glowne. Po kliknieciu otwiera sie pelna biblioteka zdjec z danego wydarzenia.",
  },
  documentsMenu: {
    title: "Menu okolicznosciowe",
    intro: "Przykladowa propozycja dla imprez rodzinnych, spotkan firmowych i przyjec zamknietych.",
    sections: [
      {
        title: "Przystawki",
        items: [
          "Tatar wolowy z ogorkiem kiszonym i pieczywem",
          "Carpaccio z buraka z kozim serem i orzechami",
          "Deska regionalnych wedlin i serow",
        ],
      },
      {
        title: "Dania glowne",
        items: [
          "Rolada z indyka w sosie tymiankowym",
          "Schab pieczony z sosem pieczeniowym",
          "Sandacz na puree ziemniaczanym i warzywach sezonowych",
        ],
      },
      {
        title: "Dodatki",
        items: [
          "Ziemniaki opiekane z ziolami",
          "Kluski slaskie",
          "Bukiet salat z winegretem",
        ],
      },
      {
        title: "Desery",
        items: [
          "Sernik z biala czekolada",
          "Szarlotka na cieplo",
          "Mini beza z kremem mascarpone",
        ],
      },
    ],
  },
  contact: {
    intro:
      "Napisz do nas w sprawie rezerwacji stolika, noclegu, przyjecia lub wspolpracy biznesowej.",
    fieldsNote:
      "Odpowiadamy na zapytania najszybciej jak to mozliwe. W przypadku wydarzen prosimy o podanie orientacyjnego terminu.",
  },
  cookies: {
    updatedAt: "2026-03-05",
    text:
      "Strona korzysta z plikow cookies niezbednych do dzialania oraz opcjonalnych cookies analitycznych i marketingowych. Zgode mozna zmienic w dowolnym momencie.",
  },
};
