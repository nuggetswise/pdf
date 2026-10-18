# Leadership demonstration: narrative, requirements check and feature inventory (D75)

Fictional data throughout (Maple Retail Group buying from Northern Foods Manufacturing). The mailbox, the ERP and
Trading Grid delivery are simulated and the screen says so. In a live session the AI reads the PDFs; in tests a
scripted reader does, and the header says "Scripted reader, not AI". The scenario is in docs/07-demo-scenario.md.

## The claim
A supplier that still takes purchase orders by email can trade with retailers as if it were on EDI, without retyping.
The few orders that need a person arrive with their reason, their context and an owner. The retailer gets standard
documents back (order confirmation, ship notice, invoice) and agrees any change before it ships.

## Supplier story (about 6 minutes, Supplier view)
| Beat | What happens on screen | Takeaway |
|---|---|---|
| 1. Orders arrive | Orders shows the order mailbox: the supplier's own address, with one sentence on how orders reach it (an auto-forward rule on the mailbox that receives retailer POs, or the retailer sends there). In the test environment, "Receive sample email" brings in the milk PO. | Nothing changes for the retailer. |
| 2. Read and checked | The order opens with the PDF beside the structured order and the lifecycle bar: Received, Read, Checked, Decision, In your ERP, Confirmed to retailer, Shipped, Invoiced. Every check passed; Review all asks for one approval. | The reader finds the values; rules check them; one click moves a clean order on. |
| 3. In your ERP, confirmed | Approve. The order is in the ERP, the stock check has promised dates, the confirmation went to Maple. Create the ship notice and the invoice from the same screen. | One email in, three standard documents out. |
| 4. An exception with context | Receive the cheese PO. Orders shows the one finding with the decision needed, value, delivery date and owner. The review shows 54.60 printed against 52.80 agreed. A person accepts the price with a reason. | A person sees only what needs judgement, and the reason is recorded. |
| 5. Stock is short | Mozzarella is 25 cases short. The order waits for a choice; "Ship now, backorder the rest" confirms to Maple with each line's dates. | The promise comes from ERP stock and lead time, not a guess. |
| 6. The record | Transactions lists every document in and out, filtered by type, retailer, status, environment, date or number. Rules shows what the checks read, synced from the ERP and read-only. | The supplier can always see what was received and sent, and what it was checked against. |
| 7. How much runs on its own | Settings: Review all or Automatic when checks pass (needs a reason; a failed check still stops the order); who handles each kind of finding; notifications. | Trust is given in steps, and the supplier controls it. |

## Retailer story (about 2 minutes, Retailer view)
| Beat | What happens on screen | Takeaway |
|---|---|---|
| 1. Documents received | Maple sees the order confirmation with the backorder line; "Show EDI" shows the X12 855. | Standard EDI from a supplier who stayed on email. |
| 2. A change to accept | Command Center: "Revised delivery awaiting retailer". Accept revision. The finding closes only when Maple answers. | Changes are agreed before they ship. |
| 3. Suppliers | One supplier and how it connects. | More suppliers can trade electronically without an EDI project. |

## Requirements register and where each is met
| # | Requirement from the owner | Met by | Checked in |
|---|---|---|---|
| 1 | One retailer (Maple), one supplier (Northern Foods), no other name in product data or screens | Reference data holds MAPLE-01 only; the intake pack and onboarding fixtures use one made-up buyer, Birchwood Test Market, as an unknown customer | `workflow.test.ts` fixture checks; screenshots 01 to 13 |
| 2 | Two Maple POs for different items; at most five orders | Milk and cheese sample emails | `maple-story.spec.ts` |
| 3 | Rules come from the ERP, synced and read-only | Rules screen has no inputs; stock edits and shipping values are not editable | `maple-story.spec.ts` (no input, select or textarea on Rules) |
| 4 | One exception per PO, no wording that blames a partner | Cheese PO has one finding; messages name the check and the decision | `workflow.test.ts`, `maple-pack.test.ts` M-02 |
| 5 | Ship notice and invoice are visible steps in the order | Lifecycle bar and the order screen | `maple-story.spec.ts` |
| 6 | Tiles and chips on Orders are clickable | Filter tiles, approval-mode chip, search | `intake.spec.ts` |
| 7 | Settings explained field by field or removed | Connections, Company, Team, Notifications, Approval mode, Who handles findings; Test controls collapsed | `maple-story.spec.ts`, screenshot 09 |
| 8 | A narrative for supplier and retailer, and what is used or not | This document | Owner walkthrough: Not run |
| 9 | No demo-world words in the product | Test environment badge and Test controls replace presenter and rehearsal wording; "forward" appears only where the mailbox explains the auto-forward rule | Text search of `frontend/app`; screenshots |
| 10 | Every visible string passes the enterprise writing review | Review done on 18 October 2026 across all screen files; findings fixed (below) | Record below |

## Feature inventory
| Area | Feature | In the main path |
|---|---|---|
| Orders | Order mailbox, sample emails (test environment), add a document by hand, filter tiles, search, Needs attention with context, Not an order and duplicates with "Treat as order", approval-mode chip | Used |
| Order review | Lifecycle bar with next action, source with value boxes, decision cards, structured order, your ERP, terms, history, how each value was read | Used |
| Order review | Stock and ship date, confirmation, ship notice with packing and labels, invoice with tax and three-way match, retailer check before sending | Used |
| Order review | Hold, reject, add an unknown retailer or item for this session, email-text orders, X12 850 upload | Available, not in the main path |
| Transactions | One list of documents in and out with filters and the full X12 | Used for one beat |
| Command Center | Findings with owner, rule, deadline source, priority basis, verification that stays pending until the outcome is seen | Used for one beat |
| Rules | ERP prices, minimums, stock, shipping values, units, ship-tos, retired codes; the 17 checks; approved corrections | Used for one beat |
| Settings | Connections, Company, Team (read-only); Notifications, Approval mode, Who handles findings; Test controls | Used for one beat |
| Retailer view | Documents received, Command Center, Suppliers | Used |
| Not built | A real mailbox, an ERP sync button, editing ERP values, credit-hold rejection, Procuros network invitations, price catalogs, order forms | Out of scope |

## Copy review (enterprise product writing), 18 October 2026
Every string in `frontend/app/*.tsx` over 18 characters was listed and read for jargon, internal names, blame and
inconsistent terms. Changed: the top banner and header (test environment, not "prototype" or "demo"), "forward" and
"Forward to agent" (now "Receive sample email" and a mailbox explanation), "Presenter tools" and "Rehearsal mode"
(Test controls, "Order reader"), "Order Agent" in screen text (the portal), "Order acknowledgement" (Order
confirmation everywhere), "ASN" in buttons and headings (ship notice; ASN stays inside Transactions detail and the
X12 name), "Submit" (Send), "Memory rule" (approved correction), "Proposed composition" and "CCIM or CCPM" in Command
Center (plain sentence), "Went through untouched" (without a person). Not changed: finding names and priority text
in `lib/domain/command-center.ts`, and the X12 mapping text shown beside raw EDI; both are accurate but technical and
need a pass with a supplier user. Not run: a review with a real supplier or retailer.

## What not to claim
No live mailbox, ERP or Trading Grid connection. AI accuracy on a supplier's real documents is not measured here:
the intake test pack has fictional emails with hand-written expected results, and the live reader was not run in this
environment. The X12 mapping is untested with a real retailer. A revised PO is compared on its values; added or
removed lines are not compared yet.
