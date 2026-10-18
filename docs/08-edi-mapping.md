# EDI mapping: purchase order to X12 855, 856 and 810 (provisional)

Scope after D75: one retailer, Maple Retail Group, receives ANSI X12 004010 documents. EANCOM/EDIFACT was removed.
Nothing here has been tested with a real retailer. Every rule below is the app's own reading of the X12 standard and of
GS1 practice, so each finding is marked "inferred" on screen. A real trading-partner guide would replace these rules.

The builders are in `frontend/lib/domain/x12.ts`; the rule checks run on the finished message before anything is sent.
A message that fails a blocking rule is held with the reasons and sent only after the cause is fixed.

## Messages
| Document | Built from | Key segments |
|---|---|---|
| Order confirmation, 855 | The order as approved, plus the stock plan | `BAK*00*AK` PO number and date; `REF*VN` supplier order number; `DTM*068` ship date; `N1` buyer, supplier, ship-to with GLN; `PO1` per line with `UP` GTIN and `VN` supplier SKU; `ACK*IA` accepted, `IB` backordered, `IR` rejected, with quantity, unit and date; `CTT` |
| Ship notice, 856 | What actually ships, packed into pallets and cartons | `BSN`; `HL` loops for shipment, order, pallet, carton and item; `MAN*GM` with the SSCC; `TD5` carrier SCAC; `REF*BM` bill of lading, `REF*CN` tracking; `DTM*017` estimated delivery; `CTT` counts the `HL` loops |
| Invoice, 810 | The shipped quantities at the order's prices | `BIG` date, invoice number, PO number; `REF*PK` ship notice number; `ITD` terms; `DTM*814` due date; `IT1` per line; `SAC*A` allowance and `SAC*C` charge in cents; `TXI` tax per rate; `TDS` total in cents; `CTT` |

The envelope (`ISA`, `GS`, `ST`, `SE`, `GE`, `IEA`) is fixed width, marks test data (`T`), and takes sender and receiver GLNs from the company and connection settings. Text from a PO is cleaned of X12 separators before it is written, so it cannot start a new segment.

## Rules checked before sending
| Rule | Blocks | What it checks |
|---|---|---|
| X12-ENVELOPE | all | ISA is 106 characters; SE, GE and IEA counts and control numbers match |
| X12-PARTIES | all | Sender, receiver, buyer, supplier and ship-to carry valid GS1 GLNs (check digit) |
| X12-PO | all | The retailer's PO number is present |
| X12-ITEM-GTIN | all | Every item has a valid GTIN with the matching qualifier |
| X12-DATES | all | Dates are valid CCYYMMDD; the ship notice has a ship and an estimated delivery date |
| X12-SSCC | 856 | Every pallet and carton carries a valid SSCC |
| X12-HL-COUNT | all | CTT equals the line items, or the HL levels on the ship notice |
| X12-TOTAL | 810 | TDS equals the lines less allowances plus charges plus tax, in cents |

Unit tests (`frontend/lib/domain/compliance.test.ts`, `x12.test.ts`) hold hand-derived expectations, and `fixtures/edi-samples/maple-855.x12`, `-856.x12` and `-810.x12` let a reader see the output; `UPDATE_EDI_SAMPLES=1 npx vitest run lib/domain/x12.test.ts` rewrites them.

## What still needs a real retailer
Maple's own guide (segment qualifiers, required references, label format, ship-to codes), a certified X12 validator, real GLNs, and a test with the retailer's EDI network. None of these were available.
