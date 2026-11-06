/** Depth Anything V2 Small, ONNX build used by Transformers.js. fp16 file is 49.6 MB. */
export const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small';

export const GESTURE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Long side of the frame sent to the depth worker. The network still runs at its own size. */
export const INFER_LONG_SIDE = 320;

/** Particle / depth-texture columns. Rows follow the video aspect. */
export const DEPTH_COLS = 160;

export const ACTIVE_PERIOD_MS = 56;
export const IDLE_PERIOD_MS = 520;
