// D68: the intake test pack (fixtures/test-pack, fictional); see pack-runner.ts for how a pack is run.
import { join } from "node:path";
import { definePack } from "./pack-runner";

definePack("intake test pack (fixtures/test-pack, fictional)", join(__dirname, "..", "..", "fixtures", "test-pack"));
