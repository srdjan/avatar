import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  controlCommand,
  facialRigScriptUrl,
  generatedAvatar,
  generatedDescription,
  renderedBot,
} from "./consumer.ts";

Deno.test("linked external consumer uses only public bare entry points", async () => {
  assertEquals(generatedAvatar.kind, "human-generated");
  assert(generatedDescription.startsWith("human:"));
  assert(renderedBot.includes('data-rig-kind="bot"'));
  assert(renderedBot.includes('data-control-layer="smile"'));
  assertEquals(controlCommand.preset, "smile");
  assert((await Deno.readFile(facialRigScriptUrl)).byteLength > 0);
});
