import { Buffer } from 'node:buffer'
import {
  AmountType,
  CountryIDType,
  CreditorFinancialAccountType,
  CreditorFinancialInstitutionType,
  CrossIndustryInvoiceType,
  CurrencyCodeType,
  DateTimeType,
  DocumentCodeType,
  DocumentContextParameterType,
  DocumentLineDocumentType,
  ExchangedDocumentContextType,
  ExchangedDocumentType,
  HeaderTradeAgreementType,
  HeaderTradeDeliveryType,
  HeaderTradeSettlementType,
  IDType,
  LineTradeAgreementType,
  LineTradeDeliveryType,
  LineTradeSettlementType,
  PaymentMeansCodeType,
  PercentType,
  QuantityType,
  SupplyChainEventType,
  SupplyChainTradeLineItemType,
  SupplyChainTradeTransactionType,
  TaxCategoryCodeType,
  TaxRegistrationType,
  TaxTypeCodeType,
  TextType,
  TradeAddressType,
  TradePartyType,
  TradePaymentTermsType,
  TradePriceType,
  TradeProductType,
  TradeSettlementHeaderMonetarySummationType,
  TradeSettlementLineMonetarySummationType,
  TradeSettlementPaymentMeansType,
  TradeTaxType,
} from '@stafyniaksacha/facturx/models'
import { check, extract, generate, invoiceToXml } from '@stafyniaksacha/facturx'
import { PDFDocument } from 'pdf-lib'
import type { VerifiedInvoice } from '@app/invoice-core'

const EN16931_GUIDELINE = 'urn:cen.eu:en16931:2017'
const minorToAmount = (minor: number, currencyID: string) =>
  new AmountType({ value: minor / 100, currencyID })
const invoiceDate = (value: string) => value.replaceAll('-', '')

function party(
  partyData: VerifiedInvoice['buyer'] & { vatId?: string | undefined },
) {
  return new TradePartyType({
    name: new TextType({ value: partyData.name }),
    postalTradeAddress: new TradeAddressType({
      lineOne: new TextType({ value: partyData.street }),
      postcodeCode: new TextType({ value: partyData.postalCode }),
      cityName: new TextType({ value: partyData.city }),
      countryID: new CountryIDType({ value: partyData.countryCode }),
    }),
    ...(partyData.vatId
      ? {
          specifiedTaxRegistration: [
            new TaxRegistrationType({
              id: new IDType({ value: partyData.vatId, schemeID: 'VA' }),
            }),
          ],
        }
      : {}),
  })
}

function toFacturxInvoice(invoice: VerifiedInvoice): CrossIndustryInvoiceType {
  const currency = invoice.currency
  const vat = (
    category: 'S' | 'Z',
    rateBasisPoints: number,
    taxableAmountMinor: number,
    taxAmountMinor?: number,
  ) =>
    new TradeTaxType({
      ...(taxAmountMinor === undefined
        ? {}
        : { calculatedAmount: minorToAmount(taxAmountMinor, currency) }),
      basisAmount: minorToAmount(taxableAmountMinor, currency),
      categoryCode: new TaxCategoryCodeType({ value: category }),
      typeCode: new TaxTypeCodeType({ value: 'VAT' }),
      rateApplicablePercent: new PercentType({ value: rateBasisPoints / 100 }),
    })

  return new CrossIndustryInvoiceType({
    exchangedDocumentContext: new ExchangedDocumentContextType({
      guidelineSpecifiedDocumentContextParameter:
        new DocumentContextParameterType({
          id: new IDType({ value: EN16931_GUIDELINE }),
        }),
    }),
    exchangedDocument: new ExchangedDocumentType({
      id: new IDType({ value: invoice.number }),
      typeCode: new DocumentCodeType({ value: '380' }),
      issueDateTime: new DateTimeType({
        dateTimeString: invoiceDate(invoice.issueDate),
        format: '102',
      }),
    }),
    supplyChainTradeTransaction: new SupplyChainTradeTransactionType({
      includedSupplyChainTradeLineItem: invoice.lines.map(
        (line, index) =>
          new SupplyChainTradeLineItemType({
            associatedDocumentLineDocument: new DocumentLineDocumentType({
              lineID: new IDType({ value: String(index + 1) }),
            }),
            specifiedTradeProduct: new TradeProductType({
              name: new TextType({ value: line.description }),
            }),
            specifiedLineTradeAgreement: new LineTradeAgreementType({
              netPriceProductTradePrice: new TradePriceType({
                chargeAmount: minorToAmount(line.unitPriceMinor, currency),
              }),
            }),
            specifiedLineTradeDelivery: new LineTradeDeliveryType({
              billedQuantity: new QuantityType({
                value: line.quantity,
                unitCode: line.unitCode,
              }),
            }),
            specifiedLineTradeSettlement: new LineTradeSettlementType({
              applicableTradeTax: [
                vat(
                  line.vatCategory,
                  line.vatRateBasisPoints,
                  line.netAmountMinor,
                ),
              ],
              specifiedTradeSettlementLineMonetarySummation:
                new TradeSettlementLineMonetarySummationType({
                  lineTotalAmount: minorToAmount(line.netAmountMinor, currency),
                }),
            }),
          }),
      ),
      applicableHeaderTradeAgreement: new HeaderTradeAgreementType({
        sellerTradeParty: party(invoice.seller),
        buyerTradeParty: party(invoice.buyer),
      }),
      applicableHeaderTradeDelivery: new HeaderTradeDeliveryType({
        actualDeliverySupplyChainEvent: new SupplyChainEventType({
          occurrenceDateTime: new DateTimeType({
            dateTimeString: invoiceDate(invoice.deliveryDate),
            format: '102',
          }),
        }),
      }),
      applicableHeaderTradeSettlement: new HeaderTradeSettlementType({
        invoiceCurrencyCode: new CurrencyCodeType({ value: currency }),
        paymentReference: new TextType({
          value: invoice.payment.reference ?? invoice.number,
        }),
        specifiedTradeSettlementPaymentMeans: [
          new TradeSettlementPaymentMeansType({
            typeCode: new PaymentMeansCodeType({ value: '58' }),
            payeePartyCreditorFinancialAccount:
              new CreditorFinancialAccountType({
                ibanID: new IDType({ value: invoice.payment.iban }),
              }),
            ...(invoice.payment.bic
              ? {
                  payeeSpecifiedCreditorFinancialInstitution:
                    new CreditorFinancialInstitutionType({
                      bicID: new IDType({ value: invoice.payment.bic }),
                    }),
                }
              : {}),
          }),
        ],
        applicableTradeTax: invoice.vatBreakdown.map((entry) =>
          vat(
            entry.vatCategory,
            entry.rateBasisPoints,
            entry.taxableAmountMinor,
            entry.taxAmountMinor,
          ),
        ),
        ...(invoice.payment.dueDate
          ? {
              specifiedTradePaymentTerms: [
                new TradePaymentTermsType({
                  dueDateDateTime: new DateTimeType({
                    dateTimeString: invoiceDate(invoice.payment.dueDate),
                    format: '102',
                  }),
                }),
              ],
            }
          : {}),
        specifiedTradeSettlementHeaderMonetarySummation:
          new TradeSettlementHeaderMonetarySummationType({
            lineTotalAmount: minorToAmount(invoice.netTotalMinor, currency),
            taxBasisTotalAmount: minorToAmount(invoice.netTotalMinor, currency),
            taxTotalAmount: [minorToAmount(invoice.taxTotalMinor, currency)],
            grandTotalAmount: minorToAmount(invoice.grossTotalMinor, currency),
            duePayableAmount: minorToAmount(invoice.grossTotalMinor, currency),
          }),
      }),
    }),
  })
}

export async function generateZugferdPdf(
  pdf: Uint8Array,
  invoice: VerifiedInvoice,
) {
  const xml = (await invoiceToXml(toFacturxInvoice(invoice))).toString()
  const validation = await validateZugferdXml(xml)
  if (!validation.valid) throw new ZugferdValidationError(validation.errors)
  const source = await PDFDocument.load(Buffer.from(pdf))
  // facturx 0.6.x rejects valid source PDFs that already have a trailer ID.
  delete source.context.trailerInfo.ID
  return generate({
    pdf: Buffer.from(await source.save()),
    xml,
    flavor: 'facturx',
    level: 'en16931',
  })
}

export class ZugferdValidationError extends Error {
  constructor(readonly errors: Array<string>) {
    super(errors.join('\n'))
    this.name = 'ZugferdValidationError'
  }
}

export async function createZugferdXml(invoice: VerifiedInvoice) {
  return (await invoiceToXml(toFacturxInvoice(invoice))).toString()
}

export async function validateZugferdXml(xml: string) {
  const result = await check({
    xml,
    flavor: 'facturx',
    level: 'en16931',
    schematron: true,
  })
  return {
    valid: result.valid && result.schematronValid !== false,
    profile: result.level,
    errors: [...result.errors, ...(result.schematronErrors ?? [])].map(String),
  }
}

export async function extractZugferdXml(pdf: Uint8Array) {
  return (await extract({ pdf: Buffer.from(pdf) })).xml
}
