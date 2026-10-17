// Numbers of the WingCLIP model and of its scoring. Most come from WingDex (MIT, https://github.com/jlian/wingdex,
// src/lib/bird-id-local-adapter.ts and ml/distill/MODEL_CARD.md), where they were fitted on thousands of labelled photos;
// the rest are our own decisions, each with its reason. docs/notes/photo-engine.md has the measurements.

/** The three model files, as named in models/manifest.json (see MODEL_FILE_IDS in src/ml/runtime/modelStore.ts). */
export const WINGCLIP = {
  /** Name used in ModelProgress. */
  modelId: 'wingclip',
  /** Size of the image embedding and of every classifier row. */
  embeddingSize: 768,
  /** Rows of text_classifier_int8.bin that are species. One more row follows: the bird / not-bird probe. */
  speciesRows: 10994,
  /** The .onnx file names its weights file like this; ONNX Runtime must be handed the bytes under exactly this name. */
  externalDataName: 'wingclip_visual_int8.data',
  /** Side of the square the model sees. */
  inputSize: 224,
} as const

/** Fitted by WingDex for this checkpoint (int8 weights, resize 248): the softmax temperature and the bird probe. */
export const CALIBRATION = {
  /** Temperature of the species softmax: probability is proportional to exp(cosine / temperature). */
  temperature: 0.007435,
  probe: {
    /** P_raw = sigmoid(probe . embedding + bias), then a Platt map onto a calibrated P(bird). */
    bias: 1.7004907607405835,
    plattA: 1.248338657716024,
    plattB: 2.1821600341974303,
    /** On the calibrated scale: below this the picture is very probably not a bird. WingDex: the 0.5 % quantile of birds. */
    threshold: 0.3736373465,
  },
} as const

/**
 * Our own additions to the scoring (WingDex has an occurrence prior instead, which needs data we do not have for photos).
 */
export const SCORING = {
  /**
   * The Dex has 421 of WingCLIP's 10994 species. The score of every species outside it is lowered by this much (in units
   * of cosine / temperature) before the softmax, so a bird outside the Dex still competes: an American woodpecker, a
   * chicken or a zoo flamingo then takes most of the probability instead of being forced into the nearest Dex bird.
   * exp(6) is about 400: outside the Dex means 400 times less likely beforehand. WingDex's own absent-from-the-region
   * floor works out at 4 to 9.5 of these units. On the fixture photos 6 keeps true European birds at 0.85 and above and
   * foreign birds below 0.6 (see the notes for the whole table).
   */
  outOfDexPenalty: 6,
  /** How strongly an OccurrencePrior counts: score += strength * ln(weight / best weight). 1 is a neutral first guess. */
  priorStrength: 1,
  /**
   * Weights below this count as this (0.01), so one zero does not veto a species for good: a bird that BirdNET's location model
   * has never seen here is held back by a factor of 100 at most (4.6 units), less than the 6 units of a bird outside the Dex, so a
   * real rarity can still win. Measured with the location prior on the fixtures (docs/notes/integration.md): 0.01 keeps the
   * effect on the foreign birds (geese 0.67 to 0.09, gulls 0.39 to 0.08) while 0.03 and above gives it back (0.23, 0.16).
   */
  priorFloor: 0.01,
  /** A picture whose brightness (0 to 255) varies less than this over the crop is blank (covered lens): no bird. */
  blankSpread: 3,
  /** How many guesses go back to the screens. */
  candidateCount: 3,
} as const

/** How the pictures are made smaller before the exact Pillow resize (the browser does the first, rough step). */
export const FRAME = {
  /** Photos: scale down until the shorter side is this long (about twice the 248 the model needs), never up. */
  photoShortSide: 512,
  /** Live camera frames: smaller, because there is one every 0.7 s. */
  liveShortSide: 320,
  /** Very wide pictures (panoramas) are also held to this on the long side. */
  maxLongSide: 1536,
} as const

/** The live camera. */
export const LIVE = {
  /** At most one analysed frame per this many milliseconds. */
  minIntervalMs: 700,
  /** The analysis may use up to this share of the time; a slower model gets longer pauses than 700 ms. */
  maxDutyCycle: 0.8,
  /** Exponential average over about this many frames. */
  smoothingFrames: 5,
  /** The same species must lead for this many frames in a row ... */
  lockFrames: 3,
  /** ... with a smoothed confidence above this. */
  lockConfidence: 0.4,
  /** A lock holds until the species has lost the lead for this many frames in a row or falls below this confidence. */
  unlockFrames: 2,
  unlockConfidence: 0.25,
  /** A JPEG snapshot is scaled to at most this on the long side and saved with this quality. */
  snapshotMaxSide: 1600,
  snapshotQuality: 0.88,
} as const

/** How long the model stays in memory after the last use. The WebAssembly memory of the model is about 150 MB. */
export const IDLE_RELEASE_MS = 180_000
