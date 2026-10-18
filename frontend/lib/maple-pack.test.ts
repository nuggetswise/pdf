// D75: the Maple Retail Group purchase orders sent to Northern Foods (fixtures/maple, fictional). They prove the
// acceptance checks with one retailer; see pack-runner.ts for how a pack is run.
import { join } from "node:path";
import { definePack } from "./pack-runner";

definePack("Maple purchase orders (fixtures/maple, fictional)", join(__dirname, "..", "..", "fixtures", "maple"));
