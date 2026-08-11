import type { Avatar, RigControlBank } from "../types.ts";

type BotAvatar = Extract<Avatar, { kind: "bot" }>;
type GeneratedAvatar = Extract<Avatar, { kind: "human-generated" }>;
type PhotoAvatar = Extract<Avatar, { kind: "human-photo" }>;
type BotControlBank = Extract<RigControlBank, { rigKind: "bot" }>;
type GeneratedControlBank = Extract<RigControlBank, { rigKind: "human-generated" }>;

export function createRigControlBank(avatar: BotAvatar): BotControlBank;
export function createRigControlBank(avatar: GeneratedAvatar): GeneratedControlBank;
export function createRigControlBank(avatar: PhotoAvatar): null;
export function createRigControlBank(avatar: Avatar): RigControlBank | null;
export function createRigControlBank(avatar: Avatar): RigControlBank | null {
  switch (avatar.kind) {
    case "bot":
      return {
        rigKind: "bot",
        layers: {
          neutral: avatar.emotions.focused,
          focused: avatar.emotions.focused,
          smile: avatar.emotions.happy,
          sad: avatar.emotions.sad,
          worry: avatar.emotions.dizzy,
          mad: avatar.emotions.angry,
          surprised: avatar.emotions.dizzy,
          laugh: avatar.emotions.laughing,
        },
      };
    case "human-generated":
      return {
        rigKind: "human-generated",
        layers: {
          neutral: avatar.expressions.neutral,
          focused: avatar.expressions.focused,
          smile: avatar.expressions.happiness,
          sad: avatar.expressions.sadness,
          worry: avatar.expressions.fear,
          mad: avatar.expressions.anger,
          surprised: avatar.expressions.surprise,
          laugh: avatar.expressions.happiness,
        },
      };
    case "human-photo":
      return null;
  }
}
