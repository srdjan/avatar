import { type Avatar, AVATAR_EXPRESSIONS, createAvatarGenerator } from "@srdjan/avatar";
import { AVATAR_ASSETS } from "@srdjan/avatar/assets";
import { renderFacialRig } from "@srdjan/avatar/server";

export function describeAvatar(avatar: Avatar): string {
  switch (avatar.kind) {
    case "human-photo":
      return `photo:${avatar.src}`;
    case "human-generated":
      return `human:${
        AVATAR_EXPRESSIONS.map((expression) => avatar.expressions[expression].length).join(",")
      }`;
    case "bot":
      return `bot:${avatar.emotions.focused.length}`;
    default: {
      const exhaustive: never = avatar;
      return exhaustive;
    }
  }
}

const generator = createAvatarGenerator();
export const generatedAvatar = generator.forHuman({ picture: null, seed: "external" });
export const generatedDescription = describeAvatar(generatedAvatar);

const bot = generator.forBot("mason-steady");
if (bot.kind !== "bot") throw new TypeError("built-in bot profile returned a non-bot avatar");

export const renderedBot = renderFacialRig({
  id: "consumer",
  label: "Consumer bot",
  reaction: null,
  precedingReaction: null,
  microReaction: null,
  personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
  rigKind: "bot",
  baseSvg: bot.src,
  expressionSvg: bot.emotions.focused,
  microSvg: bot.emotions.focused,
});

export const facialRigScriptUrl = AVATAR_ASSETS.facialRigScript.url;
