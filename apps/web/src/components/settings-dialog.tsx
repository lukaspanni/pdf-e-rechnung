import { useState } from 'react'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import type { ExtractionSettings } from '@/lib/extraction-settings'
import { validateInvoiceNumberPatterns } from '@/lib/extraction-settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type SettingsDialogProps = {
  settings: ExtractionSettings
  onSave: (settings: ExtractionSettings) => void
}

export function SettingsDialog({ settings, onSave }: SettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [patterns, setPatterns] = useState(settings.invoiceNumberPatterns)
  const errors = validateInvoiceNumberPatterns(patterns)
  const canSave = errors.every((error) => error === null)

  function save() {
    if (!canSave) return
    onSave({
      invoiceNumberPatterns: patterns
        .map((pattern) => pattern.trim())
        .filter(Boolean),
    })
    setOpen(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setPatterns(settings.invoiceNumberPatterns)
    setOpen(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          id="settings-open"
          name="settings-open"
          type="button"
          variant="ghost"
          aria-label="Einstellungen öffnen"
        >
          <Settings2 aria-hidden="true" />
          Einstellungen
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby="settings-description">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription id="settings-description">
            Zusätzliche Regex-Muster für Rechnungsnummern. Der erste
            Regex-Treffer wird als Rechnungsnummer übernommen. Bei einer
            Erfassungsgruppe wird die erste Gruppe verwendet, sonst der gesamte
            Treffer.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="invoice-number-patterns-heading">
          <h3
            id="invoice-number-patterns-heading"
            className="mb-2 text-sm font-medium"
          >
            Rechnungsnummern-Muster
          </h3>
          <div className="grid gap-3">
            {patterns.map((pattern, index) => (
              <div className="grid gap-1" key={index}>
                <div className="flex items-start gap-2">
                  <label
                    className="sr-only"
                    htmlFor={`invoice-pattern-${index}`}
                  >
                    Regex-Muster {index + 1}
                  </label>
                  <Input
                    id={`invoice-pattern-${index}`}
                    name={`invoice-pattern-${index}`}
                    value={pattern}
                    aria-invalid={Boolean(errors[index])}
                    aria-describedby={
                      errors[index]
                        ? `invoice-pattern-error-${index}`
                        : undefined
                    }
                    placeholder="z. B. \bEW-\d{4}-\d+\b"
                    onChange={(event) =>
                      setPatterns((current) =>
                        current.map((value, valueIndex) =>
                          valueIndex === index ? event.target.value : value,
                        ),
                      )
                    }
                  />
                  <Button
                    id={`invoice-pattern-remove-${index}`}
                    name={`invoice-pattern-remove-${index}`}
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Muster ${index + 1} entfernen`}
                    onClick={() =>
                      setPatterns((current) =>
                        current.filter((_, valueIndex) => valueIndex !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {errors[index] && (
                  <p
                    id={`invoice-pattern-error-${index}`}
                    className="text-sm text-red-700"
                    role="alert"
                  >
                    {errors[index]}
                  </p>
                )}
              </div>
            ))}
            <Button
              id="invoice-pattern-add"
              name="invoice-pattern-add"
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => setPatterns((current) => [...current, ''])}
            >
              <Plus aria-hidden="true" />
              Muster hinzufügen
            </Button>
          </div>
        </section>

        <DialogFooter>
          <Button
            id="settings-cancel"
            name="settings-cancel"
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Abbrechen
          </Button>
          <Button
            id="settings-save"
            name="settings-save"
            type="button"
            onClick={save}
            disabled={!canSave}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
