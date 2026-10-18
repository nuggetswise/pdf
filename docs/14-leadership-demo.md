# Leadership demo: narrative and feature inventory (D74)

Fictional data throughout. The ERP, Trading Grid delivery and the retailer's mailbox are simulated. In a live demo
the AI reads the PDFs; in tests a scripted reader does, and the screen says which.

## The claim
Suppliers who still take purchase orders by email can trade with retailers as if they were on EDI, without
retyping, and the exceptions that need a person are few, explained and owned. The retailer gets standard
documents back (855, 856, 810) and sees changes before they ship.

## Supplier story (about 7 minutes, Supplier view, Orders tab)
| Beat | What the presenter does | What the leader should take away | Status |
|---|---|---|---|
| 1. The inbox | Shows five retailer emails; forwards Maple Retail Group PO-2026-104587 | Nothing changes for the retailer; the supplier forwards an email | Runtime-tested |
| 2. Read and checked | Opens the order: PDF on the left with every value boxed, structured order on the right, lifecycle bar on top | AI reads any layout; rules check it; every value traces to the page | Runtime-tested (AI read is live only in a live demo) |
| 3. Stock is short | Approves; the ERP stock check needs a choice; picks "ship now, backorder the rest" | The promise to the retailer comes from real stock and lead time, not a guess | Runtime-tested |
| 4. The retailer is told | Points at the confirmation (855) with the backorder date; marks shipped; the ship notice (856) and invoice (810) follow | One email in, three standard documents out, no retyping | Runtime-tested; delivery simulated |
| 5. Exceptions with context | Forwards Northfield VIDEO-DEMO-001; the queue row shows the decision needed, value, delivery date and owner | A person sees only what needs judgement, with enough context to act | Runtime-tested |
| 6. The supplier's rules | Rules tab: adds a price policy for Northfield (within 10 percent, from a date, with a reason) and sets Northfield email orders to automatic | The supplier controls automation like a price rule in their accounting system; every automatic decision cites its policy | Runtime-tested |
| 7. Learning that is approved | Resolves the retired GTIN on 001 and saves it for reuse; an administrator approves; VIDEO-DEMO-002 goes through with no person | Learning is an approved, scoped rule, not model retraining | Runtime-tested in Vitest and the app-flow test |
| 8. A revised PO | Forwards VIDEO-DEMO-005 (goes straight to the ERP), then its revision; accepts it as a revision | The same ERP order is updated; no duplicate order | Runtime-tested |

## Retailer story (about 3 minutes)
Main path: the order screen's confirmation and shipment sections already show what the retailer receives. Closing
beat: switch to the Retailer view once.
| Beat | What the presenter does | Takeaway | Status |
|---|---|---|---|
| 1. Documents received | Opens the 855 with the backorder line; "Show EDI" shows the X12 | The retailer gets standard EDI from a supplier who stays on email | Runtime-tested; delivery simulated |
| 2. A change to accept | Command Center: accepts the revised delivery | Changes are agreed before they ship, not found at the dock | Runtime-tested |
| 3. Suppliers | Shows how each supplier connects and its path onto EDI | More suppliers trade electronically without an EDI project | Available; content is illustrative |

## Feature inventory
| Area | Feature | In the demo |
|---|---|---|
| Orders | Five-email inbox, forward, drop a PDF or .eml | Used |
| Orders | Filter tiles, Needs attention with context | Used |
| Order screen | Lifecycle bar and next action, source with value boxes, issue cards, decisions, structured order, ERP box | Used |
| Order screen | Stock and ship date, confirmation, ASN, invoice, compliance check | Used |
| Order screen | Reject, hold, onboard a new customer or product, email-text orders, EDI 850 upload | Available, not in the main path |
| All documents | Intake list with search and filters, what the agent did | Available (question time) |
| Command Center | Order exceptions and findings (stock short, revised delivery, ERP not confirmed, document not delivered) with owner and verification | Used for one beat |
| Sent | ERP records, stock, outbound documents with X12 | Used for one beat |
| Rules | Which orders need a person, order policies, approved rules, list of checks | Used |
| Settings | Retailer connections, ship dates and short stock, who handles what | Available |
| Settings | Presenter tools: ERP failure, rehearsal mode, clear tab | Backstage only |
| Account menu | Switch to reviewer or viewer to show permissions | Available (question time) |
| Retailer view | Documents received, Command Center | Closing beat |
| Retailer view | Suppliers | Available |
| Removed | The 18 hardcoded sample orders (D71 to D73) | Removed in D74 |

## What not to claim
No live mailbox, ERP or Trading Grid connection. Accuracy of the AI on a supplier's real documents is not measured
here; the test pack has 9 fictional emails with hand-written expected results. Policy rules cover price and minimum
quantity only. A revised PO is compared on its values; added or removed lines are not compared yet.
