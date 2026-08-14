import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.14";
import {
  audioProfiles,
  climacticLaughReaction,
  declaredAssetUrls,
  declaredAudioAssetIds,
  declaredProfileSlots,
  generatedAvatar,
  generatedDescription,
  initReceipt,
  releaseControlCommand,
  renderedBot,
  renderedNullableBot,
  semanticDecisions,
  setControlCommand,
  standardLaughReaction,
  stateOnlyReaction,
} from "./consumer.ts";

Deno.test("linked external consumer executes the complete public v0.5.0 contract", async () => {
  assertEquals(generatedAvatar.kind, "human-generated");
  assert(generatedDescription.startsWith("human:"));

  assertEquals("gesture" in stateOnlyReaction, false);
  assertEquals(standardLaughReaction.qualifier, "standard");
  assertEquals(climacticLaughReaction.qualifier, "climactic");
  assertEquals(semanticDecisions.map((decision) => decision.family), [
    "Happiness",
    "Laughter",
    "Laughter",
  ]);

  assertEquals(Object.keys(audioProfiles), ["mason-steady"]);
  assertEquals(Object.keys(audioProfiles["mason-steady"]), [...declaredProfileSlots]);
  assertEquals(initReceipt, { tag: "accepted" });

  assertStringIncludes(renderedBot, 'data-rig-kind="bot"');
  assertStringIncludes(renderedBot, 'data-match-scope="match-1"');
  assertStringIncludes(renderedBot, 'data-audio-profile-id="mason-steady"');
  assertStringIncludes(renderedBot, 'data-reaction="{&quot;identity&quot;:');
  assertStringIncludes(renderedBot, 'data-preceding-reaction="{&quot;identity&quot;:');
  assertStringIncludes(renderedBot, 'data-micro-reaction="{&quot;identity&quot;:');
  assertStringIncludes(renderedBot, 'data-control-layer="smile"');
  assertStringIncludes(renderedNullableBot, 'data-reaction="null"');
  assertStringIncludes(renderedNullableBot, 'data-preceding-reaction="null"');
  assertStringIncludes(renderedNullableBot, 'data-micro-reaction="null"');

  assertEquals(setControlCommand.tag, "set");
  assertEquals(releaseControlCommand.tag, "release");
  assertEquals(declaredAudioAssetIds, ["haha", "hahaha", "nenene", "opa", "ufNanumu", "silence"]);
  for (const url of declaredAssetUrls) {
    assert((await Deno.readFile(new URL(url))).byteLength > 0);
  }

  const source = await Deno.readTextFile(new URL("./consumer.ts", import.meta.url));
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assertEquals(imports, [
    "@srdjan/avatar",
    "@srdjan/avatar/assets",
    "@srdjan/avatar/server",
  ]);
});
