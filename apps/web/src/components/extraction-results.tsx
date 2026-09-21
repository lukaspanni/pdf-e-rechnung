import type { InvoiceExtractionCandidates } from '@app/invoice-extraction'

export function ExtractionResults({
  candidates,
}: {
  candidates: InvoiceExtractionCandidates | null
}) {
  if (!candidates) {
    return <p className="p-4 text-sm text-stone-600">PDF-Text wird gelesen …</p>
  }

  const groups = [
    ['IBAN', candidates.ibans.map((candidate) => candidate.value)],
    ['Umsatzsteuer-IDs', candidates.vatIds.map((candidate) => candidate.value)],
    ['Daten', candidates.dates.map((candidate) => candidate.value)],
    [
      'Amounts',
      candidates.amounts.map(({ value }) =>
        value.currency
          ? new Intl.NumberFormat('de-DE', {
              style: 'currency',
              currency: value.currency,
            }).format(value.minor / 100)
          : (value.minor / 100).toFixed(2),
      ),
    ],
    [
      'Umsatzsteuersätze',
      candidates.taxRates.map((candidate) => `${candidate.value}%`),
    ],
    ['Währungen', candidates.currencies.map((candidate) => candidate.value)],
  ] as const

  return (
    <section aria-label="Erkennungsdetails" className="bg-white">
      <div className="border-b border-stone-300 px-4 py-3">
        <h2 className="text-sm font-semibold">Erkennungsdetails</h2>
      </div>
      <div className="divide-y divide-stone-200">
        {groups.map(([title, values]) => (
          <div key={title} className="px-4 py-3">
            <h3 className="text-sm font-medium">{title}</h3>
            {values.length ? (
              <ul className="mt-1 space-y-1 text-sm text-stone-700">
                {values.map((value, index) => (
                  <li key={`${value}-${index}`}>{value}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-stone-500">Nichts erkannt</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
