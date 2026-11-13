import type { VoiceId } from "../shared/voices";

// Provider side of the voice catalogue in src/shared/voices.ts. Main process
// only: the renderer never sees these ids. The generation job will use this
// to call ElevenLabs (and to add a voice to the account before first use).

export interface ProviderVoice {
  /** ElevenLabs voice id. */
  voiceId: string;
  /** Public owner id, needed to add a library voice to the account. */
  publicOwnerId: string;
}

export const PROVIDER_VOICES: Record<VoiceId, ProviderVoice> = {
  mai: {
    voiceId: "d5HVupAWCwe4e6GvMCAL",
    publicOwnerId: "dd79fd4576fc7cb0e09c5d9c8fa7bb655b955b7db4ec2c8d772fdb761b128786",
  },
  nhu: {
    voiceId: "A5w1fw5x0uXded1LDvZp",
    publicOwnerId: "05dd6769433649849769268286399b1b49ebeff356933059b790c4be0a79ad33",
  },
  hanh: {
    voiceId: "pGapy9MNHCukzJtjavF0",
    publicOwnerId: "25d870a6a44d2d507e982828fa6d18e307830574294aea48e46c45bcf38253d8",
  },
  hien: {
    voiceId: "jdlxsPOZOHdGEfcItXVu",
    publicOwnerId: "30b8e1aeea21783657f8942bf121407be71d81f5951405974707ba44e203b216",
  },
  trang: {
    voiceId: "ArosID24mP18TEiQpNhs",
    publicOwnerId: "0c0ae29d61a1d225f875b683f74926e394d167bf555e48e5dfe565e164d0206d",
  },
  ninh: {
    voiceId: "aN7cv9yXNrfIR87bDmyD",
    publicOwnerId: "8c8f87dddfccb18ce488693f863a7b1cc43968cb8befeae75e34712c0bf2b763",
  },
  son: {
    voiceId: "ObhtJZSfI8Ps4i8lwyVx",
    publicOwnerId: "ae71b306320769b7c44bda7c7b966b0d5239b9462203d2ea58463dd35bcd803d",
  },
  "tuan-anh": {
    voiceId: "YeV2u3R2gzLArVTYTis8",
    publicOwnerId: "94e0252bab58aa3c153ee616698c23287db5949f2024ff5b62e14760fca860f7",
  },
  lam: {
    voiceId: "7XOKiK112QRZRSLbCfMc",
    publicOwnerId: "0c8c9796ff9649dbb3709cf111dd9137f82d33c542d88f522e1fe83b34e5bcc0",
  },
  luong: {
    voiceId: "Vr1jwoqy1MDvyAPwDY9C",
    publicOwnerId: "0e42a381938c1cc8829d909291328d64e0da779240582871d11cc4eeebe4b2d7",
  },
};

/**
 * Direction before every line, as in the approved dialogue 03
 * (experiments/voice-auditions/dialogue-03.json): dry, close-mic, brisk.
 */
export const VOICE_DIRECTION = "[close mic, dry studio recording, no echo] [speaks quickly]";
