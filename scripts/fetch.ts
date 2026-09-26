/// Download pinned sources (scripts/common.ts) and print their paths.
///
///   node scripts/fetch.ts <name>...

import * as common from "./common.ts";

for (const name of process.argv.slice(2)) {
  if (!(name in common.SOURCES)) common.fail(`unknown source ${name}`);
  console.log(await common.fetchSource(name as common.Source));
}
