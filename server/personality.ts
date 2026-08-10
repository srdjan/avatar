import type { RigBotEmotion, RigExpression } from "../types.ts";

// Maps the generic expression vocabulary to the six DiceBear bot variants.
// Surprise and fear share the wide-eyed dizzy face; neutral uses focused.
const BOT_EMOTION_BY_EXPRESSION = {
  neutral: "focused",
  focused: "focused",
  happiness: "happy",
  sadness: "sad",
  anger: "angry",
  fear: "dizzy",
  surprise: "dizzy",
} as const satisfies Readonly<Record<RigExpression, RigBotEmotion>>;

export function expressionVariantForBot(expression: RigExpression): RigBotEmotion {
  return BOT_EMOTION_BY_EXPRESSION[expression];
}
