#import "@preview/classy-german-invoice:0.3.2": invoice

#show: invoice(
  "RE-2026-0042",
  datetime(year: 2026, month: 9, day: 28),
  (
    (
      description: "IT-Beratung und Prozessanalyse – September 2026 (2 Stunden)",
      price: 250,
    ),
    (
      description: "Dokumentation und Handlungsempfehlungen",
      price: 50,
    ),
  ),
  (
    name: "Nordlicht Digitalberatung GmbH",
    street: "Kastanienallee 27",
    zip: "10435",
    city: "Berlin",
    tax_nr: "DE123456789",
  ),
  (
    name: "Hanseatischer Werkstattbedarf GmbH",
    street: "Am Sandtorkai 42",
    zip: "20457",
    city: "Hamburg",
  ),
  (
    name: "Nordlicht Digitalberatung GmbH",
    bank: "Berliner Sparkasse",
    iban: "DE89370400440532013000",
    bic: "COBADEFFXXX",
  ),
  vat: 0.19,
  kleinunternehmer: false,
)

#set text(size: 8pt, fill: rgb("#555555"))
#align(right)[USt-IdNr.: DE123456789 · Rechnungsdatum: 28.09.2026 · Rechnungsnummer: RE-2026-0042]
