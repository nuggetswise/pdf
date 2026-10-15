# EDI mapping: purchase order PDF to EANCOM ORDRSP, DESADV and INVOIC

Status: **provisional**. Written 2026-10-15 for decision D47. The mapping is built from the fictional fixture POs in `fixtures/` because no real long-tail purchase order PDFs were available. It should be checked again against two or three real POs and against the target retailer's own message implementation guides (MIGs) before any real partner is connected.

Nothing in this document or in the app sends anything to a real retailer or ERP. Every identifier in the bundled samples uses GS1 prefix 952, which GS1 reserves for demonstrations and examples, so it cannot collide with a real company.

## How the sources were read

The cloud environment that built this could not open gs1.org, edi.mediamarktsaturn.com or the other guide hosts directly (the network policy refused them). Every source below was seen only through web search result summaries, which quote parts of the documents. Where a rule rests on such a quote it is marked **sourced**. Where it follows from the EDIFACT standard, from arithmetic, or from common practice but was not seen written down, it is marked **inferred**. Every inferred row is a question to put to the retailer's EDI team.

| Id in code | Document |
|---|---|
| gs1_desadv_s4 | [GS1 EANCOM 2002 S4 Part II, DESADV examples](https://www.gs1.org/sites/gs1/files/docs/eancom/ean02s4/part2/desadv/examples.htm) |
| gs1de_desadv_unh | [GS1 Germany eDESADV segment layout, UNH](https://www.publikationen.gs1-germany.de/Complete/eEurope_english/desadv/english/all/h51.htm) |
| gs1de_desadv_examples | [GS1 Germany EANCOM 2002 S3 DESADV examples](https://www.publikationen.gs1-germany.de/Complete/ae_schuhe/english/messages/desadv/bsp3.htm) |
| sap_desadv_d01b | [SAP Business Network EANCOM DESADV D01B guide](https://help.sap.com/doc/sap-business-network-eancom-desadv-d01b-inbound/cloud/en-US/SAP%20Business%20Network%20EANCOM%20DESADV%20D01B%20Inbound.pdf) |
| gs1at_pharma_desadv | [GS1 Austria PHARMA DESADV EANCOM 2002](https://www.gs1.at/sites/default/files/2020-05/PHARMA_DESADV_EANCOM_2002_1_3_EN.PDF) |
| gs1_ordrsp_s4 | [GS1 EANCOM 2002 S4 Part II, ORDRSP examples](https://www.gs1.org/sites/gs1/files/docs/eancom/ean02s4/part2/ordrsp/examples.htm) |
| gs1_invoic_s3_moa | [GS1 INVOIC (EAN011) S3, segment MOA](https://edi.gs1si.org/eancom/ean02s3/part2/invoic/0515.htm) |
| gs1_invoic_s3 | [GS1 EANCOM 2002 S3 INVOIC, Edition 2016](https://www.gs1.org/sites/default/files/docs/eancom/s3/invoic.pdf) |
| gs1_invoic_s3_examples | [GS1 EANCOM 2002 S3 INVOIC examples](https://www.gs1.org/sites/default/files/docs/eancom/ean02s3/part2/invoic/examples.htm) |
| gs1de_invoic_media | [GS1 Germany EDI recommendations v9.3, INVOIC](https://www.publikationen.gs1-germany.de/Complete/eancom_v9.3/profiles/ae/media/invoic/de/html/..%5C..%5Cen%5Cinvoic-ae-media-en.pdf) |
| sap_invoic_d01b | [SAP Business Network EANCOM INVOIC D01B guide](https://help.sap.com/doc/sap-business-network-eancom-invoic-d01b-inbound/cloud/en-US/SAP%20Business%20Network%20EANCOM%20INVOIC%20D01B%20Inbound.pdf) |
| gs1at_fashion_invoic | [GS1 Austria FASHION INVOIC EANCOM 2002](https://www.gs1.at/sites/default/files/2020-05/FASHION_INVOIC_Einzelrechnung_EANCOM_2002_1_1_EN.pdf) |
| mms_invoic | [MediaMarktSaturn INVOIC guideline 3.3](https://edi.mediamarktsaturn.com/files/MMS_EDI-INVOIC-GUIDELINES_3.3.pdf) |
| mms_desadv | [MediaMarktSaturn DESADV guideline 2.5](https://edi.mediamarktsaturn.com/files/MMS_EDI_DESADV_GUIDELINE.pdf) |
| gs1_prefixes | [GS1 prefix list](https://www.gs1.org/prefixes) |

The same list lives in `frontend/lib/domain/compliance.ts` (`SOURCES`), and the screen links each finding to its sources.

## Why MediaMarktSaturn, and how far it goes

The ask was one real retailer. MediaMarktSaturn (MMS) is the only large retailer found that publishes its EANCOM INVOIC and DESADV guides openly, and both use directory D.01B, which matches the EANCOM 2002 baseline. The app therefore has three compliance profiles:

| Profile | Used for | What it adds |
|---|---|---|
| `eancom2002` | Any customer added from a real PO (default) | The GS1 EANCOM 2002 baseline rules below |
| `mediamarktsaturn` | Chosen in EDI setup | Baseline plus RFF+VA for buyer and supplier and RFF+CT on the invoice, both from the MMS INVOIC guide 3.3 |
| `fictional_demo` | Only the bundled fictional customers | Baseline, but ITEM-GTIN is a warning, because the demo catalogue uses made-up item numbers such as DEMO-GTIN-A01 |

What is not covered from the MMS guides: the full rule set (only the parts quoted in search summaries were seen), the MMS statement that it does not yet accept SSCC-18 for break-bulk cross-dock deliveries (MGL), and its requirement that the delivery note number equals the invoice number in some flows. The profile is named "public guides, partial" on screen for that reason.

## Envelope (all three messages)

| Segment | Value | Comes from | Basis |
|---|---|---|---|
| UNA | `:+.? '` | Fixed | Standard EDIFACT service string advice |
| UNB S001 | `UNOC:3` | Fixed | Inferred: EANCOM 2002 commonly uses UNOC (Latin-1); confirm with retailer |
| UNB S002/S003 | Supplier GLN `:14`, buyer GLN `:14` | EDI setup (supplier GLN, buyer GLN for this customer) | Inferred: GLN with code 14 is the EANCOM convention; the retailer may require a different interchange ID |
| UNB S004 | Document date `YYMMDD:HHMM` | Record creation time | Standard |
| UNB 0020 / UNZ | Document number (max 14 chars) | Portal record number | Standard; uniqueness across the supplier's interchanges is assumed, not enforced across browser sessions |
| UNH | `ORDRSP:D:01B:UN:EAN009`, `DESADV:D:01B:UN:EAN007`, `INVOIC:D:01B:UN:EAN011` | Fixed | Sourced: gs1_ordrsp_s4, gs1de_desadv_unh, gs1_desadv_s4, gs1_invoic_s3_moa, mms_desadv |
| UNT | Segment count UNH..UNT, `1` | Computed | Standard |

## ORDRSP (order response)

Sent automatically when the order reaches the ERP simulator. If the compliance check blocks it (for example no GLNs yet), it is **held**, not sent, and the EDI tab offers "Check again and send" after setup is fixed.

| Segment | Value | PO / app source | Basis |
|---|---|---|---|
| BGM | `231` + ORDRSP number + `9` | Portal number | Inferred: 231 = order response and 9 = original; GS1 examples also use function 29 (accepted without amendment), which the retailer may prefer |
| DTM+137 | Response date CCYYMMDD:102 | Creation time | Inferred |
| RFF+ON | PO number | `po_number` extracted from the PDF | Sourced (gs1_desadv_s4 for RFF+ON usage) |
| RFF+VN | ERP order number | ERP simulator | Inferred |
| NAD+BY / SU / DP | GLNs with `::9` | EDI setup; DP from the GLN entered for the printed ship-to code | Sourced (gs1_desadv_s4) |
| LIN | Line number, GTIN`:SRV` | `gtin` printed on the PO line | Inferred: SRV = GS1 GTIN; a bare LIN when no GTIN is printed |
| PIA+1 `SA::91` | Supplier article number | Matched catalogue SKU | Inferred |
| PIA+1 `IN::92` | Buyer's item number | `customer_item_code` printed on the PO | Inferred |
| IMD+F | Description, first 35 characters | PO line description | Inferred: cut to 35 to fit 7008 an..35 |
| QTY+21 | Confirmed quantity | PO line quantity (the order as accepted) | Inferred: partial confirmation (QTY+113/changed lines) is not modelled |
| UNS+S, CNT+2 | Line count | Computed | Standard |

ts-edifact has no ORDRSP table, so ORDRSP is checked by pydifact (syntax, counts) and the app's own rules only.

## DESADV (ASN) with pallets, cartons and SSCCs

The ASN form takes despatch date (default today), estimated delivery date (default the PO's requested delivery date when it is a valid date), units per carton per line and cartons per pallet. The packing preview shows the hierarchy before submit.

| Segment | Value | Source | Basis |
|---|---|---|---|
| BGM+351 + ASN number + 9 | Despatch advice, original | Portal number | Inferred (351 is the UNTDID code for despatch advice) |
| DTM+137 | Document date | Creation time | Inferred |
| DTM+11 | Despatch date | ASN form | Sourced (gs1de_desadv_examples) |
| DTM+17 | Estimated delivery date | ASN form, default PO requested date | Sourced (gs1de_desadv_examples) |
| RFF+ON | PO number | PDF | Sourced (gs1_desadv_s4) |
| NAD BY / SU / DP | GLNs | EDI setup | Sourced (gs1_desadv_s4) |
| CPS+1, PAC+n++201 | Consignment, n pallets | Packing | Sourced for the CPS/PAC/PCI/GIN pattern (gs1_desadv_s4, sap_desadv_d01b) |
| CPS+k+1, PAC+1++201, PCI+33E, GIN+BJ | Each pallet with its SSCC | SSCC generated from the GS1 company prefix | Sourced: PCI+33E then GIN+BJ for SSCC (sap_desadv_d01b, gs1at_pharma_desadv) |
| CPS+m+k, PAC+1++CT, PCI+33E, GIN+BJ | Each carton on pallet k with its SSCC | Same | Sourced pattern; PAC type CT is inferred |
| LIN / PIA / IMD | As ORDRSP | PO line | As ORDRSP |
| QTY+12 | Despatched quantity in this carton | ASN shipped quantity split by units per carton | Inferred: no unit qualifier, because the quantity is in the trade unit of the GTIN |
| RFF+ON:PO:line | PO number and PO line | PDF | Inferred (line-level order reference) |
| CNT+2 | LIN count | Computed | Standard |

SSCC: extension digit 0 + company prefix + serial, padded to 17 digits, plus the GS1 mod-10 check digit. The test suite checks the routine against GS1's published example 106141411234567897. Serials are a counter held in the run, so they can repeat across browser sessions; real use needs the supplier's ERP or label printer to own SSCC numbering.

## INVOIC with tax, allowances and three-way match

The invoice form shows a three-way match table (PO ordered, ASN shipped, invoiced) per line. Invoiced quantities default to the ASN; prices come from the PO. A line that does not match the ASN blocks submission. Each line has a tax rate (default from supplier setup), and allowances or charges can be added as a percentage or an amount at a given tax rate.

| Segment | Value | Source | Basis |
|---|---|---|---|
| BGM+380 + number + 9 | Commercial invoice, original | Portal number | Inferred (380 is the UNTDID code) |
| DTM+137 | Invoice date | Creation time | Inferred |
| RFF+ON | PO number | PDF | Sourced (gs1_desadv_s4 usage) |
| RFF+AAK | ASN number | The ASN this invoice bills | Inferred: the INVOICE-HEADER rule requires it so the invoice can be matched to the despatch |
| RFF+CT | EDI agreement / contract reference | EDI setup | Sourced for MMS (mms_invoic); omitted when empty on other profiles |
| NAD BY / SU / DP | GLNs | EDI setup | Sourced |
| RFF+VA after BY and SU | VAT registration numbers | EDI setup | Sourced for MMS (mms_invoic); sent whenever entered |
| CUX+2:CUR:4 | Invoice currency | PO currency | Inferred |
| ALC+A / ALC+C `+++1+DI` / `FC` | Discount allowance / freight charge | Invoice form | Sourced pattern (gs1at_fashion_invoic); only DI and FC codes offered |
| PCD+3 | Allowance percentage | Invoice form | Sourced (gs1at_fashion_invoic) |
| MOA+204 / MOA+23 | Allowance / charge amount | Computed (percent of the lines at that rate) or entered | Sourced (gs1at_fashion_invoic) |
| TAX+7 after ALC | Tax rate of the allowance or charge | Invoice form | Inferred placement |
| LIN / PIA / IMD | As ORDRSP | PO line | As ORDRSP |
| QTY+47 | Invoiced quantity | ASN shipped quantity | Sourced (gs1_invoic_s3_examples) |
| MOA+203 | Line amount before tax | Quantity × PO unit price, rounded half-up to cents | Sourced (gs1_invoic_s3_examples) |
| PRI+AAA | Net unit price | PO unit price | Sourced (gs1_invoic_s3_examples) |
| RFF+ON:PO:line | PO line reference | PDF | Inferred |
| TAX+7+TYPE+++:::rate+S/Z | Line tax rate; category Z when the rate is 0 | Invoice form | Sourced (sap_invoic_d01b); only categories S and Z are modelled |
| UNS+S, CNT+2 | Line count | Computed | Standard |
| MOA+77 | Invoice amount incl. tax | Computed | Sourced (mms_invoic, gs1_invoic_s3) |
| MOA+79 | Sum of line amounts | Computed | Sourced (gs1_invoic_s3) |
| MOA+125 | Taxable amount (lines − allowances + charges) | Computed | Sourced (gs1_invoic_s3, gs1de_invoic_media) |
| MOA+176 | Total tax | Computed | Sourced (sap_invoic_d01b) |
| TAX+7 + MOA+124 + MOA+125 per rate | Tax and taxable amount per rate, present even when zero | Computed | Sourced (gs1_invoic_s3, gs1de_invoic_media) |

Tax is computed once per rate on the taxable total for that rate, rounded half-up to cents, with the exact decimal module (no binary floats). Example from `fixtures/edi-samples/retailer-INVOIC.edi`: lines 150.00 at 19 % and 49.00 at 7 %, a 2 % discount (3.00) and 15.00 freight at 19 %, give taxable 162.00 and 49.00, tax 30.78 and 3.43, invoice amount 245.21 EUR. MOA+131 (total allowances and charges) is not sent.

## Rules that block sending

Each generated message is parsed back from its own text and checked before it may be sent. A blocking finding stops the send; the screen shows the profile, "N of M rules pass", and each finding with its basis and source links. The ASN and invoice forms run the same check live and disable submit while a rule blocks.

| Rule | Messages | Basis | What it checks |
|---|---|---|---|
| SYNTAX-COUNTS | all | inferred | UNT and UNZ counts and references match |
| HEADER-VERSION | all | sourced | UNH carries the EANCOM 2002 D.01B version for the type |
| INTERCHANGE-GLN | all | inferred | UNB sender and recipient are valid GLNs |
| BGM | all | inferred | Correct document code and a number |
| DOCUMENT-DATE | all | inferred | DTM+137 is a valid CCYYMMDD date |
| ORDER-REFERENCE | all | sourced | RFF+ON present and non-empty |
| PARTY-GLN | all | sourced | NAD BY, SU and DP each carry a valid GLN |
| ITEM-GTIN | all | inferred | Every LIN has a valid GTIN (warning on the fictional profile) |
| DESADV-DATES | DESADV | sourced | DTM+11 and DTM+17 present and valid, delivery not before despatch |
| DESADV-SSCC | DESADV | sourced | Every pallet and carton has PCI+33E and a valid, unique SSCC |
| DESADV-HIERARCHY | DESADV | inferred | Parents exist, every carton sits on a pallet, every line has a positive QTY+12 |
| INVOICE-HEADER | INVOIC | inferred | CUX currency and RFF+AAK present |
| INVOICE-LINES | INVOIC | sourced | QTY+47, PRI, MOA+203 and TAX on every line, amount = quantity × price |
| INVOICE-ALLOWANCES | INVOIC | sourced | Every ALC has an amount and tax rate; a PCD percentage matches its amount |
| INVOICE-TOTALS | INVOIC | sourced | MOA 77, 79, 125, 176 and per-rate 124/125 present and reconcile to the cent |
| MMS-VAT-IDS | INVOIC | sourced (MMS only) | RFF+VA after BY and SU |
| MMS-CONTRACT | INVOIC | sourced (MMS only) | RFF+CT present |

Data from the PDF is untrusted text: release characters `? ' + :` are escaped and control characters replaced, and a tamper test confirms the check catches an edited total.

## Independent validation

Two open-source validators that share no code with the app check the six committed samples in `fixtures/edi-samples/` (fictional demo partner and a session retailer on the MMS profile, each ORDRSP, DESADV and INVOIC).

ts-edifact 0.0.14 (TypeScript, `frontend/lib/domain/edifact-independent.test.ts`) parses each DESADV and INVOIC and builds the message tree against the UN/EDIFACT D.01B structure, segment and element tables it ships. It fails on a missing mandatory segment, a segment out of place, an unknown segment or an over-long element; four negative-control tests prove it does. It ships no ORDRSP table.

pydifact 0.2.3 (Python, `scripts/edi_syntax_check.py`) tokenises all six interchanges and checks the UNOC character set, UNB syntax identifier, UNT and UNZ counts and references, and the D.01B directory.

Neither validator knows EANCOM's subset restrictions or any retailer's rules; that layer is the app's own rule set above, which the same tests run against the retailer samples. Commands and results are in `docs/acceptance-results.md`.

## What needs a real retailer test environment

These cannot be proven here and need the retailer's EDI test system (or a VAN partner's) and their onboarding checklist:

1. The retailer's full MIGs, including codes and conditional segments this mapping does not produce (for example PIA for promotional variants, FTX, delivery note numbers, MOA+131, payment terms PAT, IBAN in FII).
2. Interchange addressing: whether the retailer uses GLN `:14` in UNB, a VAN mailbox ID, or AS2 identifiers, and the test indicator (UNB 0035).
3. Transport: AS2 certificates, SFTP or VAN connection, and acknowledgements (CONTRL, APERAK) and how rejections come back.
4. Retailer-specific rules not seen in public summaries, such as MMS not accepting SSCC-18 for break-bulk cross-dock, and the delivery-note-equals-invoice rule.
5. Real SSCC labels scanned against the DESADV at the retailer's dock, and SSCC numbering owned by the supplier's ERP so serials never repeat.
6. Tax: categories other than S and Z (exempt, reverse charge), cross-border VAT, and rounding the retailer applies (per line versus per rate).
7. ORDRSP behaviour: whether the retailer wants it at all, BGM function 9 versus 29, and partial or changed confirmations.

## Inferred mappings to confirm

Every row marked inferred above, and especially: BGM function 9 on ORDRSP; QTY without a unit qualifier; PAC type CT for cartons; RFF+AAK as the ASN reference on the invoice; TAX placement after ALC; UNOC as the character set; IMD cut at 35 characters; mixed cartons (one carton holding several items) are not produced, as each carton holds one line.

## Inputs needed from the owner

Two or three real long-tail PO PDFs (any confidential values can be redacted) and the target retailer's MIGs for ORDERS, DESADV and INVOIC, or the MMS PDFs above downloaded and uploaded to the project, since this environment could not open them.
