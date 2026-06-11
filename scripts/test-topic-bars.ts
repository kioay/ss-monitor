import assert from "node:assert/strict";
import { topicBarWidthPercent } from "../src/topicBars";

assert.equal(topicBarWidthPercent(172, 172), 100);
assert.equal(topicBarWidthPercent(90, 172), 52.3);
assert.equal(topicBarWidthPercent(23, 172), 13.4);

assert.ok(topicBarWidthPercent(155, 172) < 100);
assert.ok(topicBarWidthPercent(23, 172) < topicBarWidthPercent(90, 172));
assert.equal(topicBarWidthPercent(1, 172), 6);
assert.equal(topicBarWidthPercent(0, 172), 0);
assert.equal(topicBarWidthPercent(10, 0), 0);
