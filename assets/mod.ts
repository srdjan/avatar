import type { RigVoiceCue } from "../types.ts";

export const AVATAR_ASSETS = {
  facialRigScript: {
    id: "facialRigScript",
    fileName: "facial-rig.js",
    mimeType: "text/javascript; charset=utf-8",
    url: new URL("./private/facial-rig.js", import.meta.url),
  },
  facialRigStyles: {
    id: "facialRigStyles",
    fileName: "facial-rig.css",
    mimeType: "text/css; charset=utf-8",
    url: new URL("./private/facial-rig.css", import.meta.url),
  },
  haha: {
    id: "haha",
    fileName: "haha.mp3",
    mimeType: "audio/mpeg",
    url: new URL("./private/audio/haha.mp3", import.meta.url),
  },
  hahaha: {
    id: "hahaha",
    fileName: "hahaha.mp3",
    mimeType: "audio/mpeg",
    url: new URL("./private/audio/hahaha.mp3", import.meta.url),
  },
  nenene: {
    id: "nenene",
    fileName: "nenene.mp3",
    mimeType: "audio/mpeg",
    url: new URL("./private/audio/nenene.mp3", import.meta.url),
  },
  opa: {
    id: "opa",
    fileName: "opa.mp3",
    mimeType: "audio/mpeg",
    url: new URL("./private/audio/opa.mp3", import.meta.url),
  },
  ufNanumu: {
    id: "ufNanumu",
    fileName: "uf-nanumu.mp3",
    mimeType: "audio/mpeg",
    url: new URL("./private/audio/uf-nanumu.mp3", import.meta.url),
  },
  silence: {
    id: "silence",
    fileName: "silence.mp3",
    mimeType: "audio/mpeg",
    url: new URL("./private/audio/silence.mp3", import.meta.url),
  },
} as const;

export type AvatarAssetId = keyof typeof AVATAR_ASSETS;
export type AvatarAssetDescriptor<Id extends AvatarAssetId = AvatarAssetId> =
  (typeof AVATAR_ASSETS)[Id];

export const AVATAR_AUDIO_ASSETS = [
  AVATAR_ASSETS.haha,
  AVATAR_ASSETS.hahaha,
  AVATAR_ASSETS.nenene,
  AVATAR_ASSETS.opa,
  AVATAR_ASSETS.ufNanumu,
  AVATAR_ASSETS.silence,
] as const;

export const DEFAULT_VOICE_PACK = {
  gasp: "opa",
  laugh: "haha",
  sigh: "ufNanumu",
  groan: "ufNanumu",
  challenge: "nenene",
  laughClimactic: "hahaha",
  silence: "silence",
} as const satisfies Readonly<
  Record<
    RigVoiceCue | "laughClimactic" | "silence",
    AvatarAssetId
  >
>;
